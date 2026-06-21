<script setup lang="ts">
import type { BlogListItem } from "~/types/blog"
import { fallbackImage, formatDate } from "~/utils/format"

const props = defineProps<{
  article: BlogListItem
  /** LCP optimisation: eager-load the first cards above the fold. */
  priority?: boolean
}>()

const img = computed(() =>
  props.article.featuredImageUrl && props.article.featuredImageUrl.length > 0
    ? props.article.featuredImageUrl
    : fallbackImage(`blog-${props.article.slug}`, 1200, 800),
)
</script>

<template>
  <article class="card">
    <NuxtLink :to="`/blog/${article.slug}`" class="card__link">
      <div class="card__media">
        <img
          :src="img"
          :alt="article.title"
          width="1200"
          height="800"
          :loading="priority ? 'eager' : 'lazy'"
          :fetchpriority="priority ? 'high' : 'auto'"
          decoding="async"
        />
      </div>

      <div class="card__body">
        <p v-if="article.category" class="eyebrow">{{ article.category }}</p>
        <h2 class="card__title">{{ article.title }}</h2>
        <p v-if="article.excerpt" class="card__excerpt">{{ article.excerpt }}</p>
        <p class="card__meta">
          <span v-if="article.authorName">{{ article.authorName }} · </span>
          <time v-if="article.publishedAt" :datetime="article.publishedAt">{{ formatDate(article.publishedAt) }}</time>
        </p>
      </div>
    </NuxtLink>
  </article>
</template>

<style scoped>
.card__link {
  display: block;
}
.card__media {
  position: relative;
  aspect-ratio: 3 / 2;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
}
.card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.9s var(--ease);
}
.card:hover .card__media img {
  transform: scale(1.045);
}
.card__body {
  padding: 1.1rem 0.15rem 0;
}
.card__title {
  font-size: 1.5rem;
  margin: 0.5rem 0 0.5rem;
  transition: color 0.3s var(--ease);
}
.card:hover .card__title {
  color: var(--brass);
}
.card__excerpt {
  color: var(--paper-dim);
  font-size: 0.95rem;
  margin: 0 0 0.7rem;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card__meta {
  font-size: 0.8rem;
  color: var(--paper-faint);
  margin: 0;
}
</style>
