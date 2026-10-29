<script setup lang="ts">
import { setResponseHeader } from "h3"

// A day: the opening is weeks away, robots need not come back sooner.
const WAITING_PAGE_RETRY_AFTER_SECONDS = 86_400

const config = useRuntimeConfig()
const siteUrl = config.public.siteUrl as string

// Site-wide SEO defaults; pages override title/description/canonical.
useHead({
  titleTemplate: (t) => (t ? `${t} — SCS Firearms` : "SCS Firearms — Armurerie en ligne & Gun Art"),
})

useSeoMeta({
  ogSiteName: "SCS Firearms",
  ogType: "website",
  ogLocale: "fr_FR",
  twitterCard: "summary_large_image",
})

// Search Console ownership (story 9.6): the DNS method needs no code, but the
// HTML tag is the one a client can set up alone from the Search Console UI.
const googleSiteVerification = config.public.googleSiteVerification as string
if (googleSiteVerification) {
  useHead({ meta: [{ name: "google-site-verification", content: googleSiteVerification }] })
}

// Sitewide structured data (story 9.6): ONE Organization, identified by an
// `@id` every other node points at (the WebSite, a blog article's publisher),
// describing both universes as its two online stores. There is no physical
// point of sale, so no LocalBusiness and no address (decision 2026-09-24).
const organizationId = `${siteUrl}/#organization`

useHead({
  script: [
    {
      key: "organization-jsonld",
      type: "application/ld+json",
      innerHTML: serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": organizationId,
        name: "SCS Firearms",
        url: siteUrl,
        description:
          "Armurerie en ligne réglementée — armes de chasse et de tir, armes de collection, munitions et accessoires — et Gun Art, des tirages d'art photographiques en édition strictement limitée, signés et numérotés.",
        department: [
          {
            "@type": "OnlineStore",
            "@id": `${siteUrl}/boutique#store`,
            name: "Armurerie SCS Firearms",
            url: `${siteUrl}/boutique`,
          },
          {
            "@type": "OnlineStore",
            "@id": `${siteUrl}/collection#store`,
            name: "Gun Art — SCS Firearms",
            url: `${siteUrl}/collection`,
          },
        ],
      }),
    },
    {
      key: "website-jsonld",
      type: "application/ld+json",
      innerHTML: serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: "SCS Firearms",
        url: siteUrl,
        inLanguage: "fr-FR",
        publisher: { "@id": organizationId },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${siteUrl}/recherche?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      }),
    },
  ],
})

// Story 12.10 — before the opening, the waiting page stands in for every public
// page. A 503 with Retry-After tells robots the absence is temporary, so the
// waiting page is never taken for the content of the URL.
const route = useRoute()
const launch = useLaunch()
const waiting = computed(() => launch.waitingPageFor(route.path))
if (import.meta.server && waiting.value) {
  const event = useRequestEvent()
  if (event) {
    setResponseStatus(event, 503, "Opening soon")
    setResponseHeader(event, "retry-after", WAITING_PAGE_RETRY_AFTER_SECONDS)
  }
}
</script>

<template>
  <ComingSoonPage v-if="waiting" />
  <NuxtLayout v-else>
    <NuxtPage />
  </NuxtLayout>
</template>
