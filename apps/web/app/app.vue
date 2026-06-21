<script setup lang="ts">
const config = useRuntimeConfig()
const siteUrl = config.public.siteUrl as string

// Site-wide SEO defaults; pages override title/description/canonical.
useHead({
  titleTemplate: (t) => (t ? `${t} — SCS Firearm` : "SCS Firearm — Gun Art, tirages d'art en édition limitée"),
})

useSeoMeta({
  ogSiteName: "SCS Firearm",
  ogType: "website",
  twitterCard: "summary_large_image",
})

// Organization JSON-LD (sitewide)
// Sitewide structured data: the Organization plus a WebSite node carrying a
// SearchAction (sitelinks search box / agent-discoverable search endpoint).
useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "SCS Firearm",
        url: siteUrl,
        description:
          "Édition et vente de tirages d'art photographiques en série strictement limitée (Gun Art), signés, numérotés et livrés avec certificat d'authenticité.",
        slogan: "Gun Art — éditions limitées",
      }),
    },
    {
      type: "application/ld+json",
      innerHTML: serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "SCS Firearm",
        url: siteUrl,
        inLanguage: "fr-FR",
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
