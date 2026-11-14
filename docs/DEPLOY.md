# Deployment — IONOS VPS (Docker Compose)

Production runs the whole stack from `docker-compose.prod.yml` on a single
IONOS VPS: **Postgres + API + Web + Caddy** on one private Docker network.
Cloudflare proxies every public host (CDN, WAF, DDoS) and answers the browsers;
Caddy is the only thing the VPS exposes (80/443). It serves a **Cloudflare
Origin Certificate** (TLS mode *Full (strict)*) and routes everything on one
public origin — so the browser never makes a cross-origin API call.

```
browser ──443──▶ Cloudflare ──443──▶ caddy ──/api/*, /health──▶ api:8080
                                           └──everything else──▶ web:3000
                                                                api ──▶ postgres:5432
```

> **Nothing is built with Node on the server.** No Node, no pnpm there: every
> image installs its own dependencies inside Docker. The server needs Docker
> (with the compose plugin), git and `just` — nothing else.

> **Ops shortcuts (`just`).** The Compose operations in this guide are wrapped as
> [`just`](https://github.com/casey/just) recipes in the repo-root `justfile`, so
> go-live steps are runnable, not copy-pasted. Install with `apt install just`
> (Ubuntu 24.04+) or `brew install just`, then run `just` from the repo root to list them:
> `just deploy` · `just migrate` · `just seed` · `just update` · `just logs api` ·
> `just ps` · `just psql` · `just db-roles` · `just backup` · `just restore <key> [dump]`. They complement
> the pnpm scripts (dev/build/test stay in `package.json`).

## 1. Prepare the server

The VPS (Ubuntu) is already hardened (2026-11-14): SSH by key only, password
logins refused, ufw, fail2ban. Check that no drop-in file re-enables passwords
— Ubuntu cloud images ship `/etc/ssh/sshd_config.d/50-cloud-init.conf`, which
wins over `sshd_config`:

```bash
sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin)'
# expected: passwordauthentication no · kbdinteractiveauthentication no · permitrootlogin no (or prohibit-password)
```

**Two accounts, two roles** (set up 2026-11-14):

| Account | Role | Groups |
|---|---|---|
| `franck` | the human admin: system updates, firewall, journald, the IONOS console (§ 1.1) | `sudo` |
| `deploy` | the application: owns the repo, `.env` and `certs/`, runs `docker compose` / `just` | `docker`, `systemd-journal` — **no sudo** |

The `docker` group is root-equivalent, so the split keeps things tidy and
prevents slips rather than containing an attacker; it also lets someone else be
given `deploy` one day without the admin account. Anything needing root goes
through `franck`. Both accounts have a password (Bitwarden): `sudo` asks for
`franck`'s, the console accepts either; SSH refuses both.

As `franck`:

```bash
sudo adduser --gecos "" deploy        # strong password, in Bitwarden
sudo apt install -y git just          # Ubuntu 24.04+; Docker: below
curl -fsSL https://get.docker.com | sudo sh   # skip if `dpkg -l docker-ce` already lists it
sudo usermod -aG docker deploy

# deploy logs in with the same keys as franck (§ 1.1 adds the emergency one)
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo cp ~/.ssh/authorized_keys /home/deploy/.ssh/
sudo chown deploy: /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys

# The app lives in /srv (FHS: data served by this system), readable by deploy only.
sudo install -d -m 750 -o deploy -g deploy /srv/scs-firearm
```

Docker's ubuntu packages pull a kernel update now and then: `needrestart`
says so after `apt`; reboot (`sudo reboot`) while nothing runs yet. Check
`deploy` with `ssh deploy@<server> 'id; docker ps'`: groups without `sudo`,
an empty container list.

**Firewall.** ufw keeps SSH + 80 + 443. ⚠️ Docker publishes its ports through
its own iptables rules, **ahead of ufw**: a ufw rule cannot restrict who reaches
80/443. Restrictions on those ports belong to the **IONOS firewall policy**
(Cloud Panel › Network › Firewall Policies), which filters before the VPS:
SSH (22), 80 and 443 over TCP only — and, once Cloudflare is in front, 80/443
only from the Cloudflare ranges (§ 7, *Lock the origin*). Compose also publishes
443/udp (HTTP/3); Cloudflare reaches the origin over TCP, so leaving UDP closed
in the policy is intended.

**Read access to the repo — a deploy key.** The server clones from Forgejo
with its own key, read-only, scoped to this repo (never a personal key):

```bash
# as deploy
ssh-keygen -t ed25519 -f ~/.ssh/forgejo_deploy -N "" -C "scs-prod deploy key"
cat >> ~/.ssh/config <<'CFG'
Host git.fvienot.link
  IdentityFile ~/.ssh/forgejo_deploy
  IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config
cat ~/.ssh/forgejo_deploy.pub
```

Add the public key in Forgejo: repository › Settings › Deploy keys, **without**
write access. A compromised server can then read the code, not change it.
Test with `ssh -T git@git.fvienot.link`, and compare the host fingerprint it
asks you to accept with the one a trusted machine already knows
(`ssh-keygen -F git.fvienot.link -l`) — it was
`SHA256:wW0jQPmuLdjgWZjD+me3izyyKik8jAiUSoiMZ4RnYvI` on 2026-11-14.

Once the repo is cloned (§3), install the log retention: § 5 › Logs.

### 1.1 Emergency access — when the Mac is gone

The everyday key lives on Franck's Mac. Losing the Mac must not mean losing the
server, so two independent ways in are set up **and tested** before go-live:

1. **A second SSH key in Bitwarden** (done 2026-11-14, item `scs-prod
   secours`). An *SSH key* item, generated by the vault (Ed25519; the web vault
   does it too), its public key appended to `~/.ssh/authorized_keys` of
   **both** `franck` and `deploy`. The key exists only in the vault: never keep
   a copy on the Mac, or one failure takes both. To use it from any computer
   (and to test it — with `IdentitiesOnly`, else the everyday key answers):

   ```bash
   nano /tmp/secours && chmod 600 /tmp/secours    # paste the private key from the vault
   ssh -i /tmp/secours -o IdentitiesOnly=yes franck@<server>
   rm -P /tmp/secours                             # shred -u on Linux
   ```

   With the Bitwarden **desktop** app, its SSH agent serves the key without
   any file. Optional third key: the YubiKey, as a resident FIDO2 key
   (`ssh-keygen -t ed25519-sk -O resident -O verify-required`), recoverable on
   any computer with `ssh-keygen -K`.
2. **The IONOS remote console** (Cloud Panel › the server › Actions › remote
   console / KVM). It needs no SSH and no network on the VPS, but it asks for a
   **local password**: log in as `franck` (password in Bitwarden; the
   console keyboard is often QWERTY). SSH
   still refuses passwords; only the console accepts it. Last resort: IONOS's
   recovery/rescue system boots the VPS from another image to fix a broken disk
   or reset a password.

Around them:

- **2FA on the IONOS, Cloudflare and Forgejo accounts**, recovery codes in
  Bitwarden — the console is only as safe as the IONOS login.
- **Off-server, off-Mac copies in Bitwarden**: the production `.env`, the age
  identity and `BACKUP_OBJECTS_PASSWORD` (§ 6), the origin certificate's key
  (§ 2 — it can also be revoked and re-issued). The client holds a second copy
  of the backup keys.
- **Test it once**: log in from another device with the Bitwarden key, and
  through the IONOS console with the password. An access never tried is a hope.

## 2. DNS and TLS — Cloudflare from the first boot

The origin certificate is trusted by Cloudflare only, so the site is reached
**through Cloudflare** from the start, never on the bare IP. The domain
`scs-firearms.com` is registered at **OVH** (renewal due 2027-02-05: keep
auto-renew on, account in the client's name); its current site is an empty
shell, nothing to migrate.

1. **Add the zone to Cloudflare** (free plan) with the client's account. Drop
   the imported records that point at the old OVH hosting (`145.239.37.162`)
   and create, all **proxied** (orange cloud):

   | Type | Name    | Value         |
   | ---- | ------- | ------------- |
   | A    | `@`     | `<server IP>` |
   | A    | `www`   | `<server IP>` |
   | A    | `stats` | `<server IP>` |

   (+ `AAAA` if the VPS has IPv6.) Keep the TXT records; the e-mail ones (SPF,
   DKIM, DMARC for Brevo) are set up with Brevo — the domain has no MX today.
2. **Switch the nameservers** at OVH (Domain › DNS servers) to the two
   Cloudflare gives. Propagation: minutes to a few hours.
3. **SSL/TLS** in Cloudflare: mode **Full (strict)**, *Always Use HTTPS* on,
   minimum TLS 1.2.
4. **Origin certificate**: SSL/TLS › Origin Server › *Create certificate*,
   hostnames `scs-firearms.com` and `*.scs-firearms.com`, validity 15 years,
   PEM. The key is shown **once**: save both blocks in Bitwarden right away.
   They go onto the server after the clone (§ 3). `just check-caddyfile` (dev
   machine) checks the Caddyfile serves them and never falls back to ACME.

**Safety Case Solutions is not affected.** It lives on the same OVH hosting but
under its own domain, registered and served by IONOS DNS (MX included): moving
`scs-firearms.com` to Cloudflare does not touch it. Do **not** cancel the OVH
hosting while that site is on it.

## 3. Deploy

```bash
# as deploy — /srv/scs-firearm exists and belongs to deploy (§ 1)
git clone git@git.fvienot.link:antikkorps/scs-firearms.git /srv/scs-firearm
cd /srv/scs-firearm

# The origin certificate from § 2 (ignored by git and by the Docker build
# context; Caddy mounts the folder read-only and refuses to start without it).
mkdir -p certs && chmod 700 certs
nano certs/origin.pem       # the certificate
nano certs/origin-key.pem   # the private key
chmod 600 certs/origin-key.pem

cp .env.prod.example .env
nano .env            # fill EVERY secret; set DOMAIN
                     # BACKUP_AGE_RECIPIENT: § 6 (the key pair is made off the server)

# Least-privilege database roles (§ Database roles below), then the schema.
docker compose -f docker-compose.prod.yml --profile db-roles run --rm db-roles
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate

# Build + start the stack.
docker compose -f docker-compose.prod.yml up -d --build

# Seed reference data (idempotent; safe to re-run). No demo content: `--demo`
# (just seed-demo) is for demo servers only. No admin either: they are invited.
docker compose -f docker-compose.prod.yml exec api node_modules/.bin/tsx src/db/seed-cli.ts

# Invite each admin (decision 2026-11-04): an account without a password and a
# single-use link, valid 72 h, to choose one — e-mailed and printed. Pass the
# printed link another way (Signal, phone) if the e-mail does not arrive.
just admin-invite fred@scs-firearms.com Fred Martin
just admin-invite steph@scs-firearms.com Stéphane Durand
```

Afterwards, admins invite their helpers (full admins) and take an access back
from the back-office, *Administrateurs* — each change asks their password and
code. The command stays for the first admin and for when no admin can log in.

Verify:

```bash
docker compose -f docker-compose.prod.yml ps          # all healthy
curl -fsS https://www.<DOMAIN>/health                  # API behind Caddy → ok
curl -fsSI https://<DOMAIN> | grep -i location         # apex 301 → www
```

### Database roles

The Postgres superuser (`POSTGRES_USER`) is for administration only (story
12.9f, `infra/postgres/roles.sql`). Each service has its own role:

| Role | Used by | May |
|---|---|---|
| `scs_owner` | `migrate` (and `just restore`) | own the schema: DDL |
| `scs_app` | the API | read and write rows; no DDL, no `TRUNCATE`, nothing in the `drizzle` schema |
| `scs_backup` | the `backup` service | read everything (`pg_read_all_data`), write nothing |

No other role (Umami's included) may connect to the shop's database. In
production the API **refuses to start** as a superuser, a table owner or a role
that may create objects: point `DATABASE_URL` at `scs_app` (compose does).

`just db-roles` creates the roles and (re)applies their passwords and grants;
re-run it after changing a `DB_*_PASSWORD`, then restart the services that use
it. It is safe to re-run, and hands objects the superuser created earlier over
to `scs_owner`. `just check-db-roles` (dev machine, Docker) checks the script
against a throwaway Postgres with the real migrations.

> Caddy refuses to start without `certs/origin.pem` and `certs/origin-key.pem`
> (§ 2). A `526 Invalid SSL certificate` from Cloudflare means the origin did not
> present a certificate Cloudflare trusts for that hostname: `certs/` missing or
> holding something else, or a hostname the certificate does not cover.

## 4. Updates

```bash
cd /srv/scs-firearm && git pull
# If schema.ts changed:
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
```

CI (Forgejo Actions) already runs lint + typecheck + tests on every PR/push to
`main`, so only green commits should reach the server.

## 5. Operations

```bash
# Logs (follow one service) — searching them: § Logs below
docker compose -f docker-compose.prod.yml logs -f api

# Restart / stop
docker compose -f docker-compose.prod.yml restart caddy
docker compose -f docker-compose.prod.yml down            # keeps volumes

# psql shell
docker compose -f docker-compose.prod.yml exec postgres psql -U armurier -d armurier_prod
```

**Persistent state** lives in named volumes: `postgres_data` (the database) and
`caddy_data` (Caddy's own state; the TLS certificate is the file in `certs/`).
Snapshot the VPS from the IONOS Cloud Panel before risky changes;
uptime monitoring is **Story 8.5**.

### Logs (story 12.7a)

Every container logs to the host's **journald** (`logging: *logging` in
`docker-compose.prod.yml`), so the logs survive a deploy that recreates the
containers. They are kept **14 days**, under a 2 GB cap, then deleted: that is
the retention in the privacy policy and the RGPD register. One-time setup, as
`franck`:

```bash
sudo install -d /etc/systemd/journald.conf.d
sudo cp /srv/scs-firearm/infra/journald/scs-firearm.conf /etc/systemd/journald.conf.d/
sudo systemctl restart systemd-journald
sudo usermod -aG systemd-journal deploy   # lets `deploy` read the journal without sudo
journalctl --disk-usage                   # check it took
```

Each line is tagged with its container name (`scs-firearm-api-1`,
`scs-firearm-web-1`, …); the API writes one JSON object per line, carrying the
request id (`reqId`), and the order id (`orderId`) on payment, Henrri and parcel
lines. Searching:

```bash
just journal <text>                     # API, last 14 days: a reqId, an orderId, an e-mail…
just journal <text> scs-firearm-web-1   # another container
journalctl -t scs-firearm-api-1 -p warning --since today   # today's warnings and errors
journalctl -t scs-firearm-api-1 -f                         # follow live
```

The admin shows a short order reference (`0B7D1F3E`, the first 8 characters of
the id): `just journal 0b7d1f3e` finds its lines too, as a lowercase pattern
matches regardless of case.

## 6. Backups (automated)

The `backup` service runs two daily jobs (story 8.4, hardened in 12.9f). Both
write under `backups/` in the app's bucket (`BACKUP_S3_BUCKET` moves them to
another one):

- **03:00 UTC — database.** `pg_dump` as `scs_backup`, piped into
  [age](https://age-encryption.org) and uploaded as
  `backups/postgres/<db>_<timestamp>.dump.age`. The newest
  `BACKUP_RETENTION_COUNT` dumps (default 14) are kept.
- **03:15 UTC — objects** (identity documents, images). `rclone sync`
  copies the bucket, encrypted (names and content), into
  `backups/objects/current/`. What a run sees deleted or overwritten moves to
  `backups/objects/deleted/<YYYY-MM-DD>/`, kept `BACKUP_OBJECTS_RETENTION_DAYS`
  (default 30): an object purged from the shop leaves the backups that long
  after (privacy register, § Sauvegardes).

**Same bucket, same keys (Franck's choice, 2026-10-24).** The backups share the
app's bucket and credentials: whoever holds the server's S3 keys can **delete**
the backups along with the data. The encryption keeps them unreadable, not safe
from deletion. Moving them later is one variable (`BACKUP_S3_BUCKET`) plus a
second bucket and key without delete rights, with a lifecycle rule for expiry.

### Keys — made once, kept off the server

```bash
# On your own machine, not the server:
age-keygen -o scs-backup-identity.txt     # prints "Public key: age1…"
```

- `BACKUP_AGE_RECIPIENT` in `.env` = the **public** key (`age1…`).
- The **identity file** (private key) goes in the password manager / a vault,
  with a second copy held by the client. Never on the server: a compromised
  server then cannot read the dumps it wrote. **Lose it, and the dumps are
  unreadable.**
- `BACKUP_OBJECTS_PASSWORD` (`openssl rand -hex 32`) encrypts the object copy.
  It must be on the server, but keep a copy next to the identity file: a lost
  server takes `.env` with it.

### Operations

```bash
just backup                        # both jobs now (the cron's path)
just backups                       # list the encrypted dumps

# Restore the database — DESTRUCTIVE (pg_restore --clean). Copy the identity
# file to the server for the run only, then delete it.
just restore ~/scs-backup-identity.txt                                   # latest
just restore ~/scs-backup-identity.txt armurier_prod_20261024T030000Z.dump.age
shred -u ~/scs-backup-identity.txt

# Restore objects (adds and overwrites, never deletes)
just restore-objects               # the latest copy
just restore-objects 2026-10-24    # what that day's run saw deleted or overwritten
```

`just restore` runs as `scs_owner` (the backup role may not write); the
restored tables are owned by it and `scs_app` gets its grants back through the
default privileges.

Verify scheduling and the last runs in the logs: `docker compose -f
docker-compose.prod.yml logs -f backup`. **Test a restore periodically** — a
backup you've never restored is a hypothesis, not a backup. On a dev machine,
`just check-backup` runs the whole cycle (dump, restore, objects, retention)
against a throwaway Postgres and S3.

## 7. Go-live (IONOS + Cloudflare)

The old site on OVH is an empty shell: nothing to migrate, no rollback window
to keep. Sections 1–6 bring the stack up behind Cloudflare; the *launch stage*
(below) keeps the shop on its waiting page until it is opened from the
back-office, so the DNS can move early.

### Pre-flight checklist (before opening the shop)

- [ ] VPS prepared (§ 1): `sshd -T` shows no password login, IONOS firewall
      policy = SSH/80/443 only, deploy key read-only.
- [ ] **Emergency access tested** (§ 1.1): SSH from another device with the
      Bitwarden key, and a login through the IONOS console.
- [ ] Cloudflare in front (§ 2): nameservers switched, Full (strict), origin
      certificate in `certs/` (§ 3); `curl -fsS https://www.<DOMAIN>/health` answers.
- [ ] `.env` filled: every secret, `DOMAIN`, `S3_*`, Stripe **live**
      keys, SMTP creds, the real `VIREMENT_*` account. No placeholder left — the
      API refuses to start otherwise (story 12.9b): any secret still holding a
      `CHANGE-ME` / `replace-me` / `your-…` sample (Postgres, Umami and the admin
      seed included), the sample IBAN, the same value for both JWT secrets, or
      `TOTP_ENCRYPTION_KEY` (story 12.8e, `openssl rand -base64 48`) equal to the
      JWT secret. `just logs api` then names the variables to fix, never their values.
- [ ] **Each admin has their own account, invited** (`just admin-invite`, never a
      shared or provisional password) and **used the link themselves**: a link
      that answers « invalide » to its owner was used by someone else — invite
      again (the old link dies) and look at the account's journal.
- [ ] **Admins enrol their authenticator app** at their first login (mandatory,
      story 12.8e) and keep their recovery codes. Check it before opening (audit
      B5): in *Clients*, each admin account shows « Activée » under
      « Double authentification ». One who loses both is reset by
      another admin (*Comptes pro* for a pro member, or the API), or on the server:
      `docker compose exec api pnpm auth:totp-reset <email>`. Never rotate
      `TOTP_ENCRYPTION_KEY` casually: every enrolled app would have to enrol again.
- [ ] Stack builds & boots on the VM; `migrate` ran; seed ran; `ps` all healthy.
- [ ] **Launch stage** (story 12.10): a fresh database starts at the *waiting
      page*, sales closed (`ShopNotOpen`), robots told not to index. Open it from
      *Réglages* in the back-office — *Vitrine* (site visible, no sales) then
      *Ouvert* — and allow indexing only once the real catalogue is online. No
      Stripe live key before sales open.
- [ ] **Stripe live webhook** registered at `https://www.<DOMAIN>/api/webhooks/stripe`,
      subscribed to exactly these five events: `payment_intent.succeeded`,
      `payment_intent.payment_failed`, `payment_intent.canceled`,
      `refund.created`, `refund.updated` → `STRIPE_WEBHOOK_SECRET` set.
      Test one live-mode payment.
- [ ] **Brevo delivery reports** (story 12.7c): generate a token
      (`openssl rand -hex 32`) → `BREVO_WEBHOOK_SECRET` in `.env`, then register
      the transactional webhook — with the account's API key:
      ```bash
      curl -X POST https://api.brevo.com/v3/webhooks \
        -H "api-key: $BREVO_API_KEY" -H "content-type: application/json" \
        -d '{"type":"transactional","url":"https://www.<DOMAIN>/api/webhooks/brevo",
             "events":["delivered","hardBounce","blocked","spam","invalid","error"],
             "auth":{"type":"bearer","token":"<BREVO_WEBHOOK_SECRET>"}}'
      ```
      Check end to end: send a password reset to a non-existent address of a
      domain you own; the admin history (or `audit_logs`) must show
      `email.password_reset.hard_bounce` under the same `message_id` as the
      `…sent` line. If it never arrives, Brevo is not reporting our SMTP
      Message-ID: look at the webhook payload in the logs (`Brevo report for an
      e-mail we did not journal`).
- [ ] **Henrri production** API key in `.env` (`HENRRI_BASE_URL=https://api.henrri.io`,
      `HENRRI_CLIENT_ID`, `HENRRI_CLIENT_SECRET`) → `pnpm henrri:check` green. See the
      Henrri section below.
- [ ] Backups verified: `just backup` produces an encrypted dump and the object
      copy, **and** a `just restore` round-trip works with the identity file
      fetched from where it is kept (a backup you've never restored is a hypothesis).
- [ ] age identity file and `BACKUP_OBJECTS_PASSWORD` stored off the server, with
      a second copy held by the client (§ 6 Keys).
- [ ] Legal notice and privacy policy name the real host (IONOS entity on the
      contract, data-centre country): `packages/shared/src/legal-identity.ts`,
      `confidentialite.vue`, `docs/REGISTRE_TRAITEMENTS_RGPD.md`.
- [ ] `smtp` deliverability from the VM IP (or relay) confirmed — regulated-domain
      mail is easily flagged as spam.

### Cloudflare configuration

- **TLS mode = Full (strict)** with a **Cloudflare Origin Certificate** on
  Caddy (decision 2026-11-14, § 2): no ACME behind the proxy, no DNS API token
  on the server. Certificate automation is off in the `Caddyfile`
  (`auto_https disable_certs`); `just check-caddyfile` guards it.
- **Real client IP — done in story 9.6, keep it that way.** Behind the proxy,
  Caddy/Fastify would otherwise see Cloudflare IPs — which would poison the
  **rate-limiter**, **audit logs** and **newsletter consent proofs**:
  - Caddy (`Caddyfile`, global `servers`): `trusted_proxies static <cloudflare-ranges>`
    + `client_ip_headers CF-Connecting-IP`, and each `reverse_proxy` **overwrites**
    `X-Forwarded-For` with `{client_ip}`. Re-check the ranges against
    <https://www.cloudflare.com/ips> once a year.
  - Fastify trusts **one hop, and only a private one** (`src/net/client-ip.ts`) —
    never `trustProxy: true`, whose left-most `X-Forwarded-For` entry is written
    by the client and makes the rate limiter trivially bypassable.
  - The Nuxt server calls the API **over the private network**
    (`NUXT_API_INTERNAL_BASE`) with the visitor's IP and `INTERNAL_API_SECRET`.
    Without it, every server-rendered page shares one rate-limit budget: a
    crawler exhausts it and the catalogue starts answering errors.
  - ⚠️ Nuxt trusts `X-Forwarded-For` unconditionally. That is sound only because
    `web` publishes no port — Caddy is its sole client. Never publish it.
- **Lock the origin to Cloudflare.** In the IONOS firewall policy, accept
  80/443 **only from the Cloudflare IP ranges** (`https://www.cloudflare.com/ips`),
  so no one can bypass the WAF by hitting the IP directly. Not with ufw: Docker's
  published ports bypass it (§ 1). If the policy cannot hold the ~22 ranges,
  the alternative is Cloudflare *Authenticated Origin Pulls* (Caddy then demands
  Cloudflare's client certificate) — a Caddyfile change, not done yet.
- Optional: WAF managed rules, a rate-limit rule on `/api/auth/*`, cache rules for
  static assets. Object storage stays on Scaleway (decision 2026-09-06).

### Security hardening at go-live (currently deferred — see BACKLOG Phase 8.6)

- [ ] **Least-privilege S3 key** scoped to a separate backup bucket (not the app's
      key). Declined for now (Franck, 2026-10-24: backups stay in the app's bucket,
      encrypted; § 6) — revisit if the client agrees to a second bucket.
- [x] **Migration baseline** (Drizzle) instead of `push --force` — done 2026-09-06. `just migrate` now runs `drizzle-kit migrate`, applying the committed `apps/api/drizzle/*.sql` in order and recording them, so re-running is a no-op and the deployed schema is always a known revision.
- [ ] **CSP nonces** to drop `'unsafe-inline'` on script/style (Caddyfile CSP).
- [ ] **Secret rotation** post-launch (initial secrets were shared during setup).
- [ ] Container hardening (`cap_drop`, `read_only`) validated in staging.

## Umami — audience measurement (story 9.6)

Self-hosted, in its own database on the existing Postgres. The front loads the
tracker **only after the visitor accepts** the consent banner (Franck's choice,
2026-09-24 — even though Umami is cookie-free).

One-time setup:

1. Secrets in `.env`: `UMAMI_DB_PASSWORD`, `UMAMI_APP_SECRET` (`openssl rand -hex 32`),
   and the HTTP login Caddy puts in front of the whole dashboard (story 12.9g:
   a fresh Umami answers `admin` / `umami` until step 3):
   `UMAMI_BASIC_AUTH_USER`, and `UMAMI_BASIC_AUTH_HASH` from
   `docker run --rm caddy:2-alpine caddy hash-password --plaintext '<password>'`,
   **in single quotes** in `.env` (the hash is full of `$` that compose would
   expand). Caddy refuses to start on the sample value. Give the client this
   login too; the tracker is not behind it (it goes through `www`).
2. Database and role (Umami migrates its own schema on start):
   ```sh
   docker compose -f docker-compose.prod.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "CREATE ROLE umami LOGIN PASSWORD '<UMAMI_DB_PASSWORD>';" -c "CREATE DATABASE umami OWNER umami;"
   docker compose -f docker-compose.prod.yml up -d umami
   ```
3. DNS: `stats` record (proxied), like `www`. Log in at `https://stats.<DOMAIN>`
   with `admin` / `umami` and **change the password at once**; create the
   client's own user and hand the account over to them.
4. Add the website (domain `www.<DOMAIN>`), copy its id into `UMAMI_WEBSITE_ID`,
   then `docker compose -f docker-compose.prod.yml up -d web`.

How it is wired: Caddy exposes only `/_a/script.js` and `/_a/api/send` on the
public origin (no third party sees the visit, the CSP needs no new source); the
tracker counts `www.<DOMAIN>` only. The `backup` service dumps the app database
only — analytics are not backed up (acceptable loss; add a second dump if the
client wants history preserved).

Retention: audience data is kept **25 months** (privacy policy). Umami deletes
nothing by itself, so the `backup` service runs `umami-purge.sh` daily
(`UMAMI_PURGE_CRON`, default 03:30 UTC); it skips quietly until the `umami`
database exists. On demand:
`docker compose -f docker-compose.prod.yml run --rm backup umami-purge.sh`.
The SQL (`infra/backup/umami-purge.sql`) targets Umami 3.2.0's tables: check it
when upgrading Umami.

## Search Console (story 9.6)

1. Add the property `https://www.<DOMAIN>` in Search Console **with the client's
   Google account**. Either verify by DNS (a TXT record at Cloudflare — nothing
   to deploy), or pick "HTML tag", put its `content` value in
   `GOOGLE_SITE_VERIFICATION` and `docker compose -f docker-compose.prod.yml up -d web`.
2. Submit `https://www.<DOMAIN>/sitemap.xml` (it is also declared in
   `robots.txt`). There is nothing to "ping": Google retired sitemap pings in 2023.
3. Do the same in Bing Webmaster Tools (it can import the Search Console property).
4. After go-live, run the Rich Results Test on a product, an artwork and a
   category page; the markup is produced by `app/utils/structuredData.ts`.
5. About 28 days after go-live, read **Core Web Vitals** (Search Console, or
   PageSpeed Insights' "real users" block — CrUX data). Mobile LCP is judged
   there, against 2.5 s at the 75th percentile, not on the Lighthouse lab score
   (decision 2026-10-20: the lab simulation gives ~3.0 s for a hero text real
   browsers paint in ~0.2 s). If real users miss 2.5 s, the next lever is to
   preload a single font family (BACKLOG § 9.6).

## Responsive images (story 9.6)

Every catalogue image is stored at 400/800/1400 px in AVIF and WebP. Images
uploaded before story 9.6 only have WebP; give them their AVIF once, after the
deploy (idempotent — it only fills what is missing):

```sh
docker compose -f docker-compose.prod.yml exec api node_modules/.bin/tsx src/media/backfill-avif-cli.ts
```

## Gun Art visuals (story 11.5)

- Watermark and public resolution are set through `ARTWORK_WATERMARK_*` / `ARTWORK_PUBLIC_MAX_WIDTH` in `.env` — changing the look is a config change plus a restart, no deploy of code.
- ⚠️ The watermark is SVG text rendered by sharp: the API image installs `fonts-dejavu-core` for it. If you ever rebuild the image from a different base, **check a published visual actually carries the mark** — a font-less runtime renders it empty, silently.
- Print-grade originals live under `gun-art/originals/` in the bucket and are served by **no public route**. Keep them in the backup scope: they are the only copy the workshop can print from.

## Henrri invoicing (story 12.6)

- Every fully paid order becomes a Henrri invoice, every succeeded refund a credit note, through a
  queue (`henrri_documents`). A Henrri outage never blocks a sale: documents wait and the next pass
  resumes them. Reference contract: `docs/henrri/`.
- `.env`: `HENRRI_BASE_URL` (sandbox `https://api-sandbox.henrri.io`, production
  `https://api.henrri.io`), `HENRRI_CLIENT_ID`, `HENRRI_CLIENT_SECRET`, `HENRRI_WEBHOOK_SECRET`,
  `HENRRI_SYNC_INTERVAL_MINUTES` (default 5; 0 disables the in-process pass). Without credentials,
  invoices simply wait in the queue.
- ⚠️ **Getting the API secret**: in the Henrri account, the client secret is generated **together
  with the webhook** (a callback URL is required): use
  `https://www.<DOMAIN>/api/webhooks/henrri`, copy the secret when it is shown, and do not press
  "Test": **that route does not exist yet** — the site does not use Henrri's webhooks, the URL is
  only how Henrri hands out the secret (subscribe to no event). A 401 / `invalid_client` from
  `pnpm henrri:check` means the pair is wrong.
- Henrri allows about **100 API calls an hour** (one invoice ≈ 10–20 calls). A pass stops at the
  first refusal, slowness or outage and resumes on the next one; a backlog drains over a few hours,
  never by hammering Henrri. Each call gives up after 30 s.
- Checks, from `apps/api`: `pnpm henrri:check` (read-only, spends no credit) and `pnpm henrri:sync`
  (one queue pass, for a system cron instead of the in-process timer).
- Refunds (admin order screen): a **goods return** picks the articles that came back — the credit
  note carries their own VAT rate; a **goodwill gesture** is an amount, spread over what is left to
  credit; an **overpayment** refund (transfer only) returns money paid in excess and gets no credit
  note. Credit notes never exceed the invoice; an amount Henrri cannot express is refused before
  any money moves, with the closest ones offered.
- An issued invoice whose payment Henrri refuses, or whose payments do not add up (a short transfer
  accepted), stays issued and is held for an admin: record the payment by hand in Henrri, or fix
  the cause and use « Relancer la facturation ». An order with Henrri documents cannot be deleted
  (accounting records are kept 10 years).
- Credits: each finalized invoice or credit note costs 8 credits (free pack: 200 a month, i.e. 25
  documents). Out of credits, documents wait; the admin dashboard counts the ones needing attention
  (« Factures à traiter »), and the order screen has « Relancer la facturation ».
- Henrri numbering must follow the order of sales: never issue an invoice by hand in Henrri for an
  order the site will invoice, and never backdate one.

## Notes / gotchas

- `.env` is the single source of truth: docker-compose reads it for `${VAR}`
  interpolation (postgres/web/caddy) **and** injects it into the API via
  `env_file`. `DATABASE_URL` is set by compose to the in-network `postgres`
  host, so it is deliberately absent from `.env.prod.example`.
- The `migrate` service builds the API **build stage** (which has the full
  workspace incl. `drizzle-kit`); the runtime API image ships prod deps only.
- Postgres is **not** published to the host — reach it via
  `docker compose … exec postgres` or another service on the `internal` network.
- Stripe: register the live webhook endpoint at
  `https://www.<DOMAIN>/api/webhooks/stripe` with the five events listed in the
  checklist above, and put the resulting signing secret in `STRIPE_WEBHOOK_SECRET`.
