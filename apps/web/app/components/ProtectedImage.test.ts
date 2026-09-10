// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import type { ArtworkListItem } from "~/types/artwork"
import ArtworkCard from "./ArtworkCard.vue"
import ProtectedImage from "./ProtectedImage.vue"

const artwork: ArtworkListItem = {
  id: "a1",
  slug: "piece-test",
  title: "Pièce de test",
  artistName: "Sylvain",
  artistSlug: "sylvain",
  series: null,
  description: null,
  featuredImageUrl: "/api/artworks/images/11111111-1111-1111-1111-111111111111.webp",
  orientation: "landscape",
  editionLimit: 25,
  editionYear: 2026,
  availableCount: 4,
  soldCount: 1,
  priceFromHt: 100,
  priceFromTtc: 120,
}

describe("ProtectedImage", () => {
  it("blocks the drag-to-save gesture at the markup level", async () => {
    const wrapper = await mountSuspended(ProtectedImage, { props: { src: "/x.webp", alt: "Œuvre" } })
    expect(wrapper.find("img").attributes("draggable")).toBe("false")
  })

  it("swallows the context menu and the drag, so the default save paths misfire", async () => {
    const wrapper = await mountSuspended(ProtectedImage, { props: { src: "/x.webp", alt: "Œuvre" } })
    const img = wrapper.find("img")
    const menu = new Event("contextmenu", { cancelable: true })
    const drag = new Event("dragstart", { cancelable: true })
    img.element.dispatchEvent(menu)
    img.element.dispatchEvent(drag)
    expect(menu.defaultPrevented).toBe(true)
    expect(drag.defaultPrevented).toBe(true)
  })

  it("keeps the image in the accessibility tree — deterrence must not cost the alt text", async () => {
    const wrapper = await mountSuspended(ProtectedImage, {
      props: { src: "/x.webp", alt: "Une œuvre de Sylvain", width: 800, height: 600 },
    })
    const img = wrapper.find("img")
    expect(img.attributes("alt")).toBe("Une œuvre de Sylvain")
    // Intrinsic size preserved: no layout shift traded for the protection.
    expect(img.attributes("width")).toBe("800")
    expect(img.attributes("height")).toBe("600")
  })
})

describe("Gun Art surfaces", () => {
  it("serves catalogue cards through the protected image", async () => {
    const wrapper = await mountSuspended(ArtworkCard, { props: { artwork } })
    const img = wrapper.find(".card__media img")
    expect(img.exists()).toBe(true)
    expect(img.attributes("draggable")).toBe("false")
  })
})
