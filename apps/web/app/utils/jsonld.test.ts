import { describe, expect, it } from "vitest"
import { breadcrumbJsonLd, serializeJsonLd } from "./jsonld"

describe("serializeJsonLd", () => {
  it("escapes < > & so a payload cannot break out of the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" })
    expect(out).not.toContain("</script>")
    expect(out).not.toContain("<")
    expect(out).not.toContain(">")
    expect(out).toContain("\\u003c")
    expect(out).toContain("\\u003e")
  })

  it("stays valid JSON that round-trips to the original value", () => {
    const value = { name: "A & B </script>", nested: { x: 1 } }
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value)
  })
})

describe("breadcrumbJsonLd", () => {
  const SITE = "https://www.scs-firearms.com"

  it("lists the crumbs in order, with absolute URLs for the links", () => {
    const ld = breadcrumbJsonLd(SITE, [
      { name: "Boutique", to: "/boutique" },
      { name: "Munitions", to: "/boutique/categorie/munition" },
      { name: "9×19 FMJ" },
    ])
    expect(ld["@type"]).toBe("BreadcrumbList")
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Boutique", item: `${SITE}/boutique` },
      { "@type": "ListItem", position: 2, name: "Munitions", item: `${SITE}/boutique/categorie/munition` },
      { "@type": "ListItem", position: 3, name: "9×19 FMJ" },
    ])
  })

  it("never gives the current page a URL, even when one is passed", () => {
    const ld = breadcrumbJsonLd(SITE, [{ name: "Boutique", to: "/boutique" }])
    expect(ld.itemListElement[0]).not.toHaveProperty("item")
  })
})
