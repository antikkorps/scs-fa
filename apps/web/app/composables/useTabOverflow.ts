import type { Ref } from "vue"
import { tabsThatFit } from "~/utils/tab-overflow"

/**
 * How many of a row's tabs fit, kept up to date as the row resizes. The row
 * holds its tabs as `.shop-tab` children and, somewhere inside, its « Plus » entry as `.shop-more`;
 * both stay measurable while set aside (visibility, not display). The server
 * and the first render keep every tab.
 */
export function useTabOverflow(row: Ref<HTMLElement | null>, tabCount: Ref<number>) {
  const fitting = ref(Number.POSITIVE_INFINITY)
  let observer: ResizeObserver | null = null

  function measure() {
    const element = row.value
    if (!element) return
    const tabs = [...element.querySelectorAll<HTMLElement>(":scope > .shop-tab")]
    const more = element.querySelector<HTMLElement>(".shop-more")
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0
    const widths = tabs.map((tab) => tab.offsetWidth)
    fitting.value = tabsThatFit(widths, element.clientWidth, more?.offsetWidth ?? 0, gap)
  }

  onMounted(() => {
    if (!row.value) return
    observer = new ResizeObserver(measure)
    observer.observe(row.value)
    // The web font changes the labels' widths without resizing the row.
    document.fonts?.ready.then(measure)
  })
  watch(tabCount, () => nextTick(measure))
  onBeforeUnmount(() => observer?.disconnect())
  return fitting
}
