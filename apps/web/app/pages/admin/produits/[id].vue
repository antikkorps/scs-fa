<script setup lang="ts">
import { LEGAL_CATEGORIES } from "@armurier/shared"
import type { AdminProductDetail, AdminProductVariant } from "~/types/admin-catalogue"

definePageMeta({ layout: "admin", middleware: "admin" })

const route = useRoute()
const api = useApi()
const isNew = computed(() => route.params.id === "nouveau")
const id = computed(() => route.params.id as string)

useHead({ title: () => `${isNew.value ? "Nouveau produit" : "Modifier un produit"} — Administration SCS` })

const form = reactive({
  sku: "",
  slug: "",
  name: "",
  description: "",
  longDescription: "",
  categorySlug: "",
  legalCategory: "none" as (typeof LEGAL_CATEGORIES)[number],
  priceHt: 0,
  vatPct: 20,
  stockQty: 0,
  trackStock: true,
  featuredImageUrl: "",
  published: false,
  featured: false,
  tagSlugs: [] as string[],
  variants: [] as AdminProductVariant[],
  metaTitle: "",
  metaDescription: "",
})

// Re-bound locally: the import is also used in a `typeof` position, and Vue
// then drops it from the template scope.
const legalCategoryOptions = LEGAL_CATEGORIES
const loadError = ref(false)
const saveError = ref<string | null>(null)
const saving = ref(false)

const { data: categoriesData } = await useAsyncData("admin-product-categories", () =>
  api<{ data: Array<{ slug: string; name: string }> }>("/product-categories"),
)
const { data: tagsData } = await useAsyncData("admin-tags-opts", () =>
  api<{ data: Array<{ slug: string; name: string; facet: string }> }>("/admin/tags"),
)
const categories = computed(() => (categoriesData.value?.data ?? []).filter((c) => c.slug !== "gun-art"))
const allTags = computed(() => tagsData.value?.data ?? [])

async function load() {
  if (isNew.value) return
  try {
    const d = (await api<{ data: AdminProductDetail }>(`/admin/products/${id.value}`)).data
    Object.assign(form, {
      sku: d.sku,
      slug: d.slug,
      name: d.name,
      description: d.description ?? "",
      longDescription: d.longDescription ?? "",
      categorySlug: d.categorySlug,
      legalCategory: (d.legalCategory ?? "none") as (typeof LEGAL_CATEGORIES)[number],
      priceHt: d.priceHt,
      vatPct: d.vatPct,
      stockQty: d.stockQty ?? 0,
      trackStock: d.trackStock ?? true,
      featuredImageUrl: d.featuredImageUrl ?? "",
      published: d.published,
      featured: d.featured,
      tagSlugs: d.tagSlugs,
      variants: d.variants,
      metaTitle: d.metaTitle ?? "",
      metaDescription: d.metaDescription ?? "",
    })
  } catch {
    loadError.value = true
  }
}
await load()

// Mirrors the server: the flag is derived from the legal category, never typed in.
const requiresVerification = computed(() => form.legalCategory !== "none")

function addVariant() {
  if (form.variants.length >= 50) return
  form.variants.push({
    skuVariant: `${form.sku || "SKU"}-${form.variants.length + 1}`,
    finition: "",
    munition: null,
    couleur: null,
    priceDeltaHt: 0,
    stockQty: 0,
  })
}
function removeVariant(index: number) {
  form.variants.splice(index, 1)
}

function toggleTag(slug: string) {
  const i = form.tagSlugs.indexOf(slug)
  if (i === -1) form.tagSlugs.push(slug)
  else form.tagSlugs.splice(i, 1)
}

function payload() {
  const body: Record<string, unknown> = {
    name: form.name,
    categorySlug: form.categorySlug,
    legalCategory: form.legalCategory,
    priceHt: Number(form.priceHt),
    vatPct: Number(form.vatPct),
    stockQty: Number(form.stockQty),
    trackStock: form.trackStock,
    published: form.published,
    featured: form.featured,
    tagSlugs: form.tagSlugs,
    variants: form.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      skuVariant: v.skuVariant,
      ...(v.finition ? { finition: v.finition } : {}),
      ...(v.munition ? { munition: v.munition } : {}),
      ...(v.couleur ? { couleur: v.couleur } : {}),
      priceDeltaHt: Number(v.priceDeltaHt) || 0,
      stockQty: Number(v.stockQty) || 0,
    })),
  }
  // `featuredImageUrl` is written by the server from the gallery's position 0.
  for (const key of ["description", "longDescription", "metaTitle", "metaDescription"] as const) {
    if (form[key].trim()) body[key] = form[key]
  }
  if (isNew.value) {
    body.sku = form.sku
    body.slug = form.slug
  }
  return body
}

function messageFrom(err: unknown): string {
  const body = (err as { data?: { message?: string; issues?: Array<{ path: string; message: string }> } }).data
  if (body?.issues?.length) return body.issues.map((i) => `${i.path} : ${i.message}`).join(" · ")
  return body?.message ?? "L'enregistrement a échoué."
}

async function save() {
  saving.value = true
  saveError.value = null
  try {
    if (isNew.value) {
      const res = await api<{ data: AdminProductDetail }>("/admin/products", { method: "POST", body: payload() })
      await navigateTo(`/admin/produits/${res.data.id}`)
    } else {
      const res = await api<{ data: AdminProductDetail }>(`/admin/products/${id.value}`, {
        method: "PATCH",
        body: payload(),
      })
      form.variants = res.data.variants
      form.tagSlugs = res.data.tagSlugs
    }
  } catch (err) {
    saveError.value = messageFrom(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <p class="eyebrow"><NuxtLink to="/admin/produits" class="back">Produits</NuxtLink></p>
        <h1>{{ isNew ? "Nouveau produit" : form.name || "Produit" }}</h1>
      </div>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
        {{ saving ? "Enregistrement…" : "Enregistrer" }}
      </button>
    </header>

    <p v-if="loadError" class="alert" role="alert">Impossible de charger ce produit.</p>
    <p v-if="saveError" class="alert" role="alert">{{ saveError }}</p>

    <section class="panel">
      <h2 class="panel__title">Identité</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">SKU *</span>
          <input v-model="form.sku" class="ctl" :disabled="!isNew" >
        </label>
        <label class="field">
          <span class="field__label">Slug (URL) *</span>
          <input v-model="form.slug" class="ctl" :disabled="!isNew" >
          <span v-if="!isNew" class="field__help">Définitif : il est indexé.</span>
        </label>
        <label class="field field--wide">
          <span class="field__label">Nom *</span>
          <input v-model="form.name" class="ctl" >
        </label>
        <label class="field field--wide">
          <span class="field__label">Description courte</span>
          <textarea v-model="form.description" class="ctl ctl--area" rows="2" />
        </label>
        <label class="field field--wide">
          <span class="field__label">Description longue</span>
          <textarea v-model="form.longDescription" class="ctl ctl--area" rows="5" />
        </label>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel__title">Classement & réglementation</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">Catégorie *</span>
          <select v-model="form.categorySlug" class="ctl">
            <option value="">— choisir —</option>
            <option v-for="c in categories" :key="c.slug" :value="c.slug">{{ c.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Catégorie légale *</span>
          <select v-model="form.legalCategory" class="ctl">
            <option v-for="c in legalCategoryOptions" :key="c" :value="c">{{ c === "none" ? "Aucune (libre)" : c }}</option>
          </select>
          <span class="field__help">
            {{ requiresVerification
              ? "Vérification des documents exigée à la commande — déduite de la catégorie, pas modifiable à la main."
              : "Aucune vérification de documents exigée." }}
          </span>
        </label>
      </div>

      <h3 class="sub">Tags</h3>
      <p v-if="allTags.length === 0" class="note">
        Aucun tag n'existe encore. <NuxtLink to="/admin/tags">Créez-en un</NuxtLink>.
      </p>
      <div v-else class="tags">
        <button
          v-for="t in allTags"
          :key="t.slug"
          type="button"
          class="tag"
          :class="{ 'tag--on': form.tagSlugs.includes(t.slug) }"
          :aria-pressed="form.tagSlugs.includes(t.slug)"
          @click="toggleTag(t.slug)"
        >
          {{ t.name }}
        </button>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel__title">Prix & stock</h2>
      <div class="fields">
        <label class="field">
          <span class="field__label">Prix HT (€) *</span>
          <input v-model.number="form.priceHt" type="number" min="0" step="0.01" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">TVA (%)</span>
          <input v-model.number="form.vatPct" type="number" min="0" max="100" step="0.1" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Stock</span>
          <input v-model.number="form.stockQty" type="number" min="0" class="ctl" >
        </label>
        <label class="field field--check">
          <input v-model="form.trackStock" type="checkbox" class="check" >
          <span>Suivre le stock</span>
        </label>
      </div>

      <h3 class="sub">Variantes</h3>
      <p class="note">
        Le panier s'appuie sur la variante : un produit sans variante ne peut pas être acheté. Une variante déjà
        présente sur une commande ne peut pas être retirée — mettez son stock à zéro.
      </p>
      <div v-for="(v, i) in form.variants" :key="v.id ?? i" class="variant">
        <label class="field">
          <span class="field__label">SKU variante</span>
          <input v-model="v.skuVariant" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Finition</span>
          <input v-model="v.finition as string" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Munition</span>
          <input v-model="v.munition as string" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Couleur</span>
          <input v-model="v.couleur as string" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Delta prix HT</span>
          <input v-model.number="v.priceDeltaHt" type="number" step="0.01" class="ctl" >
        </label>
        <label class="field">
          <span class="field__label">Stock</span>
          <input v-model.number="v.stockQty" type="number" min="0" class="ctl" >
        </label>
        <button class="remove" type="button" :aria-label="`Supprimer la variante ${v.skuVariant}`" @click="removeVariant(i)">
          ✕
        </button>
      </div>
      <button class="add" type="button" @click="addVariant">+ Ajouter une variante</button>
    </section>

    <section class="panel">
      <AdminMediaGallery owner-type="product" :owner-id="isNew ? null : id" />
    </section>

    <section class="panel">
      <h2 class="panel__title">Publication</h2>
      <div class="fields">
        <label class="field field--check">
          <input v-model="form.published" type="checkbox" class="check" >
          <span>Publié sur le site</span>
        </label>
        <label class="field field--check">
          <input v-model="form.featured" type="checkbox" class="check" >
          <span>Mis en avant</span>
        </label>
        <label class="field">
          <span class="field__label">Titre SEO</span>
          <input v-model="form.metaTitle" class="ctl" >
        </label>
        <label class="field field--wide">
          <span class="field__label">Description SEO</span>
          <textarea v-model="form.metaDescription" class="ctl ctl--area" rows="2" />
        </label>
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
.back {
  color: var(--paper-faint);
  text-decoration: none;
}
.back:hover {
  color: var(--brass);
}
h1 {
  margin: 0.3rem 0 0;
  font-size: clamp(1.8rem, 5vw, 2.4rem);
}
.panel {
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  padding: 1.3rem 1.4rem;
  margin-bottom: 1.4rem;
}
.panel__title,
.sub {
  margin: 0 0 1.1rem;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
.sub {
  margin-top: 1.8rem;
}
.fields {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: 1fr;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.field--check {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
  color: var(--paper-dim);
  font-size: 0.9rem;
}
.field__label {
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: 600;
}
.field__help {
  font-size: 0.76rem;
  color: var(--paper-faint);
  line-height: 1.5;
}
.ctl {
  padding: 0.6rem 0.8rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.92rem;
  width: 100%;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.ctl:disabled {
  opacity: 0.55;
}
.ctl--area {
  line-height: 1.6;
  resize: vertical;
}
.check {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--brass);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.tag {
  padding: 0.4rem 0.85rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: 999px;
  color: var(--paper-dim);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.tag--on {
  border-color: var(--brass);
  color: var(--brass);
}
.variant {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: 1fr;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--ink-line);
  align-items: end;
}
.remove,
.add {
  padding: 0.55rem 0.9rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.note {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: var(--paper-faint);
  line-height: 1.6;
}
.note a {
  color: var(--brass);
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

@media (min-width: 720px) {
  .fields {
    grid-template-columns: 1fr 1fr;
  }
  .field--wide {
    grid-column: 1 / -1;
  }
  .variant {
    grid-template-columns: repeat(6, minmax(80px, 1fr)) auto;
  }
}
</style>
