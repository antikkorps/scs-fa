// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ref, toValue } from "vue"
import BlogIndex from "./index.vue"

// SEO audit 2026-11-15, finding 15: past 24 articles, the older ones were
// linked from nowhere but the sitemap.
const { blogQueries, pagination } = vi.hoisted(() => ({
  blogQueries: [] as unknown[],
  pagination: { value: { page: 1, limit: 24, total: 60, totalPages: 3, hasMore: true } },
}))

mockNuxtImport("useFetch", () => (_url: string, opts?: { query?: unknown }) => {
  blogQueries.push(toValue(opts?.query))
  return {
    data: ref({ data: [{ id: "a1", slug: "atelier", title: "L'atelier" }], pagination: pagination.value }),
    error: ref(null),
  }
})

const stubs = { global: { stubs: { BlogCard: true } } }
const headWritten = () => new Promise((resolve) => setTimeout(resolve, 50))

afterEach(async () => {
  pagination.value = { page: 1, limit: 24, total: 60, totalPages: 3, hasMore: true }
  await clearError()
})

describe("blog index pagination", () => {
  it("asks the API for the page in the address, and links the next one", async () => {
    const wrapper = await mountSuspended(BlogIndex, { route: "/blog?page=2", ...stubs })
    expect(blogQueries.at(-1)).toMatchObject({ limit: 24, page: 2 })
    expect(wrapper.find('a[rel="next"]').attributes("href")).toBe("/blog?page=3")
    expect(wrapper.find('a[rel="prev"]').attributes("href")).toBe("/blog")
  })

  it("numbers the title of a later page", async () => {
    await mountSuspended(BlogIndex, { route: "/blog?page=2", ...stubs })
    await headWritten()
    expect(document.title).toContain("Le Journal — page 2")
  })

  it("answers 404 to a page past the last one", async () => {
    await mountSuspended(BlogIndex, {
      route: "/blog?page=9",
      global: { stubs: { BlogCard: true }, config: { errorHandler: () => undefined } },
    }).catch(() => undefined)
    expect(useError().value).toMatchObject({ statusCode: 404 })
  })
})
