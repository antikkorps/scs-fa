<script setup lang="ts">
import { UNIVERSES } from "#shared/utils/universes"

// Story 12.13 — the hunting universe: every product tagged « chasse », whatever
// its category. Introduction = first draft, to be read by Fred.
const universe = UNIVERSES.find((u) => u.path === "/chasse") as (typeof UNIVERSES)[number]
const route = useRoute()

usePageSeo({
  title: () => pagedTitle("Chasse — armes, munitions, optiques et équipement", pageFromQuery(route.query.page)),
  socialTitle: "Chasse — SCS Firearms",
  description:
    "L'univers chasse de SCS Firearms : carabines et fusils de chasse, munitions, optiques, couteaux et équipement du chasseur. Catégories légales, prix TTC et stock en temps réel.",
  path: "/chasse",
  // ShopCatalogue states the canonical: it knows the page of results.
  canonical: false,
})
</script>

<template>
  <UniverseLayout :universe="universe" eyebrow="Univers">
    <p>
      Carabines et fusils de chasse, munitions, optiques, couteaux et équipement du chasseur : tout ce qu'il faut
      pour la saison, choisi par notre armurerie.
    </p>
    <p>
      Chaque arme indique sa catégorie légale et les pièces exigées : pour une arme de catégorie C, un permis de
      chasser validé ou une licence de tir, avec une pièce d'identité.
    </p>
  </UniverseLayout>
</template>
