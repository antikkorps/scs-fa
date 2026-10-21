<script setup lang="ts">
import { isValidSiret, normaliseSiret, type OrganisationType } from "@armurier/shared"
import type { SiretLookup } from "~/types/organisation"
import { ORGANISATION_TYPE_OPTIONS } from "~/utils/organisation"

// Story 12.8b — SIRET, legal name and type, shared by the pro signup page and
// the request from an existing account. Fills the parent's form object in
// place; once the SIRET is complete, the registry pre-fills what it knows.
const props = defineProps<{
  form: { siret: string; legalName: string; organisationType: OrganisationType | "" }
  fieldErrors: Record<string, string>
}>()

const { lookup } = useOrganisation()

const registry = ref<SiretLookup | "checking" | "invalid" | null>(null)
let lastLookedUp = ""

async function checkSiret() {
  const siret = normaliseSiret(props.form.siret)
  if (siret === "" || siret === lastLookedUp) return
  if (!isValidSiret(siret)) {
    registry.value = "invalid"
    return
  }
  lastLookedUp = siret
  registry.value = "checking"
  try {
    const answer = await lookup(siret)
    registry.value = answer
    if (answer.status !== "found") return
    if (!props.form.legalName.trim()) props.form.legalName = answer.legalName
    if (!props.form.organisationType && answer.suggestedType) props.form.organisationType = answer.suggestedType
  } catch {
    registry.value = { status: "unavailable" }
  }
}

const hint = computed(() => {
  const answer = registry.value
  if (answer === null || answer === "checking" || answer === "invalid") return null
  if (answer.status === "found") {
    return answer.active
      ? { tone: "ok", text: `Établissement actif : ${answer.legalName}` }
      : { tone: "warn", text: "Cet établissement est fermé au registre des entreprises. Vérifiez le numéro." }
  }
  return answer.status === "not_found"
    ? { tone: "warn", text: "Ce SIRET est inconnu du registre des entreprises. Notre équipe vérifiera votre demande." }
    : { tone: "warn", text: "Le registre des entreprises ne répond pas. Notre équipe vérifiera votre demande." }
})

const siretError = computed(
  () => props.fieldErrors.siret ?? (registry.value === "invalid" ? "Numéro SIRET invalide (14 chiffres)." : null),
)
</script>

<template>
  <div class="pro-fields">
    <label class="auth-field">
      <span>SIRET de l'établissement</span>
      <input
        v-model="form.siret"
        name="siret"
        type="text"
        inputmode="numeric"
        maxlength="20"
        autocomplete="off"
        class="auth-input"
        :aria-invalid="siretError ? 'true' : undefined"
        @blur="checkSiret"
      />
      <p v-if="siretError" class="auth-field__error">{{ siretError }}</p>
      <p v-else-if="registry === 'checking'" class="pro-fields__hint">Recherche au registre des entreprises…</p>
      <p v-else-if="hint" class="pro-fields__hint" :class="`pro-fields__hint--${hint.tone}`" role="status">
        {{ hint.text }}
      </p>
    </label>

    <label class="auth-field">
      <span>Raison sociale</span>
      <input v-model="form.legalName" name="legalName" type="text" maxlength="255" autocomplete="organization" class="auth-input" />
      <p v-if="fieldErrors.legalName" class="auth-field__error">{{ fieldErrors.legalName }}</p>
    </label>

    <label class="auth-field">
      <span>Vous êtes</span>
      <select v-model="form.organisationType" name="organisationType" class="auth-input">
        <option value="" disabled>Choisir…</option>
        <option v-for="option in ORGANISATION_TYPE_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <p v-if="fieldErrors.organisationType" class="auth-field__error">{{ fieldErrors.organisationType }}</p>
    </label>
  </div>
</template>

<style scoped>
.pro-fields__hint {
  margin: 0.4rem 0 0;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.pro-fields__hint--ok {
  color: var(--brass);
}
.pro-fields__hint--warn {
  color: #e0b15f;
}
</style>
