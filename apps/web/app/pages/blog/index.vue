<script setup lang="ts">
import type { BlogListResponse } from "~/types/blog"

const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string

const { data, error } = await useFetch<BlogListResponse>(`${apiBase}/blog`, {
  key: "blog-index",
  query: { limit: 24 },
})
const articles = computed(() => data.value?.data ?? [])

const pageUrl = `${siteUrl}/blog`
const description =
  "Le journal SCS Firearm : histoire de l'armurerie de collection, regards d'artistes et coulisses des éditions Gun Art."

useSeoMeta({
  title: "Le Journal",
  description,
  ogTitle: "Le Journal — SCS Firearm",
  ogDescription: description,
  ogUrl: pageUrl,
})

useHead({
  link: [
    { rel: "canonical", href: pageUrl },
    {
      rel: "alternate",
      type: "application/rss+xml",
      title: "SCS Firearm — Le Journal",
      href: `${siteUrl}/blog/rss.xml`,
    },
  ],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "Le Journal — SCS Firearm",
          url: pageUrl,
          blogPost: articles.value.map((a) => ({
            "@type": "BlogPosting",
            headline: a.title,
            url: `${siteUrl}/blog/${a.slug}`,
            datePublished: a.publishedAt ?? undefined,
            author: a.authorName ? { "@type": "Person", name: a.authorName } : undefined,
          })),
        }),
      ),
    },
  ],
})
</script>

<template>
  <div class="blog">
    <section class="container intro">
      <p class="eyebrow">Le Journal</p>
      <h1 class="intro__title">Histoires & coulisses</h1>
      <p class="intro__lede">
        Articles sur l'armurerie de collection, le travail des artistes et les éditions Gun Art. Une lecture lente,
        pour prolonger le regard.
      </p>
    </section>

    <section class="container">
      <p v-if="error" class="state">Le journal n'est pas disponible pour le moment. Revenez bientôt.</p>
      <p v-else-if="articles.length === 0" class="state">Aucun article publié pour l'instant.</p>

      <ul v-else class="grid" role="list">
        <li v-for="(article, i) in articles" :key="article.id">
          <BlogCard :article="article" :priority="i < 2" />
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.intro {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(1.75rem, 5vw, 3rem);
  max-width: 760px;
}
.intro__title {
  font-size: clamp(2.6rem, 8vw, 4.5rem);
  margin: 0.6rem 0 1rem;
}
.intro__lede {
  font-size: clamp(1rem, 2.4vw, 1.15rem);
  color: var(--paper-dim);
  max-width: 56ch;
  margin: 0;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0 0 1rem;
  display: grid;
  gap: clamp(1.5rem, 4vw, 2.75rem);
  grid-template-columns: 1fr;
  align-items: start;
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0 4rem;
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
