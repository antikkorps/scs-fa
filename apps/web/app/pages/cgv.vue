<script setup lang="ts">
import { CURRENT_TERMS_VERSION, TERMS_SECTIONS, WITHDRAWAL_FORM } from "@armurier/shared"
import { EDITORIAL_PAGES } from "#shared/utils/editorialPages"
import { formatDate } from "~/utils/format"

/**
 * Terms of sale (story 12.1): one text for both universes — common terms, a
 * section on regulated articles, a section on Gun Art prints. The text lives
 * in packages/shared/src/terms-content.ts, because the order confirmation
 * e-mail sends the very same text (durable medium, art. L221-13).
 *
 * ⚠️ Every change to the WORDING bumps CURRENT_TERMS_VERSION
 * (packages/shared/src/terms.ts): each order stores the version it was placed
 * under. Validation is tracked in shared/utils/editorialPages.ts.
 */
const REVIEWED = EDITORIAL_PAGES.cgv.reviewed
const VERSION_LABEL = formatDate(CURRENT_TERMS_VERSION)

usePageSeo({
  title: "Conditions générales de vente",
  description:
    "Commande, paiement, livraison, droit de rétractation, garanties et conditions propres aux armes réglementées et aux tirages Gun Art vendus sur SCS Firearms.",
  path: "/cgv",
  noindex: !REVIEWED,
})
</script>

<template>
  <LegalPage
    crumb="CGV"
    eyebrow="Informations légales"
    title="Conditions générales de vente"
    :updated-on="`${VERSION_LABEL} (version en vigueur)`"
    draft-subject="Ce texte"
    :reviewed="REVIEWED"
  >
    <section v-for="section in TERMS_SECTIONS" :key="section.title">
      <h2>{{ section.title }}</h2>
      <template v-for="(block, i) in section.blocks" :key="i">
        <p v-if="'paragraph' in block"><TermsInlines :content="block.paragraph" /></p>
        <ul v-else>
          <li v-for="(item, j) in block.list" :key="j"><TermsInlines :content="item" /></li>
        </ul>
      </template>
    </section>

    <template #after>
      <section class="withdrawal" aria-labelledby="withdrawal-h">
        <h2 id="withdrawal-h">{{ WITHDRAWAL_FORM.title }}</h2>
        <p class="withdrawal__intro">{{ WITHDRAWAL_FORM.intro }}</p>
        <div class="withdrawal__form">
          <p v-for="(line, i) in WITHDRAWAL_FORM.lines" :key="i"><TermsInlines :content="line" /></p>
        </div>
      </section>
    </template>
  </LegalPage>
</template>

<style scoped>
.withdrawal {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid var(--ink-line);
}
.withdrawal h2 {
  font-size: var(--fs-lg);
  margin: 0 0 0.75rem;
}
.withdrawal__intro {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin: 0 0 1.25rem;
}
.withdrawal__form {
  padding: 1.25rem 1.4rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
}
.withdrawal__form p {
  margin: 0 0 0.6rem;
}
.withdrawal__form p:last-child {
  margin-bottom: 0;
}
</style>
