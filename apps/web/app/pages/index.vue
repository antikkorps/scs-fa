<script setup lang="ts">
import type { ArtworkListItem } from "~/types/artwork"
import type { ProductListResponse } from "~/types/product"
import { artworkImage } from "~/utils/format"

const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string

// Both universes feed the unified home: artworks (Gun Art gallery) and the
// featured-first armurerie catalogue.
const { data: artworkData } = await useFetch<{ data: ArtworkListItem[] }>(`${apiBase}/artworks`, {
  key: "home-artworks",
})
const { data: productData } = await useFetch<ProductListResponse>(`${apiBase}/products`, {
  key: "home-products",
  query: { limit: 3 },
})

const artworks = computed(() => artworkData.value?.data ?? [])
const products = computed(() => productData.value?.data ?? [])
const artSelection = computed(() => artworks.value.slice(0, 3))
const featured = computed(() => artworks.value[0] ?? null)
const heroImg = computed(() =>
  featured.value ? artworkImage(featured.value.featuredImageUrl, featured.value.slug, 1600, 1100) : null,
)

const description =
  "SCS Firearm réunit une armurerie de précision — armes, munitions, optiques et accessoires encadrés par la réglementation française — et Gun Art, des tirages d'art en édition limitée, signés, numérotés et certifiés."

useSeoMeta({
  title: "",
  description,
  ogTitle: "SCS Firearm — Armurerie de précision & Gun Art",
  ogDescription: description,
  ogUrl: siteUrl,
  ogImage: heroImg,
})

useHead({
  link: [{ rel: "canonical", href: siteUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "SCS Firearm",
        url: siteUrl,
        description,
        department: [
          { "@type": "Store", name: "Armurerie SCS Firearm", url: `${siteUrl}/boutique` },
          { "@type": "Store", name: "Gun Art", url: `${siteUrl}/collection` },
        ],
      }),
    },
  ],
})
</script>

<template>
  <div class="home">
    <!-- Brand hero -->
    <section class="hero">
      <img
        v-if="heroImg"
        class="hero__bg"
        :src="heroImg"
        alt=""
        aria-hidden="true"
        width="1600"
        height="1100"
        fetchpriority="high"
        decoding="async"
      />
      <div class="hero__veil" />
      <div class="container hero__inner">
        <p class="eyebrow">La maison SCS Firearm</p>
        <h1 class="hero__title">Armurerie de précision<br />& Gun Art.</h1>
        <p class="hero__lede">
          Deux univers, une même exigence : une armurerie encadrée par la réglementation française, et une galerie de
          tirages d'art en édition limitée. Le geste de l'armurier rencontre l'œil du collectionneur.
        </p>
        <div class="hero__actions">
          <NuxtLink to="/boutique" class="btn btn-primary">Entrer dans la boutique</NuxtLink>
          <NuxtLink to="/collection" class="btn btn-ghost">Découvrir Gun Art</NuxtLink>
        </div>
      </div>
    </section>

    <!-- Two universes -->
    <section class="container universes" aria-label="Nos deux univers">
      <NuxtLink to="/boutique" class="universe universe--shop">
        <p class="eyebrow">Armurerie</p>
        <h2 class="universe__title">La boutique</h2>
        <p class="universe__text">
          Armes de chasse et de tir, munitions, optiques et accessoires. Catégorie légale, prix TTC et contrôles requis
          affichés sur chaque article.
        </p>
        <span class="universe__cta">Explorer la boutique <span aria-hidden="true">→</span></span>
      </NuxtLink>

      <NuxtLink to="/collection" class="universe universe--art">
        <p class="eyebrow">Gun Art</p>
        <h2 class="universe__title">La collection</h2>
        <p class="universe__text">
          Des tirages photographiques d'exception, signés et numérotés, tirés à un nombre strictement limité
          d'exemplaires, avec certificat d'authenticité.
        </p>
        <span class="universe__cta">Voir la collection <span aria-hidden="true">→</span></span>
      </NuxtLink>
    </section>

    <!-- Armurerie selection -->
    <section v-if="products.length" class="container selection">
      <header class="selection__head">
        <p class="eyebrow">Armurerie</p>
        <h2 class="selection__title">Sélection de la boutique</h2>
      </header>
      <ul class="grid" role="list">
        <li v-for="(p, i) in products" :key="p.id">
          <ProductCard :product="p" :priority="i === 0" />
        </li>
      </ul>
      <div class="selection__more">
        <NuxtLink to="/boutique" class="btn btn-ghost">Voir toute la boutique</NuxtLink>
      </div>
    </section>

    <!-- Gun Art selection -->
    <section v-if="artSelection.length" class="container selection">
      <header class="selection__head">
        <p class="eyebrow">Gun Art</p>
        <h2 class="selection__title">Pièces du moment</h2>
      </header>
      <ul class="grid" role="list">
        <li v-for="art in artSelection" :key="art.id">
          <ArtworkCard :artwork="art" />
        </li>
      </ul>
      <div class="selection__more">
        <NuxtLink to="/collection" class="btn btn-ghost">Voir toute la collection</NuxtLink>
      </div>
    </section>

    <!-- À propos -->
    <section id="about" class="container about">
      <p class="eyebrow">À propos</p>
      <h2 class="about__title">Une maison, deux exigences</h2>
      <p class="about__text">
        SCS Firearm réunit deux savoir-faire&nbsp;: une <strong>armurerie de précision</strong>, où chaque arme, munition
        et accessoire est sélectionné et encadré par les obligations légales françaises, et une galerie
        <strong>Gun Art</strong>, qui élève l'objet au rang d'œuvre à travers des tirages signés en édition limitée.
      </p>
      <p class="about__text">
        Même maison, même soin du détail&nbsp;: conseil rigoureux, traçabilité, et un accompagnement de la commande
        jusqu'à la conformité réglementaire. Découvrez la
        <NuxtLink to="/boutique" class="about__link">boutique</NuxtLink> ou la
        <NuxtLink to="/collection" class="about__link">collection Gun Art</NuxtLink>.
      </p>
    </section>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  min-height: min(88vh, 760px);
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
.hero__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(0.62) saturate(0.9);
}
.hero__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(14, 14, 16, 0.35) 0%, rgba(14, 14, 16, 0.55) 55%, var(--ink) 100%);
}
.hero__inner {
  position: relative;
  padding-block: clamp(3rem, 9vw, 6rem);
  max-width: 760px;
}
.hero__title {
  font-size: clamp(2.6rem, 9vw, 5.5rem);
  margin: 0.75rem 0 1.25rem;
}
.hero__lede {
  font-size: clamp(1.05rem, 2.6vw, 1.3rem);
  color: var(--paper-dim);
  max-width: 54ch;
  margin: 0 0 2rem;
}
.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

/* Two universes */
.universes {
  padding-top: clamp(3rem, 8vw, 5.5rem);
  display: grid;
  gap: clamp(1.25rem, 3vw, 2rem);
  grid-template-columns: 1fr;
}
.universe {
  display: flex;
  flex-direction: column;
  padding: clamp(1.75rem, 4vw, 2.75rem);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  transition:
    border-color 0.3s var(--ease),
    transform 0.3s var(--ease);
}
.universe:hover {
  border-color: var(--brass);
  transform: translateY(-3px);
}
.universe__title {
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  margin: 0.4rem 0 0.9rem;
}
.universe__text {
  font-size: 1rem;
  line-height: 1.65;
  color: var(--paper-dim);
  margin: 0 0 1.5rem;
  max-width: 46ch;
}
.universe__cta {
  margin-top: auto;
  font-size: 0.8rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brass);
}

.selection {
  padding-top: clamp(3rem, 8vw, 5.5rem);
}
.selection__head {
  margin-bottom: clamp(1.5rem, 4vw, 2.5rem);
}
.selection__title {
  font-size: clamp(2rem, 6vw, 3rem);
  margin-top: 0.5rem;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: clamp(1.5rem, 4vw, 2.75rem);
  grid-template-columns: 1fr;
}
.selection__more {
  display: flex;
  justify-content: center;
  margin-top: clamp(2rem, 5vw, 3rem);
}

.about {
  padding-top: clamp(3rem, 8vw, 5.5rem);
  padding-bottom: clamp(3rem, 8vw, 5.5rem);
  max-width: 760px;
}
.about__title {
  font-size: clamp(2rem, 6vw, 3rem);
  margin: 0.5rem 0 1.25rem;
}
.about__text {
  font-size: clamp(1rem, 2.4vw, 1.12rem);
  color: var(--paper-dim);
  line-height: 1.7;
  margin: 0 0 1rem;
}
.about__text strong {
  color: var(--paper);
  font-weight: 600;
}
.about__link {
  color: var(--brass);
  text-decoration: underline;
}

@media (min-width: 720px) {
  .universes {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 560px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 960px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
