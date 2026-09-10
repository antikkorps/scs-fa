<script setup lang="ts">
import type { CatalogueColumn } from "~/components/AdminCatalogueList.vue"
import type { AdminAncientWeaponListItem } from "~/types/admin-catalogue"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Armes de collection — Administration SCS" })

const api = useApi()
const { data, pending, error, refresh } = await useAsyncData(
  "admin-ancient-weapons",
  () => api<{ data: AdminAncientWeaponListItem[] }>("/admin/ancient-weapons"),
  { server: false },
)

const columns: CatalogueColumn[] = [
  { key: "name", label: "Nom" },
  { key: "sku", label: "SKU" },
  { key: "period", label: "Époque" },
  { key: "makerName", label: "Fabricant" },
  { key: "condition", label: "État" },
  { key: "priceHt", label: "Prix HT", numeric: true },
  { key: "isAuthentic", label: "Authentifiée", boolean: true },
  { key: "published", label: "Publiée", boolean: true },
]

const rows = computed(() => data.value?.data ?? [])
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Collection</p>
        <h1>Armes de collection</h1>
      </div>
      <NuxtLink to="/admin/armes-anciennes/nouvelle" class="btn-add">+ Nouvelle pièce</NuxtLink>
    </header>

    <p class="intro">
      Chaque pièce existe en un seul exemplaire : sa variante unique est créée automatiquement, sans quoi elle ne
      pourrait pas être achetée. Une pièce vendue reste au catalogue, marquée vendue.
    </p>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les pièces.</p>
    <AdminCatalogueList
      v-else
      :rows="rows"
      :columns="columns"
      edit-base="/admin/armes-anciennes"
      endpoint="/admin/ancient-weapons"
      label-key="name"
      noun="pièce"
      @changed="refresh()"
    />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.eyebrow {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
h1 {
  margin: 0.3rem 0 0;
  font-size: clamp(1.9rem, 5vw, 2.6rem);
}
.btn-add {
  padding: 0.55rem 1rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font-size: 0.85rem;
  text-decoration: none;
}
.btn-add:hover {
  border-color: var(--brass);
  color: var(--brass);
}
.intro {
  max-width: 72ch;
  margin: 0 0 1.5rem;
  color: var(--paper-dim);
  font-size: 0.9rem;
  line-height: 1.7;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
.state--error {
  color: var(--danger);
}
</style>
