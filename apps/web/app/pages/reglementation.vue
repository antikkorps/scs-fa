<script setup lang="ts">
import { EDITORIAL_PAGES } from "#shared/utils/editorialPages"
import { REGULATION_FAQ, regulationFaqJsonLd } from "~/utils/regulationFaq"

/**
 * The regulation guide (story 9.6): categories, what each one requires, how a
 * regulated purchase goes on this site. Content in utils/regulationFaq.ts.
 * Drafted, to be validated by Fred and Steph (shared/utils/editorialPages.ts).
 */
const REVIEWED = EDITORIAL_PAGES.reglementation.reviewed

usePageSeo({
  title: "Acheter une arme légalement : la réglementation",
  socialTitle: "Acheter une arme légalement — SCS Firearm",
  description:
    "Catégories A, B, C et D, autorisation préfectorale, déclaration, SIA, âge minimum : ce qu'il faut pour acheter une arme en France, et comment se passe un achat réglementé.",
  path: "/reglementation",
  noindex: !REVIEWED,
})

useHead({
  script: [{ type: "application/ld+json", innerHTML: serializeJsonLd(regulationFaqJsonLd()) }],
})
</script>

<template>
  <LegalPage
    crumb="Réglementation"
    eyebrow="Armurerie"
    title="Acheter une arme légalement"
    lede="Ce qu'il faut savoir avant d'acheter une arme en France, et comment se déroule un achat réglementé chez SCS Firearm."
    draft-subject="Ce guide"
    :reviewed="REVIEWED"
  >
    <section v-for="section in REGULATION_FAQ" :key="section.title">
      <h2>{{ section.title }}</h2>
      <template v-for="entry in section.entries" :key="entry.question">
        <h3>{{ entry.question }}</h3>
        <p v-for="(paragraph, i) in entry.answer" :key="i">{{ paragraph }}</p>
        <p v-if="entry.todo && !REVIEWED"><mark class="todo">[À confirmer : {{ entry.todo }}]</mark></p>
      </template>
    </section>

    <p class="legal__disclaimer">
      Ces informations sont générales et ne remplacent pas les textes officiels : le Code de la sécurité intérieure et
      le site service-public.fr font foi. En cas de doute sur un article, contactez-nous avant de commander.
    </p>
  </LegalPage>
</template>

<style scoped>
.legal__disclaimer {
  margin-top: 2.5rem;
  font-size: var(--fs-sm);
  color: var(--paper-faint);
}
</style>
