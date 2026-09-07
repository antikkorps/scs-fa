import sharp from "sharp"

// Server-side watermarking for Gun Art visuals (story 11.5).
//
// ⚠️ Read this before promising anything to the client: **no measure here makes
// an image untakeable**. Anything a browser displays is in its cache, and a
// screenshot defeats every client-side trick. The watermark burnt into the
// pixels is the ONLY measure that survives a screenshot — which is why it exists
// and why the public file is the only one ever served. The rest (capped
// resolution, right-click and drag blocking) is deterrence, not protection.
//
// Every knob is configurable because the aesthetic call — discreet signature or
// assumed, gallery-wide mark — belongs to the artist, not to this file.

export const WATERMARK_POSITIONS = ["bottom-right", "center", "tiled"] as const
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number]

export interface WatermarkOptions {
  text: string
  position: WatermarkPosition
  /** 0 (invisible) … 1 (opaque). */
  opacity: number
  /** Share of the image width the mark spans, e.g. 0.28 = 28%. */
  scale: number
}

export interface ProtectedImageOptions extends WatermarkOptions {
  /** Longest edge of the public file. The HD original is never served. */
  maxWidth: number
  quality: number
}

// DejaVu is what the Debian runtime image installs (see apps/api/Dockerfile):
// name it explicitly so the mark renders identically on a laptop and in prod.
// A font-less image would silently render an EMPTY watermark — the pipeline test
// asserts ink is actually laid down, so that regression fails loudly.
const FONT_STACK = "'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif"
const MARGIN_RATIO = 0.035
/**
 * Rough advance of one character, as a share of the font size: the glyph width
 * plus the tracking we apply. Both terms matter — leaving the tracking out of
 * the estimate is what pushed the corner mark off the right edge.
 */
const LETTER_SPACING_RATIO = 0.08
const CHAR_WIDTH_RATIO = 0.62
const CHAR_ADVANCE_RATIO = CHAR_WIDTH_RATIO + LETTER_SPACING_RATIO

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

/**
 * One mark, drawn twice: a dark copy offset by a pixel under a light one. Cheap
 * drop shadow, and the only reason the mark stays readable both on a black
 * background and on a bright sky — which a single flat fill never manages.
 */
function markup(text: string, fontSize: number, opacity: number, attrs: string): string {
  const shadow = Math.max(1, Math.round(fontSize * 0.04))
  const common = `font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="600" letter-spacing="${(fontSize * LETTER_SPACING_RATIO).toFixed(2)}"`
  return (
    `<g ${attrs}>` +
    `<text x="${shadow}" y="${shadow}" ${common} fill="#000000" fill-opacity="${(opacity * 0.45).toFixed(3)}">${text}</text>` +
    `<text x="0" y="0" ${common} fill="#ffffff" fill-opacity="${opacity.toFixed(3)}">${text}</text>` +
    `</g>`
  )
}

/** Build the overlay covering the whole image, with the mark laid out on it. */
export function watermarkSvg(width: number, height: number, options: WatermarkOptions): string {
  const text = escapeXml(options.text)
  const charCount = Math.max(options.text.length, 1)
  // Derive the font size from the requested span so `scale` means the same
  // thing whatever the wording length or the image size.
  const fontSize = Math.max(10, Math.round((width * options.scale) / (CHAR_ADVANCE_RATIO * charCount)))
  const textWidth = fontSize * CHAR_ADVANCE_RATIO * charCount
  const margin = Math.round(width * MARGIN_RATIO)
  let body: string

  if (options.position === "center") {
    body = markup(text, fontSize, options.opacity, `transform="translate(${(width - textWidth) / 2} ${height / 2})"`)
  } else if (options.position === "tiled") {
    // The assumed option: a diagonal grid across the whole piece. Cropping the
    // corner off does not get rid of it.
    const stepX = Math.round(textWidth * 1.6)
    const stepY = Math.round(fontSize * 4)
    const tiles: string[] = []
    // Start off-canvas so the rotation never leaves a bare corner.
    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        tiles.push(markup(text, fontSize, options.opacity, `transform="translate(${x} ${y})"`))
      }
    }
    body = `<g transform="rotate(-30 ${width / 2} ${height / 2})">${tiles.join("")}</g>`
  } else {
    body = markup(
      text,
      fontSize,
      options.opacity,
      `transform="translate(${width - textWidth - margin} ${height - margin})"`,
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
}

/**
 * Decode, downscale and watermark an uploaded artwork visual.
 *
 * The decode doubles as the content check (sharp rejects a mislabeled or
 * polyglot file), EXIF orientation is honoured before metadata is stripped, and
 * the output is capped so the file that goes public is never the print-grade
 * one. Throws on anything sharp cannot read — callers answer 400.
 */
export async function renderProtectedImage(
  input: Buffer,
  options: ProtectedImageOptions,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const resized = await sharp(input)
    .rotate()
    .resize({ width: options.maxWidth, withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true })

  const { width, height } = resized.info
  const overlay = Buffer.from(watermarkSvg(width, height, options))
  const buffer = await sharp(resized.data)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .webp({ quality: options.quality })
    .toBuffer()

  return { buffer, width, height }
}
