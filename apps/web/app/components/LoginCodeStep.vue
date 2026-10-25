<script setup lang="ts">
import type { CodeOutcome, LoginEnrolment, LoginMethod } from "~/composables/useAuth"

// The second step of a login, after the right password: the mailed code (story
// 12.8a), the authenticator app's code or a recovery code, or the app's
// enrolment for an admin without it (story 12.8e) — whose recovery codes are
// shown before going on. Shared by the shop's login and the back-office's.
const props = defineProps<{ email: string; method: LoginMethod; enrollment?: LoginEnrolment }>()
const emit = defineEmits<{
  signedIn: [outcome: CodeOutcome]
  /** The code can no longer be used: back to the password, with why. */
  restart: [message: string]
}>()

const { verifyLoginCode, resendLoginCode } = useAuth()

const code = ref("")
const fieldError = ref("")
const error = ref("")
const notice = ref("")
const loading = ref(false)
// The app just enrolled: its recovery codes, to note before going on.
const finished = ref<CodeOutcome | null>(null)

const LOCKED_MESSAGE = "Trop de tentatives. Réessayez dans quelques minutes."
const RECOVERY_CODE = /^[A-Z0-9]{5}-?[A-Z0-9]{5}$/

const qrSource = computed(() => (props.enrollment ? `data:image/svg+xml;base64,${btoa(props.enrollment.qrSvg)}` : null))

/** What to send: six digits, or (app only) a recovery code; null when it is neither. */
function typedCode(): string | null {
  const digits = code.value.replace(/[\s-]/g, "")
  if (/^\d{6}$/.test(digits)) return digits
  if (props.method !== "totp") return null
  const recovery = code.value.replace(/\s/g, "").toUpperCase()
  return RECOVERY_CODE.test(recovery) ? recovery : null
}

async function submit() {
  error.value = ""
  fieldError.value = ""
  const typed = typedCode()
  if (!typed) {
    fieldError.value =
      props.method === "totp"
        ? "Saisissez les 6 chiffres de l'application, ou un code de secours."
        : "Le code compte 6 chiffres."
    return
  }

  loading.value = true
  try {
    const outcome = await verifyLoginCode(typed)
    if (outcome.recoveryCodes?.length) finished.value = outcome
    else emit("signedIn", outcome)
  } catch (err) {
    const remaining = apiErrorField<number>(err, "remainingAttempts")
    if (apiErrorCode(err) === "InvalidLoginCode" && remaining !== undefined && remaining > 0) {
      error.value = `Code incorrect. Encore ${remaining} essai${remaining > 1 ? "s" : ""}.`
    } else if (authErrorStatus(err) === 423) {
      // Wrong passwords and wrong codes add up on the account (story 12.9f).
      emit("restart", LOCKED_MESSAGE)
    } else if (authErrorStatus(err) === 401) {
      emit("restart", "Ce code ne peut plus servir. Reconnectez-vous avec votre mot de passe.")
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
    else if (authErrorStatus(err) === 429)
      emit("restart", "Plus de nouveau code pour cette connexion. Reconnectez-vous.")
    else if (authErrorStatus(err) === 423) emit("restart", LOCKED_MESSAGE)
    else if (authErrorStatus(err) === 401) emit("restart", "Cette connexion a expiré. Reconnectez-vous.")
    else error.value = "Envoi impossible. Réessayez."
  }
}
</script>

<template>
  <div v-if="finished" class="recovery">
    <p class="auth-card__lede">
      L'application est enregistrée. Voici vos <strong>codes de secours</strong> : chacun remplace une fois
      l'application si vous perdez votre téléphone. Notez-les en lieu sûr, ils ne seront plus affichés.
    </p>
    <ul class="recovery__codes" role="list">
      <li v-for="recovery in finished.recoveryCodes" :key="recovery">{{ recovery }}</li>
    </ul>
    <button type="button" class="btn btn-primary auth-submit recovery-done" @click="emit('signedIn', finished)">
      J'ai noté mes codes, continuer
    </button>
  </div>

  <form v-else novalidate @submit.prevent="submit">
    <template v-if="method === 'email_code'">
      <p class="auth-card__lede">
        Un code de connexion vient d'être envoyé à <strong>{{ email }}</strong>. Il est valable 10 minutes.
      </p>
    </template>
    <template v-else-if="method === 'totp_enrollment'">
      <p class="auth-card__lede">
        La double authentification est obligatoire pour ce compte. Scannez ce QR code avec votre application
        d'authentification (Google Authenticator, Aegis, 1Password…), puis saisissez le code qu'elle affiche.
      </p>
      <img v-if="qrSource" :src="qrSource" alt="QR code à scanner avec l'application d'authentification" class="qr" />
      <p class="key">Ou saisissez cette clé : <code>{{ enrollment?.secret }}</code></p>
    </template>
    <template v-else>
      <p class="auth-card__lede">
        Saisissez le code affiché par votre application d'authentification, ou un de vos codes de secours.
      </p>
    </template>

    <label class="auth-field">
      <span>{{ method === "email_code" ? "Code reçu par e-mail" : "Code de l'application" }}</span>
      <input
        v-model="code"
        type="text"
        :inputmode="method === 'totp' ? 'text' : 'numeric'"
        autocomplete="one-time-code"
        maxlength="12"
        class="auth-input auth-input--code"
      />
      <p v-if="fieldError" class="auth-field__error">{{ fieldError }}</p>
    </label>

    <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="auth-notice" role="status">{{ notice }}</p>

    <button type="submit" class="btn btn-primary auth-submit" :disabled="loading">
      {{ loading ? "Vérification…" : "Valider le code" }}
    </button>

    <p v-if="method === 'email_code'" class="auth-alt">
      Rien reçu&nbsp;? Vérifiez vos indésirables, ou
      <button type="button" class="auth-resend" @click="resend">recevoir un nouveau code</button>.
    </p>
    <p v-else-if="method === 'totp'" class="auth-alt">
      Téléphone perdu, plus de code de secours&nbsp;? Contactez-nous : nous réinitialiserons l'application.
    </p>
  </form>
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
.qr {
  display: block;
  width: 200px;
  height: 200px;
  margin: 0 auto 1rem;
  padding: 0.6rem;
  background: #fff;
  border-radius: var(--radius);
}
.key {
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  word-break: break-all;
  margin: 0 0 1rem;
}
.recovery__codes {
  list-style: none;
  margin: 0 0 1.2rem;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  font-family: ui-monospace, monospace;
  font-size: var(--fs-base);
}
.recovery__codes li {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  text-align: center;
}
</style>
