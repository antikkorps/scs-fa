<script setup lang="ts">
import { loginSchema } from "@armurier/shared"

useHead({ title: "Connexion — SCS Firearm" })

const { login, isAuthenticated } = useAuth()
const route = useRoute()

const email = ref("")
const password = ref("")
const fieldErrors = ref<Record<string, string>>({})
const error = ref("")
const loading = ref(false)

const redirectTo = computed(() => (route.query.redirect as string) || "/")

// Already signed in? Skip the form.
if (isAuthenticated.value) {
  await navigateTo(redirectTo.value)
}

async function submit() {
  error.value = ""
  fieldErrors.value = {}

  const parsed = loginSchema.safeParse({ email: email.value, password: password.value })
  if (!parsed.success) {
    fieldErrors.value = zodFieldErrors(parsed.error)
    return
  }

  loading.value = true
  try {
    await login(parsed.data.email, parsed.data.password)
    await navigateTo(redirectTo.value)
  } catch (err) {
    const status = authErrorStatus(err)
    if (status === 401) error.value = "Email ou mot de passe invalide."
    else if (status === 423) error.value = "Trop de tentatives. Réessayez dans quelques minutes."
    else error.value = "Connexion impossible. Réessayez."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" novalidate @submit.prevent="submit">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Connexion</h1>
      <p class="auth-card__lede">Accédez à vos commandes et à vos documents.</p>

      <label class="auth-field">
        <span>Email</span>
        <input v-model="email" type="email" autocomplete="username" class="auth-input" />
        <p v-if="fieldErrors.email" class="auth-field__error">{{ fieldErrors.email }}</p>
      </label>

      <label class="auth-field">
        <span>Mot de passe</span>
        <input v-model="password" type="password" autocomplete="current-password" class="auth-input" />
        <p v-if="fieldErrors.password" class="auth-field__error">{{ fieldErrors.password }}</p>
      </label>

      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

      <button type="submit" class="btn btn-primary auth-submit" :disabled="loading">
        {{ loading ? "Connexion…" : "Se connecter" }}
      </button>

      <p class="auth-alt">
        <NuxtLink to="/mot-de-passe-oublie">Mot de passe oublié ?</NuxtLink>
      </p>
      <p class="auth-alt">
        Pas encore de compte ?
        <NuxtLink to="/inscription">Créer un compte</NuxtLink>
      </p>
    </form>
  </div>
</template>
