<script setup lang="ts">
import type { AdminColumn, AdminField } from "~/components/AdminEntityManager.vue"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Fournisseurs — Administration SCS" })

const fields: AdminField[] = [
  {
    key: "name",
    label: "Nom",
    type: "text",
    required: true,
    help: "Le nom écrit dans la colonne Fournisseur des fichiers d'import (majuscules indifférentes). Le renommer ne perd aucun produit, mais un fichier exporté avant porte encore l'ancien nom.",
  },
  { key: "contactEmail", label: "E-mail", type: "text" },
  { key: "contactPhone", label: "Téléphone", type: "text" },
]

const columns: AdminColumn[] = [
  { key: "name", label: "Nom" },
  { key: "contactEmail", label: "E-mail" },
  { key: "contactPhone", label: "Téléphone" },
  { key: "products", label: "Produits", numeric: true },
]
</script>

<template>
  <div>
    <AdminEntityManager
      title="Fournisseurs"
      noun="fournisseur"
      new-label="Nouveau fournisseur"
      empty-label="Aucun fournisseur pour l'instant."
      endpoint="/admin/suppliers"
      intro="Un fournisseur se déclare ici avant son premier import : l'import refuse une ligne d'un fournisseur inconnu, pour qu'une faute de frappe ne crée pas un doublon. La suppression n'est possible que tant qu'aucun produit ne s'y rattache."
      :fields="fields"
      :columns="columns"
    />
    <p class="link">
      <NuxtLink to="/admin/imports">Exporter le fichier d'un fournisseur, vierge ou rempli →</NuxtLink>
    </p>
  </div>
</template>

<style scoped>
.link {
  margin-top: 1.2rem;
  font-size: var(--fs-sm);
}
.link a {
  color: var(--brass);
  text-decoration: none;
}
.link a:hover {
  text-decoration: underline;
}
</style>
