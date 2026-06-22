<script setup lang="ts">
import { resetPasswordSchema } from "@armurier/shared"

useHead({ title: "Réinitialiser le mot de passe — SCS Firearm" })

const { resetPassword } = useAuth()
const route = useRoute()

const token = computed(() => (route.query.token as string) || "")

const password = ref("")
const confirm = ref("")
const fieldErrors = ref<Record<string, string>>({})
const error = ref("")
const done = ref(false)
const loading = ref(false)

async function submit() {
  error.value = ""
  fieldErrors.value = {}

  if (password.value !== confirm.value) {
    fieldErrors.value = { confirm: "Les mots de passe ne correspondent pas." }
    return
  }

  const parsed = resetPasswordSchema.safeParse({ token: token.value, password: password.value })
  if (!parsed.success) {
    fieldErrors.value = zodFieldErrors(parsed.error)
    return
  }

  loading.value = true
  try {
    await resetPassword(parsed.data.token, parsed.data.password)
    done.value = true
  } catch (err) {
    const status = authErrorStatus(err)
    if (status === 422) error.value = "Le nouveau mot de passe doit être différent de l'ancien."
    else if (status === 400) error.value = "Ce lien est invalide ou a expiré. Refaites une demande."
    else error.value = "Réinitialisation impossible. Réessayez."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" novalidate @submit.prevent="submit">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Nouveau mot de passe</h1>

      <template v-if="done">
        <p class="auth-notice" role="status">
          Votre mot de passe a été réinitialisé. Vous pouvez vous connecter.
        </p>
        <p class="auth-alt">
          <NuxtLink to="/connexion">Se connecter</NuxtLink>
        </p>
      </template>

      <template v-else-if="!token">
        <p class="auth-error" role="alert">Lien invalide : aucun jeton fourni.</p>
        <p class="auth-alt">
          <NuxtLink to="/mot-de-passe-oublie">Demander un nouveau lien</NuxtLink>
        </p>
      </template>

      <template v-else>
        <p class="auth-card__lede">Choisissez un mot de passe d'au moins 12 caractères.</p>

        <label class="auth-field">
          <span>Nouveau mot de passe</span>
          <input v-model="password" type="password" autocomplete="new-password" class="auth-input" />
          <p v-if="fieldErrors.password" class="auth-field__error">{{ fieldErrors.password }}</p>
        </label>

        <label class="auth-field">
          <span>Confirmer le mot de passe</span>
          <input v-model="confirm" type="password" autocomplete="new-password" class="auth-input" />
          <p v-if="fieldErrors.confirm" class="auth-field__error">{{ fieldErrors.confirm }}</p>
        </label>

        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn-primary auth-submit" :disabled="loading">
          {{ loading ? "Validation…" : "Réinitialiser" }}
        </button>
      </template>
    </form>
  </div>
</template>
