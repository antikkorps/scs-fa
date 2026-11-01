<script setup lang="ts">
import { telHref } from "~/utils/contact"

// Audit 2026-11-01 (I8) — the site had no way to reach the shop. What shows
// here is the shop_identity record the admins fill in the back-office.
const identity = await loadShopIdentity()

usePageSeo({
  title: "Nous contacter",
  description:
    "Joindre SCS Firearms, armurerie et galerie Gun Art : e-mail, téléphone, adresse et horaires de la boutique.",
  path: "/contact",
})

const hasDetails = computed(() =>
  Boolean(identity.value.email || identity.value.phone || identity.value.address || identity.value.contactHours),
)
</script>

<template>
  <article class="container contact">
    <AppBreadcrumbs :items="[{ name: 'Accueil', to: '/' }, { name: 'Contact' }]" />
    <p class="eyebrow">SCS Firearms</p>
    <h1 class="contact__title">Nous contacter</h1>
    <p class="contact__lede">
      Une question sur une arme, une commande, les pièces à fournir ou une œuvre Gun Art : nous vous répondons.
    </p>

    <dl v-if="hasDetails" class="details">
      <div v-if="identity.email" class="details__row">
        <dt>E-mail</dt>
        <dd><a :href="`mailto:${identity.email}`">{{ identity.email }}</a></dd>
      </div>
      <div v-if="identity.phone" class="details__row">
        <dt>Téléphone</dt>
        <dd><a :href="telHref(identity.phone)">{{ identity.phone }}</a></dd>
      </div>
      <div v-if="identity.address" class="details__row">
        <dt>Adresse</dt>
        <dd>{{ identity.address }}</dd>
      </div>
      <div v-if="identity.contactHours" class="details__row">
        <dt>Horaires</dt>
        <dd>{{ identity.contactHours }}</dd>
      </div>
    </dl>
    <p v-else class="contact__pending">Nos coordonnées seront bientôt disponibles ici.</p>

    <p v-if="identity.contactNote" class="contact__note">{{ identity.contactNote }}</p>
  </article>
</template>

<style scoped>
.contact {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(2rem, 6vw, 4rem);
  max-width: 720px;
}
.contact__title {
  font-size: var(--fs-3xl);
  margin: 0.6rem 0 0.75rem;
}
.contact__lede,
.contact__pending {
  color: var(--paper-dim);
  line-height: var(--lh-normal);
  margin: 0 0 2rem;
}
.details {
  display: grid;
  gap: 0;
  margin: 0 0 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.details__row {
  display: grid;
  grid-template-columns: minmax(7rem, 9rem) 1fr;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--ink-line);
}
.details__row:last-child {
  border-bottom: 0;
}
.details dt {
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
  align-self: center;
}
.details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.details a {
  color: var(--brass);
}
.contact__note {
  color: var(--paper);
  margin: 0;
}
@media (max-width: 480px) {
  .details__row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
}
</style>
