<script setup lang="ts">
import { TAG_FACETS } from "@armurier/shared"
import type { AdminColumn, AdminField } from "~/components/AdminEntityManager.vue"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Tags — Administration SCS" })

const FACET_LABELS: Record<string, string> = {
  etat: "État",
  epoque: "Époque",
  caracteristique: "Caractéristique",
}

const fields: AdminField[] = [
  {
    key: "slug",
    label: "Slug (URL)",
    type: "text",
    required: true,
    createOnly: true,
    help: "Définitif : il est indexé.",
  },
  { key: "name", label: "Nom", type: "text", required: true },
  {
    key: "facet",
    label: "Facette",
    type: "select",
    required: true,
    createOnly: true,
    options: TAG_FACETS.map((f) => ({ value: f, label: FACET_LABELS[f] ?? f })),
    help: "Définitive. La facette pilote le sens du filtrage (OU à l'intérieur d'une facette, ET entre facettes) : la changer modifierait silencieusement tous les filtres enregistrés.",
  },
  { key: "description", label: "Description", type: "textarea" },
  { key: "displayOrder", label: "Ordre d'affichage", type: "number" },
]

const columns: AdminColumn[] = [
  { key: "name", label: "Nom" },
  { key: "slug", label: "Slug" },
  { key: "facet", label: "Facette" },
  { key: "usageCount", label: "Produits", numeric: true },
]
</script>

<template>
  <AdminEntityManager
    title="Tags"
    noun="tag"
    new-label="Nouveau tag"
    empty-label="Aucun tag pour l'instant."
    endpoint="/admin/tags"
    intro="Un produit porte une seule catégorie mais autant de tags que nécessaire. Supprimer un tag le retire des produits qui le portent, sans toucher aux produits eux-mêmes."
    :fields="fields"
    :columns="columns"
  />
</template>
