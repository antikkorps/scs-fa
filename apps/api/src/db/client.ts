import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { env } from "../env.js"
import * as schema from "./schema.js"

const { Pool } = pg

const pool = new Pool({
  connectionString: env.DATABASE_URL,
})

export const db = drizzle(pool, { schema })
export type Database = typeof db
