<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: "Connexion — Administration SCS" })

const { login, isAdmin } = useAuth()
const route = useRoute()

const email = ref("")
const password = ref("")
const error = ref("")
const loading = ref(false)

// Already signed in as admin? Skip straight through.
if (isAdmin.value) {
  await navigateTo((route.query.redirect as string) || "/admin")
}

async function submit() {
  error.value = ""
  loading.value = true
  try {
    const user = await login(email.value, password.value)
    if (user.role !== "admin") {
      error.value = "Ce compte n'a pas accès à l'administration."
      return
    }
    await navigateTo((route.query.redirect as string) || "/admin")
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    error.value = status === 401 ? "Identifiants invalides." : "Connexion impossible. Réessayez."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth">
    <form class="card" @submit.prevent="submit">
      <p class="eyebrow">Administration</p>
      <h1 class="card__title">SCS Firearm</h1>
      <p class="card__lede">Accès réservé à l'équipe.</p>

      <label class="field">
        <span>Email</span>
        <input v-model="email" type="email" autocomplete="username" required class="input" />
      </label>
      <label class="field">
        <span>Mot de passe</span>
        <input v-model="password" type="password" autocomplete="current-password" required class="input" />
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <button type="submit" class="btn btn-primary submit" :disabled="loading">
        {{ loading ? "Connexion…" : "Se connecter" }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem 1.25rem;
}
.card {
  width: 100%;
  max-width: 380px;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: clamp(1.6rem, 5vw, 2.5rem);
  box-shadow: var(--shadow);
}
.card__title {
  font-size: 2.2rem;
  margin: 0.4rem 0 0.2rem;
}
.card__lede {
  color: var(--paper-dim);
  margin: 0 0 1.6rem;
  font-size: 0.95rem;
}
.field {
  display: block;
  margin-bottom: 1.1rem;
}
.field span {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.45rem;
}
.input {
  width: 100%;
  padding: 0.75rem 0.85rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.95rem;
}
.input:focus {
  outline: none;
  border-color: var(--brass);
}
.error {
  color: var(--danger);
  font-size: 0.85rem;
  margin: 0 0 1rem;
}
.submit {
  width: 100%;
  justify-content: center;
}
.submit:disabled {
  opacity: 0.6;
  cursor: progress;
}
</style>
