<script setup lang="ts">
// The sale condition of a regulated product, as its buyer meets it: a
// customer's documents are checked after the order; a pro buys by quote, which
// can only be accepted once SCS has judged the organisation's documents (story 12.8d).
defineProps<{ pro: boolean }>()
</script>

<template>
  <p v-if="pro" class="note">
    La vente est soumise à la vérification des justificatifs de votre organisation avant l'acceptation du devis.
    <NuxtLink to="/pro/documents" class="more">Vos justificatifs</NuxtLink>
  </p>
  <p v-else class="note">
    La vente est soumise à la vérification de vos documents après la commande.
    <NuxtLink to="/reglementation" class="more">Comprendre la réglementation</NuxtLink>
  </p>
</template>

<style scoped>
.note {
  margin: 1rem 0 0;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.more {
  color: var(--brass);
  white-space: nowrap;
  /* Colour alone does not tell a link from the sentence around it (WCAG 1.4.1). */
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
