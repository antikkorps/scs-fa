/** The longest description search engines show before truncating it themselves. */
export const META_DESCRIPTION_MAX = 160

/**
 * A meta description that fits (story 9.6): whitespace collapsed, HTML-free,
 * and cut on a word boundary with an ellipsis rather than mid-word by the
 * search engine. The audit found them from 24 to 214 characters.
 */
export function metaDescription(text: string, max = META_DESCRIPTION_MAX): string {
  const clean = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, "")}…`
}
