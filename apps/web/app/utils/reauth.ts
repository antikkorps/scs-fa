// What a re-confirmation refusal means (password, then the app's code), in
// French — shared by "Mon compte" and the back-office's second-factor reset.
export const REAUTH_REFUSALS: Record<string, string> = {
  InvalidCredentials: "Mot de passe incorrect.",
  TotpCodeRequired: "Saisissez aussi le code de votre application d'authentification.",
  InvalidTotpCode: "Code de l'application incorrect.",
  AccountLocked: "Trop d'essais : votre compte est bloqué pour 15 minutes.",
}
