<script setup lang="ts">
import type { ShopMenuEntry, ShopMenuFilter } from "#shared/utils/menu"

// Story 12.15c — the page of a menu entry, at its path in the menu
// (/chasse/armes-longues/carabines, decision D4): its texts, its trail, its
// sub-entries, then the catalogue under the entry's saved filter. Any address
// the site has no page for ends here too, and the menu answers 404.

interface MenuPage {
  label: string
  path: string
  description: string | null
  intro: string | null
  filter: ShopMenuFilter
  breadcrumb: { label: string; href: string | null }[]
  children: ShopMenuEntry[]
  productCount: number
}

const route = useRoute()
const path = computed(() => `/${[route.params.menuPath ?? []].flat().join("/")}`)

const { data, error } = await useApiFetch<{ data: MenuPage }>("/menu/page", {
  key: `menu-page-${path.value}`,
  query: { path },
})
if (!data.value) throw missingPageError(error.value, "Page introuvable")
// The menu decides where the category and tag links lead, canonical included.
await useShopMenu().ready

const page = computed(() => data.value?.data as MenuPage)
const trail = computed(() => page.value.breadcrumb.map((step) => step.label))
const noindex = computed(() => page.value.productCount === 0)

const crumbs = computed(() => [
  { name: "Boutique", to: "/boutique" },
  ...page.value.breadcrumb.map((step) => ({ name: step.label, to: step.href ?? undefined })),
  { name: page.value.label },
])

const paragraphs = computed(() =>
  (page.value.intro ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean),
)

/** The sub-entries to follow: a heading has no page, its own entries stand in its place. */
const subentries = computed(() =>
  page.value.children
    .flatMap((child) => (child.kind === "group" ? child.children : [child]))
    .filter((entry) => entry.href),
)

// « Carabines — Armes longues · Chasse »: the entry first, then where it sits.
const title = computed(() => [page.value.label, [...trail.value].reverse().join(" · ")].filter(Boolean).join(" — "))
const description = computed(
  () =>
    page.value.description ??
    `${[...trail.value, page.value.label].join(" › ")} : la sélection de l'armurerie SCS Firearms. Catégories légales, prix TTC et stock en temps réel.`,
)

usePageSeo({
  title: () => pagedTitle(title.value, pageFromQuery(route.query.page)),
  socialTitle: () => `${title.value} — SCS Firearms`,
  description,
  path: () => page.value.path,
  // Read once: Nuxt mounts the page afresh for each path.
  noindex: noindex.value,
  // ShopCatalogue states the canonical: it knows the page of results.
  canonical: false,
})
</script>

<template>
  <div class="shop">
    <section class="container intro">
      <AppBreadcrumbs :items="crumbs" />
      <p class="eyebrow">{{ trail.at(-1) ?? "Boutique" }}</p>
      <h1 class="intro__title">{{ page.label }}</h1>
      <div v-if="paragraphs.length" class="intro__lede">
        <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
      </div>
      <nav v-if="subentries.length" class="subentries" :aria-label="`Dans « ${page.label} »`">
        <NuxtLink v-for="entry in subentries" :key="entry.path" :to="entry.href ?? ''" class="subentries__link">
          {{ entry.label }}
        </NuxtLink>
      </nav>
    </section>

    <ShopCatalogue
      :key="page.path"
      :category="page.filter.category ?? ''"
      :subcategory="page.filter.subcategory ?? undefined"
      :locked-tags="page.filter.tags"
      :locked-legal-category="page.filter.legalCategory ?? undefined"
      :base-path="page.path"
      :noindex="noindex"
      :list-name="`${page.label} — SCS Firearms`"
    />
  </div>
</template>

<style scoped>
.intro {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(1.5rem, 4vw, 2.5rem);
  max-width: 760px;
}
.intro__title {
  font-size: var(--fs-3xl);
  margin: 0.6rem 0 1rem;
}
.intro__lede {
  font-size: var(--fs-md);
  color: var(--paper-dim);
  max-width: 60ch;
}
.intro__lede p {
  margin: 0 0 0.8rem;
}
.subentries {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.2rem;
}
.subentries__link {
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  text-decoration: none;
}
.subentries__link:hover,
.subentries__link:focus-visible {
  border-color: var(--brass);
  color: var(--brass);
}
</style>
