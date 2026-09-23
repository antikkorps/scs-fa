<script setup lang="ts">
import type { ArtistListItem } from "~/types/artwork"
import { artworkImage } from "~/utils/format"

// The entry point into Gun Art is the artist, not the print (Franck, 2026-09-23):
// the house sells someone's work, and a visitor who does not know whose is
// looking at objects rather than at a body of work.
//
// `lead` is the first card on /collection, laid out wider with the biography
// showing. The others stay compact, so a second artist changes the row without
// changing the component.
const props = withDefaults(defineProps<{ artist: ArtistListItem; lead?: boolean }>(), { lead: false })

const PORTRAIT = { width: 480, height: 600 }
const portrait = computed(() =>
  artworkImage(props.artist.portraitUrl, props.artist.slug, PORTRAIT.width, PORTRAIT.height),
)
</script>

<template>
  <NuxtLink :to="`/collection/artiste/${artist.slug}`" class="artist" :class="{ 'artist--lead': lead }">
    <img
      v-img-fallback="portrait.fallback"
      class="artist__portrait"
      :src="portrait.src"
      :alt="`Portrait de ${artist.name}`"
      :width="PORTRAIT.width"
      :height="PORTRAIT.height"
      loading="lazy"
      decoding="async"
    />
    <div class="artist__body">
      <p class="eyebrow">L'artiste</p>
      <h3 class="artist__name">{{ artist.name }}</h3>
      <p v-if="artist.headline" class="artist__headline">{{ artist.headline }}</p>
      <p v-if="lead && artist.bio" class="artist__bio">{{ artist.bio }}</p>
      <span class="artist__cta">Découvrir son travail <span aria-hidden="true">→</span></span>
    </div>
  </NuxtLink>
</template>

<style scoped>
.artist {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.4rem;
  height: 100%;
  padding: 1.3rem 1.4rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: inherit;
  text-decoration: none;
  transition:
    border-color 0.3s var(--ease),
    transform 0.4s var(--ease);
}
.artist:hover {
  border-color: var(--brass);
  transform: translateY(-2px);
}
.artist__portrait {
  width: 100%;
  /* `height` is set as an attribute so the browser reserves the right box before
     the portrait loads — but on an <img> that attribute maps to the CSS height
     property, which beats `aspect-ratio`. Without this the portrait rendered at
     its full 600px and left the card half empty. */
  height: auto;
  aspect-ratio: 4 / 5;
  object-fit: cover;
  border-radius: var(--radius);
}
.artist__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}
.artist__name {
  margin: 0.4rem 0 0.3rem;
  font-size: var(--fs-xl);
}
.artist__headline {
  margin: 0;
  color: var(--paper-dim);
  font-size: var(--fs-base);
}
.artist__bio {
  margin: 0.9rem 0 0;
  color: var(--paper-dim);
  font-size: var(--fs-base);
  line-height: var(--lh-relaxed);
  max-width: 58ch;
}
.artist__cta {
  margin-top: 1.1rem;
  color: var(--brass);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
}
.artist:hover .artist__cta {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* The lead card reads as a portrait beside a text column once there is room. */
@media (min-width: 760px) {
  .artist--lead {
    grid-template-columns: minmax(200px, 300px) 1fr;
    align-items: center;
    gap: 2rem;
    padding: 1.6rem 1.8rem;
  }
  .artist--lead .artist__name {
    font-size: var(--fs-2xl);
  }
}
</style>
