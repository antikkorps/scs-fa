<script setup lang="ts">
// A value the customer copies into their bank's app — an IBAN, a BIC, a transfer
// reference (audit 2026-11-01, I1): shown as read (`display`), copied as typed
// (`value`). If the browser refuses the clipboard, the value stays selectable.
const props = defineProps<{ value: string; display?: string; label: string }>()

const status = ref("")
let reset: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    status.value = "Copié"
  } catch {
    status.value = "Copie impossible, sélectionnez le texte"
  }
  clearTimeout(reset)
  reset = setTimeout(() => {
    status.value = ""
  }, 2500)
}

onBeforeUnmount(() => clearTimeout(reset))
</script>

<template>
  <span class="copy">
    <span class="copy__value">{{ props.display ?? props.value }}</span>
    <button type="button" class="copy__btn" :aria-label="`Copier ${props.label}`" @click="copy">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M9 9h11v11H9z M5 15H4V4h11v1"
        />
      </svg>
    </button>
    <span class="copy__status" role="status">{{ status }}</span>
  </span>
</template>

<style scoped>
/* The button stays beside the value, which wraps between its groups if it must. */
.copy {
  display: inline-grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 0.5rem;
}
.copy__value {
  user-select: all;
  overflow-wrap: anywhere;
}
.copy__btn {
  display: inline-grid;
  place-items: center;
  /* A 44 px target on touch screens, drawn small. */
  width: 2.75rem;
  height: 2.75rem;
  margin: -0.6rem -0.6rem -0.6rem 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--paper-dim);
  cursor: pointer;
}
.copy__btn:hover,
.copy__btn:focus-visible {
  color: var(--brass);
}
.copy__btn svg {
  width: 1.1rem;
  height: 1.1rem;
}
.copy__status {
  grid-column: 1 / -1;
  text-align: right;
  font-size: var(--fs-sm);
  color: var(--brass);
}
/* Empty, it takes no room but stays in the accessibility tree, so the live
   region is already there when "Copié" is written into it. */
.copy__status:empty {
  position: absolute;
}
</style>
