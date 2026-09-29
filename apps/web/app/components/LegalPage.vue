<script setup lang="ts">
/**
 * Frame shared by the reference pages drafted in the codebase — privacy policy,
 * regulation guide (story 9.6), legal notice and CGV (story 12.1): breadcrumb,
 * header, draft notice while the client has not validated the text, then the
 * body in `.prose`. Each page keeps its own SEO and its `reviewed` flag from
 * shared/utils/editorialPages.ts.
 */
defineProps<{
  /** Last breadcrumb item. */
  crumb: string
  eyebrow: string
  title: string
  /** Shown when the page is not validated: "Cette politique", "Ce guide"… */
  draftSubject: string
  reviewed: boolean
  /** Human date of the last change to the text. */
  updatedOn?: string
  lede?: string
}>()
</script>

<template>
  <article class="container legal">
    <AppBreadcrumbs :items="[{ name: 'Accueil', to: '/' }, { name: crumb }]" />
    <p class="eyebrow">{{ eyebrow }}</p>
    <h1 class="legal__title">{{ title }}</h1>
    <p v-if="updatedOn" class="legal__updated">Dernière mise à jour : {{ updatedOn }}</p>
    <p v-if="lede" class="legal__lede">{{ lede }}</p>

    <DraftNotice v-if="!reviewed" :what="draftSubject" />

    <div class="prose">
      <slot />
    </div>

    <slot name="after" />
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
  margin: 0.6rem 0 0.5rem;
}
.legal__updated {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin: 0 0 2rem;
}
.legal__lede {
  font-size: var(--fs-md);
  color: var(--paper-dim);
  max-width: 56ch;
  margin: 0.5rem 0 2rem;
}
</style>
