# Deployment — Hetzner (Docker Compose)

Production runs the whole stack from `docker-compose.prod.yml` on a single
Hetzner Cloud VM: **Postgres + API + Web + Caddy** on one private Docker network.
Caddy is the only thing exposed to the internet (80/443); it terminates TLS
(Let's Encrypt) and routes everything on one public origin — so the browser
never makes a cross-origin API call.

```
internet ──443──▶ caddy ──/api/*, /health──▶ api:8080
                        └──everything else──▶ web:3000
                                                api ──▶ postgres:5432
```

> **Ops shortcuts (`just`).** The Compose operations in this guide are wrapped as
> [`just`](https://github.com/casey/just) recipes in the repo-root `justfile`, so
> go-live steps are runnable, not copy-pasted. Install with `brew install just`
> (or your distro package), then run `just` from the repo root to list them:
> `just deploy` · `just migrate` · `just seed` · `just update` · `just logs api` ·
> `just ps` · `just psql` · `just backup` · `just restore [dump]`. They complement
> the pnpm scripts (dev/build/test stay in `package.json`).

## 1. Provision the server

- **Hetzner Cloud** VM, e.g. `CPX21` (3 vCPU / 4 GB) in `nbg1`/`fsn1`, Ubuntu 24.04.
- Add your SSH key at creation. SSH in as `root`, then:

```bash
# System user + Docker
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Firewall: only SSH + HTTP + HTTPS
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Prefer Hetzner Cloud Firewall too (same three ports) as a second layer.

## 2. DNS

Point both records at the VM's public IPv4 (and AAAA for IPv6 if enabled):

| Type | Name  | Value          |
| ---- | ----- | -------------- |
| A    | `@`   | `<server IP>`  |
| A    | `www` | `<server IP>`  |

Caddy serves the canonical `www.<DOMAIN>` and 301-redirects the apex. ACME
HTTP/TLS challenges need these resolving **before** first boot, or cert issuance
fails (Caddy retries, so it self-heals once DNS propagates).

## 3. Deploy

```bash
su - deploy
git clone <gitea-repo-url> scsFirearm && cd scsFirearm
git checkout main

cp .env.prod.example .env
nano .env            # fill EVERY secret; set DOMAIN + ACME_EMAIL

# First-time schema push (creates all tables from schema.ts).
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate

# Build + start the stack.
docker compose -f docker-compose.prod.yml up -d --build

# Seed reference data + the admin user (idempotent; safe to re-run).
docker compose -f docker-compose.prod.yml exec api node_modules/.bin/tsx src/db/seed-cli.ts
```

Verify:

```bash
docker compose -f docker-compose.prod.yml ps          # all healthy
curl -fsS https://www.<DOMAIN>/health                  # API behind Caddy → ok
curl -fsSI https://<DOMAIN> | grep -i location         # apex 301 → www
```

> Tip: while DNS/setup is in flux, uncomment `acme_ca …staging…` in the
> `Caddyfile` to use Let's Encrypt **staging** and avoid hitting prod rate
> limits. Switch back (and `docker compose … restart caddy`) once it's green.

## 4. Updates

```bash
cd scsFirearm && git pull
# If schema.ts changed:
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
```

CI (Forgejo Actions) already runs lint + typecheck + tests on every PR/push to
`main`, so only green commits should reach the server.

## 5. Operations

```bash
# Logs (follow one service)
docker compose -f docker-compose.prod.yml logs -f api

# Restart / stop
docker compose -f docker-compose.prod.yml restart caddy
docker compose -f docker-compose.prod.yml down            # keeps volumes

# psql shell
docker compose -f docker-compose.prod.yml exec postgres psql -U armurier -d armurier_prod
```

**Persistent state** lives in named volumes: `postgres_data` (the database) and
`caddy_data` (TLS certs + ACME account — losing it re-issues certs and can hit
rate limits). Snapshot the VM from the Hetzner console before risky changes;
uptime monitoring is **Story 8.5**.

## 6. Backups (automated)

The `backup` service runs `pg_dump` on a cron schedule (default **03:00 UTC
daily**) and uploads a compressed custom-format dump to S3 — off-site, separate
from the VM. It reuses the app's `S3_*` credentials and keeps the newest
`BACKUP_RETENTION_COUNT` dumps (default 14), pruning older ones. Tunables live in
`.env` (`BACKUP_CRON`, `BACKUP_RETENTION_COUNT`, `BACKUP_S3_PREFIX`, optional
`BACKUP_S3_BUCKET`). It starts with the stack — no extra step.

```bash
# On-demand backup (same path the cron uses)
docker compose -f docker-compose.prod.yml run --rm backup backup.sh

# List dumps in the bucket
docker compose -f docker-compose.prod.yml run --rm backup \
  sh -c 'aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" s3 ls "s3://$S3_BUCKET/$BACKUP_S3_PREFIX/"'

# Restore — latest, or a named dump. DESTRUCTIVE (pg_restore --clean).
docker compose -f docker-compose.prod.yml run --rm backup restore.sh
docker compose -f docker-compose.prod.yml run --rm backup restore.sh armurier_prod_20260617T030000Z.dump
```

Verify scheduling and the last run in the logs: `docker compose -f
docker-compose.prod.yml logs -f backup`. **Test a restore periodically** — a
backup you've never restored is a hypothesis, not a backup.

> The dump contains customer PII. The bucket should be private with scoped
> credentials; consider enabling object-lock/versioning and, for extra
> defence-in-depth, at-rest encryption (e.g. SSE) on the backup bucket.

## 7. Migration OVH → Hetzner + Cloudflare (go-live)

The current site is hosted at **OVH**; go-live moves it to a **Hetzner** VM
(sections 1–6) with **Cloudflare** in front (CDN + WAF + DDoS). A few decisions
are still open — see `docs/CLARIFICATIONS_A_TRANCHER.md` §J — but the target
below is the recommended path.

### Pre-flight checklist (before touching DNS)

- [ ] VM provisioned + hardened (§1), Docker firewall = SSH/80/443 only.
- [ ] `.env` filled: every secret, `DOMAIN`, `ACME_EMAIL`, `S3_*`, Stripe **live**
      keys, SMTP creds. No placeholder left.
- [ ] Stack builds & boots on the VM; `migrate` ran; seed ran; `ps` all healthy.
- [ ] **Stripe live webhook** registered at `https://www.<DOMAIN>/api/...` →
      `STRIPE_WEBHOOK_SECRET` set. Test one live-mode payment.
- [ ] Backups verified: on-demand `backup.sh` produces a dump **and** a
      `restore.sh` round-trip works (a backup you've never restored is a hypothesis).
- [ ] Content parity check with the old OVH site (products, artworks, legal pages).
- [ ] `smtp` deliverability from the VM IP (or relay) confirmed — regulated-domain
      mail is easily flagged as spam.

### DNS cutover (OVH → Cloudflare)

1. **Lower the TTL** on the current OVH records to 300s a few days ahead, so the
   switch propagates fast.
2. Add the domain to **Cloudflare**, let it import existing records. **Verify MX +
   SPF + DKIM + DMARC are carried over** — moving nameservers without them breaks
   email (the API sends transactional mail via nodemailer). Where is the domain
   registered? If at OVH, change the **nameservers** to Cloudflare's at the registrar.
3. Point `A @`, `A www` (+ `AAAA` if IPv6) at the **Hetzner IP**, **proxied**
   (orange cloud).
4. Cut over during low traffic; watch `caddy` + `api` logs. Keep the OVH box up
   read-only for a rollback window, then decommission.

### Cloudflare configuration

- **TLS mode = Full (strict).** Origin needs a real cert. Recommended:
  a **Cloudflare Origin Certificate** on Caddy (15-year, CF-trusted) instead of
  Let's Encrypt — simpler than ACME behind a proxy. This swaps Caddy's automatic
  HTTPS for an explicit `tls <cert> <key>` (Caddyfile change). *Decision: Origin
  Cert vs keep LE via DNS-01 challenge — see §J.*
- **Restore the real client IP.** Behind the proxy, Caddy/Fastify otherwise see
  Cloudflare IPs — which would poison the **rate-limiter** and **audit logs**:
  - Caddy: global `servers { trusted_proxies static <cloudflare-ranges> }`.
  - Fastify: enable `trustProxy` so `req.ip` reads the forwarded client IP.
- **Lock the origin to Cloudflare.** Set the Hetzner Cloud Firewall to accept
  80/443 **only from Cloudflare IP ranges** (`https://www.cloudflare.com/ips`),
  so no one can bypass the WAF by hitting the IP directly.
- Optional: WAF managed rules, a rate-limit rule on `/api/auth/*`, cache rules for
  static assets. *Decision: move object storage to Cloudflare **R2** (S3-compatible,
  no egress) or keep the current S3 provider — see §J.*

### Security hardening at go-live (currently deferred — see BACKLOG Phase 8.6)

- [ ] **Least-privilege S3 key** scoped to the backup bucket (not the app's key).
- [ ] **Migration baseline** (Drizzle) instead of `push --force` before prod churn.
- [ ] **CSP nonces** to drop `'unsafe-inline'` on script/style (Caddyfile CSP).
- [ ] **Secret rotation** post-launch (initial secrets were shared during setup).
- [ ] Container hardening (`cap_drop`, `read_only`) validated in staging.

## Notes / gotchas

- `.env` is the single source of truth: docker-compose reads it for `${VAR}`
  interpolation (postgres/web/caddy) **and** injects it into the API via
  `env_file`. `DATABASE_URL` is set by compose to the in-network `postgres`
  host, so it is deliberately absent from `.env.prod.example`.
- The `migrate` service builds the API **build stage** (which has the full
  workspace incl. `drizzle-kit`); the runtime API image ships prod deps only.
- Postgres is **not** published to the host — reach it via
  `docker compose … exec postgres` or another service on the `internal` network.
- Stripe: register the live webhook endpoint at `https://www.<DOMAIN>/api/...`
  and put the resulting signing secret in `STRIPE_WEBHOOK_SECRET`.
