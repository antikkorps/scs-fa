// Shared HTTP response helpers for routes.

/** Build a 400 ValidationError body from Zod issues. */
export function validationError(issues: { path: PropertyKey[]; message: string }[]) {
  return {
    error: "ValidationError",
    issues: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  }
}
