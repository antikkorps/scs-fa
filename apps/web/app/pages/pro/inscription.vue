<script setup lang="ts">
import { type OrganisationType, proSignupSchema } from "@armurier/shared"

// Story 12.8b — a pro files a request: the account and its organisation at
// once. No session opens here: SCS approves by hand, and every pro login asks
// for a code sent by e-mail.
usePageSeo({
  title: "Ouvrir un compte professionnel",
  description:
    "Armuriers, clubs de tir, sociétés de sécurité privée et administrations : ouvrez votre compte professionnel SCS Firearms et demandez vos devis.",
  path: "/pro/inscription",
})

const { signup } = useOrganisation()
const { isAuthenticated } = useAuth()

// A signed-in customer turns pro from their account instead.
if (isAuthenticated.value) await navigateTo("/compte#compte-pro")

const form = reactive({
  siret: "",
  legalName: "",
  organisationType: "" as OrganisationType | "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  rgpdConsent: false,
})
const fieldErrors = ref<Record<string, string>>({})
const error = ref("")
const loading = ref(false)
const sent = ref(false)

async function submit() {
  error.value = ""
  fieldErrors.value = {}

  const parsed = proSignupSchema.safeParse({ ...form, phone: form.phone || undefined })
  if (!parsed.success) {
    fieldErrors.value = zodFieldErrors(parsed.error)
    return
  }

  loading.value = true
  try {
    await signup(parsed.data)
    sent.value = true
  } catch (err) {
    const code = apiErrorCode(err)
    if (code === "SiretAlreadyRegistered") {
      fieldErrors.value = { siret: SIRET_TAKEN_MESSAGE }
    } else if (code === "EmailAlreadyRegistered") {
      error.value =
        "Un compte existe déjà avec cette adresse. Connectez-vous et faites la demande depuis votre espace client."
    } else {
      error.value = "La demande n'a pas pu être envoyée. Réessayez."
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <section v-if="sent" class="auth-card" role="status">
      <p class="eyebrow">Espace professionnel</p>
      <h1 class="auth-card__title">Demande envoyée</h1>
      <p class="auth-card__lede">
        Merci. Notre équipe vérifie votre demande et vous écrit dès qu'elle est validée. Vous pouvez déjà vous connecter :
        à chaque connexion, un code vous sera envoyé par e-mail après votre mot de passe.
      </p>
      <NuxtLink to="/connexion" class="btn btn-primary auth-submit">Se connecter</NuxtLink>
    </section>

    <form v-else class="auth-card" novalidate @submit.prevent="submit">
      <p class="eyebrow">Espace professionnel</p>
      <h1 class="auth-card__title">Ouvrir un compte professionnel</h1>
      <p class="auth-card__lede">
        Armuriers, clubs de tir, sociétés de sécurité privée et administrations : vos commandes passent par un devis, établi
        par notre équipe.
      </p>

      <ProOrganisationFields :form="form" :field-errors="fieldErrors" />

      <div class="auth-row">
        <label class="auth-field">
          <span>Prénom</span>
          <input v-model="form.firstName" type="text" autocomplete="given-name" class="auth-input" />
          <p v-if="fieldErrors.firstName" class="auth-field__error">{{ fieldErrors.firstName }}</p>
        </label>
        <label class="auth-field">
          <span>Nom</span>
          <input v-model="form.lastName" type="text" autocomplete="family-name" class="auth-input" />
          <p v-if="fieldErrors.lastName" class="auth-field__error">{{ fieldErrors.lastName }}</p>
        </label>
      </div>

      <label class="auth-field">
        <span>Email professionnel</span>
        <input v-model="form.email" type="email" autocomplete="email" class="auth-input" />
        <p v-if="fieldErrors.email" class="auth-field__error">{{ fieldErrors.email }}</p>
      </label>

      <label class="auth-field">
        <span>Téléphone <em>(facultatif)</em></span>
        <input v-model="form.phone" type="tel" autocomplete="tel" class="auth-input" />
        <p v-if="fieldErrors.phone" class="auth-field__error">{{ fieldErrors.phone }}</p>
      </label>

      <label class="auth-field">
        <span>Mot de passe</span>
        <input v-model="form.password" type="password" autocomplete="new-password" class="auth-input" />
        <p v-if="fieldErrors.password" class="auth-field__error">{{ fieldErrors.password }}</p>
      </label>

      <label class="auth-consent">
        <input v-model="form.rgpdConsent" type="checkbox" />
        <span>J'accepte la politique de confidentialité et le traitement de mes données.</span>
      </label>
      <p v-if="fieldErrors.rgpdConsent" class="auth-field__error">{{ fieldErrors.rgpdConsent }}</p>

      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

      <button type="submit" class="btn btn-primary auth-submit" :disabled="loading">
        {{ loading ? "Envoi…" : "Envoyer ma demande" }}
      </button>

      <p class="auth-alt">
        Déjà un compte ?
        <NuxtLink to="/connexion">Se connecter</NuxtLink>
      </p>
    </form>
  </div>
</template>
