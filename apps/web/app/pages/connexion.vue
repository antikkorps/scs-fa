<script setup lang="ts">
import { loginSchema } from "@armurier/shared"
import type { LoginEnrolment, LoginMethod } from "~/composables/useAuth"

useHead({ title: "Connexion — SCS Firearms" })

const { login, isAuthenticated } = useAuth()
const route = useRoute()

const email = ref("")
const password = ref("")
// Story 12.8a / 12.8e: some accounts confirm the right password with a mailed
// code, the authenticator app's code, or its enrolment (LoginCodeStep).
const pending = ref<{ method: LoginMethod; enrollment?: LoginEnrolment } | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const error = ref("")
const loading = ref(false)

const redirectTo = computed(() => safeInternalPath(route.query.redirect))

// Already signed in? Skip the form.
if (isAuthenticated.value) {
  await navigateTo(redirectTo.value)
}

const LOCKED_MESSAGE = "Trop de tentatives. Réessayez dans quelques minutes."

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
    const outcome = await login(parsed.data.email, parsed.data.password)
    if (outcome.status === "code_required") {
      pending.value = { method: outcome.method, enrollment: outcome.enrollment }
      password.value = ""
      return
    }
    await navigateTo(redirectTo.value)
  } catch (err) {
    const status = authErrorStatus(err)
    if (status === 401) error.value = "Email ou mot de passe invalide."
    else if (status === 423) error.value = LOCKED_MESSAGE
    else error.value = "Connexion impossible. Réessayez."
  } finally {
    loading.value = false
  }
}

/** Back to the password: the code can no longer be used. */
function restart(message: string) {
  pending.value = null
  error.value = message
}

async function signedIn() {
  await navigateTo(redirectTo.value)
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Connexion</h1>

      <LoginCodeStep
        v-if="pending"
        :email="email"
        :method="pending.method"
        :enrollment="pending.enrollment"
        @signed-in="signedIn"
        @restart="restart"
      />

      <form v-else novalidate @submit.prevent="submit">
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
  </div>
</template>
