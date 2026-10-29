// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it } from "vitest"
import type { LaunchState } from "~/composables/useLaunch"
import LaunchBanner from "./LaunchBanner.vue"

function setState(state: LaunchState) {
  useState("launch").value = state
}

beforeEach(() => {
  useState("launch").value = null
})

describe("LaunchBanner (story 12.10)", () => {
  it("tells an administrator why they see a site the public does not", async () => {
    setState({ launchStage: "coming_soon", indexingEnabled: false, adminPreview: true })
    const wrapper = await mountSuspended(LaunchBanner)
    expect(wrapper.text()).toContain("Pré-ouverture — visible car vous êtes administrateur")
  })

  it("tells every visitor that sales open soon in the showcase stage", async () => {
    setState({ launchStage: "showcase", indexingEnabled: true, adminPreview: false })
    const wrapper = await mountSuspended(LaunchBanner)
    expect(wrapper.text()).toContain("Les ventes ouvrent prochainement")
    expect(wrapper.find('a[href="#newsletter"]').exists()).toBe(true)
  })

  it("says nothing once the shop is open", async () => {
    setState({ launchStage: "open", indexingEnabled: true, adminPreview: false })
    const wrapper = await mountSuspended(LaunchBanner)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })
})
