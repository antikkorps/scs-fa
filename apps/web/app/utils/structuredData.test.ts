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
      seller: { "@type": "Organization", "@id": `${SITE}/#organization`, name: "SCS Firearm" },
    })
    expect(ld.additionalProperty).toEqual({ "@type": "PropertyValue", name: "Catégorie légale", value: "B" })
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
  }

  it("is both a work of art and a product while prints remain", () => {
    const ld = artworkJsonLd(artwork)
    expect(ld["@type"]).toEqual(["VisualArtwork", "Product"])
    expect(ld.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: 216, offerCount: 4 })
    expect(ld.creator?.url).toBe(`${SITE}/collection/artiste/sylvain`)
    expect(ld.isPartOf?.url).toBe(`${SITE}/collection/serie/age-d-or`)
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
