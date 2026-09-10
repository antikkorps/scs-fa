<script setup lang="ts">
import type { AdminColumn, AdminField } from "~/components/AdminEntityManager.vue"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Artistes — Administration SCS" })

const fields: AdminField[] = [
  {
    key: "slug",
    label: "Slug (URL)",
    type: "text",
    required: true,
    createOnly: true,
    help: "Définitif : il est indexé. Minuscules et tirets.",
  },
  { key: "name", label: "Nom", type: "text", required: true },
  { key: "headline", label: "Accroche", type: "text", help: "Une ligne sous le nom." },
  { key: "bio", label: "Biographie", type: "textarea" },
  { key: "journey", label: "Parcours", type: "textarea" },
  { key: "bookTitle", label: "Titre du livre", type: "text" },
  {
    key: "bookUrl",
    label: "Lien du livre",
    type: "url",
    help: "Lien affilié : rendu en rel=\"sponsored noopener\", nouvel onglet. Titre ET lien sont nécessaires pour qu'il s'affiche.",
  },
  { key: "published", label: "Publié", type: "checkbox" },
  {
    key: "beneficiaryId",
    label: "Bénéficiaire (reversements)",
    type: "select",
    optionsEndpoint: "/admin/finance/beneficiary-options",
    optionsLabel: "name",
    help: "Identité financière de l'artiste, tenue à part de sa fiche éditoriale. Sans elle, aucune part ne lui est reversée sur les ventes.",
  },
  { key: "metaTitle", label: "Titre SEO", type: "text" },
  { key: "metaDescription", label: "Description SEO", type: "textarea" },
]

const columns: AdminColumn[] = [
  { key: "name", label: "Nom" },
  { key: "slug", label: "Slug" },
  { key: "published", label: "Publié" },
  { key: "seriesCount", label: "Séries", numeric: true },
  { key: "artworkCount", label: "Œuvres", numeric: true },
]
</script>

<template>
  <AdminEntityManager
    title="Artistes"
    noun="artiste"
    new-label="Nouvel artiste"
    empty-label="Aucun artiste pour l'instant."
    endpoint="/admin/gun-art/artists"
    intro="La fiche artiste alimente la page publique /collection/artiste/… : bio, parcours, portrait et lien du livre. Un artiste non publié n'a pas de page et n'apparaît sous aucune œuvre."
    :fields="fields"
    :columns="columns"
    media-owner-type="artist"
  />
</template>
