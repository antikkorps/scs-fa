// Safely serialize an object for embedding in a <script type="application/ld+json">
// block. JSON.stringify alone does NOT escape `<`, `>` or `&`, so a value such as
// `</script><script>...` would break out of the script element (stored XSS). We
// escape those characters (plus the JS line separators U+2028/U+2029) to their
// backslash-uXXXX forms - still valid JSON, no longer able to terminate the tag.
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

/**
 * A `BreadcrumbList` from the crumbs a page shows. The current page — the last
 * crumb — carries no URL, as Google's guidelines allow for the final item.
 */
export function breadcrumbJsonLd(siteUrl: string, items: { name: string; to?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.to && i < items.length - 1 ? { item: `${siteUrl}${item.to}` } : {}),
    })),
  }
}
