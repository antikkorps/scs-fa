<script setup lang="ts">
import type { BlogFormValues } from "~/types/admin"

const model = defineModel<BlogFormValues>({ required: true })

defineProps<{
  mode: "create" | "edit"
  submitting?: boolean
  errorMsg?: string
}>()

const emit = defineEmits<{
  submit: []
  remove: []
}>()

// Auto-suggest a slug from the title while creating (kebab-case, accents stripped).
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function onTitleInput() {
  if (!model.value.slug.trim()) model.value.slug = slugify(model.value.title)
}
</script>

<template>
  <form class="form" @submit.prevent="emit('submit')">
    <p v-if="errorMsg" class="alert">{{ errorMsg }}</p>

    <div class="grid">
      <label class="field field--wide">
        <span class="field__label">Titre *</span>
        <input
          v-model="model.title"
          class="ctl"
          type="text"
          maxlength="255"
          required
          @input="onTitleInput"
        />
      </label>

      <label class="field">
        <span class="field__label">Slug *</span>
        <input
          v-model="model.slug"
          class="ctl"
          type="text"
          maxlength="255"
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        />
      </label>

      <label class="field">
        <span class="field__label">Catégorie</span>
        <input v-model="model.category" class="ctl" type="text" maxlength="100" />
      </label>

      <label class="field field--wide">
        <span class="field__label">Extrait</span>
        <textarea v-model="model.excerpt" class="ctl" rows="2" maxlength="500" />
      </label>

      <label class="field field--wide">
        <span class="field__label">Contenu (HTML) *</span>
        <textarea v-model="model.content" class="ctl ctl--mono" rows="14" required />
      </label>

      <label class="field">
        <span class="field__label">Image (URL)</span>
        <input v-model="model.featuredImageUrl" class="ctl" type="url" maxlength="512" />
      </label>

      <label class="field">
        <span class="field__label">Tags (séparés par des virgules)</span>
        <input v-model="model.tags" class="ctl" type="text" maxlength="500" />
      </label>

      <label class="field">
        <span class="field__label">Meta title</span>
        <input v-model="model.metaTitle" class="ctl" type="text" maxlength="255" />
      </label>

      <label class="field">
        <span class="field__label">Meta description</span>
        <input v-model="model.metaDescription" class="ctl" type="text" maxlength="500" />
      </label>

      <div class="field field--wide toggles">
        <label class="check">
          <input v-model="model.published" type="checkbox" />
          <span>Publié</span>
        </label>
        <label class="check">
          <input v-model="model.featured" type="checkbox" />
          <span>Mis en avant</span>
        </label>
      </div>
    </div>

    <div class="actions">
      <button type="submit" class="btn btn-primary" :disabled="submitting">
        {{
          submitting
            ? "Enregistrement…"
            : mode === "create"
              ? "Créer l'article"
              : "Enregistrer"
        }}
      </button>
      <NuxtLink to="/admin/blog" class="btn btn-ghost">Annuler</NuxtLink>
      <button
        v-if="mode === 'edit'"
        type="button"
        class="btn btn-ghost danger"
        :disabled="submitting"
        @click="emit('remove')"
      >
        Supprimer
      </button>
    </div>
  </form>
</template>

<style scoped>
.alert {
  background: rgba(217, 138, 106, 0.12);
  border: 1px solid rgba(217, 138, 106, 0.35);
  color: var(--danger);
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  margin-bottom: 1.2rem;
  font-size: 0.88rem;
}
.grid {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: 1fr;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.field__label {
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--paper-faint);
  font-weight: 600;
}
.ctl {
  padding: 0.6rem 0.8rem;
  background: var(--ink-soft);
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
.ctl--mono {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.85rem;
  line-height: 1.6;
}
.toggles {
  flex-direction: row;
  gap: 1.5rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--paper-dim);
  font-size: 0.9rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin-top: 1.6rem;
}
.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

@media (min-width: 720px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
  .field--wide {
    grid-column: 1 / -1;
  }
}
</style>
