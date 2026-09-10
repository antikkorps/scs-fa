<script setup lang="ts">
import type { AdminColumn, AdminField } from "~/components/AdminEntityManager.vue"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Séries Gun Art — Administration SCS" })

const fields: AdminField[] = [
  {
    key: "slug",
    label: "Slug (URL)",
    type: "text",
    required: true,
    createOnly: true,
    help: "Définitif : il est indexé.",
  },
  { key: "title", label: "Titre", type: "text", required: true },
  {
    key: "intro",
    label: "Texte de présentation",
    type: "textarea",
    help: "C'est ce texte qui fait de la série une unité éditoriale et non un simple regroupement.",
  },
  { key: "reference", label: "Film / univers de référence", type: "text" },
  { key: "themeId", label: "Thème", type: "select", optionsEndpoint: "/admin/gun-art/themes", optionsLabel: "name" },
  {
    key: "artistId",
    label: "Artiste",
    type: "select",
    optionsEndpoint: "/admin/gun-art/artists",
    optionsLabel: "name",
  },
  { key: "displayOrder", label: "Ordre d'affichage", type: "number" },
  { key: "published", label: "Publiée", type: "checkbox" },
  { key: "metaTitle", label: "Titre SEO", type: "text" },
  { key: "metaDescription", label: "Description SEO", type: "textarea" },
]

const columns: AdminColumn[] = [
  { key: "title", label: "Titre" },
  { key: "themeName", label: "Thème" },
  { key: "artistName", label: "Artiste" },
  { key: "published", label: "Publiée" },
  { key: "artworkCount", label: "Œuvres", numeric: true },
]
</script>

<template>
  <AdminEntityManager
    title="Séries"
    noun="série"
    new-label="Nouvelle série"
    empty-label="Aucune série pour l'instant."
    endpoint="/admin/gun-art/series"
    intro="La série est l'unité éditoriale de la collection. Une série non publiée n'apparaît nulle part, mais ses œuvres restent visibles : elles perdent seulement leur étiquette de série."
    :fields="fields"
    :columns="columns"
    media-owner-type="artwork_series"
  />
</template>
