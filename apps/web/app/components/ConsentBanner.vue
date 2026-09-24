<script setup lang="ts">
/**
 * Consent to audience measurement (story 9.6). Non-modal: the page stays
 * usable, nothing is measured until "Accepter". Per the CNIL guidelines,
 * refusing is exactly as easy and as visible as accepting — same buttons, same
 * weight, same place — and the choice can be changed later from the footer.
 */
const { bannerVisible, accept, refuse } = useConsent()
</script>

<template>
  <section v-if="bannerVisible" class="consent" role="region" aria-labelledby="consent-title">
    <div class="container consent__inner">
      <div class="consent__text">
        <h2 id="consent-title" class="consent__title">Mesure d'audience</h2>
        <p class="consent__body">
          Avec votre accord, nous mesurons la fréquentation du site avec Umami, un outil sans cookie publicitaire, hébergé
          par nos soins, dont les données ne sont ni revendues ni croisées.
          <NuxtLink to="/confidentialite" class="consent__link">En savoir plus</NuxtLink>
        </p>
      </div>
      <div class="consent__actions">
        <button type="button" class="btn btn-ghost consent__btn" @click="refuse">Refuser</button>
        <button type="button" class="btn btn-ghost consent__btn" @click="accept">Accepter</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.consent {
  position: fixed;
  inset: auto 0 0;
  z-index: 60;
  background: var(--ink-soft);
  border-top: 1px solid var(--ink-line);
  box-shadow: 0 -12px 32px rgb(0 0 0 / 0.35);
  padding: 1rem 0 calc(1rem + env(safe-area-inset-bottom));
}
.consent__inner {
  display: grid;
  gap: 1rem;
}
.consent__title {
  font-family: var(--font-body);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  margin: 0 0 0.35rem;
}
.consent__body {
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  margin: 0;
  max-width: 72ch;
}
.consent__link {
  color: var(--brass);
  white-space: nowrap;
}
.consent__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
.consent__btn {
  min-height: 44px;
}

@media (min-width: 760px) {
  .consent__inner {
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 2rem;
  }
  .consent__actions {
    grid-template-columns: repeat(2, minmax(8.5rem, auto));
  }
}
</style>
