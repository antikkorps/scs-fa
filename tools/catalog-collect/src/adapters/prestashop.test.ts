import { describe, expect, it } from "vitest"
import { breadcrumbPath, imageIdFromUrl, originalImageUrl, unescapeHtml } from "./prestashop.js"

describe("PrestaShop helpers", () => {
  it("builds the original image URL, modern and legacy layouts", () => {
    expect(originalImageUrl("https://bgmwinfield.fr", 14183)).toBe("https://bgmwinfield.fr/img/p/1/4/1/8/3/14183.jpg")
    expect(originalImageUrl("https://www.espfrance.com", 7, 34074)).toBe("https://www.espfrance.com/img/p/34074-7.jpg")
  })

  it("reads the image id of a friendly image URL", () => {
    expect(imageIdFromUrl("https://bgmwinfield.fr/14183-product_main_2x/swampfox-kingslayer.jpg")).toBe("14183")
    expect(imageIdFromUrl("https://bgmwinfield.fr/img/logo.jpg")).toBeUndefined()
  })

  it("unescapes JSON-LD strings", () => {
    expect(unescapeHtml("B&amp;T 14.5&#039;")).toBe("B&T 14.5'")
  })

  it("keeps the inner breadcrumb only", () => {
    expect(breadcrumbPath(["Accueil", "Airsoft", "Répliques", "Pack G36"])).toBe("Airsoft > Répliques")
    expect(breadcrumbPath(["Accueil", "Produit"])).toBeUndefined()
  })
})
