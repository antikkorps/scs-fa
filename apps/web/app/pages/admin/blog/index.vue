<script setup lang="ts">
import type { AdminBlogListItem, Pagination } from "~/types/admin"
import { formatDate, formatDateTime } from "~/utils/format"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Journal — Administration SCS" })

const api = useApi()
const route = useRoute()
const router = useRouter()

const publishedFilter = ref((route.query.published as string) || "")
const search = ref((route.query.search as string) || "")
const page = ref(Number(route.query.page) || 1)

const query = computed(() => {
  const p = new URLSearchParams()
  if (publishedFilter.value) p.set("published", publishedFilter.value)
  if (search.value.trim()) p.set("search", search.value.trim())
  p.set("page", String(page.value))
  p.set("limit", "20")
  return p.toString()
})

const { data, pending, error } = await useAsyncData(
  "admin-blog",
  () => api<{ data: AdminBlogListItem[]; pagination: Pagination }>(`/admin/blog?${query.value}`),
  { server: false, watch: [query] },
)

const posts = computed(() => data.value?.data ?? [])
const pagination = computed(() => data.value?.pagination)

function applyFilters() {
  page.value = 1
  syncUrl()
}
function resetFilters() {
  publishedFilter.value = ""
  search.value = ""
  page.value = 1
  syncUrl()
}
function syncUrl() {
  router.replace({
    query: {
      ...(publishedFilter.value ? { published: publishedFilter.value } : {}),
      ...(search.value.trim() ? { search: search.value.trim() } : {}),
      ...(page.value > 1 ? { page: String(page.value) } : {}),
    },
  })
}
function go(delta: number) {
  const next = page.value + delta
  if (next < 1 || (pagination.value && next > pagination.value.totalPages)) return
  page.value = next
  syncUrl()
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow">Éditorial</p>
        <h1>Le Journal</h1>
      </div>
      <NuxtLink to="/admin/blog/new" class="btn btn-primary">Nouvel article</NuxtLink>
    </header>

    <form class="filters" @submit.prevent="applyFilters">
      <input v-model="search" class="ctl" type="search" placeholder="Titre ou slug…" />
      <select v-model="publishedFilter" class="ctl" @change="applyFilters">
        <option value="">Tous les statuts</option>
        <option value="true">Publiés</option>
        <option value="false">Brouillons</option>
      </select>
      <button type="submit" class="btn btn-ghost">Filtrer</button>
      <button type="button" class="btn btn-ghost" @click="resetFilters">Réinitialiser</button>
    </form>

    <p v-if="pending" class="state">Chargement…</p>
    <p v-else-if="error" class="state state--error">Impossible de charger les articles.</p>
    <p v-else-if="posts.length === 0" class="state">Aucun article pour ces critères.</p>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Titre</th>
            <th>Catégorie</th>
            <th>Statut</th>
            <th>Publié le</th>
            <th>Modifié</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in posts" :key="p.id" class="row" @click="navigateTo(`/admin/blog/${p.id}`)">
            <td>
              <span class="title">{{ p.title }}</span>
              <span class="slug">/blog/{{ p.slug }}</span>
            </td>
            <td>{{ p.category || "—" }}</td>
            <td>
              <span class="tag" :class="p.published ? 'tag--on' : 'tag--off'">
                {{ p.published ? "Publié" : "Brouillon" }}
              </span>
              <span v-if="p.featured" class="tag tag--star">En avant</span>
            </td>
            <td>{{ p.publishedAt ? formatDate(p.publishedAt) : "—" }}</td>
            <td>{{ formatDateTime(p.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="pagination && pagination.totalPages > 1" class="pager">
      <button class="btn btn-ghost" :disabled="page <= 1" @click="go(-1)">Précédent</button>
      <span class="pager__info">
        Page {{ pagination.page }} / {{ pagination.totalPages }} · {{ pagination.total }} articles
      </span>
      <button class="btn btn-ghost" :disabled="!pagination.hasMore" @click="go(1)">Suivant</button>
    </nav>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.4rem;
  flex-wrap: wrap;
}
.head h1 {
  font-size: clamp(1.9rem, 5vw, 2.6rem);
  margin-top: 0.3rem;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 1.4rem;
}
.ctl {
  padding: 0.6rem 0.8rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.88rem;
  min-width: 170px;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  min-width: 680px;
}
.table th {
  text-align: left;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: 600;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  background: var(--ink-soft);
}
.table td {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--ink-line);
  vertical-align: middle;
}
.row {
  cursor: pointer;
  transition: background 0.15s var(--ease);
}
.row:hover {
  background: rgba(255, 255, 255, 0.025);
}
.row:last-child td {
  border-bottom: none;
}
.title {
  display: block;
  color: var(--paper);
}
.slug {
  display: block;
  font-size: 0.76rem;
  color: var(--paper-faint);
}
.tag {
  display: inline-block;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--ink-line);
  margin-right: 0.35rem;
}
.tag--on {
  color: var(--brass);
  border-color: rgba(200, 163, 91, 0.4);
}
.tag--off {
  color: var(--paper-faint);
}
.tag--star {
  color: var(--paper-dim);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.4rem;
  flex-wrap: wrap;
}
.pager__info {
  font-size: 0.82rem;
  color: var(--paper-dim);
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.state--error {
  color: var(--danger);
}
</style>
