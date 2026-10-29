<script setup lang="ts">
import type { NewsletterSegment } from "@armurier/shared"

/**
 * What stands in for a purchase before the opening (story 12.10): the API
 * refuses the sale anyway (`ShopNotOpen`), so the screen says so up front and
 * offers what the visitor can do instead, hear about the opening.
 *
 * Without `what`, it is the buy button of a product page; with it, it replaces
 * a whole form ("La création de compte ouvre avec la boutique").
 */
withDefaults(
  defineProps<{
    what?: string
    /** Newsletter pre-ticked: the universe the visitor stands in. */
    segments?: NewsletterSegment[]
  }>(),
  { what: undefined, segments: () => ["armurerie"] },
)

const route = useRoute()
</script>

<template>
  <div class="closed">
    <button v-if="!what" type="button" class="btn btn-primary closed__btn" disabled>Disponible à l'ouverture</button>
    <p v-else class="closed__what">{{ what }} ouvre avec la boutique, très bientôt.</p>
    <NewsletterSignup
      :source="route.path"
      :default-segments="segments"
      title="Être prévenu de l'ouverture"
      description="Un e-mail le jour de l'ouverture des ventes, puis les arrivées — jamais de revente d'adresse."
    />
  </div>
</template>

<style scoped>
.closed {
  display: grid;
  gap: 1.25rem;
}
.closed__btn {
  width: 100%;
}
.closed__what {
  color: var(--paper-dim);
  font-size: var(--fs-md);
  line-height: var(--lh-relaxed);
}
</style>
