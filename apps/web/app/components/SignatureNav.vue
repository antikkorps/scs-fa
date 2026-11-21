<script setup lang="ts">
import { SIGNATURES } from "~/utils/signatures"

// Review of 12.15c (UI/UX) — the house's two signatures, at the end of the
// universes' row, set apart and highlighted, each with its panel.
const openPanel = defineModel<string | null>("open", { default: null })

const panelId = (key: string) => `mega-${key}`
</script>

<template>
  <ul class="shop-bar__signatures" aria-label="Signatures de la maison" role="list">
    <li v-for="signature in SIGNATURES" :key="signature.key" class="signature-item">
      <MegaMenuItem
        :panel-id="panelId(signature.key)"
        :open="openPanel === signature.key"
        @open="openPanel = signature.key"
        @close="openPanel = null"
      >
        <NuxtLink
          :to="signature.to"
          class="nav__link nav__link--feature nav__trigger"
          :class="{ 'is-open': openPanel === signature.key }"
          :aria-expanded="openPanel === signature.key"
          :aria-controls="panelId(signature.key)"
        >
          <span class="signature-item__long">{{ signature.label }}</span>
          <span class="signature-item__short" aria-hidden="true">{{ signature.shortLabel }}</span>
        </NuxtLink>
        <template #panel><SignaturePanel :signature="signature" /></template>
      </MegaMenuItem>
    </li>
  </ul>
</template>

<style scoped src="../assets/css/header-mega.css"></style>
<style scoped src="../assets/css/header-feature.css"></style>
<style scoped>
.shop-bar__signatures {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0;
  padding: 0 0 0 1.25rem;
  list-style: none;
  border-left: 1px solid var(--ink-line);
}
.signature-item {
  display: flex;
  height: 100%;
}
/* The panels hang from the row's right edge, not off the pill. */
.signature-item :deep(.mega-item) {
  position: static;
  --mega-gap: 1px;
}
.signature-item :deep(.mega) {
  left: auto;
  right: 0;
}
.signature-item__short {
  display: none;
}
/* Where the row is narrow the pill shortens; screen readers keep the full name. */
@media (max-width: 1199px) {
  .signature-item__long {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .signature-item__short {
    display: inline;
  }
}
</style>
