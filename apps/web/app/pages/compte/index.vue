<script setup lang="ts">
import type { Profile, UpdateProfile } from "~/types/account"
import { formatDate } from "~/utils/format"

definePageMeta({ middleware: "auth" })
useHead({ title: "Mon compte — SCS Firearm" })

const { get, update } = useProfile()
const { user } = useAuth()

const profile = ref<Profile | null>(null)
const pending = ref(true)
const loadError = ref(false)

const form = reactive({
  firstName: "",
  lastName: "",
  phone: "",
  addressStreet: "",
  addressPostal: "",
  addressCity: "",
})

const saving = ref(false)
const saved = ref(false)
const saveError = ref<string | null>(null)

function hydrate(p: Profile) {
  profile.value = p
  form.firstName = p.firstName ?? ""
  form.lastName = p.lastName ?? ""
  form.phone = p.phone ?? ""
  form.addressStreet = p.addressStreet ?? ""
  form.addressPostal = p.addressPostal ?? ""
  form.addressCity = p.addressCity ?? ""
}

async function load() {
  pending.value = true
  loadError.value = false
  try {
    hydrate(await get())
  } catch {
    loadError.value = true
  } finally {
    pending.value = false
  }
}
onMounted(load)

const vipActive = computed(() => profile.value?.vipActive === true)

async function save() {
  if (saving.value) return
  saving.value = true
  saved.value = false
  saveError.value = null
  // Send a nullable-friendly payload: empty optional fields clear the value.
  const payload: UpdateProfile = {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    phone: form.phone.trim() || null,
    addressStreet: form.addressStreet.trim() || null,
    addressPostal: form.addressPostal.trim() || null,
    addressCity: form.addressCity.trim() || null,
  }
  try {
    const updated = await update(payload)
    hydrate(updated)
    // Keep the cached auth user (name shown in the navbar) in sync.
    if (user.value) {
      user.value = { ...user.value, firstName: updated.firstName ?? "", lastName: updated.lastName ?? "" }
    }
    saved.value = true
  } catch (err) {
    const status = authErrorStatus(err)
    saveError.value =
      status === 400
        ? "Certaines informations sont invalides. Vérifiez les champs saisis."
        : "L'enregistrement a échoué. Veuillez réessayer."
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="account">
    <section class="container account__inner">
      <header class="account__head">
        <p class="eyebrow">Espace personnel</p>
        <h1 class="account__title">Mon compte</h1>
        <p v-if="profile" class="account__sub">
          {{ profile.email }}<template v-if="vipActive"> · <span class="vip">Membre VIP</span></template>
        </p>
      </header>

      <p v-if="pending" class="state">Chargement…</p>
      <p v-else-if="loadError" class="state">Impossible de charger votre profil. Veuillez réessayer.</p>

      <template v-else-if="profile">
        <nav class="quick" aria-label="Raccourcis">
          <NuxtLink to="/compte/commandes" class="quick__card">
            <span class="quick__title">Mes commandes</span>
            <span class="quick__desc">Suivi des paiements et des documents légaux</span>
            <span class="quick__chev" aria-hidden="true">›</span>
          </NuxtLink>
        </nav>

        <form class="card" @submit.prevent="save">
          <h2 class="card__h">Informations personnelles</h2>

          <div class="grid2">
            <label class="field">
              <span>Prénom</span>
              <input v-model="form.firstName" class="input" type="text" maxlength="100" autocomplete="given-name" />
            </label>
            <label class="field">
              <span>Nom</span>
              <input v-model="form.lastName" class="input" type="text" maxlength="100" autocomplete="family-name" />
            </label>
          </div>

          <label class="field">
            <span>Téléphone</span>
            <input v-model="form.phone" class="input" type="tel" autocomplete="tel" />
          </label>

          <label class="field">
            <span>Adresse</span>
            <input v-model="form.addressStreet" class="input" type="text" maxlength="255" autocomplete="street-address" />
          </label>

          <div class="grid2">
            <label class="field">
              <span>Code postal</span>
              <input v-model="form.addressPostal" class="input" type="text" maxlength="10" autocomplete="postal-code" />
            </label>
            <label class="field">
              <span>Ville</span>
              <input v-model="form.addressCity" class="input" type="text" maxlength="100" autocomplete="address-level2" />
            </label>
          </div>

          <p v-if="saveError" class="err" role="alert">{{ saveError }}</p>
          <p v-else-if="saved" class="ok" role="status">Vos informations ont été enregistrées.</p>

          <div class="actions">
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? "Enregistrement…" : "Enregistrer" }}
            </button>
            <span class="since">Compte créé le {{ formatDate(profile.createdAt) }}</span>
          </div>
        </form>
      </template>
    </section>
  </div>
</template>

<style scoped>
.account {
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}
.account__inner {
  max-width: 720px;
  padding-bottom: 4rem;
}
.account__head {
  margin-bottom: 1.75rem;
}
.account__title {
  font-size: clamp(1.8rem, 5vw, 2.5rem);
  margin: 0.4rem 0 0.5rem;
}
.account__sub {
  margin: 0;
  color: var(--paper-dim);
}
.vip {
  color: var(--brass);
  font-weight: 600;
}
.state {
  color: var(--paper-dim);
  padding: 1rem 0 3rem;
}
.quick {
  margin-bottom: 1.75rem;
}
.quick__card {
  position: relative;
  display: block;
  padding: 1.1rem 1.25rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  transition: border-color 0.25s var(--ease);
}
.quick__card:hover {
  border-color: var(--brass);
}
.quick__title {
  display: block;
  font-weight: 600;
  color: var(--paper);
}
.quick__desc {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.85rem;
  color: var(--paper-dim);
}
.quick__chev {
  position: absolute;
  right: 1.1rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--brass);
  font-size: 1.5rem;
}
.card {
  padding: 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.card__h {
  font-size: 1.15rem;
  margin: 0;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--paper-faint);
}
.input {
  width: 100%;
  height: 46px;
  padding: 0 0.85rem;
  color: var(--paper);
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 0.95rem;
}
.input:focus {
  outline: none;
  border-color: var(--brass);
}
.err {
  color: var(--danger);
  font-size: 0.85rem;
  margin: 0;
}
.ok {
  color: var(--brass);
  font-size: 0.85rem;
  margin: 0;
}
.actions {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  flex-wrap: wrap;
}
.since {
  font-size: 0.8rem;
  color: var(--paper-faint);
}
@media (max-width: 560px) {
  .grid2 {
    grid-template-columns: 1fr;
  }
}
</style>
