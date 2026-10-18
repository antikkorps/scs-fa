<script setup lang="ts">
// Story 12.7b — a tab list for admin screens (WAI-ARIA tabs pattern). The page
// renders each panel itself as `id="panel-<id>"`, `aria-labelledby="tab-<id>"`.

interface Tab {
  id: string
  label: string
}

const props = defineProps<{ tabs: Tab[]; modelValue: string; label: string }>()
const emit = defineEmits<{ "update:modelValue": [id: string] }>()

const buttons = ref<HTMLButtonElement[]>([])
// Arrow keys move the focus with the selection; a click already has the focus.
let focusOnChange = false

function select(id: string) {
  if (id !== props.modelValue) emit("update:modelValue", id)
}

function step(event: KeyboardEvent) {
  const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
  if (!offset) return
  event.preventDefault()
  const current = props.tabs.findIndex((tab) => tab.id === props.modelValue)
  const next = props.tabs[(current + offset + props.tabs.length) % props.tabs.length]
  if (!next) return
  focusOnChange = true
  select(next.id)
}

watch(
  () => props.modelValue,
  async (id) => {
    if (!focusOnChange) return
    focusOnChange = false
    await nextTick()
    buttons.value[props.tabs.findIndex((tab) => tab.id === id)]?.focus()
  },
)
</script>

<template>
  <div class="tabs" role="tablist" :aria-label="label">
    <button
      v-for="tab in tabs"
      :id="`tab-${tab.id}`"
      ref="buttons"
      :key="tab.id"
      type="button"
      role="tab"
      class="tabs__tab"
      :aria-selected="tab.id === modelValue"
      :aria-controls="`panel-${tab.id}`"
      :tabindex="tab.id === modelValue ? 0 : -1"
      @click="select(tab.id)"
      @keydown="step"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.3rem;
  border-bottom: 1px solid var(--ink-line);
  margin-bottom: 1.2rem;
  overflow-x: auto;
}
.tabs__tab {
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--paper-dim);
  font: inherit;
  font-weight: var(--fw-medium);
  padding: 0.6rem 0.9rem;
  margin-bottom: -1px;
  cursor: pointer;
  white-space: nowrap;
}
.tabs__tab:hover {
  color: var(--paper);
}
.tabs__tab[aria-selected="true"] {
  color: var(--brass);
  border-bottom-color: var(--brass);
}
.tabs__tab:focus-visible {
  outline: 2px solid var(--brass);
  outline-offset: -2px;
}
</style>
