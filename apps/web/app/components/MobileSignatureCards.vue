<script setup lang="ts">
import { SIGNATURES } from "~/utils/signatures"

// Review of 12.15c (UI/UX) — the house's two signatures at the top of the
// mobile menu, side by side as cards: highlighted, and never buried under the
// universes' accordions.
</script>

<template>
  <ul class="msigs" aria-label="Signatures de la maison" role="list">
    <li v-for="signature in SIGNATURES" :key="signature.key" class="msigs__item">
      <NuxtLink :to="signature.to" class="msig">
        <span class="msig__title">{{ signature.label }}</span>
        <span class="msig__tagline">{{ signature.tagline }}</span>
      </NuxtLink>
    </li>
  </ul>
</template>

<style scoped>
.msigs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0 0 1.75rem;
  padding: 0;
  list-style: none;
  animation: riseIn 0.4s var(--ease) both;
  animation-delay: 0.08s;
}
.msigs__item {
  display: flex;
}
.msig {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--brass) 45%, transparent);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--brass) 6%, transparent);
  transition:
    border-color 0.25s var(--ease),
    background 0.25s var(--ease);
}
.msig:hover,
.msig:active,
.msig.router-link-active {
  border-color: var(--brass);
  background: color-mix(in srgb, var(--brass) 12%, transparent);
}
.msig__title {
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
  color: var(--brass);
}
.msig__title::before {
  /* Decorative: the empty alternative keeps screen readers from reading it. */
  content: "✦" / "";
  margin-right: 0.4em;
  font-size: 0.7em;
  vertical-align: 0.15em;
}
.msig__tagline {
  font-size: var(--fs-sm);
  color: var(--paper-faint);
}
@keyframes riseIn {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .msigs {
    animation: none;
  }
}
</style>
