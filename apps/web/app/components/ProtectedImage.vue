<script setup lang="ts">
// Gun Art visuals only (story 11.5).
//
// ⚠️ Deterrence, never protection. Everything displayed sits in the browser
// cache, and a screenshot defeats every line below. The measure that actually
// protects a limited edition is the watermark burnt into the pixels server-side
// (`apps/api/src/artworks/watermark.ts`) and the fact that the print-grade file
// is never served. What follows only raises the effort of a casual save.
//
// Deliberately NOT done: a click-eating transparent overlay. It would swallow
// the card link and the zoom button, and adds nothing that blocking the context
// menu and the drag does not already do.
withDefaults(
  defineProps<{
    src: string
    alt: string
    width?: number
    height?: number
    loading?: "eager" | "lazy"
    fetchpriority?: "high" | "low" | "auto"
  }>(),
  { width: undefined, height: undefined, loading: "lazy", fetchpriority: "auto" },
)
</script>

<template>
  <img
    class="protected"
    :src="src"
    :alt="alt"
    :width="width"
    :height="height"
    :loading="loading"
    :fetchpriority="fetchpriority"
    decoding="async"
    draggable="false"
    @contextmenu.prevent
    @dragstart.prevent
  />
</template>

<style scoped>
.protected {
  /* Blocks the drag-to-desktop gesture and the iOS long-press "Save image"
     sheet; `user-select` keeps a selection from dragging the node along. */
  -webkit-user-drag: none;
  -webkit-touch-callout: none;
  user-select: none;
}
</style>
