<script setup lang="ts">
import type { ArtworkDetail } from "~/types/artwork"
import { artworkGeometry, artworkImage, availabilityLabel, formatEuros } from "~/utils/format"

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string
const slug = route.params.slug as string

const { data, error } = await useFetch<{ data: ArtworkDetail }>(`${apiBase}/artworks/${slug}`, {
  key: `artwork-${slug}`,
})

if (error.value || !data.value?.data) {
  throw createError({ statusCode: 404, statusMessage: "Œuvre introuvable", fatal: true })
}

// Safe: we throw a fatal 404 above when data is missing, so this only renders with data.
const art = computed(() => data.value?.data as ArtworkDetail)
const heroGeometry = computed(() => artworkGeometry(art.value.orientation))
const hero = computed(() =>
  artworkImage(art.value.featuredImageUrl, art.value.slug, heroGeometry.value.width, heroGeometry.value.height),
)
const formatName = (id: string) => art.value.availableFormats?.find((f) => f.id === id)?.name ?? id
const availablePrints = computed(() => art.value.prints.filter((p) => p.status === "available"))
const soldOut = computed(() => availablePrints.value.length === 0)

const pageUrl = `${siteUrl}/collection/${slug}`
const description = computed(
  () => art.value.description ?? `${art.value.title}, tirage d'art en édition limitée signé et numéroté.`,
)

useSeoMeta({
  title: () => art.value.title,
  description,
  ogTitle: () => `${art.value.title} — SCS Firearm`,
  ogDescription: description,
  ogType: "article",
  ogUrl: pageUrl,
  ogImage: hero,
})

useHead({
  link: [{ rel: "canonical", href: pageUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "VisualArtwork",
          name: art.value.title,
          image: hero.value,
          artform: "Photographie",
          artMedium: "Tirage pigmentaire",
          creator: art.value.artistName ? { "@type": "Person", name: art.value.artistName } : undefined,
          description: description.value,
          url: pageUrl,
          ...(art.value.priceFromTtc !== null && {
            offers: {
              "@type": "Offer",
              priceCurrency: "EUR",
              price: art.value.priceFromTtc,
              availability: soldOut.value ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
              url: pageUrl,
            },
          }),
        }),
      ),
    },
    {
      type: "application/ld+json",
      innerHTML: serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Collection", item: `${siteUrl}/collection` },
          { "@type": "ListItem", position: 2, name: art.value.title, item: pageUrl },
        ],
      }),
    },
  ],
})
</script>

<template>
  <article class="detail">
    <div class="container">
      <nav class="crumbs" aria-label="Fil d'Ariane">
        <NuxtLink to="/collection">Collection</NuxtLink>
        <span aria-hidden="true">/</span>
        <span class="crumbs__current">{{ art.title }}</span>
      </nav>

      <div class="detail__grid">
        <figure class="detail__media" :style="{ aspectRatio: heroGeometry.ratio }">
          <img
            :src="hero"
            :alt="`${art.title}${art.artistName ? ` — ${art.artistName}` : ''}`"
            :width="heroGeometry.width"
            :height="heroGeometry.height"
            fetchpriority="high"
            decoding="async"
          />
        </figure>

        <div class="detail__info">
          <p v-if="art.artistName" class="eyebrow">{{ art.artistName }}</p>
          <h1 class="detail__title">{{ art.title }}</h1>

          <span class="badge" :class="soldOut ? 'badge-soldout' : 'badge-available'">
            {{ availabilityLabel(availablePrints.length, art.editionLimit) }}
          </span>

          <p v-if="art.description" class="detail__desc">{{ art.description }}</p>
          <p v-if="art.longDescription" class="detail__long">{{ art.longDescription }}</p>

          <dl class="detail__specs">
            <div>
              <dt>Édition</dt>
              <dd>{{ art.editionLimit }} exemplaires<span v-if="art.editionYear"> · {{ art.editionYear }}</span></dd>
            </div>
            <div v-if="art.includeCertificate">
              <dt>Authenticité</dt>
              <dd>Certificat signé inclus</dd>
            </div>
            <div v-if="art.priceFromTtc !== null">
              <dt>À partir de</dt>
              <dd class="detail__price">{{ formatEuros(art.priceFromTtc) }} <span>TTC</span></dd>
            </div>
          </dl>

          <section class="prints" aria-labelledby="prints-h">
            <h2 id="prints-h" class="prints__h">Exemplaires disponibles</h2>

            <p v-if="soldOut" class="prints__sold">
              Cette édition est entièrement attribuée. Contactez la maison pour la liste d'attente.
            </p>

            <ul v-else class="prints__list" role="list">
              <li v-for="p in availablePrints" :key="p.id" class="prints__row">
                <span class="prints__num">{{ p.printDesignation }}</span>
                <span class="prints__fmt">{{ formatName(p.formatId) }}</span>
                <span class="prints__price">{{ formatEuros(p.priceTtc) }}</span>
              </li>
            </ul>

            <NuxtLink v-if="!soldOut" to="/collection" class="btn btn-primary prints__cta">
              Acquérir un exemplaire
            </NuxtLink>
          </section>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.detail {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.crumbs {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: var(--paper-faint);
  text-transform: uppercase;
  margin-bottom: clamp(1.25rem, 4vw, 2.25rem);
}
.crumbs a {
  color: var(--paper-dim);
}
.crumbs a:hover {
  color: var(--brass);
}
.crumbs__current {
  color: var(--paper);
}
.detail__grid {
  display: grid;
  gap: clamp(1.75rem, 5vw, 3.5rem);
  grid-template-columns: 1fr;
  align-items: start;
}
.detail__media {
  margin: 0;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--ink-line);
  background: var(--ink-soft);
  box-shadow: var(--shadow);
}
.detail__media img {
  /* The figure carries the orientation aspect-ratio (bound inline); the image
     fills it so portrait and landscape pieces both display uncropped at scale. */
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.detail__title {
  font-size: clamp(2.4rem, 7vw, 3.6rem);
  margin: 0.5rem 0 1rem;
}
.detail__desc {
  font-size: 1.1rem;
  color: var(--paper);
  margin: 1.4rem 0 0.5rem;
}
.detail__long {
  color: var(--paper-dim);
  margin: 0 0 1rem;
}
.detail__specs {
  display: grid;
  gap: 1rem;
  margin: 1.75rem 0;
  padding: 1.5rem 0;
  border-block: 1px solid var(--ink-line);
}
.detail__specs dt {
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--brass);
  margin-bottom: 0.25rem;
}
.detail__specs dd {
  margin: 0;
  color: var(--paper);
}
.detail__price {
  font-family: var(--font-display);
  font-size: 1.6rem;
}
.detail__price span {
  font-family: var(--font-body);
  font-size: 0.72rem;
  color: var(--paper-faint);
  letter-spacing: 0.08em;
}
.prints__h {
  font-size: 1.6rem;
  margin: 0 0 1rem;
}
.prints__sold {
  color: var(--paper-dim);
}
.prints__list {
  list-style: none;
  margin: 0 0 1.75rem;
  padding: 0;
  max-height: 340px;
  overflow-y: auto;
}
.prints__row {
  display: grid;
  grid-template-columns: 4.5rem 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--ink-line);
}
.prints__num {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--brass);
}
.prints__fmt {
  color: var(--paper-dim);
  font-size: 0.9rem;
}
.prints__price {
  font-weight: 600;
}
.prints__cta {
  width: 100%;
  justify-content: center;
}

@media (min-width: 880px) {
  .detail__grid {
    grid-template-columns: 1.05fr 0.95fr;
    gap: 4rem;
  }
  .prints__cta {
    width: auto;
  }
}
</style>
