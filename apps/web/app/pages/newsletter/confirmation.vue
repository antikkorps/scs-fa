<script setup lang="ts">
import { NEWSLETTER_SEGMENT_LABELS, type NewsletterSegment } from "@armurier/shared"

// Double opt-in, step 2 (story 11.4). Landing page of the link mailed at signup:
// following it is what turns a captured address into a lawful, timestamped
// consent — nothing is sent before this page has been reached.
useHead({ title: "Confirmation d'inscription — SCS Firearm" })
// A confirmation link is single-use and personal: it has nothing to do in an index.
useSeoMeta({ robots: "noindex, nofollow" })

const route = useRoute()
const api = useApi()

const state = ref<"loading" | "confirmed" | "invalid">("loading")
const segments = ref<NewsletterSegment[]>([])
const unsubscribeToken = ref("")

const token = typeof route.query.token === "string" ? route.query.token : ""

onMounted(async () => {
  if (!token) {
    state.value = "invalid"
    return
  }
  try {
    const res = await api<{ data: { segments: NewsletterSegment[]; unsubscribeToken: string } }>(
      "/newsletter/confirm",
      { method: "POST", body: { token } },
    )
    segments.value = res.data.segments
    unsubscribeToken.value = res.data.unsubscribeToken
    state.value = "confirmed"
  } catch {
    state.value = "invalid"
  }
})
</script>

<template>
  <div class="container nlc">
    <h1 class="nlc__title">Inscription à la newsletter</h1>

    <p v-if="state === 'loading'" class="nlc__body" role="status">Confirmation en cours…</p>

    <template v-else-if="state === 'confirmed'">
      <p class="nlc__body">
        C'est confirmé, merci&nbsp;! Vous recevrez désormais&nbsp;:
      </p>
      <ul class="nlc__list">
        <li v-for="segment in segments" :key="segment">{{ NEWSLETTER_SEGMENT_LABELS[segment] }}</li>
      </ul>
      <p class="nlc__body">
        Vous pouvez ajuster ou retirer ces abonnements à tout moment&nbsp;; un lien de désabonnement
        figure aussi dans chaque envoi.
      </p>
      <NuxtLink class="nlc__link" :to="`/newsletter/desabonnement?token=${unsubscribeToken}`">
        Gérer mes abonnements
      </NuxtLink>
    </template>

    <template v-else>
      <p class="nlc__body">
        Ce lien est invalide, expiré ou déjà utilisé. Si vous vous êtes inscrit il y a plus de trois
        jours, recommencez l'inscription — nous vous enverrons un nouveau lien.
      </p>
      <NuxtLink class="nlc__link" to="/boutique">Retour à la boutique</NuxtLink>
    </template>
  </div>
</template>

<style scoped>
.nlc {
  max-width: 46rem;
  padding-block: clamp(2.5rem, 7vw, 5rem);
}
.nlc__title {
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 4vw, 2.2rem);
  margin: 0 0 1rem;
}
.nlc__body {
  line-height: 1.6;
  margin: 0 0 0.9rem;
}
.nlc__list {
  margin: 0 0 1rem;
  padding-left: 1.2rem;
  line-height: 1.6;
}
.nlc__link {
  color: var(--brass);
  text-decoration: underline;
}
</style>
