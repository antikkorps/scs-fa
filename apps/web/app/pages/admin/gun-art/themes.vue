<script setup lang="ts">
import type { AdminColumn, AdminField } from "~/components/AdminEntityManager.vue"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Thèmes Gun Art — Administration SCS" })

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
  { key: "description", label: "Description", type: "textarea" },
  { key: "displayOrder", label: "Ordre d'affichage", type: "number" },
]

const columns: AdminColumn[] = [
  { key: "name", label: "Nom" },
  { key: "slug", label: "Slug" },
  { key: "displayOrder", label: "Ordre", numeric: true },
  { key: "seriesCount", label: "Séries", numeric: true },
]
</script>

<template>
  <AdminEntityManager
    title="Thèmes"
    noun="thème"
    new-label="Nouveau thème"
    empty-label="Aucun thème pour l'instant."
    endpoint="/admin/gun-art/themes"
    intro="Un thème regroupe des séries (un film, un univers de référence) et porte sa propre page /collection/theme/…. Supprimer un thème ne supprime pas ses séries : elles perdent seulement leur étiquette."
    :fields="fields"
    :columns="columns"
  />
</template>
