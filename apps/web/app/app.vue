<script setup lang="ts">
const config = useRuntimeConfig()
const siteUrl = config.public.siteUrl as string

// Site-wide SEO defaults; pages override title/description/canonical.
useHead({
  titleTemplate: (t) => (t ? `${t} — SCS Firearm` : "SCS Firearm — Armurerie en ligne & Gun Art"),
})

useSeoMeta({
  ogSiteName: "SCS Firearm",
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
        name: "SCS Firearm",
        url: siteUrl,
        description:
          "Armurerie en ligne réglementée — armes de chasse et de tir, armes de collection, munitions et accessoires — et Gun Art, des tirages d'art photographiques en édition strictement limitée, signés et numérotés.",
        department: [
          {
            "@type": "OnlineStore",
            "@id": `${siteUrl}/boutique#store`,
            name: "Armurerie SCS Firearm",
            url: `${siteUrl}/boutique`,
          },
          {
            "@type": "OnlineStore",
            "@id": `${siteUrl}/collection#store`,
            name: "Gun Art — SCS Firearm",
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
        name: "SCS Firearm",
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
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
