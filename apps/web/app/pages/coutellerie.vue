<script setup lang="ts">
import { UNIVERSES } from "#shared/utils/universes"

// Story 12.13 — the knife universe: the « coutellerie » category, sold to
// adults only (12.13c). Introduction = first draft, to be read by Fred.
const universe = UNIVERSES.find((u) => u.path === "/coutellerie") as (typeof UNIVERSES)[number]
const route = useRoute()

usePageSeo({
  title: () => pagedTitle("Coutellerie — couteaux pliants, à lame fixe et de chasse", pageFromQuery(route.query.page)),
  socialTitle: "Coutellerie — SCS Firearms",
  description:
    "La coutellerie SCS Firearms : couteaux pliants, à lame fixe et de chasse, des meilleures marques. Vente réservée aux personnes majeures.",
  path: "/coutellerie",
  // ShopCatalogue states the canonical: it knows the page of results.
  canonical: false,
})
</script>

<template>
  <UniverseLayout :universe="universe" eyebrow="Univers">
    <p>Couteaux pliants, à lame fixe et de chasse : une sélection de lames pour l'usage comme pour la collection.</p>
    <p>
      Vente réservée aux personnes de 18 ans et plus : la date de naissance est demandée à la première commande.
      Le port d'un couteau sans motif légitime est interdit.
    </p>
  </UniverseLayout>
</template>
