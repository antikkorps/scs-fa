// Story 12.10 — how far the shop is open. One stage rather than two switches:
// "sales open, site hidden" cannot be expressed.
//   coming_soon — a single waiting page for the public
//   showcase    — the catalogue is visible, sales are closed
//   open        — everything is open
export const LAUNCH_STAGES = ["coming_soon", "showcase", "open"] as const

export type LaunchStage = (typeof LAUNCH_STAGES)[number]

/** Whether accounts, carts, orders, payments and quote requests are accepted. */
export function salesAreOpen(stage: LaunchStage): boolean {
  return stage === "open"
}
