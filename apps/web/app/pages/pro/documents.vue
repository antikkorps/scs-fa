<script setup lang="ts">
import { ORGANISATION_DOC_TYPES, type OrganisationDocType } from "@armurier/shared"
import type { LegalDocument } from "~/types/account"
import { formatDate } from "~/utils/format"
import { docTypeLabel, docVerificationStatus } from "~/utils/status"

// Story 12.8d — the organisation's own documents (gunsmith licence, prefectoral
// authorisation, purchase order…): SCS judges them before a quote with
// category A, B or C items can be accepted.
definePageMeta({ middleware: "auth" })
useHead({ title: "Justificatifs de l'organisation — SCS Firearms" })

const BASE = "/pro/documents"
const access = useProAccess()
const { list, remove } = useDocuments(BASE)

const ready = ref(false)
const docs = ref<LegalDocument[] | null>(null)
const loadError = ref(false)
const docType = ref<OrganisationDocType>(ORGANISATION_DOC_TYPES[0])
const removeError = ref("")

async function load() {
  try {
    docs.value = await list()
  } catch {
    loadError.value = true
  }
}

onMounted(async () => {
  await access.load()
  ready.value = true
  if (access.isApprovedPro.value) await load()
})

async function withdraw(doc: LegalDocument) {
  if (!confirm(`Retirer ${docTypeLabel(doc.docType).toLowerCase()} ?`)) return
  removeError.value = ""
  try {
    await remove(doc.id)
    await load()
  } catch {
    removeError.value = "Le retrait a échoué. Réessayez."
  }
}
</script>

<template>
  <div class="pro">
    <section class="container pro__inner">
      <AppBreadcrumbs
        :structured="false"
        :items="[{ name: 'Mon compte', to: '/compte' }, { name: 'Justificatifs de l\'organisation' }]"
      />
      <h1 class="pro__title">Justificatifs de l'organisation</h1>
      <p class="lede">
        Pour les articles de catégorie A, B ou C, notre équipe vérifie les justificatifs de votre organisation avant que
        vous puissiez accepter le devis : agrément d'armurier, autorisation préfectorale, affiliation fédérale,
        autorisation CNAPS ou bon de commande signé, selon votre activité.
      </p>

      <p v-if="!ready" class="state">Chargement…</p>
      <ProAccessNotice v-else-if="!access.isApprovedPro.value" :organisation="access.organisation.value" />
      <template v-else>
        <p v-if="loadError" class="state">Impossible de charger vos justificatifs. Veuillez réessayer.</p>
        <ul v-else-if="docs && docs.length > 0" class="docs" role="list">
          <li v-for="doc in docs" :key="doc.id" class="doc">
            <span class="doc__main">
              <span class="doc__name">{{ docTypeLabel(doc.docType) }}</span>
              <span class="doc__meta">
                Déposé le {{ formatDate(doc.uploadedAt) }}<template v-if="doc.expiresAt">
                  · expire le {{ formatDate(doc.expiresAt) }}</template>
              </span>
            </span>
            <span class="doc__side">
              <AdminStatusTag v-bind="docVerificationStatus(doc.verificationStatus)" />
              <button
                v-if="doc.verificationStatus !== 'approved'"
                type="button"
                class="btn btn-ghost remove"
                @click="withdraw(doc)"
              >
                Retirer
              </button>
            </span>
          </li>
        </ul>
        <p v-else-if="docs" class="state">Aucun justificatif déposé pour l'instant.</p>
        <p v-if="removeError" class="err" role="alert">{{ removeError }}</p>

        <section class="add" aria-labelledby="add-title">
          <h2 id="add-title" class="add__h">Déposer un justificatif</h2>
          <label class="field">
            <span>Type de justificatif</span>
            <select v-model="docType" name="docType" class="input">
              <option v-for="type in ORGANISATION_DOC_TYPES" :key="type" :value="type">{{ docTypeLabel(type) }}</option>
            </select>
          </label>
          <LegalDocUpload :key="docType" :doc-type="docType" :base="BASE" @uploaded="load" />
        </section>
      </template>
    </section>
  </div>
</template>

<style scoped>
.pro {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.pro__inner {
  max-width: 820px;
  padding-bottom: 4rem;
}
.pro__title {
  font-size: var(--fs-2xl);
  margin: 0.4rem 0 0.8rem;
}
.lede {
  color: var(--paper-dim);
  margin: 0 0 1.5rem;
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0;
}
.docs {
  list-style: none;
  margin: 0 0 1.5rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.doc {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 1rem 1.2rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.doc__name {
  display: block;
  font-weight: var(--fw-semibold);
}
.doc__meta {
  display: block;
  margin-top: 0.2rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.doc__side {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.add {
  margin-top: 1rem;
  padding: 1.2rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.add__h {
  font-size: var(--fs-lg);
  margin: 0 0 0.8rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.err {
  color: var(--danger);
}
</style>
