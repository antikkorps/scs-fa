<script setup lang="ts">
import type { ArtworkListItem } from "~/types/artwork"
import { artworkImage } from "~/utils/format"

const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string

const { data } = await useFetch<{ data: ArtworkListItem[] }>(`${apiBase}/artworks`, { key: "artworks-collection" })
const artworks = computed(() => data.value?.data ?? [])
const featured = computed(() => artworks.value[0] ?? null)
const selection = computed(() => artworks.value.slice(0, 3))
const heroImg = computed(() =>
  featured.value ? artworkImage(featured.value.featuredImageUrl, featured.value.slug, 1600, 1100) : null,
)

const description =
  "SCS Firearm — Gun Art : tirages d'art photographiques en édition limitée, signés, numérotés et certifiés. Une collection à la croisée de l'armurerie de précision et de l'art contemporain."

useSeoMeta({
  title: "",
  description,
  ogTitle: "SCS Firearm — Gun Art en édition limitée",
  ogDescription: description,
  ogUrl: siteUrl,
  ogImage: heroImg,
})
useHead({ link: [{ rel: "canonical", href: siteUrl }] })
</script>

<template>
  <div class="home">
    <!-- Hero -->
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
        <p class="eyebrow">L'arme comme objet d'art</p>
        <h1 class="hero__title">Gun Art,<br />en édition limitée.</h1>
        <p class="hero__lede">
          Des tirages photographiques d'exception, signés et numérotés, tirés à un nombre strictement limité
          d'exemplaires. La précision de l'armurerie rencontre l'art contemporain.
        </p>
        <div class="hero__actions">
          <NuxtLink to="/collection" class="btn btn-primary">Découvrir la collection</NuxtLink>
          <a href="#selection" class="btn btn-ghost">La sélection</a>
        </div>
      </div>
    </section>

    <!-- Selection -->
    <section v-if="selection.length" id="selection" class="container selection">
      <header class="selection__head">
        <p class="eyebrow">La sélection</p>
        <h2 class="selection__title">Pièces du moment</h2>
      </header>
      <ul class="grid" role="list">
        <li v-for="(art, i) in selection" :key="art.id">
          <ArtworkCard :artwork="art" :priority="i === 0" />
        </li>
      </ul>
      <div class="selection__more">
        <NuxtLink to="/collection" class="btn btn-ghost">Voir toute la collection</NuxtLink>
      </div>
    </section>

    <!-- À propos -->
    <section id="about" class="container about">
      <p class="eyebrow">À propos</p>
      <h2 class="about__title">La maison SCS Firearm</h2>
      <p class="about__text">
        SCS Firearm réunit deux exigences&nbsp;: une <strong>armurerie de précision</strong>, où chaque arme, munition
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
  max-width: 720px;
}
.hero__title {
  font-size: clamp(3rem, 11vw, 6rem);
  margin: 0.75rem 0 1.25rem;
}
.hero__lede {
  font-size: clamp(1.05rem, 2.6vw, 1.3rem);
  color: var(--paper-dim);
  max-width: 52ch;
  margin: 0 0 2rem;
}
.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
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
