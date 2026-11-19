# Restore runbook

What to do, in which order, when data must come back. The commands are the
`just` recipes of the repo root, run on the server as `deploy` in
`/srv/scs-firearm` (DEPLOY.md § 6 explains how the backups are made).

## What exists, and what it costs

| Backed up | Where | How often | Kept |
|---|---|---|---|
| The shop database (`armurier_prod`), age-encrypted | Scaleway bucket, `backups/postgres/` | daily 03:00 UTC, and before every `just update` | the newest **14 dumps** |
| The bucket's files (images, identity documents), encrypted | same bucket, `backups/objects/` | daily 03:15 UTC | current copy + 30 days of deleted/overwritten |
| `.env`, age identity, `BACKUP_OBJECTS_PASSWORD`, origin certificate key | Bitwarden (client: second copy of the backup keys) | by hand, at each change | — |

- **Up to 24 hours of data can be lost** (orders, accounts, catalogue edits
  since the last dump). Before a risky operation, `just backup` narrows it.
- **Not backed up**: the Umami audience database (statistics, rebuilt from
  zero), logs, the ClamAV signatures (downloaded again).
- **Retention is by count, not by days.** Every `just backup`, `just update`
  and `just restore-drill` adds a dump and pushes the oldest out. When the dump
  you need is old, **write its name down first** and do not run backups in a
  loop while you investigate.

## Before any restore

1. **Decide what you are restoring to.** A restore replaces the *whole*
   database: everything written after that dump is gone, including legitimate
   orders. If only a few rows are wrong, see § 4 first.
2. **Get the age identity** (`AGE-SECRET-KEY-1…`) from Bitwarden into a file
   on the server, for the time of the operation only:
   ```bash
   nano ~/scs-backup-identity.txt && chmod 600 ~/scs-backup-identity.txt
   ```
3. **List the dumps** and pick one (names are UTC timestamps):
   ```bash
   just backups
   ```
4. **Keep the current state**, even broken — it may hold what the dump lacks:
   `just backup` (one dump, see the retention note above).
5. **Announce it** to the admins: the shop is down during the restore.

Afterwards, always: `shred -u ~/scs-backup-identity.txt`.

## 1. A bad update (a migration or a release broke the data)

`just update` takes a dump right before migrating: it is the newest dump
older than the update.

```bash
just rollback                                   # back to the previous images
docker compose -f docker-compose.prod.yml stop api web
just restore ~/scs-backup-identity.txt armurier_prod_<timestamp>.dump.age
just up
```

The previous code runs on the restored schema, which it was written for. Fix
the release, then `just update` again.

## 2. Database corrupted or wiped, server fine

```bash
docker compose -f docker-compose.prod.yml stop api web    # nobody writes during the restore
just restore ~/scs-backup-identity.txt                    # latest dump; or name one
just migrate                                              # an older dump gets the newer migrations
just up
```

- `just restore` asks to type `yes`, then streams the dump through age into
  `pg_restore --clean --single-transaction`: a cut stream rolls back instead
  of leaving a half-restored database.
- It runs as `scs_owner`; the API's role gets its rights back through the
  default privileges, nothing to grant by hand.

## 3. Server lost (IONOS failure, compromise, deleted VPS)

The bucket is at Scaleway, not on the server: the backups survive it. Rebuild,
then restore instead of seeding.

1. **New server**: DEPLOY.md § 1 (users, SSH, firewall, Docker). If the old
   one was compromised, do not reuse it, and rotate the secrets of `.env`
   afterwards, the Scaleway key first — except `TOTP_ENCRYPTION_KEY` (rotating it makes every
   admin enrol their authenticator again, DEPLOY.md § 7 checklist).
2. **DNS**: in Cloudflare, point the records at the new IP (DEPLOY.md § 2).
3. **Code and secrets**, as in DEPLOY.md § 3: clone into `/srv/scs-firearm`,
   the origin certificate into `certs/`, and **`.env` from Bitwarden** (not
   from `.env.prod.example`: the database passwords, `TOTP_ENCRYPTION_KEY` and
   the backup keys must be the old ones — without the old
   `TOTP_ENCRYPTION_KEY`, every admin must enrol their authenticator again).
4. **Database, then data**:
   ```bash
   docker compose -f docker-compose.prod.yml --profile env-check run --rm --build env-check
   docker compose -f docker-compose.prod.yml up -d postgres
   just db-roles                                   # the roles the dump expects
   just restore ~/scs-backup-identity.txt          # latest dump
   just migrate
   ```
5. **Start**: ClamAV first, then the stack, as DEPLOY.md § 3 — **without** the
   seed and **without** `just admin-invite`: accounts and reference data come
   back with the dump.
6. **Files**: nothing to do while the bucket is intact. Only if it was damaged:
   `just restore-objects` (§ 5).

## 4. A few rows deleted or wrong (one product, one order)

A full restore would throw away every order since the dump for one row. Do not
improvise on the live database: restore the dump **aside**, read the rows
there, and write them back with a reviewed SQL statement. The restore drill
already does the "aside" part (`infra/backup/restore-drill.sh`, a throwaway
cluster inside the backup container); adapting it to export the rows is a
small job to do with care, not under pressure — ask before touching prod.

## 5. Files deleted or overwritten in the bucket

```bash
just restore-objects               # back to the latest copy
just restore-objects 2026-11-19    # what that day's run saw deleted or overwritten
```

It adds and overwrites, never deletes. A day's folder holds what the 03:15
run of that day found gone or changed; it is kept 30 days.

## After a restore

- `curl -fsS https://www.<DOMAIN>/health`, log in to the back-office, open a
  product, an order.
- `just logs backup`: the scheduler is up, so tonight's dump happens.
- Tell the admins what period was lost (from the dump's timestamp to the
  incident), so they can re-enter orders or contact customers.
- Write the incident down: date, cause, dump used, data lost.

## Practise

`just restore-drill ~/scs-backup-identity.txt` restores the latest dump into a
throwaway database and compares it with the live one, without touching it.
Run it monthly and after anything that changes the backups. First passed on
2026-11-19 (50 tables, 9 s).
