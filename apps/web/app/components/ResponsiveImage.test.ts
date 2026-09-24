// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ArtworkListItem } from "~/types/artwork"
import { artworkImage } from "~/utils/format"
import ArtworkCard from "./ArtworkCard.vue"
import ResponsiveImage from "./ResponsiveImage.vue"

const ID = "11111111-1111-1111-1111-111111111111"
const stored = artworkImage(`/api/media/${ID}/1400.webp`, "piece")
const placeholder = artworkImage(null, "piece")

// happy-dom reports every image as "finished with no pixels", which the
// fallback directive rightly reads as a failed load — and swaps, sources and
// all. Report a loaded image, as a browser would for a file that exists.
const naturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")
beforeAll(() => {
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { value: 800, configurable: true })
})
afterAll(() => {
  if (naturalWidth) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", naturalWidth)
})

describe("ResponsiveImage — widths and formats (story 9.6)", () => {
  it("offers every width in AVIF first, then WebP, with the layout's sizes", async () => {
    const wrapper = await mountSuspended(ResponsiveImage, {
      props: { image: stored, alt: "Œuvre", sizes: "(min-width: 960px) 50vw, 100vw" },
    })
    const sources = wrapper.findAll("picture source")
    expect(sources.map((s) => s.attributes("type"))).toEqual(["image/avif", "image/webp"])
    expect(sources[0]?.attributes("srcset")).toBe(
      `/api/media/${ID}/400.avif 400w, /api/media/${ID}/800.avif 800w, /api/media/${ID}/1400.avif 1400w`,
    )
    expect(sources[1]?.attributes("sizes")).toBe("(min-width: 960px) 50vw, 100vw")
    // The <img> stays the WebP fallback for browsers without <picture>.
    expect(wrapper.find("img").attributes("src")).toBe(`/api/media/${ID}/1400.webp`)
  })

  it("renders a bare <img> for a placeholder, which has no renditions", async () => {
    const wrapper = await mountSuspended(ResponsiveImage, { props: { image: placeholder, alt: "Œuvre" } })
    expect(wrapper.find("picture").exists()).toBe(false)
    expect(wrapper.find("img").attributes("src")).toBe(placeholder.src)
  })

  it("puts the caller's class on the <img>, where the layout expects it", async () => {
    const wrapper = await mountSuspended(ResponsiveImage, {
      props: { image: stored, alt: "x" },
      attrs: { class: "hero__bg" },
    })
    expect(wrapper.find("img").classes()).toContain("hero__bg")
    expect(wrapper.find("picture").classes()).not.toContain("hero__bg")
  })
})

describe("ResponsiveImage — Gun Art deterrence (story 11.5, kept)", () => {
  it("blocks the drag-to-save gesture at the markup level", async () => {
    const wrapper = await mountSuspended(ResponsiveImage, { props: { image: stored, alt: "Œuvre", protect: true } })
    expect(wrapper.find("img").attributes("draggable")).toBe("false")
  })

  it("swallows the context menu and the drag, so the default save paths misfire", async () => {
    const wrapper = await mountSuspended(ResponsiveImage, { props: { image: stored, alt: "Œuvre", protect: true } })
    const img = wrapper.find("img")
    const menu = new Event("contextmenu", { cancelable: true })
    const drag = new Event("dragstart", { cancelable: true })
    img.element.dispatchEvent(menu)
    img.element.dispatchEvent(drag)
    expect(menu.defaultPrevented).toBe(true)
    expect(drag.defaultPrevented).toBe(true)
  })

  it("leaves an unprotected image alone", async () => {
    const wrapper = await mountSuspended(ResponsiveImage, { props: { image: stored, alt: "Produit" } })
    const menu = new Event("contextmenu", { cancelable: true })
    wrapper.find("img").element.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(false)
    expect(wrapper.find("img").attributes("draggable")).toBeUndefined()
  })

  it("keeps the image in the accessibility tree — deterrence must not cost the alt text", async () => {
    const wrapper = await mountSuspended(ResponsiveImage, {
      props: { image: stored, alt: "Une œuvre de Sylvain", width: 800, height: 600, protect: true },
    })
    const img = wrapper.find("img")
    expect(img.attributes("alt")).toBe("Une œuvre de Sylvain")
    // Intrinsic size preserved: no layout shift traded for the protection.
    expect(img.attributes("width")).toBe("800")
    expect(img.attributes("height")).toBe("600")
  })
})

describe("Gun Art surfaces", () => {
  const artwork: ArtworkListItem = {
    id: "a1",
    slug: "piece-test",
    title: "Pièce de test",
    artistName: "Sylvain",
    artistSlug: "sylvain",
    series: null,
    description: null,
    featuredImageUrl: `/api/media/${ID}/1400.webp`,
    orientation: "landscape",
    editionLimit: 25,
    editionYear: 2026,
    availableCount: 4,
    soldCount: 1,
    priceFromHt: 100,
    priceFromTtc: 120,
  }

  it("serves catalogue cards protected, and responsive", async () => {
    const wrapper = await mountSuspended(ArtworkCard, { props: { artwork } })
    const img = wrapper.find(".card__media img")
    expect(img.exists()).toBe(true)
    expect(img.attributes("draggable")).toBe("false")
    expect(wrapper.find(".card__media source[type='image/avif']").exists()).toBe(true)
  })
})
