<script setup lang="ts">
import type { MemberOrganisation } from "~/types/organisation"

// Story 12.8c — what a pro page says to an account it does not open to.
defineProps<{ organisation: Pick<MemberOrganisation, "status" | "legalName" | "reviewReason"> | null }>()
</script>

<template>
  <section class="notice" role="status">
    <template v-if="organisation?.status === 'pending'">
      <h2 class="notice__h">Demande en cours d'examen</h2>
      <p>
        L'espace professionnel de {{ organisation.legalName }} s'ouvrira dès que votre compte sera validé par notre
        équipe. Nous vous écrivons à ce moment-là.
      </p>
    </template>
    <template v-else-if="organisation?.status === 'suspended'">
      <h2 class="notice__h">Compte professionnel suspendu</h2>
      <p>Le catalogue professionnel et les demandes de devis ne sont plus accessibles pour {{ organisation.legalName }}.</p>
      <p v-if="organisation.reviewReason" class="notice__reason">Motif : {{ organisation.reviewReason }}</p>
    </template>
    <template v-else-if="organisation?.status === 'rejected'">
      <h2 class="notice__h">Demande refusée</h2>
      <p>
        La demande de compte professionnel de {{ organisation.legalName }} a été refusée.
        <NuxtLink to="/compte#compte-pro">Faire une nouvelle demande</NuxtLink>
      </p>
    </template>
    <template v-else>
      <h2 class="notice__h">Espace professionnel</h2>
      <p>
        Cet espace est réservé aux comptes professionnels validés : armuriers, clubs de tir, sociétés de sécurité privée
        et administrations.
        <NuxtLink to="/compte#compte-pro">Demander un compte professionnel</NuxtLink>
      </p>
    </template>
  </section>
</template>

<style scoped>
.notice {
  padding: 1.5rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  color: var(--paper-dim);
}
.notice__h {
  font-size: var(--fs-md);
  color: var(--paper);
  margin: 0 0 0.6rem;
}
.notice p {
  margin: 0 0 0.5rem;
}
.notice a {
  color: var(--brass);
}
.notice__reason {
  padding-left: 0.8rem;
  border-left: 2px solid var(--danger);
}
</style>
