// Structural shape of a Zod error (the web app doesn't depend on `zod` directly,
// it only consumes schemas from @armurier/shared, so we type the bits we read).
interface ZodLikeError {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>
}

// French copy for auth field errors, keyed by field. Each auth field carries a
// single user-facing constraint, so one message per field is enough — we don't
// surface the raw (English) Zod messages to visitors.
const FR_FIELD_MESSAGES: Record<string, string> = {
  email: "Adresse email invalide.",
  password: "Le mot de passe doit contenir au moins 12 caractères.",
  firstName: "Le prénom est requis.",
  lastName: "Le nom est requis.",
  phone: "Numéro de téléphone invalide.",
  rgpdConsent: "Vous devez accepter la politique de confidentialité.",
  token: "Lien invalide ou expiré.",
  siret: "Numéro SIRET invalide (14 chiffres).",
  legalName: "La raison sociale est requise.",
  organisationType: "Choisissez le type d'organisation.",
}

// Flattens Zod issues into a { field: frMessage } map for inline form errors.
// Falls back to the raw Zod message for any field without French copy.
export function zodFieldErrors(error: ZodLikeError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_"
    if (!(key in out)) out[key] = FR_FIELD_MESSAGES[key] ?? issue.message
  }
  return out
}

// Extracts the HTTP status from an upstream/BFF fetch error (FetchError shape).
export function authErrorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

/**
 * The API's own error body inside a fetch error. The /bff/api proxy passes it
 * as is; the BFF auth routes rethrow it wrapped in an H3 error, under `data`.
 */
function apiErrorBody(err: unknown): Record<string, unknown> | undefined {
  const data = (err as { data?: Record<string, unknown> } | null)?.data
  if (typeof data?.error === "string") return data
  const wrapped = data?.data
  return wrapped && typeof wrapped === "object" ? (wrapped as Record<string, unknown>) : undefined
}

// Extracts the API's machine-readable error code (`{ error: "TermsOutdated" }`)
// from an upstream/BFF fetch error (FetchError shape).
export function apiErrorCode(err: unknown): string | undefined {
  const code = apiErrorBody(err)?.error
  return typeof code === "string" ? code : undefined
}

// A detail the API sends next to its error code (`{ error, remainingAttempts }`).
export function apiErrorField<T>(err: unknown, key: string): T | undefined {
  return apiErrorBody(err)?.[key] as T | undefined
}
