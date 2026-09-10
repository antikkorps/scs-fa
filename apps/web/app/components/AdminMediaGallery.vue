<script setup lang="ts">
/**
 * Gallery manager for one owner (story 7.5b).
 *
 * Drops into any admin form: products, artworks, series covers, artist
 * portraits. The owner's own "main visual" column is written by the server from
 * position 0, so the order set here IS the choice of main image — which is why
 * the first slot is labelled rather than left to be guessed.
 */
export interface AdminMedia {
  id: string
  ownerType: string
  ownerId: string
  position: number
  alt: string
  widths: number[]
  width: number
  height: number
  sizeBytes: number
  watermarked: boolean
  url: string
  srcset: string
}

const props = defineProps<{
  ownerType: "product" | "artwork" | "artwork_series" | "artist"
  /** Absent while the owner is still being created — the gallery waits. */
  ownerId?: string | null
}>()

const api = useApi()
const items = ref<AdminMedia[]>([])
const pending = ref(false)
const error = ref<string | null>(null)
const uploading = ref(false)
const dragging = ref(false)

const ready = computed(() => Boolean(props.ownerId))

function messageFrom(err: unknown): string {
  const body = (err as { data?: { message?: string; issues?: Array<{ path: string; message: string }> } }).data
  if (body?.issues?.length) return body.issues.map((i) => `${i.path} : ${i.message}`).join(" · ")
  return body?.message ?? "L'opération a échoué."
}

async function load() {
  if (!ready.value) return
  pending.value = true
  error.value = null
  try {
    items.value = (
      await api<{ data: AdminMedia[] }>(`/admin/media?ownerType=${props.ownerType}&ownerId=${props.ownerId}`)
    ).data
  } catch (err) {
    error.value = messageFrom(err)
  } finally {
    pending.value = false
  }
}

watch(() => props.ownerId, load, { immediate: true })

async function uploadFiles(files: FileList | File[]) {
  if (!ready.value) return
  uploading.value = true
  error.value = null
  try {
    for (const file of Array.from(files)) {
      const body = new FormData()
      body.append("file", file)
      body.append("ownerType", props.ownerType)
      body.append("ownerId", String(props.ownerId))
      // A sane default the admin can correct — never an empty alt, which is
      // what the API refuses and what makes a gallery unusable.
      body.append("alt", file.name.replace(/\.[^.]+$/, ""))
      await api("/admin/media", { method: "POST", body })
    }
    await load()
  } catch (err) {
    error.value = messageFrom(err)
  } finally {
    uploading.value = false
  }
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) uploadFiles(input.files)
  input.value = ""
}

function onDrop(event: DragEvent) {
  dragging.value = false
  if (event.dataTransfer?.files.length) uploadFiles(event.dataTransfer.files)
}

async function saveAlt(item: AdminMedia, alt: string) {
  if (alt.trim() === "" || alt === item.alt) return
  error.value = null
  try {
    await api(`/admin/media/${item.id}`, { method: "PATCH", body: { alt } })
    item.alt = alt
  } catch (err) {
    error.value = messageFrom(err)
  }
}

/** Reordering goes in ONE call: a half-sorted gallery would flicker the main visual. */
async function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= items.value.length) return
  const next = [...items.value]
  const [moved] = next.splice(index, 1)
  if (!moved) return
  next.splice(target, 0, moved)
  items.value = next

  error.value = null
  try {
    const res = await api<{ data: AdminMedia[] }>("/admin/media/reorder", {
      method: "PATCH",
      body: { ownerType: props.ownerType, ownerId: props.ownerId, ids: next.map((m) => m.id) },
    })
    items.value = res.data
  } catch (err) {
    // Re-read BEFORE reporting: `load()` clears the error, so setting it first
    // would wipe the very message that explains the refused reorder.
    await load()
    error.value = messageFrom(err)
  }
}

async function remove(item: AdminMedia) {
  if (!confirm(`Supprimer cette image ? Les fichiers seront effacés.`)) return
  error.value = null
  try {
    await api(`/admin/media/${item.id}`, { method: "DELETE" })
    await load()
  } catch (err) {
    error.value = messageFrom(err)
  }
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)} ko`
</script>

<template>
  <section class="gallery">
    <h2 class="gallery__title">Visuels</h2>

    <p v-if="!ready" class="note">Enregistrez d'abord la fiche : les visuels s'attachent ensuite.</p>

    <template v-else>
      <p class="note">
        La <strong>première image est l'image principale</strong> : c'est elle qui apparaît sur les cartes, dans les
        partages et dans le plan du site. Le texte alternatif est obligatoire.
        <template v-if="ownerType === 'artwork'">
          Les visuels d'œuvres sont <strong>filigranés et plafonnés</strong> automatiquement ; l'original qualité tirage
          est conservé en privé.
        </template>
      </p>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <div
        class="drop"
        :class="{ 'drop--over': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <label class="drop__label">
          <input type="file" accept="image/jpeg,image/png,image/webp,image/tiff" multiple class="sr-only" @change="onPick" >
          <span>{{ uploading ? "Envoi en cours…" : "Glissez des images ici, ou cliquez pour les choisir" }}</span>
        </label>
      </div>

      <p v-if="pending" class="note">Chargement…</p>
      <p v-else-if="items.length === 0" class="note">Aucun visuel pour l'instant.</p>

      <ul v-else class="list" role="list">
        <li v-for="(m, i) in items" :key="m.id" class="item">
          <img :src="m.url" :alt="m.alt" class="item__img" width="160" height="120" loading="lazy" >

          <div class="item__body">
            <p class="item__badges">
              <span v-if="i === 0" class="badge badge--main">Image principale</span>
              <span v-if="m.watermarked" class="badge">Filigranée</span>
              <span class="badge badge--dim">{{ m.width }} px · {{ kb(m.sizeBytes) }} · {{ m.widths.length }} tailles</span>
            </p>
            <label class="item__alt">
              <span class="sr-only">Texte alternatif</span>
              <input
                class="ctl"
                :value="m.alt"
                placeholder="Texte alternatif (obligatoire)"
                @change="saveAlt(m, ($event.target as HTMLInputElement).value)"
              >
            </label>
          </div>

          <div class="item__actions">
            <button class="icon" type="button" :disabled="i === 0" aria-label="Monter" @click="move(i, -1)">↑</button>
            <button
              class="icon"
              type="button"
              :disabled="i === items.length - 1"
              aria-label="Descendre"
              @click="move(i, 1)"
            >
              ↓
            </button>
            <button class="icon icon--danger" type="button" aria-label="Supprimer" @click="remove(m)">✕</button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.gallery {
  /* Sits at the top of its own panel in the big forms, and under the fields in
     the generic entity manager — hence the margin only when it follows content. */
  margin-top: 0;
}
.gallery:not(:first-child) {
  margin-top: 1.8rem;
}
.gallery__title {
  margin: 0 0 1.1rem;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--paper-faint);
}
.note {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: var(--paper-faint);
  line-height: 1.6;
}
.note strong {
  color: var(--paper-dim);
}
.alert {
  background: rgba(217, 138, 106, 0.12);
  border: 1px solid rgba(217, 138, 106, 0.35);
  color: var(--danger);
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  margin: 0 0 1rem;
  font-size: 0.88rem;
}
.drop {
  border: 1px dashed var(--ink-line);
  border-radius: var(--radius);
  padding: 1.4rem;
  text-align: center;
  margin-bottom: 1.2rem;
  transition: border-color 0.2s;
}
.drop--over {
  border-color: var(--brass);
}
.drop__label {
  cursor: pointer;
  color: var(--paper-dim);
  font-size: 0.88rem;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.8rem;
}
.item {
  display: grid;
  grid-template-columns: 100px 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 0.8rem;
  background: var(--ink);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
}
.item__img {
  width: 100px;
  height: 75px;
  object-fit: cover;
  border-radius: 2px;
  background: var(--ink-soft);
}
.item__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0 0 0.5rem;
}
.badge {
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--ink-line);
  color: var(--paper-dim);
}
.badge--main {
  border-color: var(--brass);
  color: var(--brass);
}
.badge--dim {
  color: var(--paper-faint);
  text-transform: none;
  letter-spacing: normal;
}
.ctl {
  padding: 0.45rem 0.7rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper);
  font-family: inherit;
  font-size: 0.88rem;
  width: 100%;
}
.ctl:focus {
  outline: none;
  border-color: var(--brass);
}
.item__actions {
  display: flex;
  gap: 0.3rem;
}
.icon {
  width: 2rem;
  height: 2rem;
  background: transparent;
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  color: var(--paper-dim);
  cursor: pointer;
  font-size: 0.9rem;
}
.icon:hover:not(:disabled) {
  border-color: var(--brass);
  color: var(--brass);
}
.icon--danger:hover:not(:disabled) {
  border-color: var(--danger);
  color: var(--danger);
}
.icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
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
