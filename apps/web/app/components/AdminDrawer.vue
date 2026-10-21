<script setup lang="ts">
// A side panel over an admin list: a row's details and actions. Closes from
// its button, the backdrop or Escape.
defineProps<{ label: string }>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close")
}
onMounted(() => document.addEventListener("keydown", onKeydown))
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown))
</script>

<template>
  <div class="drawer-scrim" @click.self="emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" :aria-label="label">
      <button class="drawer__close" type="button" aria-label="Fermer" @click="emit('close')">✕</button>
      <slot />
    </aside>
  </div>
</template>

<style scoped>
.drawer-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 50;
  display: flex;
  justify-content: flex-end;
}
.drawer {
  width: min(480px, 100%);
  height: 100%;
  overflow-y: auto;
  background: var(--ink-soft);
  border-left: 1px solid var(--ink-line);
  padding: 2rem 1.6rem;
  position: relative;
}
.drawer__close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: transparent;
  border: none;
  color: var(--paper-dim);
  font-size: var(--fs-md);
  cursor: pointer;
}
</style>
