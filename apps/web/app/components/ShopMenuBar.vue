<script setup lang="ts">
import type { ShopMenuEntry } from "#shared/utils/menu"

// Story 12.15c — the header's second row: the shop menu's tabs, as Fred
// arranges them in the back-office. A tab with children opens a mega-panel,
// one column per sub-entry; a tab without is a plain link.
const { menu } = useShopMenu()
// The header owns which panel is open, so Gun Art and the tabs never show two.
const openPanel = defineModel<string | null>("open", { default: null })

const panelId = (tab: ShopMenuEntry) => `mega-${tab.slug}`
const isOpen = (tab: ShopMenuEntry) => openPanel.value === tab.slug
</script>

<template>
  <nav class="shop-bar" aria-label="Rayons de la boutique">
    <template v-for="tab in menu" :key="tab.path">
      <MegaMenuItem
        v-if="tab.children.length"
        class="shop-tab"
        :panel-id="panelId(tab)"
        :open="isOpen(tab)"
        @open="openPanel = tab.slug"
        @close="openPanel = null"
      >
        <NuxtLink
          :to="tab.href ?? undefined"
          class="shop-tab__link nav__trigger"
          :class="{ 'is-open': isOpen(tab) }"
          :aria-expanded="isOpen(tab)"
          :aria-controls="panelId(tab)"
        >
          {{ tab.label }}
        </NuxtLink>
        <template #panel>
          <div v-for="column in tab.children" :key="column.path" class="mega__col">
            <NuxtLink v-if="column.href" :to="column.href" class="mega__heading">{{ column.label }}</NuxtLink>
            <p v-else class="mega__heading">{{ column.label }}</p>
            <NuxtLink v-for="leaf in column.children" :key="leaf.path" :to="leaf.href ?? undefined" class="mega__link">
              {{ leaf.label }}
            </NuxtLink>
          </div>
          <NuxtLink v-if="tab.href" :to="tab.href" class="mega__cta">
            <span class="mega__cta-title">
              Tout « {{ tab.label }} » <span class="mega__cta-arrow" aria-hidden="true">→</span>
            </span>
            <span class="mega__cta-sub">Toute la sélection du rayon</span>
          </NuxtLink>
        </template>
      </MegaMenuItem>
      <NuxtLink v-else :to="tab.href ?? undefined" class="shop-tab shop-tab__link">{{ tab.label }}</NuxtLink>
    </template>

    <NuxtLink to="/boutique" class="shop-bar__all">
      Toute la boutique <span aria-hidden="true">→</span>
    </NuxtLink>
  </nav>
</template>

<style scoped src="../assets/css/header-mega.css"></style>
<style scoped>
.shop-bar {
  /* The panels anchor here, so they span the whole row instead of hanging off
     a tab and running past the screen's edge for the tabs on the right. */
  position: relative;
  display: flex;
  align-items: stretch;
  gap: clamp(1.25rem, 3vw - 0.5rem, 2.5rem);
  width: 100%;
  height: 100%;
}
.shop-bar .shop-tab {
  position: static;
  --mega-gap: 1px;
}
.shop-tab :deep(.mega) {
  right: 0;
  justify-content: flex-start;
}
.shop-tab__link {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  letter-spacing: var(--ls-wide);
  color: var(--paper-dim);
  transition: color 0.3s var(--ease);
}
.shop-tab__link:hover,
.shop-tab__link.router-link-active {
  color: var(--paper);
}
.mega__col {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 170px;
}
.mega__cta {
  margin-left: auto;
  align-self: flex-start;
}
.shop-bar__all {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  white-space: nowrap;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-wide);
  color: var(--paper-faint);
  transition: color 0.3s var(--ease);
}
.shop-bar__all:hover {
  color: var(--brass);
}
</style>
