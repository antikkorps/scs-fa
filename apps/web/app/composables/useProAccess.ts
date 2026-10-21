import type { MemberOrganisation } from "~/types/organisation"

interface ProAccessState {
  userId: string
  organisation: MemberOrganisation | null
}

// Story 12.8c — whether the signed-in account may use the pro circuit: the
// member of an approved organisation. Asked once per account; the API checks
// it again on every pro call, so this only shapes the screens.
export function useProAccess() {
  const { user } = useAuth()
  const { mine } = useOrganisation()
  const state = useState<ProAccessState | undefined>("pro-access", () => undefined)

  const organisation = computed(() => state.value?.organisation ?? null)
  const isApprovedPro = computed(() => organisation.value?.status === "approved")

  async function load(): Promise<void> {
    const userId = user.value?.id
    if (!userId) {
      state.value = undefined
      return
    }
    if (state.value?.userId === userId) return
    try {
      state.value = { userId, organisation: await mine() }
    } catch {
      // Unknown for now: the screens stay as for anyone, and the API still decides.
      state.value = undefined
    }
  }

  return { organisation, isApprovedPro, load }
}
