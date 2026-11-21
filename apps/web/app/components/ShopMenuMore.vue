<script setup lang="ts">
import type { ShopMenuEntry } from "#shared/utils/menu"

// Review of 12.15c (UI/UX) — « Plus »: the universes the row has no room for,
// a column each with its first level below. Set aside (still measurable) while
// every universe fits.
const props = defineProps<{ tabs: ShopMenuEntry[]; open: boolean }>()
const emit = defineEmits<{ open: []; close: [] }>()

const idle = computed(() => props.tabs.length === 0)
</script>

<template>
  <MegaMenuItem
    class="shop-more"
    :class="{ 'shop-more--idle': idle }"
    :aria-hidden="idle || undefined"
    panel-id="mega-plus"
    :open="open && !idle"
    @open="emit('open')"
    @close="emit('close')"
  >
    <button
      type="button"
      class="shop-tab__link nav__trigger shop-more__trigger"
      :class="{ 'is-open': open }"
      :tabindex="idle ? -1 : undefined"
      :aria-expanded="open && !idle"
      aria-controls="mega-plus"
    >
      Plus
    </button>
    <template #panel>
      <div v-for="tab in tabs" :key="tab.path" class="mega__col">
        <NuxtLink v-if="tab.href" :to="tab.href" class="mega__heading">{{ tab.label }}</NuxtLink>
        <p v-else class="mega__heading">{{ tab.label }}</p>
        <template v-for="entry in tab.children" :key="entry.path">
          <NuxtLink v-if="entry.href" :to="entry.href" class="mega__link">{{ entry.label }}</NuxtLink>
          <span v-else class="mega__link mega__link--plain">{{ entry.label }}</span>
        </template>
      </div>
    </template>
  </MegaMenuItem>
</template>

<style scoped src="../assets/css/header-mega.css"></style>
<style scoped src="../assets/css/header-shop.css"></style>
