<script setup lang="ts">
import { EMPTY_SHOP_IDENTITY, missingLegalFacts, type ShopIdentity } from "@armurier/shared"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Identité de la boutique — Administration SCS" })

// Audit 2026-11-01 (I8) — who the shop is and how to reach it: the legal
// notice, the CGV, the privacy policy, the order e-mail and /contact all state
// these facts. A legal page stays out of search engines until every legal fact
// is filled in. Each change is journaled server-side.
type FieldKey = keyof ShopIdentity

interface Field {
  key: FieldKey
  label: string
  help?: string
  type?: "email" | "tel" | "url"
  multiline?: boolean
}

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Société",
    fields: [
      { key: "companyName", label: "Raison sociale" },
      { key: "legalForm", label: "Forme juridique", help: "SAS, SARL, EI…" },
      { key: "shareCapital", label: "Capital social", help: "Par exemple « 10 000 € »." },
      { key: "registration", label: "Immatriculation", help: "« RCS <ville> <numéro> »." },
      { key: "siret", label: "SIRET", help: "14 chiffres, espaces acceptés." },
      { key: "vatNumber", label: "N° de TVA intracommunautaire" },
      { key: "address", label: "Siège social", help: "Sur une ligne." },
      { key: "publicationDirector", label: "Directeur de la publication", help: "La personne responsable du site." },
    ],
  },
  {
    title: "Coordonnées",
    fields: [
      { key: "email", label: "E-mail de contact", type: "email" },
      { key: "privacyEmail", label: "E-mail pour les données personnelles", type: "email", help: "Peut être le même." },
      { key: "phone", label: "Téléphone", type: "tel" },
    ],
  },
  {
    title: "Commerce des armes et médiation",
    fields: [
      {
        key: "firearmsTradeAuthorisation",
        label: "Autorisation de commerce des armes",
        help: "Référence de l'autorisation préfectorale.",
      },
      { key: "mediatorName", label: "Médiateur de la consommation" },
      { key: "mediatorUrl", label: "Site du médiateur", type: "url", help: "Adresse commençant par https://" },
    ],
  },
  {
    title: "Page Contact",
    fields: [
      { key: "contactHours", label: "Horaires", help: "Par exemple « Du mardi au samedi, 9 h – 18 h »." },
      {
        key: "contactNote",
        label: "Précision pour les visiteurs",
        help: "Par exemple « Retrait en boutique sur rendez-vous ».",
        multiline: true,
      },
    ],
  },
]

const LABELS = Object.fromEntries(GROUPS.flatMap((group) => group.fields).map((field) => [field.key, field.label]))

const api = useApi()

const { data, pending, error } = await useAsyncData(
  "admin-shop-identity",
  () => api<{ data: ShopIdentity }>("/admin/shop-identity"),
  { server: false },
)

/** The form edits text; a blank field is sent as "not supplied yet". */
const form = reactive<Record<FieldKey, string>>(
  Object.fromEntries(Object.keys(EMPTY_SHOP_IDENTITY).map((key) => [key, ""])) as Record<FieldKey, string>,
)

watch(
  () => data.value?.data,
  (identity) => {
    if (!identity) return
    for (const key of Object.keys(form) as FieldKey[]) form[key] = identity[key] ?? ""
  },
  { immediate: true },
)

function toIdentity(): ShopIdentity {
  const identity: ShopIdentity = { ...EMPTY_SHOP_IDENTITY }
  for (const key of Object.keys(form) as FieldKey[]) identity[key] = form[key].trim() || null
  return identity
}

const missing = computed(() => missingLegalFacts(toIdentity()))

const saving = ref(false)
const saved = ref(false)
const saveError = ref<string | null>(null)

function invalidFields(err: unknown): string[] {
  const issues = (err as { data?: { issues?: { path?: unknown }[] } }).data?.issues ?? []
  return issues.map((issue) => LABELS[String(issue.path)] ?? String(issue.path))
}

async function save() {
  saving.value = true
  saved.value = false
  saveError.value = null
  try {
    data.value = await api<{ data: ShopIdentity }>("/admin/shop-identity", { method: "PUT", body: toIdentity() })
    saved.value = true
  } catch (err) {
    const fields = invalidFields(err)
    saveError.value = fields.length ? `Vérifiez : ${fields.join(", ")}.` : "L'enregistrement a échoué. Réessayez."
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Boutique</p>
      <h1>Identité de la boutique</h1>
      <p class="intro">
        Ces informations apparaissent dans les mentions légales, les CGV, la politique de confidentialité, l'e-mail de
        confirmation de commande et la page Contact. Un champ vide s'affiche comme « à compléter ».
      </p>
    </header>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state">Impossible de charger l'identité de la boutique.</p>

    <form v-else class="form" @submit.prevent="save">
      <p v-if="missing.length" class="missing">
        {{ missing.length }} informations légales manquent : tant qu'elles ne sont pas toutes renseignées, les pages
        légales restent invisibles des moteurs de recherche.
      </p>

      <fieldset v-for="group in GROUPS" :key="group.title" class="group">
        <legend class="group__title">{{ group.title }}</legend>
        <label v-for="field in group.fields" :key="field.key" class="field">
          <span class="field__label">{{ field.label }}</span>
          <textarea v-if="field.multiline" v-model="form[field.key]" :name="field.key" class="ctl" rows="3" />
          <input v-else v-model="form[field.key]" :name="field.key" :type="field.type ?? 'text'" class="ctl" />
          <span v-if="field.help" class="field__help">{{ field.help }}</span>
        </label>
      </fieldset>

      <div class="actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? "Enregistrement…" : "Enregistrer" }}
        </button>
        <p v-if="saved" class="ok" role="status">Enregistré.</p>
        <p v-if="saveError" class="err" role="alert">{{ saveError }}</p>
      </div>
    </form>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.5rem;
  max-width: 46rem;
}
.eyebrow {
  margin: 0;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
}
h1 {
  margin: 0.3rem 0 0.6rem;
  font-size: var(--fs-2xl);
}
.intro,
.state {
  margin: 0;
  color: var(--paper-dim);
  line-height: var(--lh-normal);
}
.form {
  display: grid;
  gap: 1.6rem;
  max-width: 46rem;
}
.missing {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid var(--brass);
  border-radius: var(--radius);
  color: var(--paper);
  font-size: var(--fs-sm);
}
.group {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  margin: 0;
  padding: 1.2rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.group__title {
  padding: 0 0.4rem;
  font-size: var(--fs-md);
  color: var(--paper);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.field__label {
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: var(--fw-semibold);
}
.field__help {
  font-size: var(--fs-sm);
  color: var(--paper-faint);
  line-height: var(--lh-normal);
}
.ctl {
  padding: 0.6rem 0.8rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: var(--fs-base);
  width: 100%;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}
.ok {
  margin: 0;
  color: var(--paper-dim);
}
.err {
  margin: 0;
  color: var(--danger);
}
</style>
