<script setup lang="ts">
import type { ProductCrossSellItem } from "~/types/product"
import { artworkImage, formatEuros } from "~/utils/format"

/**
 * Bloc « Fréquemment achetés ensemble » (story 11.8).
 *
 * ⚠️ Les suggestions sont saisies à la main en administration et l'API les rend
 * déjà filtrées : ce composant ne décide de rien, il affiche. Quand le bloc est
 * éteint — son état par défaut — la liste arrive vide et rien n'est rendu.
 *
 * Chaque carte est un lien vers la fiche de l'accessoire, jamais un ajout direct
 * au panier : un accessoire peut avoir des déclinaisons à choisir, et un panier
 * qui se remplit d'un clic depuis une suggestion est un panier qu'on subit.
 */
const props = defineProps<{ items: ProductCrossSellItem[]; weaponName: string }>()

const THUMB = { width: 320, height: 240 }
const thumbs = computed(() =>
  props.items.map((item) => ({ item, img: artworkImage(item.featuredImageUrl, item.slug, THUMB.width, THUMB.height) })),
)
const hasItems = computed(() => props.items.length > 0)
</script>

<template>
  <section v-if="hasItems" class="xsell" aria-labelledby="xsell-h">
    <h2 id="xsell-h" class="xsell__h">Fréquemment achetés ensemble</h2>
    <p class="xsell__intro">Les accessoires que nous recommandons avec {{ weaponName }}.</p>

    <ul class="xsell__list">
      <li v-for="{ item, img } in thumbs" :key="item.id" class="xsell__item">
        <NuxtLink :to="`/boutique/${item.slug}`" class="xsell__link">
          <img
            v-img-fallback="img.fallback"
            :src="img.src"
            :alt="item.name"
            :width="THUMB.width"
            :height="THUMB.height"
            loading="lazy"
            decoding="async"
          />
          <span class="xsell__body">
            <span v-if="item.category.name" class="eyebrow">{{ item.category.name }}</span>
            <span class="xsell__name">{{ item.name }}</span>
            <span class="xsell__price">{{ formatEuros(item.priceTtc) }} TTC</span>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.xsell {
  margin-top: clamp(2rem, 5vw, 3.5rem);
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
  border-top: 1px solid var(--ink-line);
}
.xsell__h {
  margin: 0 0 0.35rem;
  font-size: var(--fs-lg);
}
.xsell__intro {
  margin: 0 0 1.5rem;
  color: var(--paper-dim);
  font-size: var(--fs-base);
}
.xsell__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
}
.xsell__link {
  display: grid;
  gap: 0.6rem;
  height: 100%;
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--ink-soft);
  transition: border-color 0.2s ease, transform 0.2s ease;
}
.xsell__link:hover,
.xsell__link:focus-visible {
  border-color: var(--brass);
  transform: translateY(-2px);
}
.xsell__link img {
  width: 100%;
  height: auto;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
}
.xsell__body {
  display: grid;
  gap: 0.2rem;
  padding: 0 0.85rem 0.9rem;
}
.xsell__name {
  font-weight: var(--fw-semibold);
  line-height: var(--lh-snug);
}
.xsell__price {
  color: var(--brass);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .xsell__link {
    transition: none;
  }
  .xsell__link:hover,
  .xsell__link:focus-visible {
    transform: none;
  }
}
</style>
