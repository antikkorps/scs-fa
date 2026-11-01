<script setup lang="ts">
// A row action in an admin list, as an icon (Franck, 2026-11-01): its name is
// the accessible label and a tooltip shown on hover AND on keyboard focus —
// `title` alone never shows to a keyboard user.
type RowActionIcon = "edit" | "archive" | "restore" | "delete"

const props = defineProps<{ icon: RowActionIcon; label: string; to?: string; danger?: boolean }>()
defineEmits<{ click: [] }>()
const NuxtLink = resolveComponent("NuxtLink")

// 24×24 outline strokes, drawn with currentColor like the header icons.
const PATHS: Record<RowActionIcon, string> = {
  edit: "M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4",
  archive: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
  restore: "M4 12a8 8 0 1 0 2.3-5.6L4 8.7 M4 4v4.7h4.7",
  delete: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
}
</script>

<template>
  <component
    :is="props.to ? NuxtLink : 'button'"
    :to="props.to"
    :type="props.to ? undefined : 'button'"
    class="row-action"
    :class="{ 'row-action--danger': props.danger }"
    :aria-label="props.label"
    @click="props.to ? undefined : $emit('click')"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        :d="PATHS[props.icon]"
      />
    </svg>
    <span class="row-action__tip" role="tooltip">{{ props.label }}</span>
  </component>
</template>

<style scoped>
.row-action {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  color: var(--paper-dim);
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
  text-decoration: none;
  transition:
    color 0.15s var(--ease),
    border-color 0.15s var(--ease);
}
.row-action svg {
  width: 1.15rem;
  height: 1.15rem;
}
.row-action:hover,
.row-action:focus-visible {
  color: var(--brass);
  border-color: var(--ink-line);
}
.row-action--danger:hover,
.row-action--danger:focus-visible {
  color: var(--danger);
}
.row-action__tip {
  position: absolute;
  bottom: calc(100% + 0.35rem);
  left: 50%;
  transform: translateX(-50%);
  padding: 0.25rem 0.5rem;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--paper);
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s var(--ease);
  z-index: 2;
}
.row-action:hover .row-action__tip,
.row-action:focus-visible .row-action__tip {
  opacity: 1;
}
</style>
