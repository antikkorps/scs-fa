<script setup lang="ts">
import type { LegalCategoryCode, ProductCategoryRef, ProductListResponse } from "~/types/product"
import { legalCategoryLabel } from "~/utils/product"

const PAGE_SIZE = 24

const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string

const route = useRoute()
const router = useRouter()

const LEGAL_CODES: LegalCategoryCode[] = ["B", "C", "D", "none"]

// The URL query is the single source of truth (SSR-friendly, shareable, back
// button works). Controls read from it and write back via the router.
const q = (key: string) => {
  const v = route.query[key]
  return typeof v === "string" ? v : ""
}

const term = ref(q("search"))
const category = computed(() => q("category"))
const legalCategory = computed(() => q("legalCategory"))
const minPrice = computed(() => q("minPrice"))
const maxPrice = computed(() => q("maxPrice"))
const page = computed(() => {
  const n = Number.parseInt(q("page"), 10)
  return Number.isFinite(n) && n > 0 ? n : 1
})

// Reference data for the filters.
const { data: categories } = await useFetch<{ data: ProductCategoryRef[] }>(`${apiBase}/product-categories`, {
  key: "product-categories",
})

// Reactive query object → useFetch refetches whenever a filter changes.
const apiQuery = computed(() => {
  const query: Record<string, string | number> = { limit: PAGE_SIZE, page: page.value }
  if (category.value) query.category = category.value
  if (legalCategory.value) query.legalCategory = legalCategory.value
  if (term.value.trim()) query.search = term.value.trim()
  if (minPrice.value) query.minPrice = minPrice.value
  if (maxPrice.value) query.maxPrice = maxPrice.value
  return query
})

const { data, error, pending } = await useFetch<ProductListResponse>(`${apiBase}/products`, {
  key: "boutique-products",
  query: apiQuery,
})

const products = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)
const isEmpty = computed(() => !pending.value && !error.value && products.value.length === 0)

// Build the next URL query from the current filters + overrides, dropping empties.
function navigate(overrides: Record<string, string | undefined>, resetPage = true) {
  const next: Record<string, string> = {}
  const base = {
    search: term.value.trim(),
    category: category.value,
    legalCategory: legalCategory.value,
    minPrice: minPrice.value,
    maxPrice: maxPrice.value,
    page: resetPage ? "" : String(page.value),
    ...overrides,
  }
  for (const [k, v] of Object.entries(base)) {
    if (v) next[k] = v
  }
  router.push({ query: next })
}

// Debounce the free-text search; selects/prices commit immediately.
let timer: ReturnType<typeof setTimeout> | null = null
watch(term, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => navigate({ search: term.value.trim() || undefined }), 300)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

function setFilter(key: string, value: string) {
  navigate({ [key]: value || undefined })
}
function goToPage(n: number) {
  navigate({ page: String(n) }, false)
}
function resetFilters() {
  term.value = ""
  router.push({ query: {} })
}

const hasFilters = computed(() =>
  Boolean(category.value || legalCategory.value || minPrice.value || maxPrice.value || term.value.trim()),
)

const pageUrl = `${siteUrl}/boutique`
const description =
  "La boutique armurerie SCS Firearm : armes de chasse et de tir, munitions, optiques et accessoires. Catégories légales, prix TTC et stock en temps réel."

useSeoMeta({
  title: "Boutique armurerie",
  description,
  ogTitle: "Boutique armurerie — SCS Firearm",
  ogDescription: description,
  ogUrl: pageUrl,
})

useHead({
  // Canonical points at the bare catalogue — filtered/paginated views aren't
  // distinct indexable pages.
  link: [{ rel: "canonical", href: pageUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Boutique armurerie SCS Firearm",
          itemListElement: products.value.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${siteUrl}/boutique/${p.slug}`,
            name: p.name,
          })),
        }),
      ),
    },
  ],
})
</script>

<template>
  <div class="shop">
    <section class="container intro">
      <p class="eyebrow">Armurerie</p>
      <h1 class="intro__title">La boutique</h1>
      <p class="intro__lede">
        Armes de chasse et de tir, munitions, optiques et accessoires. Chaque article indique sa catégorie légale et
        les contrôles requis.
      </p>
    </section>

    <section class="container">
      <form class="filters" role="search" @submit.prevent>
        <div class="filters__field filters__search">
          <label class="sr-only" for="shop-search">Rechercher</label>
          <input
            id="shop-search"
            v-model="term"
            type="search"
            class="input"
            placeholder="Rechercher un article…"
            autocomplete="off"
            enterkeyhint="search"
          />
        </div>

        <div class="filters__field">
          <label class="sr-only" for="shop-category">Catégorie</label>
          <select
            id="shop-category"
            class="input"
            :value="category"
            @change="setFilter('category', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Toutes les catégories</option>
            <option v-for="c in categories?.data ?? []" :key="c.slug" :value="c.slug">{{ c.name }}</option>
          </select>
        </div>

        <div class="filters__field">
          <label class="sr-only" for="shop-legal">Catégorie légale</label>
          <select
            id="shop-legal"
            class="input"
            :value="legalCategory"
            @change="setFilter('legalCategory', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Toute catégorie légale</option>
            <option v-for="code in LEGAL_CODES" :key="code" :value="code">{{ legalCategoryLabel(code) }}</option>
          </select>
        </div>

        <div class="filters__field filters__price">
          <label class="sr-only" for="shop-min">Prix minimum</label>
          <input
            id="shop-min"
            class="input"
            type="number"
            min="0"
            inputmode="numeric"
            placeholder="Prix min €"
            :value="minPrice"
            @change="setFilter('minPrice', ($event.target as HTMLInputElement).value)"
          />
          <span aria-hidden="true">–</span>
          <label class="sr-only" for="shop-max">Prix maximum</label>
          <input
            id="shop-max"
            class="input"
            type="number"
            min="0"
            inputmode="numeric"
            placeholder="Prix max €"
            :value="maxPrice"
            @change="setFilter('maxPrice', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <button v-if="hasFilters" type="button" class="filters__reset" @click="resetFilters">Réinitialiser</button>
      </form>

      <p v-if="error" class="state">La boutique est indisponible pour le moment. Revenez bientôt.</p>
      <p v-else-if="isEmpty" class="state">Aucun article ne correspond à votre recherche.</p>

      <template v-else>
        <p v-if="pagination" class="count">{{ pagination.total }} article{{ pagination.total > 1 ? "s" : "" }}</p>
        <ul class="grid" role="list">
          <li v-for="(p, i) in products" :key="p.id">
            <ProductCard :product="p" :priority="i < 3" />
          </li>
        </ul>

        <nav v-if="pagination && pagination.totalPages > 1" class="pager" aria-label="Pagination">
          <button type="button" class="pager__btn" :disabled="page <= 1" @click="goToPage(page - 1)">Précédent</button>
          <span class="pager__info">Page {{ page }} / {{ pagination.totalPages }}</span>
          <button
            type="button"
            class="pager__btn"
            :disabled="!pagination.hasMore"
            @click="goToPage(page + 1)"
          >
            Suivant
          </button>
        </nav>
      </template>
    </section>
  </div>
</template>

<style scoped>
.intro {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(1.5rem, 4vw, 2.5rem);
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
.filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
  margin-bottom: clamp(1.5rem, 4vw, 2.5rem);
}
.filters__price {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--paper-faint);
}
.input {
  width: 100%;
  height: 48px;
  padding: 0 0.9rem;
  font-size: 0.95rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-family: inherit;
}
.input::placeholder {
  color: var(--paper-faint);
}
.input:focus {
  outline: none;
  border-color: var(--brass);
  background: var(--ink);
}
select.input {
  cursor: pointer;
}
.filters__reset {
  justify-self: start;
  background: transparent;
  border: none;
  color: var(--brass);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.3rem 0;
}
.count {
  color: var(--paper-faint);
  font-size: 0.85rem;
  margin: 0 0 1.25rem;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0 4rem;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0 0 1rem;
  display: grid;
  gap: clamp(1.5rem, 4vw, 2.75rem);
  /* One column on mobile, like the rest of the site (collection / home /
     search); 2 from 560px, 3 from 960px. */
  grid-template-columns: 1fr;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding: 2rem 0 4rem;
}
.pager__btn {
  padding: 0.6rem 1.1rem;
  background: transparent;
  color: var(--paper);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 0.85rem;
}
.pager__btn:hover:not(:disabled) {
  border-color: var(--brass);
  color: var(--brass);
}
.pager__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pager__info {
  font-size: 0.85rem;
  color: var(--paper-dim);
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
@media (min-width: 720px) {
  .filters {
    grid-template-columns: 2fr 1fr 1fr;
    align-items: center;
  }
  .filters__search {
    grid-column: 1 / -1;
  }
}
@media (min-width: 960px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
