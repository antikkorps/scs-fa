<script setup lang="ts">
import { registerSchema } from "@armurier/shared"

useHead({ title: "Créer un compte" })

const { register, isAuthenticated } = useAuth()
const { salesOpen } = useLaunch()
const route = useRoute()

const form = reactive({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  rgpdConsent: false,
})
// Sign-up without enumeration: the answer is the same whether the address was
// free or taken, so the page can only send the visitor to their mailbox.
const sent = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const error = ref("")
const loading = ref(false)

const redirectTo = computed(() => safeInternalPath(route.query.redirect))
// Moving to the login keeps the way back (UX audit 2026-11-01, I3).
const returnQuery = computed(() => authReturnQuery(route.query))
const forCart = computed(() => returnQuery.value.motif === CART_REASON)

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
    sent.value = true
    form.password = ""
  } catch {
    error.value = "Inscription impossible. Réessayez."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <!-- Story 12.10: the API refuses a sign-up until the shop opens. -->
    <section v-if="!salesOpen" class="auth-card">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Créer un compte</h1>
      <SalesClosedNotice what="La création de compte" />
    </section>
    <section v-else-if="sent" class="auth-card" role="status">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Vérifiez votre boîte mail</h1>
      <p class="auth-card__lede">
        Nous venons d'écrire à <strong>{{ form.email }}</strong> pour la suite. Le message peut mettre quelques minutes
        à arriver : pensez à regarder dans les indésirables.
      </p>
      <p class="auth-card__lede">
        À votre première connexion, un code envoyé à cette adresse confirmera qu'elle est bien la vôtre.
      </p>
      <NuxtLink :to="{ path: '/connexion', query: returnQuery }" class="btn btn-primary auth-submit">
        Se connecter
      </NuxtLink>
    </section>
    <form v-else class="auth-card" novalidate @submit.prevent="submit">
      <p class="eyebrow">Espace client</p>
      <h1 class="auth-card__title">Créer un compte</h1>
      <p v-if="forCart" class="auth-card__lede">
        Quelques informations, puis l'article sera ajouté à votre panier.
      </p>
      <p v-else class="auth-card__lede">Quelques informations pour démarrer.</p>

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
        <NuxtLink :to="{ path: '/connexion', query: returnQuery }">Se connecter</NuxtLink>
      </p>
      <p class="auth-alt">
        Armurier, club, sécurité privée ou administration ?
        <NuxtLink to="/pro/inscription">Ouvrir un compte professionnel</NuxtLink>
      </p>
    </form>
  </div>
</template>
