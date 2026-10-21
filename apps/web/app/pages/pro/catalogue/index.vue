<script setup lang="ts">
import type { Pagination } from "~/types/account"
import type { ProProductCard } from "~/types/quote"
import { artworkImage, CARD_GEOMETRY, formatEuros, IMAGE_SIZES } from "~/utils/format"
import { isRegulated, legalCategoryLabel } from "~/utils/product"

// Story 12.8c — the pro catalogue: the armurerie and the products reserved for
// pros, ordered by quote. Never a public price: the pro's net price at most.
definePageMeta({ middleware: "auth" })
useHead({ title: "Catalogue professionnel — SCS Firearms" })

const PAGE_SIZE = 24

const api = useApi()
const access = useProAccess()
const ready = ref(false)

const products = ref<ProProductCard[]>([])
const pagination = ref<Pagination | null>(null)
const categories = ref<{ slug: string; name: string }[]>([])
const loading = ref(false)
const error = ref(false)

const search = ref("")
const appliedSearch = ref("")
const category = ref("")
const page = ref(1)

async function load() {
  loading.value = true
  error.value = false
  try {
    const query = {
      page: page.value,
      limit: PAGE_SIZE,
      ...(appliedSearch.value ? { search: appliedSearch.value } : {}),
      ...(category.value ? { category: category.value } : {}),
    }
    const res = await api<{ data: ProProductCard[]; pagination: Pagination }>("/pro/products", { query })
    products.value = res.data
    pagination.value = res.pagination
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await access.load()
  ready.value = true
  if (!access.isApprovedPro.value) return
  const [, list] = await Promise.all([load(), api<{ data: { slug: string; name: string }[] }>("/product-categories")])
  categories.value = list?.data ?? []
})

function applySearch() {
  appliedSearch.value = search.value.trim()
  page.value = 1
  return load()
}
watch(category, () => {
  page.value = 1
  return load()
})
function goTo(next: number) {
  page.value = next
  return load()
}

const imageOf = (product: ProProductCard) =>
  artworkImage(product.featuredImageUrl, product.slug, CARD_GEOMETRY.width, CARD_GEOMETRY.height)
</script>

<template>
  <div class="pro">
    <section class="container pro__inner">
      <header class="pro__head">
        <p class="eyebrow">Espace professionnel</p>
        <h1 class="pro__title">Catalogue professionnel</h1>
        <p class="pro__lede">
          Ajoutez les articles à votre demande : notre équipe vous répond par un devis.
          <NuxtLink to="/pro/demande" class="pro__link">Ma demande en cours</NuxtLink> ·
          <NuxtLink to="/pro/demandes" class="pro__link">Mes demandes</NuxtLink>
        </p>
      </header>

      <p v-if="!ready" class="state">Chargement…</p>
      <ProAccessNotice v-else-if="!access.isApprovedPro.value" :organisation="access.organisation.value" />

      <template v-else>
        <form class="pro-filters" role="search" @submit.prevent="applySearch">
          <label class="pro-filters__search">
            <span class="sr-only">Rechercher</span>
            <input v-model="search" type="search" class="ctl" placeholder="Rechercher un article" />
          </label>
          <label>
            <span class="sr-only">Catégorie</span>
            <select v-model="category" class="ctl">
              <option value="">Toutes les catégories</option>
              <option v-for="option in categories" :key="option.slug" :value="option.slug">{{ option.name }}</option>
            </select>
          </label>
          <button type="submit" class="btn btn-ghost">Rechercher</button>
        </form>

        <p v-if="loading" class="state">Chargement…</p>
        <p v-else-if="error" class="state">Impossible de charger le catalogue. Veuillez réessayer.</p>
        <p v-else-if="products.length === 0" class="state">Aucun article ne correspond.</p>

        <ul v-else class="pro-grid" role="list">
          <li v-for="(product, index) in products" :key="product.id" class="pro-card">
            <NuxtLink :to="`/pro/catalogue/${product.slug}`" class="pro-card__link">
              <div class="pro-card__media">
                <ResponsiveImage
                  :image="imageOf(product)"
                  :sizes="IMAGE_SIZES.card"
                  :alt="product.name"
                  :width="CARD_GEOMETRY.width"
                  :height="CARD_GEOMETRY.height"
                  :loading="index < 4 ? 'eager' : 'lazy'"
                />
                <span v-if="product.audience === 'pro'" class="pro-card__badge">Réservé pro</span>
              </div>
              <p class="pro-card__cat">{{ product.category.name }}</p>
              <h2 class="pro-card__name">{{ product.name }}</h2>
              <p class="pro-card__meta">
                <span :class="{ 'pro-card__legal': isRegulated(product.legalCategory) }">
                  {{ legalCategoryLabel(product.legalCategory) }}
                </span>
                <span class="pro-card__price">
                  {{ product.netPriceHt === null ? "Prix sur devis" : `${formatEuros(product.netPriceHt)} HT` }}
                </span>
              </p>
            </NuxtLink>
          </li>
        </ul>

        <nav v-if="pagination && pagination.totalPages > 1" class="pager" aria-label="Pages">
          <button class="btn btn-ghost" :disabled="page <= 1" @click="goTo(page - 1)">Précédent</button>
          <span class="pager__info">Page {{ pagination.page }} / {{ pagination.totalPages }}</span>
          <button class="btn btn-ghost" :disabled="!pagination.hasMore" @click="goTo(page + 1)">Suivant</button>
        </nav>
      </template>
    </section>
  </div>
</template>

<style scoped>
.pro {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.pro__inner {
  padding-bottom: 4rem;
}
.pro__head {
  margin-bottom: 1.75rem;
}
.pro__title {
  font-size: var(--fs-2xl);
  margin: 0.4rem 0 0.5rem;
}
.pro__lede {
  margin: 0;
  color: var(--paper-dim);
}
.pro__link {
  color: var(--brass);
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0 3rem;
}
.pro-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-bottom: 1.5rem;
}
.pro-filters__search {
  flex: 1 1 16rem;
}
.ctl {
  width: 100%;
  padding: 0.65rem 0.8rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-base);
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.pro-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
  gap: 1.5rem;
}
.pro-card__link {
  display: block;
  color: inherit;
}
.pro-card__media {
  position: relative;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.pro-card__media :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pro-card__badge {
  position: absolute;
  top: 0.7rem;
  left: 0.7rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  background: rgba(10, 10, 10, 0.75);
  border: 1px solid var(--brass);
  color: var(--brass);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
}
.pro-card__cat {
  margin: 0.8rem 0 0.2rem;
  font-size: var(--fs-xs);
  color: var(--paper-faint);
  text-transform: uppercase;
  letter-spacing: var(--ls-wide);
}
.pro-card__name {
  font-size: var(--fs-md);
  margin: 0 0 0.4rem;
}
.pro-card__meta {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.pro-card__legal {
  color: var(--brass);
}
.pro-card__price {
  color: var(--paper);
  white-space: nowrap;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 2rem;
}
.pager__info {
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
</style>
