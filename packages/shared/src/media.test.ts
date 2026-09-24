import { describe, expect, it } from "vitest"
import { MEDIA_WIDTHS, mediaRenditions, mediaSrcset } from "./media.js"

const ID = "0b8f6a3e-5a8c-4d59-9f6e-2d8a7c1b3e41"

describe("media renditions (story 9.6)", () => {
  it("reads the whole width set from the stored — widest — URL", () => {
    expect(mediaRenditions(`/api/media/${ID}/1400.webp`)).toEqual({ id: ID, widths: [...MEDIA_WIDTHS] })
    expect(mediaRenditions(`/api/media/${ID}/800.webp`)?.widths).toEqual([400, 800])
  })

  it("knows an image too small for the first step has that one width", () => {
    expect(mediaRenditions(`/api/media/${ID}/320.webp`)?.widths).toEqual([320])
  })

  it("does not pretend a legacy or external URL has renditions", () => {
    for (const url of [
      `/api/artworks/images/${ID}.webp`,
      "https://cdn.example/a.jpg",
      null,
      undefined,
      "data:image/svg+xml,x",
    ]) {
      expect(mediaRenditions(url)).toBeNull()
    }
  })

  it("builds a srcset per format", () => {
    expect(mediaSrcset(`/api/media/${ID}/800.webp`, "avif")).toBe(
      `/api/media/${ID}/400.avif 400w, /api/media/${ID}/800.avif 800w`,
    )
    expect(mediaSrcset(`/api/media/${ID}/800.webp`, "webp")).toContain(`/api/media/${ID}/800.webp 800w`)
  })
})
