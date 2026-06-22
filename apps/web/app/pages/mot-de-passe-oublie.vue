<script setup lang="ts">
import { forgotPasswordSchema } from "@armurier/shared"

useHead({ title: "Mot de passe oublié — SCS Firearm" })

const { forgotPassword } = useAuth()

const email = ref("")
const fieldErrors = ref<Record<string, string>>({})
const error = ref("")
const sent = ref(false)
const loading = ref(false)

async function submit() {
  error.value = ""
  fieldErrors.value = {}

  const parsed = forgotPasswordSchema.safeParse({ email: email.value })
  if (!parsed.success) {
    fieldErrors.value = zodFieldErrors(parsed.error)
    return
  }

  loading.value = true
  try {
    await forgotPassword(parsed.data.email)
    // Anti-enumeration: the API responds the same way whether or not the
    // account exists, so we always show the neutral confirmation.
    sent.value = true
  } catch {
    error.value = "Demande impossible. Réessayez."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" novalidate @submit.prevent="submit">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Mot de passe oublié</h1>

      <template v-if="sent">
        <p class="auth-notice" role="status">
          Si un compte est associé à cette adresse, vous recevrez un email avec les instructions de
          réinitialisation.
        </p>
        <p class="auth-alt">
          <NuxtLink to="/connexion">Retour à la connexion</NuxtLink>
        </p>
      </template>

      <template v-else>
        <p class="auth-card__lede">Indiquez votre email pour recevoir un lien de réinitialisation.</p>

        <label class="auth-field">
          <span>Email</span>
          <input v-model="email" type="email" autocomplete="email" class="auth-input" />
          <p v-if="fieldErrors.email" class="auth-field__error">{{ fieldErrors.email }}</p>
        </label>

        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn-primary auth-submit" :disabled="loading">
          {{ loading ? "Envoi…" : "Envoyer le lien" }}
        </button>

        <p class="auth-alt">
          <NuxtLink to="/connexion">Retour à la connexion</NuxtLink>
        </p>
      </template>
    </form>
  </div>
</template>
