<script setup lang="ts">
import type { NuxtError } from "#app"

const props = defineProps<{ error: NuxtError }>()

const isNotFound = computed(() => props.error?.statusCode === 404)
const code = computed(() => props.error?.statusCode ?? 500)

const heading = computed(() => (isNotFound.value ? "Œuvre introuvable" : "Une erreur est survenue"))
const lead = computed(() =>
  isNotFound.value
    ? "La page que vous cherchez a été déplacée, vendue ou n'a jamais existé. Le reste de la collection vous attend."
    : "Quelque chose s'est interrompu de notre côté. Reprenez votre exploration dans un instant.",
)

// `clearError` resets Nuxt's error state before navigating; a plain link would
// leave the error boundary mounted.
function goHome() {
  return clearError({ redirect: "/" })
}
function goCollection() {
  return clearError({ redirect: "/collection" })
}

// Error pages carry no SEO value and must never be indexed.
useSeoMeta({
  title: () => (isNotFound.value ? "Page introuvable" : "Erreur"),
  robots: "noindex, follow",
})
</script>

<template>
  <NuxtLayout>
    <section class="err">
      <div class="container err__inner">
        <p class="eyebrow">Erreur {{ code }}</p>
        <p class="err__code" aria-hidden="true">{{ code }}</p>
        <h1 class="err__title">{{ heading }}</h1>
        <p class="err__lead">{{ lead }}</p>
        <div class="err__actions">
          <button type="button" class="btn btn-primary" @click="goCollection">Voir la collection</button>
          <button type="button" class="btn btn-ghost" @click="goHome">Retour à l'accueil</button>
        </div>
      </div>
    </section>
  </NuxtLayout>
</template>

<style scoped>
.err {
  display: flex;
  align-items: center;
  min-height: clamp(60vh, 70vh, 80vh);
  padding-block: clamp(3rem, 10vw, 7rem);
}
.err__inner {
  max-width: 640px;
  text-align: center;
  margin-inline: auto;
}
.err__code {
  font-family: var(--font-display);
  font-weight: 600;
  line-height: 1;
  font-size: clamp(6rem, 24vw, 12rem);
  color: var(--ink-line);
  margin: 0.4rem 0 0.6rem;
  letter-spacing: 0.02em;
  user-select: none;
}
.err__title {
  font-size: clamp(2rem, 6vw, 3.25rem);
  margin: 0 0 1.1rem;
}
.err__lead {
  color: var(--paper-dim);
  font-size: 1.05rem;
  margin: 0 auto 2.2rem;
  max-width: 46ch;
}
.err__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  justify-content: center;
}
</style>
