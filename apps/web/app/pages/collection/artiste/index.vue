<script setup lang="ts">
import type { ArtistListItem } from "~/types/artwork"

// `/collection/artiste` exists so the shortened URL is never a dead end. The
// house shows one artist today, so a list of one would be pure friction: it
// redirects straight to their page, and only becomes a real index if a second
// artist is ever published.
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string

const { data } = await useFetch<{ data: ArtistListItem[] }>(`${apiBase}/artists`, { key: "artists" })
const artists = computed(() => data.value?.data ?? [])

const only = computed(() => (artists.value.length === 1 ? artists.value[0] : null))
if (only.value) {
  await navigateTo(`/collection/artiste/${only.value.slug}`, { redirectCode: 302 })
}

useSeoMeta({
  title: "Les artistes",
  description: "Les artistes de la collection Gun Art.",
  ogUrl: `${siteUrl}/collection/artiste`,
})
// Never indexed: this page is a router, its content lives on the artist pages.
useHead({ meta: [{ name: "robots", content: "noindex, follow" }] })
</script>

<template>
  <div class="container artists">
    <p class="eyebrow">Gun Art</p>
    <h1 class="artists__title">Les artistes</h1>

    <p v-if="artists.length === 0" class="state">Aucun artiste publié pour l'instant.</p>
    <ul v-else class="list" role="list">
      <li v-for="a in artists" :key="a.id">
        <NuxtLink :to="`/collection/artiste/${a.slug}`" class="row">
          <span class="row__name">{{ a.name }}</span>
          <span v-if="a.headline" class="row__headline">{{ a.headline }}</span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.artists {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(2.5rem, 7vw, 5rem);
}
.artists__title {
  font-size: clamp(2.4rem, 7vw, 4rem);
  margin: 0.6rem 0 2rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.2rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: inherit;
  text-decoration: none;
}
.row:hover {
  border-color: var(--brass);
}
.row__name {
  font-size: 1.1rem;
}
.row__headline {
  font-size: 0.85rem;
  color: var(--paper-faint);
}
.state {
  color: var(--paper-dim);
}
</style>
