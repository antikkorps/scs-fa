<script setup lang="ts">
import type { AdminColumn, AdminField } from "~/components/AdminEntityManager.vue"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Bénéficiaires — Administration SCS" })

const fields: AdminField[] = [
  { key: "slug", label: "Slug", type: "text", required: true, createOnly: true, help: "Définitif." },
  { key: "name", label: "Nom", type: "text", required: true },
  {
    key: "kind",
    label: "Rôle",
    type: "select",
    required: true,
    createOnly: true,
    options: [
      { value: "artist", label: "Artiste (vente pour son compte)" },
      { value: "advisor", label: "Conseil (commission sur la vente)" },
    ],
  },
  {
    key: "defaultSharePct",
    label: "Part par défaut (%)",
    type: "number",
    help: "Appliquée à toute vente d'un article qui lui est rattaché, sauf taux renégocié sur l'article. Changer ce taux ne réécrit jamais ce qui était dû sur les ventes passées.",
  },
  { key: "contactEmail", label: "E-mail", type: "text" },
  {
    key: "paymentNotes",
    label: "Modalités de versement",
    type: "textarea",
    help: "Note libre. Aucune coordonnée bancaire n'est stockée ici — les versements se font hors du site.",
  },
  { key: "active", label: "Actif", type: "checkbox" },
]

const columns: AdminColumn[] = [
  { key: "name", label: "Nom" },
  { key: "kind", label: "Rôle" },
  { key: "defaultSharePct", label: "Part %", numeric: true },
  { key: "pendingHt", label: "À venir €", numeric: true },
  { key: "dueHt", label: "Dû €", numeric: true },
  { key: "paidHt", label: "Versé €", numeric: true },
  { key: "active", label: "Actif" },
]
</script>

<template>
  <div>
    <AdminEntityManager
      title="Bénéficiaires"
      noun="bénéficiaire"
      new-label="Nouveau bénéficiaire"
      empty-label="Aucun bénéficiaire pour l'instant."
      endpoint="/admin/finance/beneficiaries"
      intro="Les tiers rémunérés sur les ventes : l'artiste dont on vend les tirages pour son compte, et le conseil qui touche une commission sur les pièces vendues. « À venir » attend l'encaissement, « Dû » est exigible, « Versé » est parti."
      :fields="fields"
      :columns="columns"
    />
    <p class="link"><NuxtLink to="/admin/reversements">Voir le détail des reversements →</NuxtLink></p>
  </div>
</template>

<style scoped>
.link {
  margin: 0;
  font-size: 0.88rem;
}
.link a {
  color: var(--brass);
  text-decoration: none;
}
.link a:hover {
  text-decoration: underline;
}
</style>
