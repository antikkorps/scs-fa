<script setup lang="ts">
import { CONTACT_SUBJECT_LABELS, CONTACT_SUBJECTS, type ContactSubject } from "@armurier/shared"

// Audit 2026-11-01 (I8b) — the contact form. No captcha: a field hidden from
// people (robots fill it) and the time taken to fill the form tell a script
// apart; the API also limits sends per network and per address.
const api = useApi()

const form = reactive({
  name: "",
  email: "",
  phone: "",
  subject: "" as ContactSubject | "",
  orderReference: "",
  message: "",
  website: "",
})
const shownAt = ref(Date.now())
onMounted(() => {
  shownAt.value = Date.now()
})

const sending = ref(false)
const sent = ref(false)
const error = ref("")

const REFUSALS: Record<string, string> = {
  TooManyMessages: "Vous nous avez déjà envoyé plusieurs messages : nous vous répondons au plus vite.",
  ValidationError: "Vérifiez les champs : nom, adresse e-mail, sujet et message sont nécessaires.",
}

async function submit() {
  if (sending.value) return
  sending.value = true
  error.value = ""
  try {
    await api("/contact", {
      method: "POST",
      body: { ...form, filledInMs: Date.now() - shownAt.value },
    })
    sent.value = true
  } catch (err) {
    const code = apiErrorCode(err)
    error.value = (code && REFUSALS[code]) || "L'envoi a échoué. Réessayez dans un instant."
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section class="contact-form" aria-labelledby="contact-form-h">
    <h2 id="contact-form-h" class="contact-form__h">Écrivez-nous</h2>

    <p v-if="sent" class="contact-form__sent" role="status">
      Message envoyé. Nous vous répondons par e-mail dès que possible.
    </p>

    <form v-else novalidate @submit.prevent="submit">
      <div class="grid2">
        <label class="field">
          <span>Nom</span>
          <input v-model="form.name" name="name" class="input" autocomplete="name" maxlength="100" required />
        </label>
        <label class="field">
          <span>Adresse e-mail</span>
          <input
            v-model="form.email"
            name="email"
            type="email"
            class="input"
            autocomplete="email"
            maxlength="255"
            required
          />
        </label>
        <label class="field">
          <span>Téléphone <small>(facultatif)</small></span>
          <input v-model="form.phone" name="phone" type="tel" class="input" autocomplete="tel" maxlength="20" />
        </label>
        <label class="field">
          <span>Sujet</span>
          <select v-model="form.subject" name="subject" class="input" required>
            <option value="" disabled>Choisissez…</option>
            <option v-for="subject in CONTACT_SUBJECTS" :key="subject" :value="subject">
              {{ CONTACT_SUBJECT_LABELS[subject] }}
            </option>
          </select>
        </label>
      </div>
      <label class="field">
        <span>Référence de commande <small>(facultatif)</small></span>
        <input v-model="form.orderReference" name="orderReference" class="input" maxlength="40" />
      </label>
      <label class="field">
        <span>Message</span>
        <textarea v-model="form.message" name="message" class="input input--area" rows="6" maxlength="5000" required />
      </label>

      <!-- The robot trap: invisible, skipped by the keyboard and screen readers. -->
      <div class="trap" aria-hidden="true">
        <label>Site web <input v-model="form.website" name="website" tabindex="-1" autocomplete="off" /></label>
      </div>

      <button type="submit" class="btn btn-primary" :disabled="sending">{{ sending ? "Envoi…" : "Envoyer" }}</button>
      <p v-if="error" class="contact-form__error" role="alert">{{ error }}</p>
      <p class="privacy">
        Vos coordonnées et votre message servent uniquement à vous répondre ; ils sont supprimés un an après le
        traitement de votre demande. En savoir plus : <NuxtLink to="/confidentialite">politique de confidentialité</NuxtLink>.
      </p>
    </form>
  </section>
</template>

<style scoped>
.contact-form {
  margin-top: 2.5rem;
}
.contact-form__h {
  font-size: var(--fs-xl);
  margin: 0 0 1rem;
}
form {
  display: grid;
  gap: 1rem;
}
.grid2 {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.field small {
  color: var(--paper-faint);
}
.input {
  width: 100%;
  min-height: 46px;
  padding: 0.6rem 0.85rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: var(--fs-base);
}
.input--area {
  resize: vertical;
}
.input:focus {
  outline: none;
  border-color: var(--brass);
}
.trap {
  position: absolute;
  left: -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.btn {
  justify-self: start;
}
.contact-form__sent {
  padding: 1rem 1.25rem;
  border: 1px solid var(--brass);
  border-radius: var(--radius);
}
.contact-form__error {
  margin: 0;
  color: var(--danger);
}
.privacy {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--paper-faint);
}
.privacy a {
  color: var(--brass);
}
</style>
