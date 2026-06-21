<script setup lang="ts">
import { blogErrorMessage, emptyBlogForm, toBlogPayload } from "~/utils/blogForm"

definePageMeta({ layout: "admin", middleware: "admin" })
useHead({ title: "Nouvel article — Administration SCS" })

const api = useApi()
const form = ref(emptyBlogForm())
const submitting = ref(false)
const errorMsg = ref("")

async function submit() {
  submitting.value = true
  errorMsg.value = ""
  try {
    const res = await api<{ data: { id: string } }>("/admin/blog", { method: "POST", body: toBlogPayload(form.value) })
    await navigateTo(`/admin/blog/${res.data.id}`)
  } catch (err) {
    errorMsg.value = blogErrorMessage(err, "Création impossible.")
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <header class="head">
      <p class="eyebrow">Éditorial</p>
      <h1>Nouvel article</h1>
    </header>
    <AdminBlogForm v-model="form" mode="create" :submitting="submitting" :error-msg="errorMsg" @submit="submit" />
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
</style>
