<script setup lang="ts">
import type { AdminBlogArticle, BlogFormValues } from "~/types/admin"
import { blogErrorMessage, blogFormFrom, toBlogPayload } from "~/utils/blogForm"

definePageMeta({ layout: "admin", middleware: "admin" })

const api = useApi()
const route = useRoute()
const id = route.params.id as string

const { data, error: loadError } = await useAsyncData(`admin-blog-${id}`, () =>
  api<{ data: AdminBlogArticle }>(`/admin/blog/${id}`),
)

const article = computed(() => data.value?.data ?? null)
const form = ref<BlogFormValues | null>(article.value ? blogFormFrom(article.value) : null)
watch(article, (a) => {
  if (a && !form.value) form.value = blogFormFrom(a)
})

useHead({ title: () => `${article.value?.title ?? "Article"} — Administration SCS` })

const submitting = ref(false)
const errorMsg = ref("")

async function submit() {
  if (!form.value) return
  submitting.value = true
  errorMsg.value = ""
  try {
    await api(`/admin/blog/${id}`, { method: "PATCH", body: toBlogPayload(form.value) })
    await navigateTo("/admin/blog")
  } catch (err) {
    errorMsg.value = blogErrorMessage(err, "Enregistrement impossible.")
  } finally {
    submitting.value = false
  }
}

async function remove() {
  if (!confirm("Supprimer définitivement cet article ?")) return
  submitting.value = true
  errorMsg.value = ""
  try {
    await api(`/admin/blog/${id}`, { method: "DELETE" })
    await navigateTo("/admin/blog")
  } catch (err) {
    errorMsg.value = blogErrorMessage(err, "Suppression impossible.")
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Éditorial</p>
      <h1>Modifier l'article</h1>
      <NuxtLink v-if="article" :to="`/blog/${article.slug}`" target="_blank" class="preview">Voir en ligne ↗</NuxtLink>
    </header>

    <p v-if="loadError" class="state state--error">Article introuvable.</p>
    <AdminBlogForm
      v-else-if="form"
      v-model="form"
      mode="edit"
      :submitting="submitting"
      :error-msg="errorMsg"
      @submit="submit"
      @remove="remove"
    />
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1.6rem;
}
.head h1 {
  font-size: clamp(1.9rem, 5vw, 2.6rem);
  margin-top: 0.3rem;
}
.preview {
  display: inline-block;
  margin-top: 0.6rem;
  font-size: 0.82rem;
  color: var(--brass);
}
.state {
  color: var(--paper-dim);
  padding: 2rem 0;
}
.state--error {
  color: var(--danger);
}
</style>
