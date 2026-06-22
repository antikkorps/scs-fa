<script setup lang="ts">
import { registerSchema } from "@armurier/shared"

useHead({ title: "Créer un compte — SCS Firearm" })

const { register, isAuthenticated } = useAuth()
const route = useRoute()

const form = reactive({
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

const redirectTo = computed(() => (route.query.redirect as string) || "/")

if (isAuthenticated.value) {
  await navigateTo(redirectTo.value)
}

async function submit() {
  error.value = ""
  fieldErrors.value = {}

  const parsed = registerSchema.safeParse({
    firstName: form.firstName,
    lastName: form.lastName,
    email: form.email,
    phone: form.phone || undefined,
    password: form.password,
    rgpdConsent: form.rgpdConsent,
  })
  if (!parsed.success) {
    fieldErrors.value = zodFieldErrors(parsed.error)
    return
  }

  loading.value = true
  try {
    await register(parsed.data)
    await navigateTo(redirectTo.value)
  } catch (err) {
    const status = authErrorStatus(err)
    if (status === 409) error.value = "Un compte existe déjà avec cette adresse email."
    else error.value = "Inscription impossible. Réessayez."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" novalidate @submit.prevent="submit">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Créer un compte</h1>
      <p class="auth-card__lede">Quelques informations pour démarrer.</p>

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
        <span>Email</span>
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
        {{ loading ? "Création…" : "Créer mon compte" }}
      </button>

      <p class="auth-alt">
        Déjà un compte ?
        <NuxtLink to="/connexion">Se connecter</NuxtLink>
      </p>
    </form>
  </div>
</template>
