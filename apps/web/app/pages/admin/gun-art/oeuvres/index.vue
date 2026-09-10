<script setup lang="ts">
import type { AdminArtworkListItem } from "~/types/admin-catalogue"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Œuvres Gun Art — Administration SCS" })

const api = useApi()
const { data, pending, error, refresh } = await useAsyncData(
  "admin-artworks",
  () => api<{ data: AdminArtworkListItem[] }>("/admin/artworks"),
  { server: false },
)
const artworks = computed(() => data.value?.data ?? [])
const removeError = ref<string | null>(null)

async function remove(row: AdminArtworkListItem) {
  if (!confirm(`Supprimer « ${row.title} » ? L'édition et ses tirages seront supprimés.`)) return
  removeError.value = null
  try {
    await api(`/admin/artworks/${row.id}`, { method: "DELETE" })
    await refresh()
  } catch (err) {
    const body = (err as { data?: { message?: string } }).data
    removeError.value = body?.message ?? "La suppression a échoué."
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Gun Art</p>
        <h1>Œuvres</h1>
      </div>
      <NuxtLink to="/admin/gun-art/oeuvres/nouvelle" class="btn-add">+ Nouvelle œuvre</NuxtLink>
    </header>

    <p v-if="removeError" class="alert" role="alert">{{ removeError }}</p>
    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les œuvres.</p>
    <p v-else-if="artworks.length === 0" class="state">Aucune œuvre. Créez la première.</p>

    <section v-else class="panel">
      <div class="tablewrap">
        <table class="grid">
          <thead>
            <tr>
              <th scope="col">Titre</th>
              <th scope="col">Artiste</th>
              <th scope="col">Série</th>
              <th scope="col">Publiée</th>
              <th scope="col">Édition</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in artworks" :key="a.id">
              <td>
                <NuxtLink :to="`/admin/gun-art/oeuvres/${a.id}`" class="title">{{ a.title }}</NuxtLink>
                <span class="sku">{{ a.sku }}</span>
              </td>
              <td>{{ a.artistName ?? "—" }}</td>
              <td>{{ a.seriesTitle ?? "—" }}</td>
              <td>{{ a.published ? "Oui" : "Non" }}</td>
              <td class="cell--num">{{ a.availableCount }} dispo · {{ a.soldCount }} vendus / {{ a.editionLimit }}</td>
              <td class="cell--actions">
                <NuxtLink :to="`/admin/gun-art/oeuvres/${a.id}`" class="link">Modifier</NuxtLink>
                <button class="link link--danger" type="button" @click="remove(a)">Supprimer</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.4rem;
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
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
}
.tablewrap {
  overflow-x: auto;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.grid th,
.grid td {
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid var(--ink-line);
  text-align: left;
}
.grid thead th {
  color: var(--paper-faint);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}
.title {
  color: var(--paper);
  text-decoration: none;
  display: block;
}
.title:hover {
  color: var(--brass);
}
.sku {
  display: block;
  font-size: 0.72rem;
  color: var(--paper-faint);
}
.cell--num {
  font-variant-numeric: tabular-nums;
  color: var(--paper-dim);
  white-space: nowrap;
}
.cell--actions {
  text-align: right;
  white-space: nowrap;
}
.link {
  background: none;
  border: 0;
  color: var(--paper-dim);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  padding: 0 0 0 0.8rem;
  text-decoration: none;
}
.link:hover {
  color: var(--brass);
}
.link--danger:hover {
  color: var(--danger);
}
.alert {
  background: rgba(217, 138, 106, 0.12);
  border: 1px solid rgba(217, 138, 106, 0.35);
  color: var(--danger);
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  margin: 0 0 1.2rem;
  font-size: 0.88rem;
}
.state {
  color: var(--paper-dim);
  padding: 1.5rem 0;
}
.state--error {
  color: var(--danger);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
