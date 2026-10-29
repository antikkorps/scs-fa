// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import ProductTagLinks from "./ProductTagLinks.vue"

describe("ProductTagLinks", () => {
  it("links each tag of the product to its page", async () => {
    const wrapper = await mountSuspended(ProductTagLinks, {
      props: {
        tags: [
          { slug: "occasion", name: "Occasion" },
          { slug: "xixe-siecle", name: "XIXe siècle" },
        ],
      },
    })
    const links = wrapper.findAll("a")
    expect(links.map((a) => a.attributes("href"))).toEqual(["/boutique/tag/occasion", "/boutique/tag/xixe-siecle"])
    expect(links.map((a) => a.text())).toEqual(["Occasion", "XIXe siècle"])
  })

  it("renders nothing for a product without tags", async () => {
    const wrapper = await mountSuspended(ProductTagLinks, { props: { tags: [] } })
    expect(wrapper.find("ul").exists()).toBe(false)
  })
})
