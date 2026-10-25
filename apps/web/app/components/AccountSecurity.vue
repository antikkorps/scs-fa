<script setup lang="ts">
import type { LoginEnrolment } from "~/composables/useAuth"
import { formatDate } from "~/utils/format"

// Story 12.8e — the account's authenticator app: set it up (QR code, then a
// first code; the recovery codes then), regenerate the recovery codes, turn it
// off (password and code) — never for an admin, for whom it is mandatory.
interface TotpStatus {
  enabled: boolean
  enabledAt: string | null
  required: boolean
  recoveryCodesLeft: number
}

const api = useApi()

const state = ref<TotpStatus | null>(null)
const enrolment = ref<LoginEnrolment | null>(null)
const recoveryCodes = ref<string[] | null>(null)
const setupCode = ref("")
const regenCode = ref("")
const disablePassword = ref("")
const disableCode = ref("")
const busy = ref(false)
const error = ref("")

const qrSource = computed(() => (enrolment.value ? `data:image/svg+xml;base64,${btoa(enrolment.value.qrSvg)}` : null))

async function load() {
  state.value = (await api<{ data: TotpStatus }>("/auth/totp")).data
}
onMounted(load)

function messageOf(err: unknown, fallback: string): string {
  const code = apiErrorCode(err)
  if (code === "InvalidTotpCode") return "Code incorrect."
  if (code === "InvalidCredentials") return "Mot de passe incorrect."
  return fallback
}

async function act(run: () => Promise<void>, fallback: string) {
  busy.value = true
  error.value = ""
  try {
    await run()
  } catch (err) {
    error.value = messageOf(err, fallback)
  } finally {
    busy.value = false
  }
}

const startSetup = () =>
  act(async () => {
    recoveryCodes.value = null
    enrolment.value = (await api<{ data: LoginEnrolment }>("/auth/totp/setup", { method: "POST" })).data
  }, "La mise en place a échoué.")

const enable = () =>
  act(async () => {
    const res = await api<{ data: { recoveryCodes: string[] } }>("/auth/totp/enable", {
      method: "POST",
      body: { code: setupCode.value.trim() },
    })
    recoveryCodes.value = res.data.recoveryCodes
    enrolment.value = null
    setupCode.value = ""
    await load()
  }, "L'activation a échoué.")

const regenerate = () =>
  act(async () => {
    const res = await api<{ data: { recoveryCodes: string[] } }>("/auth/totp/recovery-codes", {
      method: "POST",
      body: { code: regenCode.value.trim() },
    })
    recoveryCodes.value = res.data.recoveryCodes
    regenCode.value = ""
    await load()
  }, "La régénération a échoué.")

const disable = () =>
  act(async () => {
    await api("/auth/totp/disable", {
      method: "POST",
      body: { password: disablePassword.value, code: disableCode.value.trim() },
    })
    disablePassword.value = ""
    disableCode.value = ""
    recoveryCodes.value = null
    await load()
  }, "La désactivation a échoué.")
</script>

<template>
  <section class="card security" aria-labelledby="security-h">
    <h2 id="security-h" class="card__h">Double authentification</h2>
    <p v-if="!state" class="muted">Chargement…</p>
    <template v-else>
      <p class="muted">
        <template v-if="state.enabled">
          Activée le {{ formatDate(state.enabledAt) }} : chaque connexion demande le code de votre application
          d'authentification. Il vous reste {{ state.recoveryCodesLeft }} codes de secours.
        </template>
        <template v-else>
          Désactivée. Avec une application d'authentification (Google Authenticator, Aegis, 1Password…), chaque
          connexion demandera en plus un code à 6 chiffres.
        </template>
        <template v-if="state.required"> Elle est obligatoire pour ce compte.</template>
      </p>

      <div v-if="recoveryCodes" class="recovery" role="status">
        <p>Vos codes de secours (chacun sert une fois ; notez-les, ils ne seront plus affichés) :</p>
        <ul class="recovery__codes" role="list">
          <li v-for="recovery in recoveryCodes" :key="recovery">{{ recovery }}</li>
        </ul>
      </div>

      <template v-if="!state.enabled">
        <button v-if="!enrolment" type="button" class="btn btn-primary setup" :disabled="busy" @click="startSetup">
          Activer la double authentification
        </button>
        <form v-else class="enable" @submit.prevent="enable">
          <p class="muted">Scannez ce QR code avec l'application, puis saisissez le code qu'elle affiche.</p>
          <img v-if="qrSource" :src="qrSource" alt="QR code à scanner avec l'application d'authentification" class="qr" />
          <p class="key">Ou saisissez cette clé : <code>{{ enrolment.secret }}</code></p>
          <label class="field">
            <span>Code de l'application</span>
            <input v-model="setupCode" name="totp-code" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" />
          </label>
          <button type="submit" class="btn btn-primary" :disabled="busy">Activer</button>
        </form>
      </template>

      <template v-else>
        <form class="regenerate" @submit.prevent="regenerate">
          <p class="muted">De nouveaux codes de secours remplacent les anciens.</p>
          <label class="field">
            <span>Code de l'application</span>
            <input v-model="regenCode" name="regen-code" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" />
          </label>
          <button type="submit" class="btn btn-ghost" :disabled="busy">Nouveaux codes de secours</button>
        </form>

        <form v-if="!state.required" class="disable" @submit.prevent="disable">
          <p class="muted">Désactiver la double authentification :</p>
          <label class="field">
            <span>Mot de passe</span>
            <input v-model="disablePassword" name="disable-password" type="password" class="input" autocomplete="current-password" />
          </label>
          <label class="field">
            <span>Code de l'application</span>
            <input v-model="disableCode" name="disable-code" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="11" />
          </label>
          <button type="submit" class="btn btn-ghost" :disabled="busy">Désactiver</button>
        </form>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
.muted {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
}
.qr {
  display: block;
  width: 200px;
  height: 200px;
  margin: 0.8rem 0;
  padding: 0.6rem;
  background: #fff;
  border-radius: var(--radius);
}
.key {
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  word-break: break-all;
}
form {
  margin-top: 1rem;
  display: grid;
  gap: 0.6rem;
  max-width: 420px;
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
.recovery__codes {
  list-style: none;
  margin: 0.5rem 0 1rem;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  font-family: ui-monospace, monospace;
  max-width: 420px;
}
.recovery__codes li {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  text-align: center;
}
.error {
  color: var(--danger);
}
</style>
