import { describe, expect, it } from "vitest"
import { isMediaOgUrl, MEDIA_OG_SIZE, MEDIA_WIDTHS, mediaOgImage, mediaRenditions, mediaSrcset } from "./media.js"

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

describe("share-card (og) image", () => {
  it("points a stored media URL at its 1200×630 JPEG card", () => {
    expect(MEDIA_OG_SIZE).toEqual({ width: 1200, height: 630 })
    expect(mediaOgImage(`/api/media/${ID}/1400.webp`)).toBe(`/api/media/${ID}/og.jpg`)
    expect(mediaOgImage(`/api/media/${ID}/320.webp`)).toBe(`/api/media/${ID}/og.jpg`)
  })

  it("leaves a legacy or external URL alone — it has no card", () => {
    for (const url of [`/api/artworks/images/${ID}.webp`, "https://cdn.example/a.jpg", null, undefined]) {
      expect(mediaOgImage(url)).toBeNull()
    }
  })

  it("recognises a card URL, relative or absolute", () => {
    expect(isMediaOgUrl(`/api/media/${ID}/og.jpg`)).toBe(true)
    expect(isMediaOgUrl(`https://scs-firearms.fr/api/media/${ID}/og.jpg`)).toBe(true)
    expect(isMediaOgUrl(`/api/media/${ID}/1400.webp`)).toBe(false)
    expect(isMediaOgUrl(undefined)).toBe(false)
  })
})
