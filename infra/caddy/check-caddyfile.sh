#!/bin/sh
# Checks the production Caddyfile with the real Caddy image: it must validate
# with a certificate where docker-compose.prod.yml mounts the Cloudflare Origin
# Certificate, serve every site from that file, and never ask an ACME CA for
# one. Cloudflare sits in front (TLS mode Full (strict)) and answers the
# browsers; the origin only talks to Cloudflare, which trusts its Origin CA.
# Usage, from the repo root, with Docker running: `just check-caddyfile`.
# Also needs openssl and python3 (both present on macOS and Ubuntu).
set -eu

IMAGE=caddy:2-alpine
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"

failures=0
pass() { echo "  ok   $*"; }
fail() { echo "  FAIL $*"; failures=$((failures + 1)); }

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# A throwaway self-signed pair stands in for the origin certificate: validate
# loads the files, so they must exist and parse.
mkdir -p "$WORK/certs"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 \
  -subj "/CN=example.test" -keyout "$WORK/certs/origin-key.pem" \
  -out "$WORK/certs/origin.pem" >/dev/null 2>&1 ||
  { echo "openssl failed: it is needed to make a throwaway certificate"; exit 1; }

# Runs caddy with the same mounts and variables as the compose service.
caddy_run() {
  docker run --rm \
    -e DOMAIN=example.test \
    -e UMAMI_BASIC_AUTH_USER=check \
    -e UMAMI_BASIC_AUTH_HASH='$2a$14$bMDA3leTI4qJhwhZSoVxFuYo2wXc3YpGp3Bd24lImH.6ITM4o1GKe' \
    -v "$ROOT/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v "$WORK/certs:/etc/caddy/certs:ro" \
    "$IMAGE" caddy "$@" --config /etc/caddy/Caddyfile --adapter caddyfile
}

echo "Caddyfile check ($IMAGE)"

if caddy_run validate >"$WORK/validate.log" 2>&1; then
  pass "caddy validate accepts the Caddyfile"
else
  fail "caddy validate rejects the Caddyfile:"
  sed 's/^/       /' "$WORK/validate.log"
fi

caddy_run adapt >"$WORK/config.json" 2>"$WORK/adapt.log" || true

# Prints each host whose TLS connection policy selects the certificate loaded
# from origin.pem — a site without `import origin_tls` is missing from it.
hosts_on_origin_cert() {
  python3 -I -c '
import json, sys
config = json.load(open(sys.argv[1]))
loaded = config.get("apps", {}).get("tls", {}).get("certificates", {}).get("load_files", [])
tags = {tag for entry in loaded if entry.get("certificate") == "/etc/caddy/certs/origin.pem"
        for tag in entry.get("tags", [])}
for server in config.get("apps", {}).get("http", {}).get("servers", {}).values():
    for policy in server.get("tls_connection_policies", []):
        if tags & set(policy.get("certificate_selection", {}).get("any_tag", [])):
            print("\n".join(policy.get("match", {}).get("sni", [])))
' "$1" 2>/dev/null || true
}
hosts_on_origin_cert "$WORK/config.json" >"$WORK/hosts.txt"

for host in www.example.test stats.example.test example.test; do
  if grep -qx "$host" "$WORK/hosts.txt"; then
    pass "$host serves the origin certificate"
  else
    fail "$host does not serve the origin certificate (missing 'import origin_tls'?)"
  fi
done

# Without an explicit switch, Caddy falls back to ACME for any name the loaded
# certificate does not cover — a silent Let's Encrypt attempt that cannot pass
# behind Cloudflare. Certificate automation must be off, redirects kept.
if grep -q '"disable_certificates":true' "$WORK/config.json"; then
  pass "certificate automation is off (auto_https disable_certs)"
else
  fail "certificate automation is on: add 'auto_https disable_certs' to the global options"
fi

if grep -q '"acme"' "$WORK/config.json" || grep -q '"email"' "$WORK/config.json"; then
  fail "an ACME issuer is configured (Let's Encrypt cannot see the origin behind Cloudflare)"
else
  pass "no ACME issuer"
fi

# The API image copies the whole build context (COPY . .): the origin private
# key, kept in ./certs on the server, must never be part of it.
if grep -qx '/\{0,1\}certs/\{0,1\}' "$ROOT/.dockerignore"; then
  pass "certs/ is excluded from the Docker build context"
else
  fail "certs/ is not in .dockerignore: the origin private key would ship in the API image"
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
