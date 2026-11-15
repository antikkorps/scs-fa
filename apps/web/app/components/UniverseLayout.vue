<script setup lang="ts">
import type { Universe } from "#shared/utils/universes"

/**
 * A universe page (story 12.13): an editorial introduction, then the catalogue
 * of what the universe gathers — products tagged with its tag, across
 * categories, or the products of its category.
 */
const props = defineProps<{ universe: Universe; eyebrow: string; noindex?: boolean }>()

const catalogue = computed(() =>
  props.universe.source.kind === "tag"
    ? { category: "", tag: props.universe.source.slug }
    : { category: props.universe.source.slug, tag: undefined },
)
</script>

<template>
  <div class="universe">
    <section class="container intro">
      <AppBreadcrumbs :items="[{ name: 'Boutique', to: '/boutique' }, { name: universe.name }]" />
      <p class="eyebrow">{{ eyebrow }}</p>
      <h1 class="intro__title">{{ universe.name }}</h1>
      <div class="intro__lede">
        <slot />
      </div>
    </section>

    <ShopCatalogue
      :category="catalogue.category"
      :tag="catalogue.tag"
      :base-path="universe.path"
      :noindex="noindex"
      :list-name="`${universe.name} — SCS Firearms`"
    />
  </div>
</template>

<style scoped>
.intro {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(1.5rem, 4vw, 2.5rem);
  max-width: 760px;
}
.intro__title {
  font-size: var(--fs-3xl);
  margin: 0.6rem 0 1rem;
}
.intro__lede {
  font-size: var(--fs-md);
  color: var(--paper-dim);
  max-width: 60ch;
}
.intro__lede :deep(p) {
  margin: 0 0 0.8rem;
}
</style>
