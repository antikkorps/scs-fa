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
rate limits). Automated Postgres backups are **Story 8.4**; uptime monitoring is
**Story 8.5**. Until then, snapshot the VM from the Hetzner console before risky
changes.

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
