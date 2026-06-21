<script setup lang="ts">
import type { BlogArticleDetail } from "~/types/blog"
import { formatDate } from "~/utils/format"

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = config.public.apiBase as string
const siteUrl = config.public.siteUrl as string
const slug = route.params.slug as string

const { data, error } = await useFetch<{ data: BlogArticleDetail }>(`${apiBase}/blog/${slug}`, {
  key: `blog-${slug}`,
})

if (error.value || !data.value?.data) {
  throw createError({ statusCode: 404, statusMessage: "Article introuvable", fatal: true })
}

// Safe: we throw a fatal 404 above when data is missing, so this only renders with data.
const article = computed(() => data.value?.data as BlogArticleDetail)
const hero = computed(() => article.value.featuredImageUrl || undefined)

const pageUrl = `${siteUrl}/blog/${slug}`
const description = computed(
  () => article.value.metaDescription ?? article.value.excerpt ?? `${article.value.title} — Le Journal SCS Firearm.`,
)

useSeoMeta({
  title: () => article.value.metaTitle ?? article.value.title,
  description,
  ogTitle: () => `${article.value.title} — SCS Firearm`,
  ogDescription: description,
  ogType: "article",
  ogUrl: pageUrl,
  ogImage: hero,
  articlePublishedTime: () => article.value.publishedAt ?? undefined,
  articleModifiedTime: () => article.value.updatedAt ?? undefined,
})

useHead({
  link: [{ rel: "canonical", href: pageUrl }],
  script: [
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: article.value.title,
          image: hero.value,
          description: description.value,
          url: pageUrl,
          mainEntityOfPage: pageUrl,
          datePublished: article.value.publishedAt ?? undefined,
          dateModified: article.value.updatedAt ?? article.value.publishedAt ?? undefined,
          author: article.value.authorName
            ? { "@type": "Person", name: article.value.authorName }
            : { "@type": "Organization", name: "SCS Firearm" },
          publisher: { "@type": "Organization", name: "SCS Firearm" },
          ...(article.value.tags && {
            keywords: article.value.tags,
          }),
        }),
      ),
    },
    {
      type: "application/ld+json",
      innerHTML: computed(() =>
        serializeJsonLd({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Le Journal", item: `${siteUrl}/blog` },
            { "@type": "ListItem", position: 2, name: article.value.title, item: pageUrl },
          ],
        }),
      ),
    },
  ],
})
</script>

<template>
  <article class="post">
    <div class="container">
      <nav class="crumbs" aria-label="Fil d'Ariane">
        <NuxtLink to="/blog">Le Journal</NuxtLink>
        <span aria-hidden="true">/</span>
        <span class="crumbs__current">{{ article.title }}</span>
      </nav>

      <header class="post__head">
        <p v-if="article.category" class="eyebrow">{{ article.category }}</p>
        <h1 class="post__title">{{ article.title }}</h1>
        <p class="post__meta">
          <span v-if="article.authorName">{{ article.authorName }} · </span>
          <time v-if="article.publishedAt" :datetime="article.publishedAt">{{
            formatDate(article.publishedAt)
          }}</time>
        </p>
      </header>

      <figure v-if="hero" class="post__media">
        <img :src="hero" :alt="article.title" width="1200" height="800" fetchpriority="high" decoding="async" />
      </figure>

      <!-- Body is admin-authored HTML served from the API (trusted content). -->
      <div class="post__body" v-html="article.content" />
    </div>
  </article>
</template>

<style scoped>
.post {
  padding: clamp(1.5rem, 4vw, 2.5rem) 0 clamp(3rem, 8vw, 6rem);
}
.crumbs {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: clamp(1.5rem, 4vw, 2.5rem);
}
.crumbs a:hover {
  color: var(--brass);
}
.crumbs__current {
  color: var(--paper-dim);
}
.post__head {
  max-width: 760px;
}
.post__title {
  font-size: clamp(2.2rem, 6vw, 3.6rem);
  margin: 0.5rem 0 0.9rem;
}
.post__meta {
  font-size: 0.85rem;
  color: var(--paper-faint);
  margin: 0;
}
.post__media {
  margin: clamp(1.75rem, 5vw, 3rem) 0;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--ink-line);
  background: var(--ink-soft);
  box-shadow: var(--shadow);
  aspect-ratio: 3 / 2;
}
.post__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.post__body {
  max-width: 720px;
  font-size: 1.08rem;
  line-height: 1.8;
  color: var(--paper-dim);
}
.post__body :deep(h2) {
  font-family: var(--font-display);
  color: var(--paper);
  font-size: clamp(1.6rem, 4vw, 2.1rem);
  margin: 2.2rem 0 0.9rem;
}
.post__body :deep(h3) {
  font-family: var(--font-display);
  color: var(--paper);
  font-size: 1.35rem;
  margin: 1.8rem 0 0.7rem;
}
.post__body :deep(p) {
  margin: 0 0 1.2rem;
}
.post__body :deep(a) {
  color: var(--brass);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.post__body :deep(img) {
  border-radius: var(--radius);
  margin: 1.5rem 0;
}
.post__body :deep(blockquote) {
  margin: 1.6rem 0;
  padding-left: 1.2rem;
  border-left: 2px solid var(--brass);
  color: var(--paper);
  font-style: italic;
}
.post__body :deep(ul),
.post__body :deep(ol) {
  margin: 0 0 1.2rem;
  padding-left: 1.4rem;
}
.post__body :deep(li) {
  margin: 0.3rem 0;
}
</style>
