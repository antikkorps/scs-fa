// @vitest-environment nuxt
import { mockNuxtImport, registerEndpoint } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type LaunchState, useLaunch } from "./useLaunch"

const launchStatus = vi.fn<() => LaunchState>()
const { isAdmin } = vi.hoisted(() => ({ isAdmin: { value: false } }))
mockNuxtImport("useAuth", () => () => ({ isAdmin }))
registerEndpoint("/bff/launch-status", () => launchStatus())

function setState(state: LaunchState | null) {
  useState("launch").value = state
}

beforeEach(() => {
  launchStatus.mockReset()
  isAdmin.value = false
  setState(null)
  useState("launch-admin-checked").value = false
})

describe("useLaunch (story 12.10)", () => {
  it("assumes a closed, unindexed shop until the server has said otherwise", () => {
    const launch = useLaunch()
    expect(launch.salesOpen.value).toBe(false)
    expect(launch.waitingPageFor("/boutique")).toBe(true)
  })

  it("shows the catalogue but no sale in the showcase stage", () => {
    setState({ launchStage: "showcase", indexingEnabled: false, adminPreview: false })
    const launch = useLaunch()
    expect(launch.salesOpen.value).toBe(false)
    expect(launch.waitingPageFor("/boutique")).toBe(false)
  })

  it("opens everything in the open stage", () => {
    setState({ launchStage: "open", indexingEnabled: true, adminPreview: false })
    expect(useLaunch().salesOpen.value).toBe(true)
  })

  it("lets an administrator checked by the server through the waiting page", () => {
    setState({ launchStage: "coming_soon", indexingEnabled: false, adminPreview: true })
    const launch = useLaunch()
    expect(launch.waitingPageFor("/boutique")).toBe(false)
    expect(launch.status.value.adminPreview).toBe(true)
  })

  it("asks the server again, which decides on the session", async () => {
    launchStatus.mockReturnValue({ launchStage: "coming_soon", indexingEnabled: false, adminPreview: true })
    const launch = useLaunch()
    await launch.refresh()
    expect(launch.waitingPageFor("/")).toBe(false)
  })

  it("keeps what it knew when the server cannot be reached", async () => {
    setState({ launchStage: "showcase", indexingEnabled: false, adminPreview: false })
    launchStatus.mockImplementation(() => {
      throw createError({ statusCode: 502 })
    })
    const launch = useLaunch()
    await launch.refresh()
    expect(launch.status.value.launchStage).toBe("showcase")
  })

  describe("recheckAdmin", () => {
    const closed: LaunchState = { launchStage: "coming_soon", indexingEnabled: false, adminPreview: false }

    it("asks the server once when an administrator meets the waiting page", async () => {
      setState(closed)
      isAdmin.value = true
      launchStatus.mockReturnValue({ ...closed, adminPreview: true })
      const launch = useLaunch()

      await launch.recheckAdmin("/boutique")
      await launch.recheckAdmin("/collection")

      expect(launchStatus).toHaveBeenCalledOnce()
      expect(launch.waitingPageFor("/boutique")).toBe(false)
    })

    it("asks nothing for a visitor, or on a page the waiting page does not cover", async () => {
      setState(closed)
      const launch = useLaunch()
      await launch.recheckAdmin("/boutique")
      isAdmin.value = true
      await launch.recheckAdmin("/mentions-legales")
      expect(launchStatus).not.toHaveBeenCalled()
    })
  })
})
