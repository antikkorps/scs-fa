<script setup lang="ts">
import { type OrganisationType, organisationRequestSchema } from "@armurier/shared"
import type { MemberOrganisation } from "~/types/organisation"
import { organisationTypeLabel } from "~/utils/organisation"

// Story 12.8b — the pro side of the account page: where a request stands, or
// the form to file one (a refused request may be replaced by a new one).
const { mine, request } = useOrganisation()

const organisation = ref<MemberOrganisation | null>(null)
const loaded = ref(false)
const formOpen = ref(false)

const form = reactive({ siret: "", legalName: "", organisationType: "" as OrganisationType | "" })
const fieldErrors = ref<Record<string, string>>({})
const error = ref("")
const sending = ref(false)

onMounted(async () => {
  try {
    organisation.value = await mine()
  } catch {
    // The panel is secondary: the rest of the account page stays usable.
  } finally {
    loaded.value = true
  }
})

const canRequest = computed(() => organisation.value === null || organisation.value.status === "rejected")

async function submit() {
  error.value = ""
  fieldErrors.value = {}
  const parsed = organisationRequestSchema.safeParse(form)
  if (!parsed.success) {
    fieldErrors.value = zodFieldErrors(parsed.error)
    return
  }
  sending.value = true
  try {
    organisation.value = (await request(parsed.data)).data
    formOpen.value = false
  } catch (err) {
    error.value =
      apiErrorCode(err) === "SiretAlreadyRegistered"
        ? "Ce SIRET a déjà un compte professionnel, ou une demande est en cours d'examen."
        : "La demande n'a pas pu être envoyée. Réessayez."
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section v-if="loaded" id="compte-pro" class="pro-panel" aria-labelledby="pro-panel-title">
    <template v-if="organisation?.status === 'pending'">
      <h2 id="pro-panel-title" class="pro-panel__h">Demande en cours d'examen</h2>
      <p class="pro-panel__text">
        {{ organisation.legalName }} ({{ organisationTypeLabel(organisation.type) }}, SIRET {{ organisation.siret }}).
        Notre équipe vous écrit dès qu'elle est validée ; d'ici là, les demandes de devis ne sont pas encore ouvertes.
      </p>
      <p class="pro-panel__text pro-panel__text--dim">
        À chaque connexion, un code vous est désormais envoyé par e-mail après votre mot de passe.
      </p>
    </template>

    <template v-else-if="organisation?.status === 'approved'">
      <h2 id="pro-panel-title" class="pro-panel__h">Compte professionnel validé</h2>
      <p class="pro-panel__text">{{ organisation.legalName }} ({{ organisationTypeLabel(organisation.type) }}).</p>
    </template>

    <template v-else-if="organisation?.status === 'suspended'">
      <h2 id="pro-panel-title" class="pro-panel__h">Compte professionnel suspendu</h2>
      <p class="pro-panel__text">Les demandes de devis ne sont plus possibles pour {{ organisation.legalName }}.</p>
      <p v-if="organisation.reviewReason" class="pro-panel__reason">Motif : {{ organisation.reviewReason }}</p>
    </template>

    <template v-else-if="organisation?.status === 'rejected'">
      <h2 id="pro-panel-title" class="pro-panel__h">Demande refusée</h2>
      <p class="pro-panel__text">Nous n'avons pas pu valider la demande pour {{ organisation.legalName }}.</p>
      <p v-if="organisation.reviewReason" class="pro-panel__reason">Motif : {{ organisation.reviewReason }}</p>
    </template>

    <template v-else>
      <h2 id="pro-panel-title" class="pro-panel__h">Vous êtes un professionnel ?</h2>
      <p class="pro-panel__text">
        Armuriers, clubs de tir, sociétés de sécurité privée et administrations : vos commandes passent par un devis établi
        par notre équipe.
      </p>
    </template>

    <template v-if="canRequest">
      <button v-if="!formOpen" type="button" class="btn btn-ghost pro-panel__open" @click="formOpen = true">
        {{ organisation ? "Faire une nouvelle demande" : "Demander un compte professionnel" }}
      </button>
      <form v-else class="pro-panel__form" novalidate @submit.prevent="submit">
        <ProOrganisationFields :form="form" :field-errors="fieldErrors" />
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
        <div class="pro-panel__actions">
          <button type="submit" class="btn btn-primary" :disabled="sending">
            {{ sending ? "Envoi…" : "Envoyer ma demande" }}
          </button>
          <button type="button" class="btn btn-ghost" :disabled="sending" @click="formOpen = false">Annuler</button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.pro-panel {
  padding: 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin-bottom: 1.75rem;
  scroll-margin-top: 6rem;
}
.pro-panel__h {
  font-size: var(--fs-md);
  margin: 0;
}
.pro-panel__text {
  margin: 0;
  color: var(--paper);
}
.pro-panel__text--dim {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
}
.pro-panel__reason {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border-left: 2px solid var(--danger);
  color: var(--paper-dim);
}
.pro-panel__open {
  align-self: flex-start;
}
.pro-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
}
</style>
