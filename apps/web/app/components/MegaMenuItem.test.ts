// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { h } from "vue"
import { isShown } from "../../tests/helpers/panel"
import MegaMenuItem from "./MegaMenuItem.vue"

function mountItem(open: boolean) {
  return mountSuspended(MegaMenuItem, {
    props: { panelId: "mega-test", open },
    slots: {
      default: () => h("a", { href: "/rayon", class: "trigger" }, "Rayon"),
      panel: () => h("a", { href: "/rayon/sous-rayon", class: "inner" }, "Sous-rayon"),
    },
  })
}

describe("MegaMenuItem", () => {
  // Review of 12.15c: the panel's links stay in the server's HTML, so every
  // page links the universes' deep pages for crawlers, and aria-controls always
  // names an element that exists.
  it("keeps the panel in the page while closed, and shows it only while open", async () => {
    const closed = await mountItem(false)
    expect(closed.find("#mega-test a.inner").exists()).toBe(true)
    expect(isShown(closed.find("#mega-test"))).toBe(false)
    const open = await mountItem(true)
    expect(isShown(open.find("#mega-test"))).toBe(true)
  })

  it("asks to open on hover and on keyboard focus", async () => {
    const wrapper = await mountItem(false)
    await wrapper.trigger("pointerenter")
    await wrapper.find(".trigger").trigger("focusin")
    expect(wrapper.emitted("open")).toHaveLength(2)
  })

  it("asks to close when the pointer leaves, only if it is the open one", async () => {
    const closed = await mountItem(false)
    await closed.trigger("pointerleave")
    expect(closed.emitted("close")).toBeUndefined()
    const open = await mountItem(true)
    await open.trigger("pointerleave")
    expect(open.emitted("close")).toHaveLength(1)
  })

  it("asks to close when focus leaves the item, not when it moves inside", async () => {
    const wrapper = await mountItem(true)
    const inner = wrapper.find(".inner").element
    await wrapper.find(".trigger").trigger("focusout", { relatedTarget: inner })
    expect(wrapper.emitted("close")).toBeUndefined()
    await wrapper.find(".trigger").trigger("focusout", { relatedTarget: document.body })
    expect(wrapper.emitted("close")).toHaveLength(1)
  })
})
