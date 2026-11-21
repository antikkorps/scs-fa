import type { DOMWrapper } from "@vue/test-utils"

/**
 * Whether a mega-panel shows. Panels stay in the page while closed (v-show),
 * and the test mount is not attached to the document, so `isVisible()` cannot
 * tell: read the inline style v-show sets.
 */
export function isShown(panel: Pick<DOMWrapper<Element>, "exists" | "attributes">): boolean {
  return panel.exists() && !(panel.attributes("style") ?? "").includes("display: none")
}
