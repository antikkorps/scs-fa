<script setup lang="ts">
/**
 * Marks a page whose text awaits validation by the client (story 9.6): legal
 * and regulatory pages are drafted in the codebase, then read by Fred and
 * Steph — and, for the privacy policy, completed with what only they know.
 * Pages showing it are kept out of search indexes (see `usePageSeo({ noindex })`).
 */
defineProps<{ what: string }>()
</script>

<template>
  <aside class="draft" role="note">
    <strong>Version provisoire.</strong> {{ what }} est en cours de validation : les passages
    <mark class="todo">surlignés</mark> restent à compléter avant la mise en ligne.
  </aside>
</template>

<style scoped>
.draft {
  border: 1px solid var(--brass-deep);
  background: rgb(200 163 91 / 0.08);
  color: var(--paper);
  border-radius: var(--radius);
  padding: 0.9rem 1.1rem;
  font-size: var(--fs-sm);
  margin-bottom: 2rem;
}
</style>
