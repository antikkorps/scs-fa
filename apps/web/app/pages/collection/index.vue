<script setup lang="ts">
import type { ArtworkListItem, ArtworkSeriesListItem, ArtworkThemeListItem } from "~/types/artwork"
import { artworkImage } from "~/utils/format"

const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string

const { data, error } = await useFetch<{ data: ArtworkListItem[] }>(`${apiBase}/artworks`, {
  key: "artworks-collection",
})
const artworks = computed(() => data.value?.data ?? [])

// Series and themes are editorial navigation, not the catalogue itself: if
// either call fails the grid below still stands, it simply loses its entry points.
const { data: seriesData } = await useFetch<{ data: ArtworkSeriesListItem[] }>(`${apiBase}/artworks/series`, {
  key: "artworks-series",
})
const { data: themesData } = await useFetch<{ data: ArtworkThemeListItem[] }>(`${apiBase}/artworks/themes`, {
  key: "artworks-themes",
})
// A series with nothing published in it, or a theme with no series, would be a
// dead end — they are never advertised.
const series = computed(() => (seriesData.value?.data ?? []).filter((s) => s.artworkCount > 0))
const themes = computed(() => (themesData.value?.data ?? []).filter((t) => t.seriesCount > 0))

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
        serializeJsonLd({
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

    <section v-if="series.length > 0" class="container block" aria-labelledby="series-h">
      <div class="block__head">
        <h2 id="series-h" class="section__h">Les séries</h2>
        <nav v-if="themes.length > 0" class="themes" aria-label="Navigation par thème">
          <NuxtLink v-for="t in themes" :key="t.id" :to="`/collection/theme/${t.slug}`" class="themes__chip">
            {{ t.name }}
          </NuxtLink>
        </nav>
      </div>
      <ul class="serieslist" role="list">
        <li v-for="s in series" :key="s.id">
          <SeriesCard :series="s" />
        </li>
      </ul>
    </section>

    <section class="container block" aria-labelledby="works-h">
      <h2 id="works-h" class="section__h">Toutes les œuvres</h2>
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
.block {
  padding-top: clamp(2rem, 6vw, 3.5rem);
}
.block__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.2rem;
}
.section__h {
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin: 0 0 1.2rem;
}
.block__head .section__h {
  margin: 0;
}
.themes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.themes__chip {
  padding: 0.35rem 0.85rem;
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  font-size: 0.78rem;
  color: var(--paper-dim);
  text-decoration: none;
  transition:
    color 0.2s,
    border-color 0.2s;
}
.themes__chip:hover {
  color: var(--brass);
  border-color: var(--brass);
}
.serieslist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: clamp(1.2rem, 3vw, 2rem);
  grid-template-columns: 1fr;
}
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
@media (min-width: 720px) {
  .serieslist {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (min-width: 960px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
