/** `%` and `_` typed by an admin are plain characters, not LIKE wildcards. */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}
