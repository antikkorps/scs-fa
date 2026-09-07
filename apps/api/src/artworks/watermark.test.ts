import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { renderProtectedImage, type WatermarkOptions, watermarkSvg } from "./watermark.js"

const BASE: WatermarkOptions = { text: "SCS FIREARM", position: "bottom-right", opacity: 0.35, scale: 0.28 }

/** Mean luminance — a watermark laid on a black field can only raise it. */
async function meanLuma(buffer: Buffer): Promise<number> {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true })
  let total = 0
  for (const value of data) total += value
  return total / (info.width * info.height)
}

function blackCanvas(width: number, height: number): sharp.Sharp {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
}

describe("watermarkSvg", () => {
  it("scales the mark to the requested share of the image width", () => {
    const narrow = watermarkSvg(1000, 800, { ...BASE, scale: 0.1 })
    const wide = watermarkSvg(1000, 800, { ...BASE, scale: 0.5 })
    const size = (svg: string) => Number(/font-size="(\d+)"/.exec(svg)?.[1])
    expect(size(wide)).toBeGreaterThan(size(narrow) * 4)
  })

  it("keeps the same span whatever the wording length", () => {
    const short = watermarkSvg(1000, 800, { ...BASE, text: "SCS" })
    const long = watermarkSvg(1000, 800, { ...BASE, text: "SCS FIREARM — GUN ART" })
    const size = (svg: string) => Number(/font-size="(\d+)"/.exec(svg)?.[1])
    // A longer wording must shrink the type, not overflow the image.
    expect(size(long)).toBeLessThan(size(short))
  })

  it("repeats the mark across the piece when tiled, and only once otherwise", () => {
    const corner = watermarkSvg(1000, 800, BASE)
    const tiled = watermarkSvg(1000, 800, { ...BASE, position: "tiled" })
    const occurrences = (svg: string) => svg.split("SCS FIREARM").length - 1
    // Two <text> per mark (the shadow copy and the light one).
    expect(occurrences(corner)).toBe(2)
    expect(occurrences(tiled)).toBeGreaterThan(20)
    expect(tiled).toContain("rotate(-30")
  })

  it("escapes the wording so a stray character cannot break the overlay", () => {
    const svg = watermarkSvg(600, 400, { ...BASE, text: '<script>&"' })
    expect(svg).not.toContain("<script>")
    expect(svg).toContain("&lt;script&gt;&amp;&quot;")
  })
})

describe("renderProtectedImage", () => {
  it("burns visible ink into the pixels — the only measure a screenshot cannot strip", async () => {
    const source = await blackCanvas(1200, 900).png().toBuffer()
    const { buffer } = await renderProtectedImage(source, { ...BASE, maxWidth: 1400, quality: 82 })

    // Guards against a font-less runtime silently producing an empty overlay.
    expect(await meanLuma(buffer)).toBeGreaterThan(0.2)
  })

  it("marks far more of the surface when tiled than with a corner signature", async () => {
    const source = await blackCanvas(1200, 900).png().toBuffer()
    const corner = await renderProtectedImage(source, { ...BASE, maxWidth: 1400, quality: 82 })
    const tiled = await renderProtectedImage(source, { ...BASE, position: "tiled", maxWidth: 1400, quality: 82 })
    expect(await meanLuma(tiled.buffer)).toBeGreaterThan((await meanLuma(corner.buffer)) * 3)
  })

  it("honours the opacity setting", async () => {
    const source = await blackCanvas(1200, 900).png().toBuffer()
    const faint = await renderProtectedImage(source, { ...BASE, opacity: 0.1, maxWidth: 1400, quality: 82 })
    const strong = await renderProtectedImage(source, { ...BASE, opacity: 0.9, maxWidth: 1400, quality: 82 })
    expect(await meanLuma(strong.buffer)).toBeGreaterThan(await meanLuma(faint.buffer))
  })

  it("caps the served resolution and never enlarges a smaller original", async () => {
    const large = await blackCanvas(3000, 2000).png().toBuffer()
    const capped = await renderProtectedImage(large, { ...BASE, maxWidth: 1400, quality: 82 })
    expect(capped.width).toBe(1400)

    const small = await blackCanvas(600, 400).png().toBuffer()
    const untouched = await renderProtectedImage(small, { ...BASE, maxWidth: 1400, quality: 82 })
    expect(untouched.width).toBe(600)
  })

  it("outputs WebP and drops the source metadata", async () => {
    const source = await blackCanvas(800, 600).jpeg().toBuffer()
    const { buffer } = await renderProtectedImage(source, { ...BASE, maxWidth: 1400, quality: 82 })
    const meta = await sharp(buffer).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.exif).toBeUndefined()
  })

  it("rejects bytes that are not an image", async () => {
    await expect(
      renderProtectedImage(Buffer.from("not an image"), { ...BASE, maxWidth: 1400, quality: 82 }),
    ).rejects.toThrow()
  })
})
