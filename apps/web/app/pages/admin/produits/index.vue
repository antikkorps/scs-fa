<script setup lang="ts">
import type { CatalogueColumn } from "~/components/AdminCatalogueList.vue"
import type { AdminProductListItem } from "~/types/admin-catalogue"
import { keptChoice, supplierChoices, withSupplier } from "~/utils/supplier-filter"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Produits — Administration SCS" })

const api = useApi()
const { data, pending, error, refresh } = await useAsyncData(
  "admin-products",
  () => api<{ data: AdminProductListItem[] }>("/admin/products"),
  { server: false },
)

const columns: CatalogueColumn[] = [
  { key: "name", label: "Nom" },
  { key: "sku", label: "SKU" },
  { key: "supplierName", label: "Fournisseur" },
  { key: "categoryName", label: "Catégorie" },
  { key: "legalCategory", label: "Cat. légale" },
  { key: "priceHt", label: "Prix HT", numeric: true },
  { key: "stockQty", label: "Stock", numeric: true },
  { key: "variantCount", label: "Variantes", numeric: true },
  { key: "published", label: "Publié", boolean: true },
  { key: "proOnly", label: "Réservé pro", boolean: true },
]

// Archived products (story 12.4) stay out of the way unless asked for.
const showArchived = ref(false)
const archivedCount = computed(() => (data.value?.data ?? []).filter((p) => p.archivedAt).length)
const shown = computed(() => (data.value?.data ?? []).filter((p) => showArchived.value || !p.archivedAt))
// Story 12.16b: one supplier's catalogue, to archive it in one go.
const supplier = ref("")
const suppliers = computed(() => supplierChoices(shown.value))
// Archiving a supplier's whole catalogue takes it out of the choices.
watch(suppliers, (choices) => {
  supplier.value = keptChoice(supplier.value, choices)
})
const rows = computed(() =>
  withSupplier(shown.value, supplier.value).map((p) => ({ ...p, proOnly: p.audience === "pro" })),
)
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Armurerie</p>
        <h1>Produits</h1>
      </div>
      <NuxtLink to="/admin/produits/nouveau" class="btn-add">+ Nouveau produit</NuxtLink>
    </header>

    <p class="intro">
      Les armes de collection et les œuvres Gun Art ont leurs propres écrans : ils ne figurent pas ici, pour qu'on
      ne puisse pas désynchroniser une pièce de son édition ou de sa provenance.
    </p>

    <div class="filters">
      <label v-if="suppliers.length" class="filter">
        Fournisseur
        <select v-model="supplier">
          <option value="">Tous les fournisseurs</option>
          <option v-for="choice in suppliers" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
        </select>
      </label>
      <label v-if="archivedCount" class="toggle">
        <input v-model="showArchived" type="checkbox" />
        Afficher les produits archivés ({{ archivedCount }})
      </label>
    </div>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les produits.</p>
    <AdminCatalogueList
      v-else
      :rows="rows"
      :columns="columns"
      edit-base="/admin/produits"
      endpoint="/admin/products"
      label-key="name"
      noun="produit"
      archivable
      selectable
      :empty-message="supplier ? 'Aucun produit pour ce fournisseur.' : undefined"
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
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-eyebrow);
  text-transform: uppercase;
  color: var(--paper-faint);
}
h1 {
  margin: 0.3rem 0 0;
  font-size: var(--fs-2xl);
}
.btn-add {
  padding: 0.55rem 1rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font-size: var(--fs-sm);
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
  font-size: var(--fs-base);
  line-height: var(--lh-relaxed);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
  margin: 0 0 1rem;
}
.filter {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
}
.filter select {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
  color: var(--paper);
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--fs-sm);
  color: var(--paper-dim);
  cursor: pointer;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
.state--error {
  color: var(--danger);
}
</style>
