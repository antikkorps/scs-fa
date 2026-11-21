<script setup lang="ts">
// A row of the mobile overlay that folds out its sub-links (default slot, as
// `<li>`s). It keeps its own state: closing the overlay unmounts it, which
// folds every accordion back.
defineProps<{ panelId: string; label: string; featured?: boolean }>()
const open = defineModel<boolean>("open", { default: false })
</script>

<template>
  <button
    type="button"
    class="mlink mlink--toggle"
    :class="{ 'is-open': open, 'mlink--feature': featured }"
    :aria-expanded="open"
    :aria-controls="panelId"
    @click="open = !open"
  >
    <span>{{ label }}</span><span class="mlink__chev" aria-hidden="true">›</span>
  </button>
  <!-- Folded, its links leave the tab order: the whole menu tree sits in here. -->
  <div class="msub-wrap" :class="{ 'is-open': open }" :inert="!open">
    <div class="msub-inner">
      <ul :id="panelId" class="msub" role="list">
        <slot />
      </ul>
    </div>
  </div>
</template>

<style scoped src="../assets/css/header-mobile.css"></style>
<style scoped>
/* Accordion toggle rows reuse .mlink but are <button>s → reset UA styles. */
.mlink--toggle {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--ink-line);
  font-family: inherit;
  cursor: pointer;
}
.mlink--toggle.is-open {
  color: var(--brass);
}
.mlink--toggle.is-open .mlink__chev {
  transform: rotate(90deg);
}
/* Collapsible sub-panel: grid-rows 0fr→1fr gives a smooth height transition. */
.msub-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s var(--ease);
}
.msub-wrap.is-open {
  grid-template-rows: 1fr;
}
.msub-inner {
  overflow: hidden;
}
.msub {
  list-style: none;
  margin: 0;
  padding: 0.25rem 0 0.6rem;
}
</style>
