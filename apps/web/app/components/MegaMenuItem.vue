<script setup lang="ts">
// One header entry with a mega-panel: the label (default slot) and its panel
// (panel slot). The header decides which single panel is open; this item only
// asks to open or close.
const props = defineProps<{ panelId: string; open: boolean }>()
const emit = defineEmits<{ open: []; close: [] }>()

// The label is a link to its landing page, not a toggle (Franck, 2026-09-23).
// It used to be a button that toggled: the pointer entering opened the panel,
// and the click that naturally followed closed it again — hovering then
// clicking the label, which is what anyone does, made the menu vanish.
// Hover or keyboard focus opens it, leaving or Escape closes it, and the click
// goes where the label says.
function close() {
  // Only the open item may close: grazing another item with the pointer must
  // not shut a panel the keyboard opened.
  if (props.open) emit("close")
}

// Keyboard: close the panel when focus leaves the whole item.
function onFocusOut(event: FocusEvent) {
  const item = event.currentTarget as HTMLElement | null
  if (item && !item.contains(event.relatedTarget as Node | null)) close()
}
</script>

<template>
  <div class="mega-item" @pointerenter="emit('open')" @pointerleave="close" @focusin="emit('open')" @focusout="onFocusOut">
    <slot />
    <Transition name="mega">
      <div v-if="open" :id="panelId" class="mega">
        <slot name="panel" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mega-item {
  /* The gap between the label and its panel; a row may tighten it. */
  --mega-gap: 18px;
  position: relative;
  display: flex;
  align-items: center;
}
.mega {
  position: absolute;
  top: calc(100% + var(--mega-gap));
  left: 0;
  z-index: 70;
  display: flex;
  gap: 2.5rem;
  padding: 1.5rem 1.75rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
/* Invisible bridge so the pointer can cross the gap without closing the panel. */
.mega::before {
  content: "";
  position: absolute;
  top: calc(-1 * var(--mega-gap));
  left: 0;
  right: 0;
  height: var(--mega-gap);
}
.mega-enter-active,
.mega-leave-active {
  transition:
    opacity 0.2s var(--ease),
    transform 0.2s var(--ease);
}
.mega-enter-from,
.mega-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
