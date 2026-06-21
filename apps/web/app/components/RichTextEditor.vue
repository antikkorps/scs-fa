<script setup lang="ts">
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import StarterKit from "@tiptap/starter-kit"
import { EditorContent, useEditor } from "@tiptap/vue-3"
import { blogErrorMessage } from "~/utils/blogForm"

// HTML content, two-way bound. The body is sanitised server-side on save.
const model = defineModel<string>({ required: true })

const api = useApi()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref("")

// `useEditor` is SSR-safe: the editor is instantiated on the client only.
const editor = useEditor({
  content: model.value,
  extensions: [
    // Keep the markup aligned with the server-side sanitiser allowlist:
    // h2/h3 only, no code blocks / horizontal rules.
    StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, horizontalRule: false }),
    Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow" } }),
    Image,
  ],
  editorProps: { attributes: { class: "rte__content" } },
  onUpdate: ({ editor }) => {
    model.value = editor.getHTML()
  },
})

// Reflect external changes (e.g. loading an existing article) into the editor.
watch(model, (value) => {
  if (editor.value && value !== editor.value.getHTML()) {
    editor.value.commands.setContent(value || "", { emitUpdate: false })
  }
})

onBeforeUnmount(() => editor.value?.destroy())

function promptLink() {
  const current = (editor.value?.getAttributes("link").href as string) ?? ""
  const url = window.prompt("URL du lien", current)
  if (url === null) return
  if (url === "") {
    editor.value?.chain().focus().extendMarkRange("link").unsetLink().run()
    return
  }
  editor.value?.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
}

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  uploadError.value = ""
  try {
    const form = new FormData()
    form.append("file", file)
    const res = await api<{ data: { url: string } }>("/admin/blog/images", { method: "POST", body: form })
    editor.value?.chain().focus().setImage({ src: res.data.url }).run()
  } catch (err) {
    uploadError.value = blogErrorMessage(err, "Upload de l'image impossible.")
  } finally {
    uploading.value = false
    input.value = ""
  }
}
</script>

<template>
  <div class="rte">
    <div class="rte__bar" role="toolbar" aria-label="Mise en forme">
      <button type="button" :class="{ on: editor?.isActive('bold') }" title="Gras" @click="editor?.chain().focus().toggleBold().run()">
        <strong>B</strong>
      </button>
      <button type="button" :class="{ on: editor?.isActive('italic') }" title="Italique" @click="editor?.chain().focus().toggleItalic().run()">
        <em>I</em>
      </button>
      <button type="button" :class="{ on: editor?.isActive('underline') }" title="Souligné" @click="editor?.chain().focus().toggleUnderline().run()">
        <u>U</u>
      </button>
      <button type="button" :class="{ on: editor?.isActive('strike') }" title="Barré" @click="editor?.chain().focus().toggleStrike().run()">
        <s>S</s>
      </button>
      <span class="rte__sep" aria-hidden="true" />
      <button type="button" :class="{ on: editor?.isActive('heading', { level: 2 }) }" title="Titre 2" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()">
        H2
      </button>
      <button type="button" :class="{ on: editor?.isActive('heading', { level: 3 }) }" title="Titre 3" @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()">
        H3
      </button>
      <span class="rte__sep" aria-hidden="true" />
      <button type="button" :class="{ on: editor?.isActive('bulletList') }" title="Liste à puces" @click="editor?.chain().focus().toggleBulletList().run()">
        •
      </button>
      <button type="button" :class="{ on: editor?.isActive('orderedList') }" title="Liste numérotée" @click="editor?.chain().focus().toggleOrderedList().run()">
        1.
      </button>
      <button type="button" :class="{ on: editor?.isActive('blockquote') }" title="Citation" @click="editor?.chain().focus().toggleBlockquote().run()">
        ❝
      </button>
      <span class="rte__sep" aria-hidden="true" />
      <button type="button" :class="{ on: editor?.isActive('link') }" title="Lien" @click="promptLink">🔗</button>
      <button type="button" title="Image" :disabled="uploading" @click="fileInput?.click()">
        {{ uploading ? "…" : "🖼" }}
      </button>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onImageSelected" />
    </div>

    <p v-if="uploadError" class="rte__error">{{ uploadError }}</p>
    <EditorContent :editor="editor" class="rte__editor" />
  </div>
</template>

<style scoped>
.rte {
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  background: var(--ink-soft);
}
.rte__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--ink-line);
}
.rte__bar button {
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.5rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--paper-dim);
  cursor: pointer;
  font-size: 0.9rem;
  transition:
    background 0.15s,
    color 0.15s;
}
.rte__bar button:hover {
  color: var(--paper);
  background: rgba(255, 255, 255, 0.04);
}
.rte__bar button.on {
  color: var(--brass);
  border-color: rgba(200, 163, 91, 0.4);
}
.rte__bar button:disabled {
  opacity: 0.5;
  cursor: default;
}
.rte__sep {
  width: 1px;
  align-self: stretch;
  margin: 0.2rem 0.3rem;
  background: var(--ink-line);
}
.rte__error {
  color: var(--danger);
  font-size: 0.82rem;
  padding: 0.5rem 0.75rem 0;
  margin: 0;
}
.rte__editor {
  padding: 0.25rem 0.9rem;
}
.rte :deep(.rte__content) {
  min-height: 280px;
  outline: none;
  color: var(--paper);
  line-height: 1.7;
}
.rte :deep(.rte__content:focus) {
  outline: none;
}
.rte :deep(.rte__content h2) {
  font-family: var(--font-display);
  font-size: 1.5rem;
  margin: 1.2rem 0 0.6rem;
}
.rte :deep(.rte__content h3) {
  font-family: var(--font-display);
  font-size: 1.2rem;
  margin: 1rem 0 0.5rem;
}
.rte :deep(.rte__content p) {
  margin: 0 0 0.8rem;
}
.rte :deep(.rte__content img) {
  max-width: 100%;
  border-radius: var(--radius);
  margin: 0.5rem 0;
}
.rte :deep(.rte__content blockquote) {
  border-left: 2px solid var(--brass);
  padding-left: 1rem;
  margin: 1rem 0;
  color: var(--paper-dim);
  font-style: italic;
}
.rte :deep(.rte__content a) {
  color: var(--brass);
  text-decoration: underline;
}
.rte :deep(.rte__content ul),
.rte :deep(.rte__content ol) {
  padding-left: 1.4rem;
  margin: 0 0 0.8rem;
}
</style>
