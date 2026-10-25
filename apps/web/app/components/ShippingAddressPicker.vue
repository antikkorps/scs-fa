<script setup lang="ts">
import { isDeliverableAddress } from "@armurier/shared"
import type { Address, NewAddress } from "~/types/checkout"
import { addressLine, UNDELIVERABLE_MESSAGE } from "~/utils/order"

// The delivery address, picked in the address book or added on the spot —
// shared by the shop's checkout and the acceptance of a pro quote (story 12.8d).
// The page owns the book (it may need it for billing too): a new address is
// announced with `created`, for the page to reload the book.
const props = defineProps<{ addresses: Address[]; name?: string }>()
const selected = defineModel<string>({ required: true })
const emit = defineEmits<{ created: [address: Address] }>()

const { create } = useAddresses()

const showForm = ref(props.addresses.length === 0)
const form = reactive<NewAddress>({
  firstName: "",
  lastName: "",
  line1: "",
  line2: "",
  postal: "",
  city: "",
  phone: "",
})
const formError = ref("")
const saving = ref(false)

watch(
  () => props.addresses.length,
  (count) => {
    if (count === 0) showForm.value = true
  },
)

const chosen = computed(() => props.addresses.find((a) => a.id === selected.value) ?? null)
const undeliverable = computed(() => chosen.value !== null && !isDeliverableAddress(chosen.value))

async function save() {
  formError.value = ""
  if (!form.firstName || !form.lastName || !form.line1 || !form.postal || !form.city) {
    formError.value = "Renseignez les champs obligatoires."
    return
  }
  saving.value = true
  try {
    const created = await create({ ...form, line2: form.line2 || undefined, phone: form.phone || undefined })
    selected.value = created.id
    showForm.value = false
    Object.assign(form, { firstName: "", lastName: "", line1: "", line2: "", postal: "", city: "", phone: "" })
    emit("created", created)
  } catch {
    formError.value = "Impossible d'enregistrer l'adresse."
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <p class="addr-zone">Livraison en France métropolitaine, Corse comprise.</p>

    <ul v-if="addresses.length > 0" class="addr-list" role="list">
      <li v-for="a in addresses" :key="a.id">
        <label class="addr">
          <input v-model="selected" type="radio" :name="name ?? 'shipping'" :value="a.id" />
          <span>
            <strong v-if="a.label">{{ a.label }}</strong>
            {{ addressLine(a) }}
          </span>
        </label>
      </li>
    </ul>
    <p v-if="undeliverable" class="err" role="alert">{{ UNDELIVERABLE_MESSAGE }} Choisissez ou ajoutez une autre adresse.</p>

    <button v-if="!showForm" type="button" class="btn btn-ghost add-btn" @click="showForm = true">
      Ajouter une adresse
    </button>

    <form v-else class="addr-form" @submit.prevent="save">
      <div class="row">
        <input v-model="form.firstName" class="input" placeholder="Prénom *" autocomplete="given-name" />
        <input v-model="form.lastName" class="input" placeholder="Nom *" autocomplete="family-name" />
      </div>
      <input v-model="form.line1" class="input" placeholder="Adresse *" autocomplete="address-line1" />
      <input v-model="form.line2" class="input" placeholder="Complément" autocomplete="address-line2" />
      <div class="row">
        <input v-model="form.postal" class="input" placeholder="Code postal *" autocomplete="postal-code" />
        <input v-model="form.city" class="input" placeholder="Ville *" autocomplete="address-level2" />
      </div>
      <input v-model="form.phone" class="input" type="tel" placeholder="Téléphone" autocomplete="tel" />
      <p v-if="formError" class="err" role="alert">{{ formError }}</p>
      <div class="addr-form__actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? "Enregistrement…" : "Enregistrer" }}
        </button>
        <button v-if="addresses.length > 0" type="button" class="btn btn-ghost" @click="showForm = false">Annuler</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.addr-zone {
  margin: -0.4rem 0 0.8rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.addr-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}
.addr {
  display: flex;
  gap: 0.7rem;
  align-items: start;
  padding: 0.9rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--paper-dim);
}
.addr strong {
  color: var(--paper);
  display: block;
}
.add-btn {
  margin-bottom: 1rem;
}
.addr-form {
  display: grid;
  gap: 0.7rem;
  margin-bottom: 1rem;
}
.row {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: 1fr 1fr;
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
.addr-form__actions {
  display: flex;
  gap: 0.7rem;
}
.err {
  color: var(--danger);
  font-size: var(--fs-sm);
  margin: 0.6rem 0 0;
}
</style>
