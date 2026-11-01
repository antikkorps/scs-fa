<script setup lang="ts">
import { accountExportFilename } from "@armurier/shared"

// Story 12.11 — the holder's rights over their data, in "Mon compte": download
// everything the account holds (JSON), or delete the account. Both ask for the
// password again, plus the app's code when the account has the app on.
const props = defineProps<{
  /** False for an admin or an organisation's account: SCS closes those. */
  deletable: boolean
}>()

const api = useApi()
const { logout } = useAuth()

const appEnabled = ref(false)
onMounted(async () => {
  try {
    appEnabled.value = (await api<{ data: { enabled: boolean } }>("/auth/totp")).data.enabled
  } catch {
    // Without the status, the code field stays hidden; the API asks for it if needed.
  }
})

const REFUSALS: Record<string, string> = {
  InvalidCredentials: "Mot de passe incorrect.",
  TotpCodeRequired: "Saisissez aussi le code de votre application d'authentification.",
  InvalidTotpCode: "Code de l'application incorrect.",
  OrderInProgress:
    "Une commande est encore en cours (paiement, expédition, ou délai de rétractation de 14 jours après la livraison). Vous pourrez supprimer votre compte une fois qu'elle sera terminée.",
  QuoteInProgress: "Un devis est encore en cours. Vous pourrez supprimer votre compte une fois qu'il sera clos.",
  AdminAccount: "Ce compte ne peut pas être supprimé ici.",
  OrganisationAccount: "Le compte d'une organisation est fermé par SCS Firearms : contactez-nous.",
}

/** The API's error code; a download's refusal arrives as a blob, read before it can be parsed. */
async function errorCodeOf(err: unknown): Promise<string | undefined> {
  const body = (err as { data?: unknown }).data
  if (!(body instanceof Blob)) return apiErrorCode(err)
  try {
    const parsed = JSON.parse(await body.text()) as { error?: unknown }
    return typeof parsed.error === "string" ? parsed.error : undefined
  } catch {
    return undefined
  }
}

async function refusalOf(err: unknown, fallback: string): Promise<string> {
  const code = await errorCodeOf(err)
  return (code && REFUSALS[code]) || fallback
}

/** The confirmation the API asks for: the password, and the app's code only when there is one. */
function credentials(password: string, code: string) {
  const trimmed = code.trim()
  return appEnabled.value && trimmed ? { password, code: trimmed } : { password }
}

const exportForm = reactive({ password: "", code: "", busy: false, error: "" })

async function downloadExport() {
  if (exportForm.busy) return
  exportForm.busy = true
  exportForm.error = ""
  try {
    const file = await api<Blob>("/auth/me/export", {
      method: "POST",
      body: credentials(exportForm.password, exportForm.code),
      responseType: "blob",
    })
    const url = URL.createObjectURL(file)
    const link = document.createElement("a")
    link.href = url
    link.download = accountExportFilename(new Date())
    link.click()
    URL.revokeObjectURL(url)
    exportForm.password = ""
    exportForm.code = ""
  } catch (err) {
    exportForm.error = await refusalOf(err, "Le téléchargement a échoué. Veuillez réessayer.")
  } finally {
    exportForm.busy = false
  }
}

const deletionOpen = ref(false)
const deleteForm = reactive({ password: "", code: "", confirmed: false, busy: false, error: "" })

async function deleteAccount() {
  if (deleteForm.busy || !deleteForm.confirmed) return
  deleteForm.busy = true
  deleteForm.error = ""
  try {
    await api("/auth/me/delete", { method: "POST", body: credentials(deleteForm.password, deleteForm.code) })
  } catch (err) {
    deleteForm.error = await refusalOf(err, "La suppression a échoué. Veuillez réessayer.")
    deleteForm.busy = false
    return
  }
  // The account is gone: whatever the logout call answers, the session ends here.
  await logout().catch(() => undefined)
  await navigateTo("/compte-supprime")
}
</script>

<template>
  <section class="card rights" aria-labelledby="rights-h">
    <h2 id="rights-h" class="card__h">Vos données</h2>

    <form class="export" @submit.prevent="downloadExport">
      <p class="muted">
        Téléchargez tout ce que votre compte contient (profil, adresses, commandes, pièces justificatives, abonnement à la
        lettre d'information, consentements) dans un fichier JSON.
      </p>
      <label class="field">
        <span>Mot de passe</span>
        <input
          v-model="exportForm.password"
          name="export-password"
          type="password"
          class="input"
          autocomplete="current-password"
          required
        />
      </label>
      <label v-if="appEnabled" class="field">
        <span>Code de l'application</span>
        <input
          v-model="exportForm.code"
          name="export-code"
          class="input"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="11"
        />
      </label>
      <button type="submit" class="btn btn-ghost" :disabled="exportForm.busy">Télécharger mes données</button>
      <p v-if="exportForm.error" class="error" role="alert">{{ exportForm.error }}</p>
    </form>

    <div class="danger">
      <h3 class="danger__h">Supprimer mon compte</h3>
      <template v-if="props.deletable">
        <button v-if="!deletionOpen" type="button" class="btn btn-ghost delete-open" @click="deletionOpen = true">
          Supprimer mon compte…
        </button>
        <form v-else class="delete" @submit.prevent="deleteAccount">
          <p class="muted">
            La suppression est <strong>immédiate et définitive</strong> : vos coordonnées, votre carnet d'adresses, votre
            panier, vos pièces justificatives et votre inscription à la lettre d'information sont effacés, et vous ne
            pourrez plus vous connecter.
          </p>
          <p class="muted">
            La loi nous oblige à conserver vos commandes et leurs factures pendant 10 ans, ainsi que les pièces
            justificatives qui ont servi à une commande d'arme, pour la même durée.
          </p>
          <label class="field">
            <span>Mot de passe</span>
            <input
              v-model="deleteForm.password"
              name="delete-password"
              type="password"
              class="input"
              autocomplete="current-password"
              required
            />
          </label>
          <label v-if="appEnabled" class="field">
            <span>Code de l'application</span>
            <input
              v-model="deleteForm.code"
              name="delete-code"
              class="input"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="11"
            />
          </label>
          <label class="confirm">
            <input v-model="deleteForm.confirmed" name="delete-confirm" type="checkbox" />
            <span>Je comprends que la suppression de mon compte est définitive.</span>
          </label>
          <button type="submit" class="btn btn-danger" :disabled="!deleteForm.confirmed || deleteForm.busy">
            Supprimer définitivement mon compte
          </button>
          <p v-if="deleteForm.error" class="error" role="alert">{{ deleteForm.error }}</p>
        </form>
      </template>
      <p v-else class="muted">
        Ce compte est fermé par SCS Firearms : <NuxtLink to="/contact">contactez-nous</NuxtLink>.
      </p>
    </div>
  </section>
</template>

<style scoped>
.muted {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
}
form {
  margin-top: 1rem;
  display: grid;
  gap: 0.6rem;
  max-width: 520px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.input {
  width: 100%;
  height: 46px;
  padding: 0 0.85rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: var(--fs-base);
}
.input:focus {
  outline: none;
  border-color: var(--brass);
}
.danger {
  margin-top: 1.6rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--ink-line);
}
.danger__h {
  margin: 0 0 0.6rem;
  font-size: var(--fs-base);
  color: var(--paper);
}
.confirm {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: var(--fs-sm);
  color: var(--paper);
}
.confirm input {
  margin-top: 0.2rem;
}
.btn-danger {
  color: var(--danger);
  background: transparent;
  border: 1px solid var(--danger);
}
.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: var(--danger);
}
</style>
