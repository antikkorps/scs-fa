<script setup lang="ts">
import { NEWSLETTER_SEGMENT_LABELS, type NewsletterSegment, type NewsletterSubscriptionStatus } from "@armurier/shared"

// Withdrawing consent must be at least as easy as giving it (story 11.4): one
// link, no account, no login. Per-segment so someone who only wants to stop the
// Gun Art letters does not have to leave everything — and a full unsubscribe
// **erases** the address rather than flagging it.
useHead({ title: "Gérer mes abonnements — SCS Firearm" })
useSeoMeta({ robots: "noindex, nofollow" })

const route = useRoute()
const api = useApi()

const token = typeof route.query.token === "string" ? route.query.token : ""
const state = ref<"loading" | "ready" | "invalid" | "done">("loading")
const active = ref<NewsletterSegment[]>([])
const keep = ref<NewsletterSegment[]>([])
const purged = ref(false)
const error = ref("")
const saving = ref(false)

onMounted(async () => {
  if (!token) {
    state.value = "invalid"
    return
  }
  try {
    const res = await api<{
      data: { segments: { segment: NewsletterSegment; status: NewsletterSubscriptionStatus }[] }
    }>(`/newsletter/subscription?token=${encodeURIComponent(token)}`)
    active.value = res.data.segments.map((s) => s.segment)
    keep.value = [...active.value]
    state.value = active.value.length > 0 ? "ready" : "invalid"
  } catch {
    state.value = "invalid"
  }
})

function toggle(segment: NewsletterSegment) {
  keep.value = keep.value.includes(segment) ? keep.value.filter((s) => s !== segment) : [...keep.value, segment]
}

/** `segments` names what to REMOVE; omitting it withdraws everything at once. */
async function submit(all: boolean) {
  error.value = ""
  const removed = all ? undefined : active.value.filter((segment) => !keep.value.includes(segment))
  if (!all && (!removed || removed.length === 0)) {
    error.value = "Décochez au moins une newsletter, ou choisissez un désabonnement complet."
    return
  }

  saving.value = true
  try {
    const res = await api<{ data: { segments: NewsletterSegment[]; purged: boolean } }>("/newsletter/unsubscribe", {
      method: "POST",
      body: { token, ...(removed ? { segments: removed } : {}) },
    })
    active.value = res.data.segments
    keep.value = [...active.value]
    purged.value = res.data.purged
    state.value = "done"
  } catch {
    error.value = "Opération impossible pour le moment. Réessayez dans quelques instants."
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="container nlu">
    <h1 class="nlu__title">Gérer mes abonnements</h1>

    <p v-if="state === 'loading'" role="status">Chargement…</p>

    <template v-else-if="state === 'ready'">
      <p class="nlu__body">Décochez ce que vous ne souhaitez plus recevoir.</p>
      <fieldset class="nlu__set">
        <legend class="nlu__legend">Mes newsletters</legend>
        <label v-for="segment in active" :key="segment" class="nlu__item">
          <input type="checkbox" :checked="keep.includes(segment)" @change="toggle(segment)" />
          <span>{{ NEWSLETTER_SEGMENT_LABELS[segment] }}</span>
        </label>
      </fieldset>

      <div class="nlu__actions">
        <button type="button" class="nlu__save" :disabled="saving" @click="submit(false)">
          Enregistrer mes choix
        </button>
        <button type="button" class="nlu__all" :disabled="saving" @click="submit(true)">
          Tout désabonner et effacer mon adresse
        </button>
      </div>
      <p v-if="error" class="nlu__err" role="alert">{{ error }}</p>
    </template>

    <template v-else-if="state === 'done'">
      <p v-if="purged" class="nlu__body">
        C'est fait&nbsp;: vous êtes désabonné de tout et votre adresse a été effacée de nos listes.
      </p>
      <template v-else>
        <p class="nlu__body">Vos choix sont enregistrés. Vous recevrez encore&nbsp;:</p>
        <ul class="nlu__list">
          <li v-for="segment in active" :key="segment">{{ NEWSLETTER_SEGMENT_LABELS[segment] }}</li>
        </ul>
      </template>
      <NuxtLink class="nlu__link" to="/">Retour à l'accueil</NuxtLink>
    </template>

    <template v-else>
      <p class="nlu__body">
        Ce lien n'est plus valable. Il l'est peut-être déjà parce que vous vous êtes désabonné&nbsp;:
        dans ce cas votre adresse a été effacée et vous ne recevez plus rien.
      </p>
      <NuxtLink class="nlu__link" to="/">Retour à l'accueil</NuxtLink>
    </template>
  </div>
</template>

<style scoped>
.nlu {
  max-width: 46rem;
  padding-block: clamp(2.5rem, 7vw, 5rem);
}
.nlu__title {
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 4vw, 2.2rem);
  margin: 0 0 1rem;
}
.nlu__body {
  line-height: 1.6;
  margin: 0 0 0.9rem;
}
.nlu__set {
  border: none;
  margin: 0 0 1.2rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.nlu__legend {
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.7;
  padding: 0 0 0.5rem;
}
.nlu__item {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  cursor: pointer;
  line-height: 1.45;
}
.nlu__item input {
  margin-top: 0.25rem;
  accent-color: var(--brass);
}
.nlu__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.nlu__save,
.nlu__all {
  font: inherit;
  border-radius: 6px;
  padding: 0.6rem 1.2rem;
  cursor: pointer;
}
.nlu__save {
  border: 1px solid var(--brass);
  background: var(--brass);
  color: var(--ink, #0e0e10);
  font-weight: 600;
}
.nlu__all {
  border: 1px solid var(--line, var(--ink-line));
  background: transparent;
  color: inherit;
}
.nlu__list {
  margin: 0 0 1rem;
  padding-left: 1.2rem;
  line-height: 1.6;
}
.nlu__link {
  color: var(--brass);
  text-decoration: underline;
}
.nlu__err {
  color: #ff8a7a;
  margin: 0.6rem 0 0;
}
</style>
