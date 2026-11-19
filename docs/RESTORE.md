# Restore runbook

What to do, in which order, when data must come back. The commands are the
`just` recipes of the repo root, run on the server as `deploy` in
`/srv/scs-firearm` (DEPLOY.md § 6 explains how the backups are made).

## What exists, and what it costs

| Backed up | Where | How often | Kept |
| --- | --- | --- | --- |
| The shop database (`armurier_prod`), age-encrypted | Scaleway bucket, `backups/postgres/` | daily 03:00 UTC, and before every `just update` | the newest **14 dumps** |
| The bucket's files (images, identity documents), encrypted | same bucket, `backups/objects/` | daily 03:15 UTC | current copy + 30 days of deleted/overwritten |
| `.env`, age identity, `BACKUP_OBJECTS_PASSWORD`, origin certificate key | Bitwarden (client: second copy of the backup keys) | by hand, at each change | — |

- **Up to 24 hours of data can be lost** (orders, accounts, catalogue edits
  since the last dump). Before a risky operation, `just backup` narrows it.
- **Not backed up**: the Umami audience database (statistics, rebuilt from
  zero), logs, the ClamAV signatures (downloaded again).
- **Retention is by count, not by days.** Every `just backup`, `just update`
  and `just restore-drill` adds a dump and pushes the oldest out.
- **The backups share the app's bucket and S3 key.** Whoever holds the
  server's `.env` can delete them: on a suspected compromise, start with § 3,
  step 0.

## Before any restore

1. **Decide what you are restoring to.** A restore replaces the *whole*
   database: everything written after that dump is gone, including legitimate
   orders. If only a few rows are wrong, see § 4 first.
2. **Get the age identity** (`AGE-SECRET-KEY-1…`) from Bitwarden into a file
   only you can read, for the time of the operation:

   ```bash
   install -m 600 /dev/null ~/scs-backup-identity.txt && nano ~/scs-backup-identity.txt
   ```

3. **List the dumps, pick the last one from before the incident, and write
   its name down.** Names are UTC timestamps. Never restore "the latest" during
   an incident: a dump taken after it — the 03:00 run, step 4 below — holds the
   broken state.

   ```bash
   just backups
   ```

4. **Keep the current state**, even broken — it may hold what the dump lacks:
   `just backup`. This adds a dump *newer* than the one you chose, which is
   why step 3 comes first. Skip it for § 5 (it would sync the bad files into
   the object copy).
5. **Announce it** to the admins: the shop is down during the restore.

Afterwards, always: `shred -u ~/scs-backup-identity.txt`.

`DUMP` below stands for the name written down at step 3.

## 1. A bad update (a migration or a release broke the data)

`just update` takes a dump right before migrating: `DUMP` is the newest dump
older than the update.

```bash
docker compose -f docker-compose.prod.yml stop api web    # nothing writes from here
just restore ~/scs-backup-identity.txt DUMP
just rollback                                             # previous images, restarts the stack
```

The previous code runs on the restored schema, which it was written for. Fix
the release, then `just update` again.

## 2. Database corrupted or wiped, server fine

```bash
docker compose -f docker-compose.prod.yml stop api web    # nobody writes during the restore
just db-roles                                             # idempotent; recreates roles if the volume was lost
just restore ~/scs-backup-identity.txt DUMP
just migrate                                              # an older dump gets the newer migrations
just up
```

- `just restore` asks to type `yes`, then streams the dump through age into
  `pg_restore --clean --single-transaction`: a cut stream rolls back instead
  of leaving a half-restored database.
- It runs as `scs_owner`; the API's role gets its rights back through the
  default privileges, nothing to grant by hand.
- If the Postgres volume itself was lost, Umami's role and database went with
  it: redo DEPLOY.md § Umami, step 2 (statistics restart from zero).

## 3. Server lost (IONOS failure, compromise, deleted VPS)

The bucket is at Scaleway, not on the server: the backups survive a dead
server. A compromised one is another matter.

0. **Compromise only — before anything else**: in the Scaleway console,
   revoke the S3 key of `.env`, create a new one, and check that
   `backups/postgres/` and `backups/objects/` are still there. Until then the
   attacker can delete the data and its backups. Do not reuse the server.
1. **New server**: DEPLOY.md § 1 (users, SSH, firewall, Docker).
2. **DNS**: in Cloudflare, point the records at the new IP (DEPLOY.md § 2).
3. **Code and secrets**, as in DEPLOY.md § 3: clone into `/srv/scs-firearm`,
   the origin certificate into `certs/`, and **`.env` from Bitwarden** (not
   from `.env.prod.example`), with the new Scaleway key if step 0 ran. Keep
   the other values as they were for now — see "Rotating secrets" below.
4. **Database**:

   ```bash
   docker compose -f docker-compose.prod.yml --profile env-check run --rm --build env-check
   docker compose -f docker-compose.prod.yml up -d postgres
   just db-roles                                   # the roles the dump expects
   just restore ~/scs-backup-identity.txt DUMP
   just migrate
   ```

5. **Umami**: DEPLOY.md § Umami, steps 2 to 4 — a new, empty database, the
   `admin` / `umami` login to change at once, the website to create again and
   its new id in `UMAMI_WEBSITE_ID`.
6. **Start**: ClamAV first, then the stack, as DEPLOY.md § 3 — **without** the
   seed and **without** `just admin-invite`: accounts and reference data come
   back with the dump.
7. **Files**: nothing to do while the bucket is intact. Only if it was damaged:
   § 5.

### Rotating secrets after a compromise

Once the shop runs again, change what the attacker may have read — but not
blindly, some values guard data that already exists:

- **Keep** `TOTP_ENCRYPTION_KEY`: rotating it makes every admin enrol their
  authenticator again (DEPLOY.md § 7 checklist).
- **Keep** `BACKUP_OBJECTS_PASSWORD`: the existing object copies are
  encrypted with it and could no longer be read.
- **The age key pair**: a new pair is fine (new `BACKUP_AGE_RECIPIENT`), but
  keep the old identity in Bitwarden until the 14 older dumps have rotated out.
- **`DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `DB_BACKUP_PASSWORD`**: change them
  in `.env`, then `just db-roles` and `just up`.
- **`POSTGRES_PASSWORD`**: Postgres reads it only when the volume is created.
  First `ALTER ROLE` in `just psql`, then change `.env`; the reverse breaks
  `just db-roles`.
- **JWT secrets, `INTERNAL_API_SECRET`, Mailjet, Stripe, Umami**: change them at
  their provider and in `.env`, then `just up` (JWT: everyone logs in again).

## 4. A few rows deleted or wrong (one product, one order)

A full restore would throw away every order since the dump for one row. Do not
improvise on the live database: restore the dump **aside**, read the rows
there, and write them back with a reviewed SQL statement. Do **not** run
`just restore-drill` for this: it takes a fresh dump first and restores that,
the current state, and its database vanishes when it ends. Its script
(`infra/backup/restore-drill.sh`) shows how to restore aside; adapting it to
export rows from `DUMP` is a small job to do with care, not under pressure —
ask before touching prod.

## 5. Files deleted or overwritten in the bucket

Act before the next 03:15 run, or stop it — each run syncs the damage into the
copy and moves the good versions into that day's `deleted/` folder:

```bash
docker compose -f docker-compose.prod.yml stop backup     # if the restore waits past 03:15
just restore-objects 2026-11-19    # the date of the first run AFTER the damage
just restore-objects               # only if no run happened since: the current copy
docker compose -f docker-compose.prod.yml start backup
```

It adds and overwrites, never deletes. A day's folder holds what that day's
03:15 run found gone or changed; it is kept 30 days. Do not run `just backup`
here: it runs the object copy too.

## After a restore

- `curl -fsS https://www.<DOMAIN>/health`, log in to the back-office, open a
  product, an order.
- `just logs backup`: the scheduler is up, so tonight's dump happens.
- **The lost window** (from the dump's timestamp to the incident): payments
  and invoices made then still exist at Stripe and Henrri, not in the
  database. Use the Stripe dashboard and Henrri as the list of orders to
  re-enter or customers to contact; Stripe may also retry webhooks about rows
  that no longer exist — expect errors on those in the logs.
- Write the incident down: date, cause, dump used, data lost.

## Practise

`just restore-drill ~/scs-backup-identity.txt` restores the latest dump into a
throwaway database and compares it with the live one, without touching it.
Run it monthly and after anything that changes the backups. First passed on
2026-11-19 (50 tables, 9 s).
