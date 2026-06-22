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
