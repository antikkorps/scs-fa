import { CATALOG_SUPPLIERS } from "@armurier/shared"
import { db } from "./client.js"
import { suppliers } from "./schema.js"

/**
 * Declare the collected suppliers, so their triage files import on a fresh
 * deployment (story 12.5). Safe on a live database: a supplier already there,
 * whatever its case, is left as it is (`uq_suppliers_name_ci`).
 */
export async function seedSuppliers(): Promise<void> {
  await db
    .insert(suppliers)
    .values(Object.values(CATALOG_SUPPLIERS).map((name) => ({ name })))
    .onConflictDoNothing()
}
