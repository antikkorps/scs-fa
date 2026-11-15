import { describe, expect, it } from "vitest"
import { artworkJsonLd, itemListJsonLd, type ProductLdInput, productJsonLd } from "./structuredData"

const SITE = "https://www.scs-firearms.com"

const product: ProductLdInput = {
  siteUrl: SITE,
  pageUrl: `${SITE}/boutique/glock-17`,
  name: "Glock 17",
  description: "Pistolet 9×19.",
  sku: "GLK17",
  image: `${SITE}/api/media/glock.webp`,
  categoryName: "Armes de poing",
  legalCategory: "B",
  state: "available",
  pricesTtc: [720],
  used: false,
  makerName: null,
  brand: null,
  gtin: null,
  salesOpen: true,
}

describe("productJsonLd", () => {
  it("describes a product with a single, complete offer", () => {
    const ld = productJsonLd(product)
    expect(ld["@type"]).toBe("Product")
    expect(ld.image).toBe(`${SITE}/api/media/glock.webp`)
    expect(ld.offers).toEqual({
      "@type": "Offer",
      price: 720,
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      url: `${SITE}/boutique/glock-17`,
      seller: { "@type": "Organization", "@id": `${SITE}/#organization`, name: "SCS Firearms" },
    })
    expect(ld.additionalProperty).toEqual({ "@type": "PropertyValue", name: "Catégorie légale", value: "B" })
  })

  // SEO audit 2026-11-15, finding 3: in the showcase stage the page sells
  // nothing, so an InStock offer would contradict it.
  it("states no offer while the shop's sales are closed", () => {
    const ld = productJsonLd({ ...product, salesOpen: false })
    expect(ld).not.toHaveProperty("offers")
    expect(ld.name).toBe("Glock 17")
  })

  // Finding 5: Google expects a brand and an identifier on a product snippet.
  it("names the brand and the barcode when the product has them", () => {
    const ld = productJsonLd({ ...product, brand: "Glock", gtin: "9120039381234" })
    expect(ld.brand).toEqual({ "@type": "Brand", name: "Glock" })
    expect(ld.gtin13).toBe("9120039381234")
  })

  it("files each barcode length under its own property, and drops one that is not a barcode", () => {
    expect(productJsonLd({ ...product, gtin: "12345670" }).gtin8).toBe("12345670")
    expect(productJsonLd({ ...product, gtin: "012345678905" }).gtin12).toBe("012345678905")
    const invalid = productJsonLd({ ...product, gtin: "ABC-123" })
    expect(Object.keys(invalid).some((key) => key.startsWith("gtin"))).toBe(false)
  })

  // Finding 8: the main visual first, the share card as an alternative.
  it("passes every image it is given", () => {
    const images = [`${SITE}/api/media/x/1400.webp`, `${SITE}/api/media/x/og.jpg`]
    expect(productJsonLd({ ...product, image: images }).image).toEqual(images)
  })

  it("never emits an image it does not have — no placeholder, no object", () => {
    expect(productJsonLd({ ...product, image: undefined })).not.toHaveProperty("image")
  })

  it("spans the variants' prices with an AggregateOffer when they differ", () => {
    const ld = productJsonLd({ ...product, pricesTtc: [30, 42, 36] })
    expect(ld.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: 30, highPrice: 42, offerCount: 3 })
  })

  it("marks a sold collection piece as used and gone for good, with its maker", () => {
    const ld = productJsonLd({ ...product, state: "sold", used: true, makerName: "DWM", legalCategory: "D" })
    expect(ld.offers).toMatchObject({
      availability: "https://schema.org/SoldOut",
      itemCondition: "https://schema.org/UsedCondition",
    })
    expect(ld.manufacturer).toEqual({ "@type": "Organization", name: "DWM" })
  })

  it("words a free-sale item for a reader, not as a code", () => {
    expect(productJsonLd({ ...product, legalCategory: "none" }).additionalProperty?.value).toBe("Vente libre")
  })
})

describe("artworkJsonLd", () => {
  const artwork = {
    siteUrl: SITE,
    pageUrl: `${SITE}/collection/eclat`,
    title: "Éclat",
    description: "Un tirage.",
    image: undefined,
    artist: { name: "Sylvain", slug: "sylvain" },
    series: { title: "Âge d'or", slug: "age-d-or" },
    priceFromTtc: 216,
    availablePrints: 4,
    salesOpen: true,
  }

  it("is both a work of art and a product while prints remain", () => {
    const ld = artworkJsonLd(artwork)
    expect(ld["@type"]).toEqual(["VisualArtwork", "Product"])
    expect(ld.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: 216, offerCount: 4 })
    expect(ld.creator?.url).toBe(`${SITE}/collection/artiste/sylvain`)
    expect(ld.isPartOf?.url).toBe(`${SITE}/collection/serie/age-d-or`)
  })

  it("stays a work of art alone while the shop's sales are closed (SEO audit 2026-11-15, finding 3)", () => {
    const ld = artworkJsonLd({ ...artwork, salesOpen: false })
    expect(ld["@type"]).toBe("VisualArtwork")
    expect(ld).not.toHaveProperty("offers")
  })

  it("stays a work of art alone once the edition is closed — a Product without an offer is invalid", () => {
    const ld = artworkJsonLd({ ...artwork, priceFromTtc: null, availablePrints: 0 })
    expect(ld["@type"]).toBe("VisualArtwork")
    expect(ld).not.toHaveProperty("offers")
  })
})

describe("itemListJsonLd", () => {
  it("continues positions across pages of results", () => {
    const ld = itemListJsonLd("Boutique", [{ url: `${SITE}/boutique/a`, name: "A" }], 24)
    expect(ld.itemListElement[0]).toEqual({ "@type": "ListItem", position: 25, url: `${SITE}/boutique/a`, name: "A" })
    expect(ld.numberOfItems).toBe(1)
  })
})
