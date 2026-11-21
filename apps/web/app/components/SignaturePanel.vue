<script setup lang="ts">
import type { Signature } from "~/utils/signatures"

// The mega-panel of one of the house's signatures: its pitch, then its two ways in.
defineProps<{ signature: Signature }>()
</script>

<template>
  <div class="signature">
    <div class="signature__pitch">
      <p class="mega__label">{{ signature.label }}</p>
      <p class="signature__lede">{{ signature.lede }}</p>
      <ul class="signature__points" role="list">
        <li v-for="point in signature.points" :key="point">{{ point }}</li>
      </ul>
    </div>
    <div class="signature__ctas">
      <NuxtLink v-for="cta in signature.ctas" :key="cta.to" :to="cta.to" class="mega__cta">
        <span class="mega__cta-title">{{ cta.title }} <span class="mega__cta-arrow" aria-hidden="true">→</span></span>
        <span class="mega__cta-sub">{{ cta.sub }}</span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped src="../assets/css/header-mega.css"></style>
<style scoped>
.signature {
  display: flex;
  gap: 2.5rem;
  min-width: 400px;
}
.signature__pitch {
  max-width: 260px;
}
.signature__lede {
  margin: 0 0 0.9rem;
  font-size: var(--fs-base);
  line-height: var(--lh-relaxed);
  color: var(--paper-dim);
}
.signature__points {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.signature__points li {
  position: relative;
  padding-left: 1.1rem;
  font-size: var(--fs-sm);
  color: var(--paper-faint);
}
.signature__points li::before {
  content: "›";
  position: absolute;
  left: 0;
  color: var(--brass);
}
.signature__ctas {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-self: center;
}
</style>
