<script setup lang="ts">
/**
 * A wide table's horizontal scrollbar, repeated above it (story 12.16b). With
 * 1 800 rows the table's own bar sat at the very bottom of the page. The top
 * bar is a mirror for the mouse: screen readers and keyboards use the real one,
 * so it is hidden from them.
 */
const body = ref<HTMLElement | null>(null)
const top = ref<HTMLElement | null>(null)
const contentWidth = ref(0)
const overflows = ref(false)

function measure() {
  if (!body.value) return
  contentWidth.value = body.value.scrollWidth
  overflows.value = body.value.scrollWidth > body.value.clientWidth
  // A bar that just appeared starts at 0 while the table may already be scrolled.
  nextTick(() => follow(body.value, top.value))
}

// Setting the same value fires no new scroll event, so the two never loop.
function follow(from: HTMLElement | null, to: HTMLElement | null) {
  if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft
}

let observer: ResizeObserver | null = null
onMounted(() => {
  measure()
  if (typeof ResizeObserver === "undefined" || !body.value) return
  // The table widens or narrows as rows are filtered and the window resizes.
  observer = new ResizeObserver(measure)
  observer.observe(body.value)
  if (body.value.firstElementChild) observer.observe(body.value.firstElementChild)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="dscroll">
    <div v-if="overflows" ref="top" class="dscroll__top" aria-hidden="true" tabindex="-1" @scroll="follow(top, body)">
      <div class="dscroll__spacer" :style="{ width: `${contentWidth}px` }" />
    </div>
    <div ref="body" class="dscroll__body" @scroll="follow(body, top)">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.dscroll__top {
  overflow-x: auto;
  overflow-y: hidden;
  margin-bottom: 0.4rem;
}
.dscroll__spacer {
  height: 1px;
}
.dscroll__body {
  overflow-x: auto;
  /* Anchors the visually-hidden header: positioned against the page, it widened it on mobile. */
  position: relative;
}
</style>
