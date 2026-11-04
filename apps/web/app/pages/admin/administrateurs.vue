<script setup lang="ts">
import type { AdminTeamMember } from "@armurier/shared"
import { formatDateTime } from "~/utils/format"
import { apiErrorCode } from "~/utils/formErrors"
import { REAUTH_REFUSALS } from "~/utils/reauth"

// Request Franck 2026-11-04 — the people who run the back-office: invite a
// helper as a full admin (no password is ever handed over: they choose theirs
// through a single-use link, then set up their authenticator app), send a new
// link to one who has not finished, take an access back. Every change asks the
// acting admin's password and code, and is journaled under their name.
definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Administrateurs — Administration SCS" })

const api = useApi()
const {
  data,
  pending,
  error: loadError,
  refresh,
} = await useAsyncData("admin-team", () => api<{ data: AdminTeamMember[] }>("/admin/admins"), { server: false })
const team = computed(() => data.value?.data ?? [])

const REFUSALS: Record<string, string> = {
  ...REAUTH_REFUSALS,
  NotAnAdmin: "Cette adresse est déjà celle d'un compte client : une invitation ne change jamais un rôle.",
  OwnAccount: "Votre propre accès se retire par un autre administrateur.",
  NotFound: "Ce compte n'est plus administrateur.",
}
const refusalOf = (err: unknown, fallback: string) => {
  const code = apiErrorCode(err)
  return (code && REFUSALS[code]) || fallback
}

const notice = ref("")
// Shown only when the e-mail could not carry it: to pass on another way.
const fallbackLink = ref("")

const fullName = (member: AdminTeamMember) => [member.firstname, member.lastname].filter(Boolean).join(" ") || "—"

function accessOf(member: AdminTeamMember): { label: string; severity: "ok" | "warn" | "muted" } {
  if (member.totpEnabled) return { label: "Actif", severity: "ok" }
  if (member.invitationExpiresAt) {
    return {
      label: `Invitation envoyée, valable jusqu'au ${formatDateTime(member.invitationExpiresAt)}`,
      severity: "warn",
    }
  }
  return { label: "Accès non finalisé", severity: "muted" }
}

/** What the invited admin needs to know, whether the e-mail left or not. */
function announceInvitation(result: { email: string; emailSent: boolean; link?: string }) {
  fallbackLink.value = result.emailSent ? "" : (result.link ?? "")
  notice.value = result.emailSent
    ? `Invitation envoyée à ${result.email} : le lien est valable 72 heures.`
    : `Invitation créée pour ${result.email}, mais l'e-mail n'a pas pu partir : transmettez-lui le lien ci-dessous par un autre moyen.`
}

function resetMessages() {
  notice.value = ""
  fallbackLink.value = ""
}

// ── Invite ─────────────────────────────────────────────────────────────────
const inviting = ref(false)
const invite = reactive({ email: "", firstname: "", lastname: "", password: "", code: "", busy: false, error: "" })

function openInvite() {
  resetMessages()
  pendingAction.value = null
  Object.assign(invite, { email: "", firstname: "", lastname: "", password: "", code: "", error: "" })
  inviting.value = true
}

async function submitInvite() {
  invite.busy = true
  invite.error = ""
  try {
    const result = await api<{ data: { email: string; emailSent: boolean; link?: string } }>(
      "/admin/admins/invitations",
      {
        method: "POST",
        body: {
          email: invite.email.trim(),
          firstname: invite.firstname.trim(),
          lastname: invite.lastname.trim(),
          password: invite.password,
          code: invite.code.trim(),
        },
      },
    )
    inviting.value = false
    announceInvitation(result.data)
    await refresh()
  } catch (err) {
    invite.error = refusalOf(err, "L'invitation a échoué.")
  } finally {
    invite.busy = false
  }
}

// ── Resend an invitation / take an access back ─────────────────────────────
const pendingAction = ref<{ kind: "resend" | "revoke"; member: AdminTeamMember } | null>(null)
const confirmation = reactive({ password: "", code: "", busy: false, error: "" })

function startAction(kind: "resend" | "revoke", member: AdminTeamMember) {
  resetMessages()
  inviting.value = false
  Object.assign(confirmation, { password: "", code: "", error: "" })
  pendingAction.value = { kind, member }
}

async function submitAction() {
  const action = pendingAction.value
  if (!action) return
  confirmation.busy = true
  confirmation.error = ""
  const credentials = { password: confirmation.password, code: confirmation.code.trim() }
  try {
    if (action.kind === "resend") {
      const result = await api<{ data: { email: string; emailSent: boolean; link?: string } }>(
        "/admin/admins/invitations",
        {
          method: "POST",
          body: {
            email: action.member.email,
            firstname: action.member.firstname || "Admin",
            lastname: action.member.lastname || "SCS",
            ...credentials,
          },
        },
      )
      announceInvitation(result.data)
    } else {
      await api(`/admin/admins/${action.member.id}/revoke`, { method: "POST", body: credentials })
      notice.value = `Accès retiré à ${action.member.email} : ses sessions sont fermées, le compte devient un compte client.`
    }
    pendingAction.value = null
    await refresh()
  } catch (err) {
    confirmation.error = refusalOf(err, "L'opération a échoué.")
  } finally {
    confirmation.busy = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Ventes</p>
      <h1>Administrateurs</h1>
      <p class="intro">
        Les personnes qui ont accès à l'administration. Une personne invitée choisit elle-même son mot de passe avec
        un lien à usage unique, valable 72 heures, puis configure son application d'authentification à sa première
        connexion. Chaque invitation et chaque retrait demande votre mot de passe et votre code, et il est journalisé.
      </p>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="fallbackLink" class="invitation-link">
      <span class="label">Lien à transmettre (usage unique)</span>
      <code>{{ fallbackLink }}</code>
    </p>

    <button v-if="!inviting" type="button" class="btn btn-primary open-invite" @click="openInvite">
      Inviter un administrateur
    </button>

    <form v-if="inviting" class="panel invite" @submit.prevent="submitInvite">
      <h2 class="panel__title">Inviter un administrateur</h2>
      <p class="hint">Il aura accès à tout le back-office, comme vous.</p>
      <label class="field">
        <span>E-mail</span>
        <input v-model="invite.email" class="ctl" type="email" name="invite-email" autocomplete="off" required />
      </label>
      <div class="field-row">
        <label class="field">
          <span>Prénom</span>
          <input v-model="invite.firstname" class="ctl" type="text" name="invite-firstname" autocomplete="off" required />
        </label>
        <label class="field">
          <span>Nom</span>
          <input v-model="invite.lastname" class="ctl" type="text" name="invite-lastname" autocomplete="off" required />
        </label>
      </div>
      <AdminReauthFields v-model:password="invite.password" v-model:code="invite.code" />
      <p v-if="invite.error" class="error" role="alert">{{ invite.error }}</p>
      <div class="actions">
        <button type="submit" class="btn btn-primary" :disabled="invite.busy">Envoyer l'invitation</button>
        <button type="button" class="btn btn-ghost" :disabled="invite.busy" @click="inviting = false">Annuler</button>
      </div>
    </form>

    <form v-if="pendingAction" class="panel team-confirm" @submit.prevent="submitAction">
      <p class="hint">
        <template v-if="pendingAction.kind === 'resend'">
          Envoyer un nouveau lien à <strong class="strong">{{ pendingAction.member.email }}</strong> ? Le lien précédent ne
          fonctionnera plus.
        </template>
        <template v-else>
          Retirer l'accès de <strong class="strong">{{ pendingAction.member.email }}</strong> à l'administration ? Ses
          sessions sont fermées tout de suite ; le compte devient un compte client.
        </template>
      </p>
      <AdminReauthFields v-model:password="confirmation.password" v-model:code="confirmation.code" />
      <p v-if="confirmation.error" class="error" role="alert">{{ confirmation.error }}</p>
      <div class="actions">
        <button type="submit" class="btn btn-primary" :class="{ danger: pendingAction.kind === 'revoke' }" :disabled="confirmation.busy">
          {{ pendingAction.kind === "resend" ? "Envoyer un nouveau lien" : "Retirer l'accès" }}
        </button>
        <button type="button" class="btn btn-ghost" :disabled="confirmation.busy" @click="pendingAction = null">
          Annuler
        </button>
      </div>
    </form>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="loadError" class="state state--error">Impossible de charger les administrateurs.</p>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Administrateur</th>
            <th>Accès</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="member in team" :key="member.id">
            <td>
              <span class="strong">{{ fullName(member) }}</span>
              <span v-if="member.isMe" class="me">vous</span>
              <span class="sub cell-break">{{ member.email }}</span>
            </td>
            <td><AdminStatusTag v-bind="accessOf(member)" /></td>
            <td class="action">
              <button
                v-if="!member.totpEnabled"
                type="button"
                class="btn btn-ghost resend"
                :disabled="pendingAction !== null"
                @click="startAction('resend', member)"
              >
                Renvoyer l'invitation
              </button>
              <button
                v-if="!member.isMe"
                type="button"
                class="btn btn-ghost revoke"
                :disabled="pendingAction !== null"
                @click="startAction('revoke', member)"
              >
                Retirer l'accès
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.2rem;
}
.head h1 {
  font-size: var(--fs-2xl);
  margin-top: 0.3rem;
}
.intro {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  max-width: 46rem;
  margin-top: 0.6rem;
}
.notice {
  color: var(--brass);
  font-size: var(--fs-sm);
  margin: 0 0 1rem;
}
.invitation-link {
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 0.8rem 1rem;
  margin: 0 0 1.2rem;
}
.invitation-link .label {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.4rem;
}
.invitation-link code {
  overflow-wrap: anywhere;
  font-size: var(--fs-sm);
}
.open-invite {
  margin-bottom: 1.4rem;
}
.panel {
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  padding: 1.2rem;
  margin: 0 0 1.4rem;
  max-width: 34rem;
}
.panel__title {
  font-size: var(--fs-lg);
  margin: 0 0 0.3rem;
}
.hint {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin: 0 0 1rem;
}
.field {
  display: block;
  margin-bottom: 0.9rem;
}
.field span {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  margin-bottom: 0.4rem;
}
.field-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0 0.9rem;
}
.ctl {
  width: 100%;
  padding: 0.6rem 0.7rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-base);
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
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
.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #1a1407;
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.state--error {
  color: var(--danger);
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  min-width: 560px;
}
.table th {
  text-align: left;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: var(--fw-semibold);
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  background: var(--ink-soft);
}
.table td {
  padding: 0.8rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  vertical-align: middle;
}
.table tr:last-child td {
  border-bottom: none;
}
.strong {
  color: var(--paper);
  font-weight: var(--fw-semibold);
}
.sub {
  display: block;
  color: var(--paper-dim);
}
.me {
  margin-left: 0.4rem;
  font-size: var(--fs-xs);
  color: var(--brass);
  text-transform: uppercase;
  letter-spacing: var(--ls-wide);
}
.action {
  text-align: right;
  white-space: nowrap;
}
.action .btn + .btn {
  margin-left: 0.5rem;
}
</style>
