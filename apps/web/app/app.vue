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
useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "SCS Firearm",
        url: siteUrl,
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
