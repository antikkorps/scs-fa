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
  <article class="container legal">
    <AppBreadcrumbs :items="[{ name: 'Accueil', to: '/' }, { name: 'Réglementation' }]" />
    <p class="eyebrow">Armurerie</p>
    <h1 class="legal__title">Acheter une arme légalement</h1>
    <p class="legal__lede">
      Ce qu'il faut savoir avant d'acheter une arme en France, et comment se déroule un achat réglementé chez SCS
      Firearm.
    </p>

    <DraftNotice v-if="!REVIEWED" what="Ce guide" />

    <div class="prose">
      <section v-for="section in REGULATION_FAQ" :key="section.title">
        <h2>{{ section.title }}</h2>
        <template v-for="entry in section.entries" :key="entry.question">
          <h3>{{ entry.question }}</h3>
          <p v-for="(paragraph, i) in entry.answer" :key="i">{{ paragraph }}</p>
          <p v-if="entry.todo && !REVIEWED"><mark class="todo">[À confirmer : {{ entry.todo }}]</mark></p>
        </template>
      </section>

      <p class="legal__disclaimer">
        Ces informations sont générales et ne remplacent pas les textes officiels : le Code de la sécurité intérieure
        et le site service-public.fr font foi. En cas de doute sur un article, contactez-nous avant de commander.
      </p>
    </div>
  </article>
</template>

<style scoped>
.legal {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(2rem, 6vw, 4rem);
  max-width: 840px;
}
.legal__title {
  font-size: var(--fs-3xl);
  margin: 0.6rem 0 1rem;
}
.legal__lede {
  font-size: var(--fs-md);
  color: var(--paper-dim);
  max-width: 56ch;
  margin: 0 0 2rem;
}
.legal__disclaimer {
  margin-top: 2.5rem;
  font-size: var(--fs-sm);
  color: var(--paper-faint);
}
</style>
