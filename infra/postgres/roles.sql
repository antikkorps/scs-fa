-- Least-privilege roles for the shop's database (story 12.9f). Run as the
-- superuser (POSTGRES_USER), which is kept for administration only:
--   scs_owner   owns the schema; used by the migrations alone
--   scs_app     the API: reads and writes rows, no DDL
--   scs_backup  pg_dump: reads everything, writes nothing
-- Re-runnable: it creates what is missing and resets passwords and grants.
-- Applied by `just db-roles` (compose `db-roles` service), which passes:
--   psql -v db=… -v owner_password=… -v app_password=… -v backup_password=…
-- Checked against a throwaway Postgres by infra/postgres/check-roles.sh.

\set ON_ERROR_STOP on
-- Re-runs repeat grants that already exist: keep their notices quiet.
SET client_min_messages = warning;

\if :{?db}
\else
  \echo 'roles.sql: missing -v db=<database>'
  \quit
\endif
\if :{?owner_password}
\else
  \echo 'roles.sql: missing -v owner_password=…'
  \quit
\endif
\if :{?app_password}
\else
  \echo 'roles.sql: missing -v app_password=…'
  \quit
\endif
\if :{?backup_password}
\else
  \echo 'roles.sql: missing -v backup_password=…'
  \quit
\endif

-- Roles ---------------------------------------------------------------------

SELECT format('CREATE ROLE %I', rolname)
FROM (VALUES ('scs_owner'), ('scs_app'), ('scs_backup')) AS wanted (rolname)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE pg_roles.rolname = wanted.rolname)
\gexec

ALTER ROLE scs_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'owner_password';
ALTER ROLE scs_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE scs_backup WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'backup_password';

-- Read access to every table, schema and sequence, present and future (PG 14+).
GRANT pg_read_all_data TO scs_backup;

-- Database ------------------------------------------------------------------

-- The owner role owns the database, so the migrations can create the `drizzle`
-- schema and, since Postgres 15, the `public` schema follows the database owner.
ALTER DATABASE :"db" OWNER TO scs_owner;

-- Only the shop's roles may connect: Umami's role, for one, may not.
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO scs_app, scs_backup;

-- Objects created before these roles existed (by the superuser) move to the owner.
DO $$
DECLARE
  rel record;
  typ record;
  fn record;
BEGIN
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'drizzle') THEN
    ALTER SCHEMA drizzle OWNER TO scs_owner;
  END IF;

  -- Sequences behind a serial or identity column follow their table.
  FOR rel IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'drizzle')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND pg_get_userbyid(c.relowner) <> 'scs_owner'
      AND NOT (
        c.relkind = 'S'
        AND EXISTS (
          SELECT FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')
        )
      )
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO scs_owner',
      CASE rel.relkind
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        ELSE 'TABLE'
      END,
      rel.nspname,
      rel.relname
    );
  END LOOP;

  -- Enums and domains (a table's own row type follows the table).
  FOR typ IN
    SELECT n.nspname, t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname IN ('public', 'drizzle')
      AND t.typtype IN ('e', 'd')
      AND pg_get_userbyid(t.typowner) <> 'scs_owner'
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO scs_owner', typ.nspname, typ.typname);
  END LOOP;

  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'drizzle')
      AND pg_get_userbyid(p.proowner) <> 'scs_owner'
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO scs_owner', fn.signature);
  END LOOP;
END
$$;

-- API -----------------------------------------------------------------------

-- Rows only: no TRUNCATE, no DDL, and nothing in the `drizzle` schema.
GRANT USAGE ON SCHEMA public TO scs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scs_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO scs_app;

-- The same for every table and sequence later migrations create.
ALTER DEFAULT PRIVILEGES FOR ROLE scs_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scs_app;
ALTER DEFAULT PRIVILEGES FOR ROLE scs_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO scs_app;
