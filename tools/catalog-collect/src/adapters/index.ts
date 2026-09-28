import type { SupplierAdapter } from "../adapter.js"
import { bgmWinfield } from "./bgm.js"
import { agoraTec, corCaroli } from "./doing.js"
import { esp } from "./esp.js"
import { humbert } from "./humbert.js"
import { toro } from "./toro.js"

/**
 * Every supplier a collection can run against. Armurerie de Paris is absent on
 * purpose: its robots.txt forbids all crawling and it publishes no catalogue —
 * its articles go through the import by hand.
 */
export const ADAPTERS: readonly SupplierAdapter[] = [agoraTec, corCaroli, bgmWinfield, humbert, toro, esp]

export function adapterById(id: string): SupplierAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id)
}
