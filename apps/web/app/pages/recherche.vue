<script setup lang="ts">
import type { SearchResponse } from "~/types/artwork"

const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string

const route = useRoute()
const router = useRouter()

// `term` drives the field; `debounced` drives the request (and the URL ?q=).
const term = ref(((route.query.q as string) ?? "").toString())
const debounced = ref(term.value.trim())

let timer: ReturnType<typeof setTimeout> | null = null
watch(term, (value) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    const next = value.trim()
    debounced.value = next
    // Reflect the query in the URL (shareable, back-button friendly) without
    // stacking history entries on every keystroke.
    router.replace({ query: next ? { q: next } : {} })
  }, 300)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

const { data, error, pending } = await useAsyncData<SearchResponse | null>(
  "global-search",
  () => {
    const q = debounced.value
    if (q.length === 0) return Promise.resolve(null)
    return $fetch<SearchResponse>(`${apiBase}/search`, { query: { q } })
  },
  { watch: [debounced] },
)

const artworks = computed(() => data.value?.artworks ?? [])
const hasQuery = computed(() => debounced.value.length > 0)
const isEmpty = computed(() => hasQuery.value && !pending.value && !error.value && artworks.value.length === 0)

// Search result pages carry no standalone SEO value — keep them out of the index.
useSeoMeta({
  title: () => (hasQuery.value ? `Recherche : ${debounced.value}` : "Recherche"),
  robots: "noindex, follow",
})
</script>

<template>
  <div class="search-page">
    <section class="container head">
      <h1 class="head__title">Recherche</h1>
      <div class="head__field">
        <label class="sr-only" for="search-page-input">Rechercher</label>
        <svg class="head__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
          />
        </svg>
        <input
          id="search-page-input"
          v-model="term"
          type="search"
          class="head__input"
          placeholder="Rechercher une œuvre, une arme…"
          autocomplete="off"
          enterkeyhint="search"
        />
      </div>
    </section>

    <section class="container results">
      <p v-if="!hasQuery" class="state">Saisissez un terme pour explorer la collection.</p>
      <p v-else-if="error" class="state">La recherche est indisponible pour le moment. Réessayez bientôt.</p>
      <p v-else-if="isEmpty" class="state">
        Aucun résultat pour « {{ debounced }} ». Essayez un autre terme.
      </p>

      <template v-else-if="artworks.length > 0">
        <h2 class="results__heading">
          Œuvres <span class="results__count">{{ artworks.length }}</span>
        </h2>
        <ul class="grid" role="list">
          <li v-for="(art, i) in artworks" :key="art.id">
            <ArtworkCard :artwork="art" :priority="i < 2" />
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.head {
  padding-top: clamp(2rem, 6vw, 3.5rem);
  padding-bottom: clamp(1.25rem, 4vw, 2rem);
  max-width: 760px;
}
.head__title {
  font-size: clamp(2.2rem, 7vw, 3.5rem);
  margin: 0 0 1.25rem;
}
.head__field {
  position: relative;
  display: flex;
  align-items: center;
}
.head__icon {
  position: absolute;
  left: 0.95rem;
  width: 20px;
  height: 20px;
  color: var(--paper-faint);
  pointer-events: none;
}
.head__input {
  width: 100%;
  height: 54px;
  padding: 0 1rem 0 2.8rem;
  font-size: 1.05rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  transition:
    border-color 0.3s var(--ease),
    background 0.3s var(--ease);
}
.head__input::placeholder {
  color: var(--paper-faint);
}
.head__input:focus {
  outline: none;
  border-color: var(--brass);
  background: var(--ink);
}
.results {
  padding-bottom: 4rem;
}
.results__heading {
  font-size: 1.05rem;
  letter-spacing: 0.04em;
  margin: 0 0 1.5rem;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.results__count {
  font-size: 0.85rem;
  color: var(--paper-faint);
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0 3rem;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0 0 1rem;
  display: grid;
  gap: clamp(1.5rem, 4vw, 2.75rem);
  grid-template-columns: 1fr;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
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
