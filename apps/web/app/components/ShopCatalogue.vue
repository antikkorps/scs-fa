<script setup lang="ts">
import { PRODUCT_SORTS, type ProductSort } from "@armurier/shared"
import type { LegalCategoryCode, ProductListResponse } from "~/types/product"
import { legalCategoryLabel } from "~/utils/product"

/**
 * The armurerie catalogue — filters, grid, pagination — shared by `/boutique`
 * and the category pages (story 9.6).
 *
 * The category is a PATH, not a filter: choosing one navigates to its own
 * indexable page (and so does a tag, on its own page — /boutique/tag/:slug), and the remaining filters (search, legal category, price,
 * tags) travel along in the query. Every filtered view canonicalises to the
 * bare page it filters; a later page of results canonicalises to itself, as a
 * distinct page of the listing.
 */
const props = defineProps<{
  /** Category slug locked by the page, or "" for the whole catalogue. */
  category: string
  /** Subcategory locked by a menu entry's page (story 12.15c). */
  subcategory?: string
  /** Tags locked by the page (a tag page, a menu entry): always applied, unticking one leaves the page. */
  lockedTags?: string[]
  /** Legal category locked by a menu entry's page: its filter is then not offered. */
  lockedLegalCategory?: string
  /** Absolute path of the page hosting the catalogue, e.g. "/boutique". */
  basePath: string
  /** Name of the list in its ItemList structured data. */
  listName: string
  /** The page is kept out of the indexes (an empty tag or universe): no canonical then (SEO audit 2026-11-15, 12). */
  noindex?: boolean
}>()

const PAGE_SIZE = 24

const config = useRuntimeConfig()
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
const legalCategory = computed(() => props.lockedLegalCategory || q("legalCategory"))
const minPrice = computed(() => q("minPrice"))
const maxPrice = computed(() => q("maxPrice"))
// UX audit 2026-11-01 (I6). "relevance", the default, stays out of the address.
const SORT_LABELS: Record<ProductSort, string> = {
  relevance: "Pertinence",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
  newest: "Nouveautés",
}
const isProductSort = (value: string): value is ProductSort => (PRODUCT_SORTS as readonly string[]).includes(value)
const sort = computed<ProductSort>(() => {
  const value = q("sort")
  return isProductSort(value) ? value : "relevance"
})
const page = computed(() => pageFromQuery(route.query.page))

// Reference data for the filters (shared with the header mega-menu, one request).
const { categories } = useProductCategories()
const { facets } = useTags()
const menuLinks = useShopMenu()
const pinnedTags = computed(() => props.lockedTags ?? [])

// `?tags=` carries a comma-separated selection, matching what the API accepts,
// so a filtered view stays copy-pasteable and survives a page reload.
// Tags of one facet add up (OR): a sibling of a pinned tag would widen the page
// (« Chasse » showing sport shooting). Their facet holds the pinned tags only.
const pinnedFacets = computed(
  () =>
    new Set(
      facets.value
        .filter((group) => group.tags.some((tag) => pinnedTags.value.includes(tag.slug)))
        .map((group) => group.facet),
    ),
)
const facetOfTag = computed(
  () => new Map(facets.value.flatMap((group) => group.tags.map((tag) => [tag.slug, group.facet] as const))),
)
const refinableFacets = computed(() =>
  facets.value.map((group) =>
    pinnedFacets.value.has(group.facet)
      ? { ...group, tags: group.tags.filter((tag) => pinnedTags.value.includes(tag.slug)) }
      : group,
  ),
)

const selectedTags = computed(() =>
  q("tags")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => {
      const facet = facetOfTag.value.get(slug)
      return slug && !(facet && pinnedFacets.value.has(facet))
    }),
)

// What the API is asked for: the page's own tag, then the visitor's.
const appliedTags = computed(() => [...pinnedTags.value, ...selectedTags.value])

function toggleTag(slug: string) {
  if (pinnedTags.value.includes(slug)) {
    router.push({ path: categoryPath(""), query: filterQuery({}) })
    return
  }
  const next = selectedTags.value.includes(slug)
    ? selectedTags.value.filter((s) => s !== slug)
    : [...selectedTags.value, slug]
  navigate({ tags: next.join(",") || undefined })
}

// Reactive query object → useFetch refetches whenever a filter changes.
const apiQuery = computed(() => {
  const query: Record<string, string | number> = { limit: PAGE_SIZE, page: page.value }
  if (props.category) query.category = props.category
  if (props.subcategory) query.subcategory = props.subcategory
  if (appliedTags.value.length > 0) query.tags = appliedTags.value.join(",")
  if (legalCategory.value) query.legalCategory = legalCategory.value
  if (term.value.trim()) query.search = term.value.trim()
  if (minPrice.value) query.minPrice = minPrice.value
  if (maxPrice.value) query.maxPrice = maxPrice.value
  if (sort.value !== "relevance") query.sort = sort.value
  return query
})

const { data, error, pending } = await useApiFetch<ProductListResponse>(`/products`, {
  key: `boutique-products-${props.category || "all"}-${props.subcategory ?? ""}-${pinnedTags.value.join(",")}-${props.lockedLegalCategory ?? ""}`,
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
    legalCategory: props.lockedLegalCategory ? "" : legalCategory.value,
    minPrice: minPrice.value,
    maxPrice: maxPrice.value,
    sort: sort.value === "relevance" ? "" : sort.value,
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

/**
 * A category's page from its first page, keeping the visitor's filters. Not a
 * tag page's own tag: it stays on its page, else every category link from it
 * would be a crawlable filtered duplicate.
 */
function categoryLink(slug: string) {
  return { path: menuLinks.categoryPath(slug), query: filterQuery({}) }
}

/** Page N of these results: the first one without `?page`. */
function pageLink(n: number) {
  return { query: filterQuery({ page: n > 1 ? String(n) : undefined }, false) }
}

// A page past the last one is not an empty page of the listing (SEO audit
// 2026-11-15, finding 13: a soft 404 with a self-canonical).
if (pagination.value && page.value > Math.max(pagination.value.totalPages, 1)) {
  throw createError({ statusCode: 404, statusMessage: "Page introuvable", fatal: true })
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
function setSort(value: string) {
  navigate({ sort: isProductSort(value) && value !== "relevance" ? value : "" })
}
function resetFilters() {
  term.value = ""
  router.push({ query: {} })
}

const visitorLegalCategory = computed(() => (props.lockedLegalCategory ? "" : legalCategory.value))
const hasFiltersBesidesTags = computed(() =>
  Boolean(visitorLegalCategory.value || minPrice.value || maxPrice.value || term.value.trim()),
)
const hasFilters = computed(() => hasFiltersBesidesTags.value || selectedTags.value.length > 0)

// On a phone the filters fold behind one button (UX audit 2026-11-01, I6: they
// took ~900 px before the first product). The search and the sort stay out.
const filtersOpen = ref(false)
const activeFilterCount = computed(
  () => [visitorLegalCategory.value, minPrice.value, maxPrice.value].filter(Boolean).length + selectedTags.value.length,
)
const filtersToggleLabel = computed(() =>
  activeFilterCount.value > 0 ? `Filtres (${activeFilterCount.value})` : "Filtres",
)

// A page narrower than its category (a tag page, most menu entries) is not
// that category's page: no category is shown as the current one.
const narrowed = computed(() => Boolean(pinnedTags.value.length || props.subcategory || props.lockedLegalCategory))

const canonicalPath = computed(() =>
  catalogueCanonicalPath(props.basePath, selectedTags.value, hasFiltersBesidesTags.value, menuLinks.shortcuts.value),
)

useHead({
  // noindex and a canonical together are contradictory signals: one or the other.
  link: props.noindex
    ? []
    : [
        {
          key: "canonical",
          rel: "canonical",
          href: computed(() => catalogueCanonical(siteUrl, canonicalPath.value, page.value)),
        },
      ],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd(
          itemListJsonLd(
            props.listName,
            products.value.map((p) => ({ url: `${siteUrl}/boutique/${p.slug}`, name: p.name })),
            (page.value - 1) * PAGE_SIZE,
          ),
        ),
      ),
    },
  ],
})
</script>

<template>
  <div class="catalogue">
    <section class="container">
      <CategoryLinks :categories="categories" :current="narrowed ? null : category" :link-for="categoryLink" />
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

        <div class="toolbar">
          <button
            type="button"
            class="filters__toggle"
            aria-controls="shop-filters"
            :aria-expanded="filtersOpen"
            @click="filtersOpen = !filtersOpen"
          >
            {{ filtersToggleLabel }}
          </button>
          <div class="toolbar__sort">
            <label for="shop-sort">Trier par</label>
            <select id="shop-sort" class="input" @change="setSort(($event.target as HTMLSelectElement).value)">
              <option v-for="value in PRODUCT_SORTS" :key="value" :value="value" :selected="value === sort">
                {{ SORT_LABELS[value] }}
              </option>
            </select>
          </div>
        </div>

        <div id="shop-filters" class="filters__panel" :class="{ 'is-open': filtersOpen }">
          <div class="filters__fields">
            <div v-if="!lockedLegalCategory" class="filters__field">
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
              <label class="sr-only" for="shop-min">Prix minimum TTC</label>
              <input
                id="shop-min"
                class="input"
                type="number"
                min="0"
                inputmode="numeric"
                placeholder="Min € TTC"
                :value="minPrice"
                @change="setFilter('minPrice', ($event.target as HTMLInputElement).value)"
              />
              <span aria-hidden="true">–</span>
              <label class="sr-only" for="shop-max">Prix maximum TTC</label>
              <input
                id="shop-max"
                class="input"
                type="number"
                min="0"
                inputmode="numeric"
                placeholder="Max € TTC"
                :value="maxPrice"
                @change="setFilter('maxPrice', ($event.target as HTMLInputElement).value)"
              />
            </div>

            <button v-if="hasFilters" type="button" class="filters__reset" @click="resetFilters">Réinitialiser</button>
          </div>
          <ProductTagFilters
            :facets="refinableFacets"
            :selected="appliedTags"
            @toggle="toggleTag"
            @clear="navigate({ tags: undefined })"
          />
        </div>
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

        <CatalogPager
          v-if="pagination && pagination.totalPages > 1"
          :page="page"
          :total-pages="pagination.totalPages"
          :link-for="pageLink"
        />
      </template>
    </section>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  gap: 0.75rem;
  margin-bottom: clamp(1.5rem, 4vw, 2.5rem);
}
.toolbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 0.75rem;
}
.filters__toggle {
  height: 48px;
  padding: 0 1.1rem;
  color: var(--paper);
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: var(--fs-base);
  cursor: pointer;
}
.filters__toggle[aria-expanded="true"] {
  border-color: var(--brass);
  color: var(--brass);
}
.toolbar__sort {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  white-space: nowrap;
}
.toolbar__sort .input {
  width: auto;
}
/* Folded on a phone until asked for; always shown from 720px. */
.filters__panel {
  display: none;
}
.filters__panel.is-open {
  display: grid;
  gap: 0.75rem;
}
.filters__fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
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
@media (min-width: 560px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 720px) {
  .filters__toggle {
    display: none;
  }
  .filters__panel {
    display: grid;
    gap: 0.75rem;
  }
  .filters__fields {
    grid-template-columns: 2fr 1fr 1fr;
    align-items: center;
  }
}
@media (min-width: 960px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
