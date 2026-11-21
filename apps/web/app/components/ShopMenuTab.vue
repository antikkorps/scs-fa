<script setup lang="ts">
import { NuxtLink } from "#components"
import type { ShopMenuEntry } from "#shared/utils/menu"

// Story 12.15c — one universe of the header's row. With children it opens a
// mega-panel, one column per sub-entry; without, it is a plain link.
const props = defineProps<{ tab: ShopMenuEntry; open: boolean }>()
const emit = defineEmits<{ open: []; close: [] }>()

const panelId = computed(() => `mega-${props.tab.slug}`)
</script>

<template>
  <MegaMenuItem
    v-if="tab.children.length"
    class="shop-tab__item"
    :panel-id="panelId"
    :open="open"
    @open="emit('open')"
    @close="emit('close')"
  >
    <!-- A heading has no page: a button, so the keyboard can still focus it open. -->
    <component
      :is="tab.href ? NuxtLink : 'button'"
      v-bind="tab.href ? { to: tab.href } : { type: 'button' }"
      class="shop-tab__link nav__trigger"
      :class="{ 'is-open': open }"
      :aria-expanded="open"
      :aria-controls="panelId"
    >
      {{ tab.label }}
    </component>
    <template #panel>
      <div v-for="column in tab.children" :key="column.path" class="mega__col">
        <NuxtLink v-if="column.href" :to="column.href" class="mega__heading">{{ column.label }}</NuxtLink>
        <p v-else class="mega__heading">{{ column.label }}</p>
        <template v-for="leaf in column.children" :key="leaf.path">
          <NuxtLink v-if="leaf.href" :to="leaf.href" class="mega__link">{{ leaf.label }}</NuxtLink>
          <span v-else class="mega__link mega__link--plain">{{ leaf.label }}</span>
        </template>
      </div>
      <NuxtLink v-if="tab.href" :to="tab.href" class="mega__cta">
        <span class="mega__cta-title">
          Tout « {{ tab.label }} » <span class="mega__cta-arrow" aria-hidden="true">→</span>
        </span>
        <span class="mega__cta-sub">Toute la sélection de l'univers</span>
      </NuxtLink>
    </template>
  </MegaMenuItem>
  <NuxtLink v-else :to="tab.href ?? undefined" class="shop-tab__link">{{ tab.label }}</NuxtLink>
</template>

<style scoped src="../assets/css/header-mega.css"></style>
<style scoped src="../assets/css/header-shop.css"></style>
