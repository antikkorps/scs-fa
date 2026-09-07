<script setup lang="ts">
import {
  NEWSLETTER_SEGMENT_LABELS,
  NEWSLETTER_SEGMENTS,
  type NewsletterSegment,
  newsletterSubscribeSchema,
} from "@armurier/shared"

// Newsletter opt-in (story 11.4). One contact, several universes: the visitor
// ticks what they want to receive. `defaultSegments` pre-ticks the universe the
// visitor is standing in — never all of them, which would turn an informed
// choice into a blanket subscription.
const props = withDefaults(
  defineProps<{
    /** Segments pre-ticked for this placement. Keep it to the current universe. */
    defaultSegments?: NewsletterSegment[]
    /** Site path the address was captured from, stored with the consent as proof. */
    source?: string
    title?: string
    description?: string
    /** `panel` is the standalone card; `bare` drops the frame for the footer. */
    variant?: "panel" | "bare"
  }>(),
  {
    defaultSegments: () => ["armurerie"],
    source: undefined,
    title: "Se tenir informé des arrivées",
    description:
      "Nouveautés, pièces de collection et tirages Gun Art — quelques envois par an, jamais de revente d'adresse.",
    variant: "panel",
  },
)

const api = useApi()
// The same form appears twice on some pages (product CTA + footer), so the
// heading id that labels the section must be unique per instance.
const titleId = useId()

const email = ref("")
const consent = ref(false)
const selected = ref<NewsletterSegment[]>([...props.defaultSegments])
const status = ref<"idle" | "loading" | "sent">("idle")
const error = ref("")
const fieldErrors = ref<Record<string, string>>({})

const segments = NEWSLETTER_SEGMENTS.map((segment) => ({ segment, label: NEWSLETTER_SEGMENT_LABELS[segment] }))

function toggle(segment: NewsletterSegment) {
  selected.value = selected.value.includes(segment)
    ? selected.value.filter((s) => s !== segment)
    : [...selected.value, segment]
}

async function submit() {
  error.value = ""
  fieldErrors.value = {}

  const parsed = newsletterSubscribeSchema.safeParse({
    email: email.value.trim(),
    segments: selected.value,
    consent: consent.value,
    ...(props.source ? { source: props.source } : {}),
  })
  if (!parsed.success) {
    fieldErrors.value = zodFieldErrors(parsed.error)
    if (selected.value.length === 0) fieldErrors.value.segments = "Choisissez au moins une newsletter."
    if (!consent.value) fieldErrors.value.consent = "Votre accord explicite est nécessaire."
    return
  }

  status.value = "loading"
  try {
    await api("/newsletter/subscribe", { method: "POST", body: parsed.data })
    // Deliberately the same message whatever the address' history: the form must
    // not reveal whether an address is already subscribed.
    status.value = "sent"
  } catch {
    status.value = "idle"
    error.value = "Inscription impossible pour le moment. Réessayez dans quelques instants."
  }
}
</script>

<template>
  <section class="nl" :class="`nl--${variant}`" :aria-labelledby="titleId">
    <h2 :id="titleId" class="nl__title">{{ title }}</h2>

    <p v-if="status === 'sent'" class="nl__done" role="status">
      Vérifiez votre boîte mail&nbsp;: votre inscription n'est active qu'une fois le lien de confirmation
      suivi. Sans cette confirmation, votre adresse n'est pas conservée.
    </p>

    <form v-else class="nl__form" novalidate @submit.prevent="submit">
      <p class="nl__desc">{{ description }}</p>

      <fieldset class="nl__segments">
        <legend class="nl__legend">Ce que vous souhaitez recevoir</legend>
        <label v-for="s in segments" :key="s.segment" class="nl__seg">
          <input
            type="checkbox"
            :checked="selected.includes(s.segment)"
            :value="s.segment"
            @change="toggle(s.segment)"
          />
          <span>{{ s.label }}</span>
        </label>
        <p v-if="fieldErrors.segments" class="nl__err">{{ fieldErrors.segments }}</p>
      </fieldset>

      <label class="nl__field">
        <span class="nl__label">Votre adresse email</span>
        <input
          v-model="email"
          type="email"
          name="email"
          autocomplete="email"
          required
          placeholder="vous@exemple.fr"
          :aria-invalid="Boolean(fieldErrors.email)"
        />
      </label>
      <p v-if="fieldErrors.email" class="nl__err">{{ fieldErrors.email }}</p>

      <label class="nl__consent">
        <input v-model="consent" type="checkbox" :aria-invalid="Boolean(fieldErrors.consent)" />
        <span>
          J'accepte de recevoir les newsletters cochées ci-dessus. Je peux me désabonner à tout moment
          via le lien présent dans chaque envoi&nbsp;; mon adresse est alors effacée.
        </span>
      </label>
      <p v-if="fieldErrors.consent" class="nl__err">{{ fieldErrors.consent }}</p>

      <button class="nl__submit" type="submit" :disabled="status === 'loading'">
        {{ status === "loading" ? "Envoi…" : "Je m'inscris" }}
      </button>
      <p v-if="error" class="nl__err" role="alert">{{ error }}</p>
    </form>
  </section>
</template>

<style scoped>
.nl {
  /* A form line that runs the full width of a page reads as a banner, not as a
     field to fill in — cap it wherever the placement is unconstrained. */
  max-width: 42rem;
}
.nl--panel {
  border: 1px solid var(--line, var(--ink-line));
  border-radius: 10px;
  padding: 1.25rem 1.35rem 1.4rem;
}
.nl__title {
  font-family: var(--font-display);
  font-size: 1.15rem;
  margin: 0 0 0.35rem;
}
.nl__desc {
  font-size: 0.85rem;
  opacity: 0.75;
  margin: 0 0 0.9rem;
  max-width: 52ch;
}
.nl__segments {
  border: none;
  margin: 0 0 0.9rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.nl__legend {
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.7;
  padding: 0 0 0.35rem;
}
.nl__seg,
.nl__consent {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.85rem;
  line-height: 1.45;
  cursor: pointer;
}
.nl__seg input,
.nl__consent input {
  margin-top: 0.2rem;
  accent-color: var(--brass);
  flex: none;
}
.nl__field {
  display: block;
  margin-bottom: 0.35rem;
}
.nl__label {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.7;
  margin-bottom: 0.3rem;
}
.nl__field input {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--line, var(--ink-line));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}
.nl__consent {
  margin: 0.7rem 0 0.4rem;
  font-size: 0.78rem;
  opacity: 0.85;
}
.nl__submit {
  margin-top: 0.6rem;
  padding: 0.65rem 1.4rem;
  border: 1px solid var(--brass);
  border-radius: 6px;
  background: var(--brass);
  color: var(--ink, #0e0e10);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.nl__submit:disabled {
  opacity: 0.6;
  cursor: progress;
}
.nl__done {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.5;
}
/* Errors carry their own words, never colour alone. */
.nl__err {
  color: #ff8a7a;
  font-size: 0.78rem;
  margin: 0.25rem 0 0;
}
</style>
