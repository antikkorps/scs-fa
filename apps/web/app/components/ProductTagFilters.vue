<script setup lang="ts">
import type { TagFacetGroup } from "~/types/product"

// Faceted tag filter. Mirrors the API semantics — OR inside a facet, AND across
// facets — so the hint text under each group tells the truth about what ticking
// a second box will do.
const props = defineProps<{
  facets: TagFacetGroup[]
  selected: string[]
}>()

const emit = defineEmits<{ toggle: [slug: string]; clear: [] }>()

const { tagFacetLabel } = useTags()

const selectedSet = computed(() => new Set(props.selected))
const hasSelection = computed(() => props.selected.length > 0)
</script>

<template>
  <div v-if="facets.length > 0" class="tagf">
    <div class="tagf__head">
      <h2 class="tagf__title">Filtrer par tag</h2>
      <button v-if="hasSelection" type="button" class="tagf__clear" @click="emit('clear')">
        Tout effacer
      </button>
    </div>

    <fieldset v-for="group in facets" :key="group.facet" class="tagf__group">
      <legend class="tagf__legend">{{ tagFacetLabel(group.facet) }}</legend>
      <p class="tagf__hint">
        Plusieurs choix élargissent le résultat&nbsp;; croiser deux rubriques le restreint.
      </p>
      <ul class="tagf__list">
        <li v-for="tag in group.tags" :key="tag.slug">
          <label class="tagf__item" :class="{ 'tagf__item--on': selectedSet.has(tag.slug) }">
            <input
              type="checkbox"
              class="tagf__box"
              :checked="selectedSet.has(tag.slug)"
              @change="emit('toggle', tag.slug)"
            />
            <span class="tagf__name">{{ tag.name }}</span>
            <span class="tagf__count" aria-label="produits">{{ tag.productCount }}</span>
          </label>
        </li>
      </ul>
    </fieldset>
  </div>
</template>

<style scoped>
.tagf {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1rem 1.1rem 1.2rem;
  margin-bottom: 1.5rem;
}

.tagf__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.tagf__title {
  font-size: 0.95rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0;
}

.tagf__clear {
  background: none;
  border: none;
  color: var(--brass);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0;
  text-decoration: underline;
}

.tagf__group {
  border: none;
  margin: 0 0 1rem;
  padding: 0;
}

.tagf__group:last-child {
  margin-bottom: 0;
}

.tagf__legend {
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.75;
  padding: 0;
}

.tagf__hint {
  font-size: 0.75rem;
  opacity: 0.6;
  margin: 0.15rem 0 0.5rem;
}

.tagf__list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.tagf__item {
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  gap: 0.45rem;
  font-size: 0.85rem;
  padding: 0.35rem 0.75rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.tagf__item:hover {
  border-color: var(--brass);
}

.tagf__item--on {
  background: color-mix(in srgb, var(--brass) 14%, transparent);
  border-color: var(--brass);
}

/* The checkbox stays in the accessibility tree and keeps keyboard/screen-reader
   semantics; only its default rendering is replaced by the pill. */
.tagf__box {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.tagf__box:focus-visible + .tagf__name {
  outline: 2px solid var(--brass);
  outline-offset: 3px;
}

.tagf__count {
  font-size: 0.75rem;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
</style>
