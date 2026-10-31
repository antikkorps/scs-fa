import type { Page } from "@playwright/test"

// The layout rules the CI enforces on every public page (story: Playwright
// layout checks). Each returns a list of human-readable problems — empty when
// the page is sound — so a failure says WHAT broke, not just that something did.
//
// They run inside the page, where `getComputedStyle` and layout boxes are the
// truth. No screenshot is compared: a rule survives a redesign, a pixel diff
// does not.

/** Smallest text size a visitor is ever asked to read (the design floor of tokens.css). */
export const MIN_FONT_SIZE_PX = 12
const MAX_REPORTED = 8

/**
 * The page scrolls sideways. Names the elements that start the overflow — the
 * outermost ones sticking out — and ignores content that overflows inside its
 * own scroll container (a wide table in an `overflow-x: auto` wrapper is fine).
 */
export function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate((limit) => {
    const root = document.documentElement
    if (root.scrollWidth <= root.clientWidth) return []

    const describe = (el: Element) => `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join("")}`
    const clippedByAncestor = (el: Element) => {
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX !== "visible") return true
      }
      return false
    }
    const sticksOut = (el: Element) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && (rect.right > root.clientWidth + 0.5 || rect.left < -0.5)
    }

    const culprits = [...document.body.querySelectorAll("*")].filter(
      (el) => sticksOut(el) && !clippedByAncestor(el) && !(el.parentElement && sticksOut(el.parentElement)),
    )
    const found = culprits.slice(0, limit).map((el) => {
      const rect = el.getBoundingClientRect()
      return `${describe(el)} spans ${Math.round(rect.left)}→${Math.round(rect.right)}px in a ${root.clientWidth}px viewport`
    })
    return found.length > 0 ? found : [`page is ${root.scrollWidth}px wide in a ${root.clientWidth}px viewport`]
  }, MAX_REPORTED)
}

/** Visible text set under the minimum size. Screen-reader-only text (a 1px box) is not read on screen. */
export function smallText(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ minSize, limit }) => {
      const describe = (el: Element) => `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join("")}`
      const found = new Set<string>()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim()
        const el = node.parentElement
        if (!text || !el) continue
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
        const rect = el.getBoundingClientRect()
        if (rect.width <= 1 || rect.height <= 1) continue
        const size = Number.parseFloat(getComputedStyle(el).fontSize)
        if (size < minSize) found.add(`${describe(el)} "${text.slice(0, 40)}" at ${size}px`)
        if (found.size >= limit) break
      }
      return [...found]
    },
    { minSize: MIN_FONT_SIZE_PX, limit: MAX_REPORTED },
  )
}

/** Exactly one h1, and the header, main and footer landmarks every page is built on. */
export function landmarkProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = []
    const headings = document.querySelectorAll("h1").length
    if (headings !== 1) problems.push(`${headings} <h1> (exactly one expected)`)
    for (const tag of ["header", "main", "footer"]) {
      const visible = [...document.querySelectorAll(tag)].some((el) => el.checkVisibility())
      if (!visible) problems.push(`no visible <${tag}>`)
    }
    return problems
  })
}

/**
 * Images that failed to load. The page is scrolled through first, so lazy
 * images get their chance to load instead of passing unchecked.
 */
export function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(async (limit) => {
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y)
      await pause(50)
    }
    window.scrollTo(0, 0)

    const images = [...document.images]
    const settled = (img: HTMLImageElement) =>
      img.complete ||
      img.loading === "lazy" ||
      new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true })
        img.addEventListener("error", resolve, { once: true })
      })
    await Promise.race([Promise.all(images.map(settled)), pause(10_000)])

    return images
      .filter((img) => img.complete && img.naturalWidth === 0 && img.getAttribute("src"))
      .slice(0, limit)
      .map((img) => {
        const classes = [...img.classList].map((c) => `.${c}`).join("")
        return `img${classes} ${(img.currentSrc || img.src).slice(0, 100)}`
      })
  }, MAX_REPORTED)
}
