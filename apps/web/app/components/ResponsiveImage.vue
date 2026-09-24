<script setup lang="ts">
import type { ImageSource } from "~/utils/format"

/**
 * Every catalogue image on the site (story 9.6).
 *
 * A stored rendition comes in several widths and two formats: the browser picks
 * AVIF when it can and the width the layout needs, described by `sizes`. Before
 * this, every card fetched the 1400px WebP, including on a 390px phone.
 *
 * `<picture>` is `display: contents`, so the <img> lays out exactly as it did
 * when it was the element itself — the call sites' CSS is untouched. Extra
 * attributes (class, style…) land on the <img>.
 *
 * `protect` is for Gun Art visuals (story 11.5). ⚠️ Deterrence, never
 * protection: everything displayed sits in the browser cache and a screenshot
 * defeats every line of it. What protects a limited edition is the watermark
 * burnt in server-side — in every format and width — and the print-grade file
 * never being served. Deliberately NOT done: a click-eating overlay, which would
 * swallow the card link and the zoom button for no added protection.
 */
defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    image: ImageSource
    alt: string
    /** How wide the image is displayed, for the browser to pick a width. */
    sizes?: string
    width?: number | string
    height?: number | string
    loading?: "eager" | "lazy"
    fetchpriority?: "high" | "low" | "auto"
    protect?: boolean
  }>(),
  {
    sizes: "100vw",
    width: undefined,
    height: undefined,
    loading: "lazy",
    fetchpriority: "auto",
    protect: false,
  },
)
</script>

<template>
  <picture v-if="image.avifSrcset || image.webpSrcset" class="rimg">
    <source v-if="image.avifSrcset" type="image/avif" :srcset="image.avifSrcset" :sizes="sizes" />
    <source v-if="image.webpSrcset" type="image/webp" :srcset="image.webpSrcset" :sizes="sizes" />
    <img
      v-bind="$attrs"
      v-img-fallback="image.fallback"
      :class="{ protected: protect }"
      :src="image.src"
      :alt="alt"
      :width="width"
      :height="height"
      :loading="loading"
      :fetchpriority="fetchpriority"
      decoding="async"
      :draggable="protect ? 'false' : undefined"
      @contextmenu="protect && $event.preventDefault()"
      @dragstart="protect && $event.preventDefault()"
    />
  </picture>
  <img
    v-else
    v-bind="$attrs"
    v-img-fallback="image.fallback"
    :class="{ protected: protect }"
    :src="image.src"
    :alt="alt"
    :width="width"
    :height="height"
    :loading="loading"
    :fetchpriority="fetchpriority"
    decoding="async"
    :draggable="protect ? 'false' : undefined"
    @contextmenu="protect && $event.preventDefault()"
    @dragstart="protect && $event.preventDefault()"
  />
</template>

<style scoped>
.rimg {
  display: contents;
}
.protected {
  /* Blocks the drag-to-desktop gesture and the iOS long-press "Save image"
     sheet; `user-select` keeps a selection from dragging the node along. */
  -webkit-user-drag: none;
  -webkit-touch-callout: none;
  user-select: none;
}
</style>
