import type pg from "pg"

// Story 12.9f (security audit, medium) — the API connects as `scs_app`, which
// reads and writes rows and nothing more (infra/postgres/roles.sql). In
// production it refuses to start as a stronger role, so a `.env` that points
// DATABASE_URL back at the superuser cannot slip through unnoticed.

interface RoleFacts {
  is_superuser: boolean
  owns_tables: boolean
  may_create_in_public: boolean
}

/** What the connected role may do beyond reading and writing rows; empty when nothing. */
export async function databaseRoleProblems(client: Pick<pg.ClientBase, "query">): Promise<string[]> {
  const { rows } = await client.query<RoleFacts>(`
    SELECT
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
      EXISTS (
        SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) = current_user
      ) AS owns_tables,
      has_schema_privilege(current_user, 'public', 'CREATE') AS may_create_in_public
  `)
  const facts = rows[0]
  if (!facts) throw new Error("Could not read the database role's privileges")

  const problems: string[] = []
  if (facts.is_superuser) problems.push("the role is a superuser")
  if (facts.owns_tables) problems.push("the role owns tables")
  if (facts.may_create_in_public) problems.push("the role may create objects in the public schema")
  return problems
}
