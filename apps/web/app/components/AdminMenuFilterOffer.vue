<script setup lang="ts">
import { MENU_FILTER_KEYS, type MenuFilterKey } from "@armurier/shared"

// Story 12.15e (Fred) — the filters a menu entry's page offers. Stored as the
// ones hidden, so a filter added later shows everywhere until unticked. The
// entries below hide them too: one hidden higher up stays unticked, locked.
const hidden = defineModel<MenuFilterKey[]>({ required: true })
const props = defineProps<{ inherited: MenuFilterKey[] }>()

const { tagFacetLabel } = useTags()

function labelOf(key: MenuFilterKey): string {
  return key === "legalCategory" ? "Catégorie légale" : tagFacetLabel(key)
}

const isInherited = (key: MenuFilterKey) => props.inherited.includes(key)
const isOffered = (key: MenuFilterKey) => !hidden.value.includes(key) && !isInherited(key)

function setOffered(key: MenuFilterKey, offered: boolean) {
  const next = new Set(hidden.value)
  if (offered) next.delete(key)
  else next.add(key)
  // In the declared order, whatever the clicks' order: a stable value to save.
  hidden.value = MENU_FILTER_KEYS.filter((candidate) => next.has(candidate))
}
</script>

<template>
  <fieldset class="field offer">
    <legend class="field__label">Filtres proposés sur la page</legend>
    <label v-for="key in MENU_FILTER_KEYS" :key="key" class="offer__item">
      <input
        type="checkbox"
        name="offer"
        :value="key"
        :checked="isOffered(key)"
        :disabled="isInherited(key)"
        @change="setOffered(key, ($event.target as HTMLInputElement).checked)"
      >
      {{ labelOf(key) }}
      <span v-if="isInherited(key)" class="field__help">Masqué plus haut dans la branche</span>
    </label>
    <span class="field__help">Les entrées en dessous ne proposent pas non plus les filtres décochés ici. Le prix et la recherche restent toujours.</span>
  </fieldset>
</template>

<style scoped>
.offer {
  border: none;
  padding: 0;
  margin: 0;
}

.offer__item {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
</style>
