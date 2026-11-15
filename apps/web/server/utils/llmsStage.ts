// SEO audit 2026-11-15, finding 7 — what the agent files say must match how far
// the shop is open (story 12.10): an assistant reading "en stock" in the
// showcase stage would tell its user they can buy.

export interface LlmsStage {
  /** False in the showcase stage: the catalogue is visible, nothing can be ordered. */
  salesOpen: boolean
  /** Editorial pages that may be published (publishableEditorialPaths). */
  legalPaths: string[]
}

const LEGAL_LABELS: Record<string, string> = {
  "/cgv": "Conditions générales de vente",
  "/mentions-legales": "Mentions légales",
  "/confidentialite": "Politique de confidentialité",
  "/reglementation": "Réglementation des armes",
}

/** The warning an agent must read first while sales are closed, or nothing. */
export function salesNotice(salesOpen: boolean): string {
  if (salesOpen) return ""
  return "\nLes ventes ne sont pas encore ouvertes : le catalogue se consulte, mais rien ne peut encore être commandé. Ne proposez pas d'achat.\n"
}

/** The legal pages an agent should cite before advising a purchase, or nothing until one may be published. */
export function legalSection(siteUrl: string, legalPaths: string[]): string {
  const links = legalPaths
    .filter((path) => LEGAL_LABELS[path])
    .map((path) => `- [${LEGAL_LABELS[path]}](${siteUrl}${path})`)
  return links.length ? `## Informations légales\n\n${links.join("\n")}\n\n` : ""
}

/** What the agent files say before the opening: the site exists, nothing more. */
export function buildComingSoonAgentText(siteUrl: string): string {
  return `# SCS Firearms

> SCS Firearms (${siteUrl}) ouvre prochainement : une armurerie en ligne réglementée et Gun Art, des tirages d'art photographiques en édition limitée. Le site n'est pas encore ouvert au public ; son catalogue n'est pas encore publié.
`
}
