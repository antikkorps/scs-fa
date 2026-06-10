<script setup lang="ts">
import type { ArtworkListItem } from "~/types/artwork"
import { artworkImage } from "~/utils/format"

const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string

const { data, error } = await useFetch<{ data: ArtworkListItem[] }>(`${apiBase}/artworks`, {
  key: "artworks-collection",
})
const artworks = computed(() => data.value?.data ?? [])

const pageUrl = `${siteUrl}/collection`
const description =
  "Découvrez la collection Gun Art : des tirages d'art photographiques en édition strictement limitée, signés, numérotés et livrés avec certificat d'authenticité."

useSeoMeta({
  title: "La collection Gun Art",
  description,
  ogTitle: "La collection Gun Art — SCS Firearm",
  ogDescription: description,
  ogUrl: pageUrl,
  ogImage: () =>
    artworks.value[0] ? artworkImage(artworks.value[0].featuredImageUrl, artworks.value[0].slug) : undefined,
})

useHead({
  link: [{ rel: "canonical", href: pageUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Collection Gun Art",
          itemListElement: artworks.value.map((a, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${siteUrl}/collection/${a.slug}`,
            name: a.title,
          })),
        }),
      ),
    },
  ],
})
</script>

<template>
  <div class="collection">
    <section class="container intro">
      <p class="eyebrow">Éditions limitées</p>
      <h1 class="intro__title">La collection Gun Art</h1>
      <p class="intro__lede">
        Des pièces photographiques tirées à un nombre strictement limité d'exemplaires. Chaque tirage est signé,
        numéroté et accompagné de son certificat d'authenticité.
      </p>
    </section>

    <section class="container">
      <p v-if="error" class="state">La collection n'est pas disponible pour le moment. Revenez bientôt.</p>
      <p v-else-if="artworks.length === 0" class="state">Aucune œuvre publiée pour l'instant.</p>

      <ul v-else class="grid" role="list">
        <li v-for="(art, i) in artworks" :key="art.id">
          <ArtworkCard :artwork="art" :priority="i < 2" />
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.intro {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(1.75rem, 5vw, 3rem);
  max-width: 760px;
}
.intro__title {
  font-size: clamp(2.6rem, 8vw, 4.5rem);
  margin: 0.6rem 0 1rem;
}
.intro__lede {
  font-size: clamp(1rem, 2.4vw, 1.15rem);
  color: var(--paper-dim);
  max-width: 56ch;
  margin: 0;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0 0 1rem;
  display: grid;
  gap: clamp(1.5rem, 4vw, 2.75rem);
  grid-template-columns: 1fr;
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0 4rem;
}

@media (min-width: 560px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 960px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
