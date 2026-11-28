// Story 12.16b — narrow the product list to one supplier's catalogue.

/** The choice for products entered by hand, with no supplier. */
export const NO_SUPPLIER = "__none__"

interface SupplierRow {
  supplierName: string | null
}

export interface SupplierChoice {
  value: string
  label: string
}

export function supplierChoices(rows: readonly SupplierRow[]): SupplierChoice[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = row.supplierName ?? NO_SUPPLIER
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const named = [...counts.keys()]
    .filter((name) => name !== NO_SUPPLIER)
    .sort((left, right) => left.localeCompare(right, "fr"))
  const choices = named.map((name) => ({ value: name, label: `${name} (${counts.get(name)})` }))
  const without = counts.get(NO_SUPPLIER)
  return without ? [...choices, { value: NO_SUPPLIER, label: `Sans fournisseur (${without})` }] : choices
}

/** An empty choice keeps every row. */
export function withSupplier<Row extends SupplierRow>(rows: readonly Row[], choice: string): Row[] {
  if (!choice) return [...rows]
  return rows.filter((row) => (row.supplierName ?? NO_SUPPLIER) === choice)
}

/** The chosen supplier while it is still offered, else every supplier. */
export function keptChoice(choice: string, choices: readonly SupplierChoice[]): string {
  return choices.some((offered) => offered.value === choice) ? choice : ""
}
