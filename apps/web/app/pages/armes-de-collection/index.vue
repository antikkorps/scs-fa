<script setup lang="ts">
import type { AncientWeaponListResponse } from "~/types/product"
import { artworkImage, CARD_GEOMETRY, formatEuros } from "~/utils/format"
import { conditionLabel, legalCategoryLabel } from "~/utils/product"

const PAGE_SIZE = 24

const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string

const route = useRoute()
const router = useRouter()

// The URL is the source of truth, as on the main catalogue: a filtered view
// stays shareable and the back button behaves.
const q = (key: string) => {
  const v = route.query[key]
  return typeof v === "string" ? v : ""
}

const selectedTags = computed(() =>
  q("tags")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)
const showSold = computed(() => q("vendues") === "1")
const page = computed(() => {
  const n = Number.parseInt(q("page"), 10)
  return Number.isFinite(n) && n > 0 ? n : 1
})

const { facets } = useTags()
// Only the period facet makes sense here — every piece in this universe is
// second-hand by definition, so an "état" filter would be noise.
const periodFacets = computed(() => facets.value.filter((f) => f.facet === "epoque"))

const apiQuery = computed(() => {
  const query: Record<string, string | number> = { limit: PAGE_SIZE, page: page.value }
  if (selectedTags.value.length > 0) query.tags = selectedTags.value.join(",")
  // Sold pieces stay on display by default; the toggle narrows to what is
  // still buyable.
  if (!showSold.value) query.available = "true"
  return query
})

const { data, error, pending } = await useFetch<AncientWeaponListResponse>(`${apiBase}/ancient-weapons`, {
  key: "ancient-weapons",
  query: apiQuery,
})

const weapons = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)
const isEmpty = computed(() => !pending.value && !error.value && weapons.value.length === 0)

function navigate(overrides: Record<string, string | undefined>, resetPage = true) {
  const next: Record<string, string> = {}
  const base = {
    tags: selectedTags.value.join(","),
    vendues: showSold.value ? "1" : "",
    page: resetPage ? "" : String(page.value),
    ...overrides,
  }
  for (const [k, v] of Object.entries(base)) {
    if (v) next[k] = v
  }
  router.push({ query: next })
}

function goToPage(n: number) {
  navigate({ page: String(n) }, false)
}

function toggleTag(slug: string) {
  const next = selectedTags.value.includes(slug)
    ? selectedTags.value.filter((s) => s !== slug)
    : [...selectedTags.value, slug]
  navigate({ tags: next.join(",") || undefined })
}

const pageUrl = `${siteUrl}/armes-de-collection`
const description =
  "Armes anciennes et historiques : pièces uniques expertisées, d'avant 1900 aux armes de guerre. Provenance documentée, état détaillé, vente encadrée par la réglementation française."

useSeoMeta({
  title: "Armes de collection & historiques",
  description,
  ogTitle: "Armes de collection & historiques — SCS Firearm",
  ogDescription: description,
  ogUrl: pageUrl,
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
          name: "Armes de collection & historiques",
          itemListElement: weapons.value.map((w, i) => ({
            "@type": "ListItem",
            position: i + 1,
            // One canonical URL per weapon: the piece lives in the catalogue,
            // this universe is a curated view onto it.
            url: `${siteUrl}/boutique/${w.slug}`,
            name: w.name,
          })),
        }),
      ),
    },
  ],
})
</script>

<template>
  <div class="coll">
    <section class="container intro">
      <p class="eyebrow">Armurerie</p>
      <h1 class="intro__title">Armes de collection & historiques</h1>
      <p class="intro__lede">
        Chaque pièce est un exemplaire unique, expertisé et documenté : provenance, fabricant, état réel. Des armes
        anciennes d'avant 1900 aux pièces de guerre, la vente reste encadrée par la réglementation française.
      </p>
    </section>

    <section class="container">
      <div class="filters">
        <div v-if="periodFacets.length > 0" class="filters__tags">
          <span class="filters__label">Époque</span>
          <button
            v-for="tag in periodFacets.flatMap((f) => f.tags)"
            :key="tag.slug"
            type="button"
            class="chip"
            :class="{ 'chip--on': selectedTags.includes(tag.slug) }"
            :aria-pressed="selectedTags.includes(tag.slug)"
            @click="toggleTag(tag.slug)"
          >
            {{ tag.name }}
          </button>
        </div>

        <label class="filters__sold">
          <input type="checkbox" :checked="showSold" @change="navigate({ vendues: showSold ? undefined : '1' })" />
          <span>Afficher les pièces vendues</span>
        </label>
      </div>

      <p v-if="error" class="state">La collection est indisponible pour le moment. Revenez bientôt.</p>
      <p v-else-if="isEmpty" class="state">Aucune pièce ne correspond à cette sélection.</p>

      <template v-else>
        <p v-if="pagination" class="count">
          {{ pagination.total }} pièce{{ pagination.total > 1 ? "s" : "" }}
        </p>

        <ul class="grid" role="list">
          <li v-for="(w, i) in weapons" :key="w.id">
            <NuxtLink :to="`/boutique/${w.slug}`" class="card" :class="{ 'card--sold': !w.available }">
              <div class="card__media">
                <img
                  :src="artworkImage(w.featuredImageUrl, w.slug, CARD_GEOMETRY.width, CARD_GEOMETRY.height)"
                  :alt="w.name"
                  :width="CARD_GEOMETRY.width"
                  :height="CARD_GEOMETRY.height"
                  :loading="i < 3 ? 'eager' : 'lazy'"
                  :fetchpriority="i < 3 ? 'high' : 'auto'"
                />
                <AvailabilityBadge v-if="!w.available" state="sold" size="sm" class="card__sold" />
              </div>
              <div class="card__body">
                <p class="card__period">
                  {{ w.period || "Époque non datée" }}
                  <span v-if="w.legalCategory"> · {{ legalCategoryLabel(w.legalCategory) }}</span>
                </p>
                <h2 class="card__name">{{ w.name }}</h2>
                <p v-if="w.description" class="card__desc">{{ w.description }}</p>
                <p class="card__meta">
                  <span v-if="w.makerName">{{ w.makerName }}</span>
                  <span>État&nbsp;: {{ conditionLabel(w.condition) }}</span>
                </p>
                <p class="card__price">{{ formatEuros(w.priceTtc) }} <span>TTC</span></p>
              </div>
            </NuxtLink>
          </li>
        </ul>

        <nav v-if="pagination && pagination.totalPages > 1" class="pager" aria-label="Pagination">
          <button type="button" class="pager__btn" :disabled="page <= 1" @click="goToPage(page - 1)">Précédent</button>
          <span class="pager__info">Page {{ page }} / {{ pagination.totalPages }}</span>
          <button type="button" class="pager__btn" :disabled="!pagination.hasMore" @click="goToPage(page + 1)">
            Suivant
          </button>
        </nav>
      </template>
    </section>
  </div>
</template>

<style scoped>
.intro {
  padding: 3rem 0 1.5rem;
}
.eyebrow {
  color: var(--brass);
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  margin: 0 0 0.5rem;
  text-transform: uppercase;
}
.intro__title {
  font-family: var(--font-display, serif);
  font-size: clamp(2rem, 5vw, 3rem);
  margin: 0 0 0.75rem;
}
.intro__lede {
  color: var(--paper-dim);
  margin: 0;
  max-width: 62ch;
}
.filters {
  align-items: center;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  margin-bottom: 2rem;
  padding-bottom: 1.25rem;
}
.filters__tags {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.filters__label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  opacity: 0.6;
  text-transform: uppercase;
}
.chip {
  background: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: inherit;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.35rem 0.8rem;
}
.chip:hover {
  border-color: var(--brass);
}
.chip--on {
  background: color-mix(in srgb, var(--brass) 14%, transparent);
  border-color: var(--brass);
}
.filters__sold {
  align-items: center;
  color: var(--paper-dim);
  display: inline-flex;
  font-size: 0.85rem;
  gap: 0.4rem;
}
.count {
  color: var(--paper-dim);
  font-size: 0.85rem;
  margin: 0 0 1rem;
}
.state {
  color: var(--paper-dim);
  padding: 3rem 0;
  text-align: center;
}
.grid {
  display: grid;
  gap: 2rem;
  grid-template-columns: 1fr;
  list-style: none;
  margin: 0 0 3rem;
  padding: 0;
}
@media (min-width: 640px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
.card {
  color: inherit;
  display: block;
  text-decoration: none;
}
.card__media {
  aspect-ratio: 4 / 5;
  overflow: hidden;
  position: relative;
}
.card__media img {
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
  width: 100%;
}
.card:hover .card__media img {
  transform: scale(1.03);
}
.card--sold .card__media img {
  filter: grayscale(1);
  opacity: 0.55;
}
.card__sold {
  background: var(--ink, #111);
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
}
.card__body {
  padding-top: 0.9rem;
}
.card__period {
  color: var(--brass);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  margin: 0 0 0.35rem;
  text-transform: uppercase;
}
.card__name {
  font-family: var(--font-display, serif);
  font-size: 1.2rem;
  margin: 0 0 0.4rem;
}
.card__desc {
  color: var(--paper-dim);
  font-size: 0.9rem;
  margin: 0 0 0.5rem;
}
.card__meta {
  color: var(--paper-dim);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.78rem;
  gap: 0.75rem;
  margin: 0 0 0.5rem;
}
.card__price {
  font-size: 1.05rem;
  margin: 0;
}
.card__price span {
  font-size: 0.75rem;
  opacity: 0.6;
}
.pager {
  align-items: center;
  display: flex;
  gap: 1.25rem;
  justify-content: center;
  padding: 2rem 0 4rem;
}
.pager__btn {
  background: transparent;
  border: 1px solid var(--line);
  color: inherit;
  cursor: pointer;
  padding: 0.6rem 1.1rem;
}
.pager__btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.pager__info {
  color: var(--paper-dim);
  font-size: 0.85rem;
}
</style>
