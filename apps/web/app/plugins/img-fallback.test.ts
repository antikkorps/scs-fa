// @vitest-environment nuxt
import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { fallbackImage } from "~/utils/format"
import imgFallbackPlugin from "./img-fallback"

/** The directive as the plugin registers it, without booting a Nuxt app. */
function directive() {
  let registered: unknown
  const nuxtApp = {
    vueApp: {
      directive(_name: string, definition: unknown) {
        registered = definition
      },
    },
  }
  ;(imgFallbackPlugin as unknown as (app: unknown) => void)(nuxtApp)
  return registered as { mounted(el: HTMLImageElement, binding: { value: string }): void }
}

const Host = {
  props: { src: String, fallback: String },
  template: '<img v-img-fallback="fallback" :src="src" alt="Œuvre" />',
}

function mountImg(src: string, fallback: string) {
  return mount(Host, { props: { src, fallback }, global: { directives: { "img-fallback": directive() } } })
}

describe("v-img-fallback", () => {
  it("swaps a broken image for its placeholder", () => {
    const placeholder = fallbackImage("piece-test", 400, 500)
    const wrapper = mountImg("/api/artworks/images/gone.webp", placeholder)
    const img = wrapper.find("img").element as HTMLImageElement

    img.dispatchEvent(new Event("error"))

    // Without this, a stored image the storage can no longer serve left the
    // browser rendering the alt text across the grid, while a piece with no
    // image at all showed a clean placeholder. Same state, same rendering.
    expect(img.getAttribute("src")).toBe(placeholder)
  })

  it("does not loop if the placeholder itself fails", () => {
    const placeholder = fallbackImage("piece-test", 400, 500)
    const wrapper = mountImg("/api/artworks/images/gone.webp", placeholder)
    const img = wrapper.find("img").element as HTMLImageElement

    img.dispatchEvent(new Event("error"))
    img.dispatchEvent(new Event("error"))

    expect(img.getAttribute("src")).toBe(placeholder)
  })

  // The DOM implementation reports every image as "finished with no pixels",
  // since nothing is ever fetched. Driving `naturalWidth` is what separates a
  // successful load from a failed one here.
  function withNaturalWidth<T>(width: number, run: () => T): T {
    const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { value: width, configurable: true })
    try {
      return run()
    } finally {
      if (original) Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", original)
    }
  }

  it("leaves a working image alone", () => {
    const placeholder = fallbackImage("piece-test", 400, 500)
    const src = withNaturalWidth(120, () => {
      const wrapper = mountImg("/api/artworks/images/ok.webp", placeholder)
      return (wrapper.find("img").element as HTMLImageElement).getAttribute("src")
    })
    expect(src).toBe("/api/artworks/images/ok.webp")
  })

  it("catches a load that already failed before the directive was mounted", () => {
    // SSR markup is hydrated after the browser has started fetching, so the
    // error event can fire before any listener exists. Without this check the
    // very case that prompted the fix — a server-rendered card whose image is
    // already 404 by hydration — would keep showing the alt text.
    const placeholder = fallbackImage("piece-test", 400, 500)
    const src = withNaturalWidth(0, () => {
      const wrapper = mountImg("/api/artworks/images/gone.webp", placeholder)
      return (wrapper.find("img").element as HTMLImageElement).getAttribute("src")
    })
    expect(src).toBe(placeholder)
  })
})
