import type { Ref } from "vue"

interface BulkArchiveInput {
  /** The rows the list shows: only they can be selected. */
  rows: Ref<readonly { id: string; archivedAt?: unknown }[]>
  endpoint: Ref<string>
  noun: Ref<string>
  onArchived: () => void
}

const plural = (count: number, noun: string) => `${count} ${noun}${count > 1 ? "s" : ""}`

function confirmation(count: number, noun: string): string {
  const consequence =
    count > 1 ? "Ils seront retirés de la vente, sans être effacés." : "Il sera retiré de la vente, sans être effacé."
  return `Archiver ${plural(count, noun)} ? ${consequence}`
}

/**
 * Story 12.16b — tick rows, archive them in one call. Only rows on screen and
 * still on sale can be ticked: a selection hidden by a filter would archive
 * products the admin no longer sees.
 */
export function useBulkArchive({ rows, endpoint, noun, onArchived }: BulkArchiveInput) {
  const api = useApi()
  const selected = ref<ReadonlySet<string>>(new Set())
  const message = ref("")
  const error = ref("")
  const busy = ref(false)

  const selectableIds = computed(() => rows.value.filter((row) => !row.archivedAt).map((row) => row.id))
  const allSelected = computed(
    () => selectableIds.value.length > 0 && selectableIds.value.every((id) => selected.value.has(id)),
  )
  const someSelected = computed(() => selected.value.size > 0 && !allSelected.value)

  watch(selectableIds, (ids) => {
    selected.value = new Set(ids.filter((id) => selected.value.has(id)))
  })

  function toggle(id: string, on: boolean) {
    const next = new Set(selected.value)
    if (on) next.add(id)
    else next.delete(id)
    selected.value = next
  }

  function toggleAll(on: boolean) {
    selected.value = new Set(on ? selectableIds.value : [])
  }

  async function archiveSelected() {
    if (busy.value) return
    const ids = selectableIds.value.filter((id) => selected.value.has(id))
    if (!confirm(confirmation(ids.length, noun.value))) return
    error.value = ""
    message.value = ""
    busy.value = true
    try {
      const result = await api<{ data: { archived: number } }>(`${endpoint.value}/archive`, {
        method: "POST",
        body: { ids },
      })
      message.value = `${plural(result.data.archived, noun.value)} archivé${result.data.archived > 1 ? "s" : ""}.`
      selected.value = new Set()
      onArchived()
    } catch {
      error.value = "L'archivage a échoué : rien n'a été archivé."
    } finally {
      busy.value = false
    }
  }

  return {
    selected,
    selectableIds,
    allSelected,
    someSelected,
    message,
    error,
    busy,
    toggle,
    toggleAll,
    archiveSelected,
  }
}
