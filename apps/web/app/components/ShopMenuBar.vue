<script setup lang="ts">
// Story 12.15c — the header's second row, everything one buys (review of
// 12.15c, UI/UX): « Nos univers », the menu's tabs as Fred arranges them in the
// back-office, « Plus » for those the row has no room for, then the house's
// two signatures, set apart.
const { menu } = useShopMenu()
// The header owns which panel is open, so the row never shows two.
const openPanel = defineModel<string | null>("open", { default: null })

const universes = ref<HTMLElement | null>(null)
const fitting = useTabOverflow(
  universes,
  computed(() => menu.value.length),
)
const spilled = computed(() => menu.value.slice(fitting.value))
const isSpilled = (index: number) => index >= fitting.value
</script>

<template>
  <nav class="shop-bar" aria-label="Navigation principale">
    <NuxtLink to="/boutique" class="shop-bar__label">Nos univers <span aria-hidden="true">›</span></NuxtLink>

    <ul
      ref="universes"
      class="shop-bar__universes"
      :class="{ 'shop-bar__universes--unmeasured': !Number.isFinite(fitting) }"
      aria-label="Nos univers"
      role="list"
    >
      <li
        v-for="(tab, index) in menu"
        :key="tab.path"
        class="shop-tab"
        :class="{ 'shop-tab--spilled': isSpilled(index) }"
        :aria-hidden="isSpilled(index) || undefined"
      >
        <ShopMenuTab
          :tab="tab"
          :open="openPanel === tab.slug"
          @open="openPanel = tab.slug"
          @close="openPanel = null"
        />
      </li>
      <li class="shop-more-slot">
        <ShopMenuMore :tabs="spilled" :open="openPanel === 'plus'" @open="openPanel = 'plus'" @close="openPanel = null" />
      </li>
    </ul>

    <SignatureNav v-model:open="openPanel" />
  </nav>
</template>

<style scoped>
.shop-bar {
  /* The panels anchor here: they span the whole row. */
  position: relative;
  display: flex;
  align-items: stretch;
  gap: clamp(1rem, 2vw, 1.75rem);
  width: 100%;
  height: 100%;
}
.shop-bar__label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--brass);
  transition: color 0.3s var(--ease);
}
.shop-bar__label:hover {
  color: var(--paper);
}
.shop-bar__universes {
  /* Sized by the row, never by its tabs: that width is what decides who fits. */
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: stretch;
  gap: clamp(1.25rem, 3vw - 0.5rem, 2.25rem);
  margin: 0;
  padding: 0;
  list-style: none;
}
/* Before the first measure (the server's render), a long row must not run under
   the signatures. Only then: once measured, « Plus » hangs its panel past it. */
.shop-bar__universes--unmeasured {
  overflow-x: clip;
}
.shop-tab,
.shop-more-slot {
  display: flex;
}
/* Kept in the page for crawlers, out of sight and reach: « Plus » shows it. */
.shop-tab--spilled {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
}
</style>
