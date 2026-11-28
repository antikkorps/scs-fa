// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, describe, expect, it } from "vitest"
import { h } from "vue"
import AdminDualScroll from "./AdminDualScroll.vue"

// happy-dom lays nothing out: give the scrolled area the sizes a browser would.
function fakeSizes(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => scrollWidth })
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => clientWidth })
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth")
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth")
})

const mounted = () => mountSuspended(AdminDualScroll, { slots: { default: () => h("table", { class: "wide" }) } })

// Story 12.16b: with 1 800 rows, the table's own scrollbar sat at the bottom
// of the page; Fred scrolled down, slid it, and came back up.
describe("AdminDualScroll", () => {
  it("adds a scrollbar above, as wide as the content, when the content overflows", async () => {
    fakeSizes(1200, 600)
    const wrapper = await mounted()
    const top = wrapper.find(".dscroll__top")
    expect(top.exists()).toBe(true)
    expect(top.find(".dscroll__spacer").attributes("style")).toContain("width: 1200px")
    expect(top.attributes("aria-hidden")).toBe("true")
  })

  it("adds nothing when the content fits", async () => {
    fakeSizes(600, 600)
    const wrapper = await mounted()
    expect(wrapper.find(".dscroll__top").exists()).toBe(false)
  })

  it("keeps both scrollbars at the same place", async () => {
    fakeSizes(1200, 600)
    const wrapper = await mounted()
    const top = wrapper.find(".dscroll__top").element as HTMLElement
    const body = wrapper.find(".dscroll__body").element as HTMLElement

    top.scrollLeft = 150
    top.dispatchEvent(new Event("scroll"))
    expect(body.scrollLeft).toBe(150)

    body.scrollLeft = 40
    body.dispatchEvent(new Event("scroll"))
    expect(top.scrollLeft).toBe(40)
  })
})
