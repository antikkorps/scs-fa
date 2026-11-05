<script setup lang="ts">
import { apiErrorCode } from "~/utils/formErrors"
import { REAUTH_REFUSALS } from "~/utils/reauth"

// Story 12.8e — an admin clears an account's authenticator app (lost phone, no
// recovery codes). Review 2026-11-04: the admin confirms with their own password
// and code first, so a stolen admin session alone cannot strip an account of its
// second factor. Admins always have the app, so the code is always asked.
const props = defineProps<{ userId: string; email: string }>()
const emit = defineEmits<{ done: []; cancel: [] }>()

const api = useApi()
const password = ref("")
const code = ref("")
const busy = ref(false)
const error = ref("")

const REFUSALS: Record<string, string> = {
  ...REAUTH_REFUSALS,
  OwnAccount: "Votre propre double authentification se réinitialise par un autre administrateur.",
  NotFound: "Ce compte n'existe plus.",
}

async function submit() {
  busy.value = true
  error.value = ""
  try {
    await api(`/admin/users/${props.userId}/totp/reset`, {
      method: "POST",
      body: { password: password.value, code: code.value.trim() },
    })
    emit("done")
  } catch (err) {
    const refusal = apiErrorCode(err)
    error.value = (refusal && REFUSALS[refusal]) || "La réinitialisation a échoué."
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="totp-reset-confirm">
    <p class="intro">
      Réinitialiser la double authentification de <strong class="email">{{ email }}</strong> ? Confirmez avec
      <em>votre</em> mot de passe et le code de <em>votre</em> application.
    </p>
    <form @submit.prevent="submit">
      <AdminReauthFields v-model:password="password" v-model:code="code" />
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="submit" class="btn btn-primary" :disabled="busy">Réinitialiser</button>
        <button type="button" class="btn btn-ghost cancel" :disabled="busy" @click="emit('cancel')">Annuler</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.totp-reset-confirm {
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  padding: 1.2rem;
  margin: 1rem 0;
  max-width: 34rem;
}
.intro {
  margin: 0 0 1rem;
  color: var(--paper-dim);
  font-size: var(--fs-sm);
}
.email {
  color: var(--paper);
  overflow-wrap: anywhere;
}
.error {
  color: var(--danger);
  font-size: var(--fs-sm);
  margin: 0 0 0.8rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
}
</style>
