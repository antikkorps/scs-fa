<script setup lang="ts">
import { ALLOWED_LEGAL_DOC_MIME_TYPES, type LegalDocType, MAX_LEGAL_DOC_SIZE_BYTES } from "@armurier/shared"
import type { LegalDocument } from "~/types/account"
import { formatFileSize } from "~/utils/legal"

const props = defineProps<{ docType: LegalDocType }>()
const emit = defineEmits<{ uploaded: [doc: LegalDocument] }>()

const { upload } = useDocuments()

const file = ref<File | null>(null)
const docNumber = ref("")
const expiresAt = ref("") // YYYY-MM-DD, optional
const submitting = ref(false)
const error = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const ACCEPT = ALLOWED_LEGAL_DOC_MIME_TYPES.join(",")

function onFileChange(e: Event) {
  error.value = null
  const picked = (e.target as HTMLInputElement).files?.[0] ?? null
  if (picked && !validate(picked)) {
    file.value = null
    return
  }
  file.value = picked
}

function validate(f: File): boolean {
  if (!(ALLOWED_LEGAL_DOC_MIME_TYPES as readonly string[]).includes(f.type)) {
    error.value = "Format non accepté. Formats autorisés : PDF, JPEG, PNG."
    return false
  }
  if (f.size > MAX_LEGAL_DOC_SIZE_BYTES) {
    error.value = `Fichier trop volumineux (max ${formatFileSize(MAX_LEGAL_DOC_SIZE_BYTES)}).`
    return false
  }
  return true
}

// Maps the API's error envelope to French copy for the customer.
function messageFor(err: unknown): string {
  const status = authErrorStatus(err)
  const code = (err as { data?: { error?: string } })?.data?.error
  if (status === 413) return `Fichier trop volumineux (max ${formatFileSize(MAX_LEGAL_DOC_SIZE_BYTES)}).`
  if (code === "UnsupportedMediaType") return "Format de fichier non accepté ou contenu non conforme."
  if (status === 400) return "Document invalide. Vérifiez le fichier et les informations saisies."
  return "L'envoi a échoué. Veuillez réessayer."
}

async function submit() {
  if (!file.value || submitting.value) return
  submitting.value = true
  error.value = null
  try {
    const doc = await upload(file.value, {
      docType: props.docType,
      ...(docNumber.value.trim() ? { docNumber: docNumber.value.trim() } : {}),
      ...(expiresAt.value ? { expiresAt: expiresAt.value } : {}),
    })
    file.value = null
    docNumber.value = ""
    expiresAt.value = ""
    if (fileInput.value) fileInput.value.value = ""
    emit("uploaded", doc)
  } catch (err) {
    error.value = messageFor(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="up" @submit.prevent="submit">
    <p class="up__lede">Envoyez votre {{ docTypeLabel(docType).toLowerCase() }} (PDF, JPEG ou PNG, 10 Mo max).</p>

    <label class="up__file">
      <input ref="fileInput" type="file" :accept="ACCEPT" @change="onFileChange" />
      <span class="up__file-name">{{ file ? file.name : "Choisir un fichier…" }}</span>
    </label>

    <div class="up__meta">
      <label class="up__field">
        <span>Numéro du document <em>(facultatif)</em></span>
        <input v-model="docNumber" class="input" type="text" maxlength="100" autocomplete="off" />
      </label>
      <label class="up__field">
        <span>Date d'expiration <em>(facultatif)</em></span>
        <input v-model="expiresAt" class="input" type="date" />
      </label>
    </div>

    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <button type="submit" class="btn btn-primary" :disabled="!file || submitting">
      {{ submitting ? "Envoi…" : "Envoyer le document" }}
    </button>
  </form>
</template>

<style scoped>
.up {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 0.75rem;
}
.up__lede {
  margin: 0;
  font-size: 0.85rem;
  color: var(--paper-dim);
}
.up__file {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
}
.up__file input[type="file"] {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}
.up__file-name {
  flex: 1;
  padding: 0.7rem 0.9rem;
  font-size: 0.9rem;
  color: var(--paper);
  border: 1px dashed var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.up__file:hover .up__file-name {
  border-color: var(--brass);
}
.up__meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
.up__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--paper-faint);
}
.up__field em {
  font-style: normal;
  opacity: 0.7;
}
.input {
  width: 100%;
  height: 46px;
  padding: 0 0.85rem;
  color: var(--paper);
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: 0.95rem;
}
.input:focus {
  outline: none;
  border-color: var(--brass);
}
.err {
  color: var(--danger);
  font-size: 0.85rem;
  margin: 0;
}
.btn-primary {
  align-self: flex-start;
}
@media (max-width: 560px) {
  .up__meta {
    grid-template-columns: 1fr;
  }
}
</style>
