<script setup lang="ts">
// Unified search entry point (Story 9.1). Submitting navigates to the results
// page; the page itself owns the live, debounced querying.
const props = defineProps<{
  /** Pre-fill the field (e.g. on the results page). */
  initial?: string
  /** Larger field used on the results page header. */
  large?: boolean
}>()

const emit = defineEmits<{ submit: [] }>()

const term = ref(props.initial ?? "")
watch(
  () => props.initial,
  (v) => {
    term.value = v ?? ""
  },
)

function onSubmit() {
  const q = term.value.trim()
  if (q.length === 0) return
  emit("submit")
  navigateTo({ path: "/recherche", query: { q } })
}
</script>

<template>
  <form class="search" :class="{ 'search--lg': large }" role="search" @submit.prevent="onSubmit">
    <label class="search__label" for="site-search">Rechercher</label>
    <svg class="search__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
      />
    </svg>
    <input
      id="site-search"
      v-model="term"
      type="search"
      class="search__input"
      placeholder="Rechercher une œuvre, une arme…"
      autocomplete="off"
      enterkeyhint="search"
    />
  </form>
</template>

<style scoped>
.search {
  position: relative;
  display: flex;
  align-items: center;
}
.search__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.search__icon {
  position: absolute;
  left: 0.7rem;
  width: 18px;
  height: 18px;
  color: var(--paper-faint);
  pointer-events: none;
}
.search__input {
  width: 100%;
  height: 40px;
  padding: 0 0.85rem 0 2.3rem;
  font-size: 0.9rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  transition:
    border-color 0.3s var(--ease),
    background 0.3s var(--ease);
}
.search__input::placeholder {
  color: var(--paper-faint);
}
.search__input:focus {
  outline: none;
  border-color: var(--brass);
  background: var(--ink);
}
.search--lg .search__input {
  height: 52px;
  font-size: 1.05rem;
  padding-left: 2.6rem;
}
.search--lg .search__icon {
  left: 0.9rem;
  width: 20px;
  height: 20px;
}
</style>
