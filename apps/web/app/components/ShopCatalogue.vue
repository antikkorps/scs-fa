<script setup lang="ts">
import type { LegalCategoryCode, ProductListResponse } from "~/types/product"
import { legalCategoryLabel } from "~/utils/product"

/**
 * The armurerie catalogue — filters, grid, pagination — shared by `/boutique`
 * and the category pages (story 9.6).
 *
 * The category is a PATH, not a filter: choosing one navigates to its own
 * indexable page, and the remaining filters (search, legal category, price,
 * tags) travel along in the query. Every filtered view canonicalises to the
 * bare page it filters; a later page of results canonicalises to itself, as a
 * distinct page of the listing.
 */
const props = defineProps<{
  /** Category slug locked by the page, or "" for the whole catalogue. */
  category: string
  /** Absolute path of the page hosting the catalogue, e.g. "/boutique". */
  basePath: string
  /** Name of the list in its ItemList structured data. */
  listName: string
}>()

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
const legalCategory = computed(() => q("legalCategory"))
const minPrice = computed(() => q("minPrice"))
const maxPrice = computed(() => q("maxPrice"))
const page = computed(() => {
  const n = Number.parseInt(q("page"), 10)
  return Number.isFinite(n) && n > 0 ? n : 1
})

// Reference data for the filters (shared with the header mega-menu, one request).
const { categories } = useProductCategories()
const { facets } = useTags()

// `?tags=` carries a comma-separated selection, matching what the API accepts,
// so a filtered view stays copy-pasteable and survives a page reload.
const selectedTags = computed(() =>
  q("tags")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

function toggleTag(slug: string) {
  const next = selectedTags.value.includes(slug)
    ? selectedTags.value.filter((s) => s !== slug)
    : [...selectedTags.value, slug]
  navigate({ tags: next.join(",") || undefined })
}

// Reactive query object → useFetch refetches whenever a filter changes.
const apiQuery = computed(() => {
  const query: Record<string, string | number> = { limit: PAGE_SIZE, page: page.value }
  if (props.category) query.category = props.category
  if (selectedTags.value.length > 0) query.tags = selectedTags.value.join(",")
  if (legalCategory.value) query.legalCategory = legalCategory.value
  if (term.value.trim()) query.search = term.value.trim()
  if (minPrice.value) query.minPrice = minPrice.value
  if (maxPrice.value) query.maxPrice = maxPrice.value
  return query
})

const { data, error, pending } = await useFetch<ProductListResponse>(`${apiBase}/products`, {
  key: `boutique-products-${props.category || "all"}`,
  query: apiQuery,
})

const products = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)
const isEmpty = computed(() => !pending.value && !error.value && products.value.length === 0)

// The current filters + overrides, empties dropped.
function filterQuery(overrides: Record<string, string | undefined>, resetPage = true): Record<string, string> {
  const next: Record<string, string> = {}
  const base = {
    search: term.value.trim(),
    tags: selectedTags.value.join(","),
    legalCategory: legalCategory.value,
    minPrice: minPrice.value,
    maxPrice: maxPrice.value,
    page: resetPage ? "" : String(page.value),
    ...overrides,
  }
  for (const [k, v] of Object.entries(base)) {
    if (v) next[k] = v
  }
  return next
}

function navigate(overrides: Record<string, string | undefined>, resetPage = true) {
  router.push({ query: filterQuery(overrides, resetPage) })
}

/** Switching category changes page, keeping the other filters. */
function selectCategory(slug: string) {
  router.push({ path: categoryPath(slug), query: filterQuery({}) })
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
  Boolean(
    legalCategory.value || minPrice.value || maxPrice.value || term.value.trim() || selectedTags.value.length > 0,
  ),
)

useHead({
  link: [{ rel: "canonical", href: computed(() => catalogueCanonical(siteUrl, props.basePath, page.value)) }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: props.listName,
          itemListElement: products.value.map((p, i) => ({
            "@type": "ListItem",
            position: (page.value - 1) * PAGE_SIZE + i + 1,
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
  <div class="catalogue">
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
            @change="selectCategory(($event.target as HTMLSelectElement).value)"
          >
            <!-- `:selected` per option, not `:value` on the select: the latter is
                 neither rendered server-side nor re-applied when the options
                 arrive after it, so the page's own category showed as "all". -->
            <option value="" :selected="!category">Toutes les catégories</option>
            <option v-for="c in categories" :key="c.slug" :value="c.slug" :selected="c.slug === category">
              {{ c.name }}
            </option>
          </select>
        </div>

        <div class="filters__field">
          <label class="sr-only" for="shop-legal">Catégorie légale</label>
          <select
            id="shop-legal"
            class="input"
            @change="setFilter('legalCategory', ($event.target as HTMLSelectElement).value)"
          >
            <option value="" :selected="!legalCategory">Toute catégorie légale</option>
            <option v-for="code in LEGAL_CODES" :key="code" :value="code" :selected="code === legalCategory">
              {{ legalCategoryLabel(code) }}
            </option>
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

      <ProductTagFilters
        :facets="facets"
        :selected="selectedTags"
        @toggle="toggleTag"
        @clear="navigate({ tags: undefined })"
      />

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
  font-size: var(--fs-base);
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
  font-size: var(--fs-sm);
  cursor: pointer;
  padding: 0.3rem 0;
}
.count {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
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
  font-size: var(--fs-sm);
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
  font-size: var(--fs-sm);
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
