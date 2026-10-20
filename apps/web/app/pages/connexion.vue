<script setup lang="ts">
import { loginSchema } from "@armurier/shared"

useHead({ title: "Connexion — SCS Firearms" })

const { login, verifyLoginCode, resendLoginCode, isAuthenticated } = useAuth()
const route = useRoute()

const email = ref("")
const password = ref("")
const code = ref("")
// Story 12.8a: some accounts confirm the right password with a mailed code.
const step = ref<"password" | "code">("password")
const fieldErrors = ref<Record<string, string>>({})
const error = ref("")
const notice = ref("")
const loading = ref(false)

const redirectTo = computed(() => safeInternalPath(route.query.redirect))

// Already signed in? Skip the form.
if (isAuthenticated.value) {
  await navigateTo(redirectTo.value)
}

async function submitPassword() {
  const parsed = loginSchema.safeParse({ email: email.value, password: password.value })
  if (!parsed.success) {
    fieldErrors.value = zodFieldErrors(parsed.error)
    return
  }

  loading.value = true
  try {
    const outcome = await login(parsed.data.email, parsed.data.password)
    if (outcome.status === "code_required") {
      step.value = "code"
      password.value = ""
      return
    }
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

/** Back to the password: the code can no longer be used. */
function restart(message: string) {
  step.value = "password"
  code.value = ""
  notice.value = ""
  error.value = message
}

async function submitCode() {
  // Spaces and dashes are how people copy a code out of a mail.
  const typed = code.value.replace(/[\s-]/g, "")
  if (!/^\d{6}$/.test(typed)) {
    fieldErrors.value = { code: "Le code compte 6 chiffres." }
    return
  }

  loading.value = true
  try {
    await verifyLoginCode(typed)
    await navigateTo(redirectTo.value)
  } catch (err) {
    const remaining = apiErrorField<number>(err, "remainingAttempts")
    if (apiErrorCode(err) === "InvalidLoginCode" && remaining !== undefined && remaining > 0) {
      error.value = `Code incorrect. Encore ${remaining} essai${remaining > 1 ? "s" : ""}.`
    } else if (authErrorStatus(err) === 401) {
      restart("Ce code ne peut plus servir. Reconnectez-vous avec votre mot de passe.")
    } else {
      error.value = "Vérification impossible. Réessayez."
    }
  } finally {
    loading.value = false
  }
}

async function resend() {
  error.value = ""
  notice.value = ""
  try {
    await resendLoginCode()
    code.value = ""
    notice.value = "Un nouveau code vous a été envoyé."
  } catch (err) {
    const wait = apiErrorField<number | null>(err, "retryAfterSeconds")
    if (authErrorStatus(err) === 429 && wait) error.value = `Patientez encore ${wait} secondes avant un nouveau code.`
    else if (authErrorStatus(err) === 429) restart("Plus de nouveau code pour cette connexion. Reconnectez-vous.")
    else if (authErrorStatus(err) === 401) restart("Cette connexion a expiré. Reconnectez-vous.")
    else error.value = "Envoi impossible. Réessayez."
  }
}

function submit() {
  error.value = ""
  fieldErrors.value = {}
  return step.value === "password" ? submitPassword() : submitCode()
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" novalidate @submit.prevent="submit">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Connexion</h1>

      <template v-if="step === 'password'">
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
      </template>

      <template v-else>
        <p class="auth-card__lede">
          Un code de connexion vient d'être envoyé à <strong>{{ email }}</strong>. Il est valable 10 minutes.
        </p>

        <label class="auth-field">
          <span>Code reçu par e-mail</span>
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="9"
            class="auth-input auth-input--code"
          />
          <p v-if="fieldErrors.code" class="auth-field__error">{{ fieldErrors.code }}</p>
        </label>
      </template>

      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="auth-notice" role="status">{{ notice }}</p>

      <button type="submit" class="btn btn-primary auth-submit" :disabled="loading">
        <template v-if="step === 'password'">{{ loading ? "Connexion…" : "Se connecter" }}</template>
        <template v-else>{{ loading ? "Vérification…" : "Valider le code" }}</template>
      </button>

      <template v-if="step === 'password'">
        <p class="auth-alt">
          <NuxtLink to="/mot-de-passe-oublie">Mot de passe oublié ?</NuxtLink>
        </p>
        <p class="auth-alt">
          Pas encore de compte ?
          <NuxtLink to="/inscription">Créer un compte</NuxtLink>
        </p>
      </template>
      <p v-else class="auth-alt">
        Rien reçu&nbsp;? Vérifiez vos indésirables, ou
        <button type="button" class="auth-resend" @click="resend">recevoir un nouveau code</button>.
      </p>
    </form>
  </div>
</template>

<style scoped>
.auth-input--code {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.3em;
  font-size: var(--fs-lg);
}

.auth-notice {
  color: var(--ink-soft);
  margin: 0 0 1rem;
  font-size: var(--fs-sm);
}

.auth-resend {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
