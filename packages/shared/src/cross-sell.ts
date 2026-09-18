import type { LegalCategory } from "./constants.js"
import { FIREARM_CATEGORY_SLUGS } from "./shipping.js"

// Story 11.8 — cross-sell « fréquemment achetés ensemble ». Tout est pur ici :
// l'API refuse avec ces règles, l'écran d'administration explique avec les
// mêmes, et la fiche publique filtre avec les mêmes encore.
//
// ⚠️ Les associations sont SAISIES À LA MAIN (décision du 2026-09-18). Au
// lancement il n'existe aucun historique de co-achats à exploiter, et surtout
// les restrictions d'accessoires ne sont modélisées que par un booléen et une
// NOTE EN TEXTE LIBRE (`hasAccessoryRestrictions`, `accessoryRestrictionNotes`) :
// aucune règle ne peut lire « interdit sur une carabine semi-automatique ».
// Ce que le code garantit est donc strictement mécanique — jamais la conformité
// d'un accessoire à une arme, qui reste une décision humaine informée.

/** Catégories dont la fiche détail peut porter un bloc de suggestions. */
export const CROSS_SELL_SOURCE_CATEGORY_SLUGS: readonly string[] = FIREARM_CATEGORY_SLUGS

/** Catégories dans lesquelles un article suggéré doit se trouver. */
export const CROSS_SELL_ACCESSORY_CATEGORY_SLUGS: readonly string[] = [
  "munition",
  "accessoire-tireur",
  "aide-visee",
  "accessoire-autre",
]

/**
 * Plafond d'associations par arme. Un bloc de suggestions qui déroule un
 * catalogue n'est plus une suggestion : il redevient une liste à parcourir.
 */
export const MAX_CROSS_SELLS_PER_PRODUCT = 6

/** Exigence administrative croissante. `none` = vente libre, `A` = interdite au public. */
const LEGAL_CATEGORY_RANK: Record<LegalCategory, number> = { none: 0, D: 1, C: 2, B: 3, A: 4 }

export interface CrossSellSource {
  id: string
  categorySlug: string
  legalCategory: LegalCategory
}

export interface CrossSellCandidate {
  id: string
  categorySlug: string
  legalCategory: LegalCategory
  published: boolean
  trackStock: boolean
  stockQty: number
}

/** Pourquoi une association est refusée. `null` quand elle est permise. */
export type CrossSellRejection = "self" | "source-not-a-weapon" | "not-an-accessory" | "stricter-legal-category"

const REJECTION_MESSAGES: Record<CrossSellRejection, string> = {
  self: "Un article ne peut pas se suggérer lui-même",
  "source-not-a-weapon": "Seule la fiche d'une arme porte un bloc de suggestions",
  "not-an-accessory": "Seuls une munition ou un accessoire peuvent être suggérés",
  "stricter-legal-category":
    "Cet accessoire exige plus de formalités que l'arme sur laquelle il serait suggéré — il ne peut pas y figurer",
}

export function crossSellRejectionMessage(reason: CrossSellRejection): string {
  return REJECTION_MESSAGES[reason]
}

/**
 * La raison mécanique de refuser une association, ou `null`.
 *
 * ⚠️ La dernière règle est la seule qui touche au droit, et elle est
 * volontairement étroite : **un accessoire ne peut pas exiger plus de formalités
 * que l'arme sur laquelle il apparaît**. Proposer une munition de catégorie B
 * sur la fiche d'une arme de catégorie D enverrait le client vers un achat qu'il
 * ne peut pas conclure ; l'inverse (un accessoire en vente libre sur une arme B)
 * ne pose aucun problème. Tout le reste — la compatibilité réelle, les
 * restrictions écrites en toutes lettres sur la fiche — relève de l'admin.
 */
export function rejectCrossSell(source: CrossSellSource, candidate: CrossSellCandidate): CrossSellRejection | null {
  if (source.id === candidate.id) return "self"
  if (!CROSS_SELL_SOURCE_CATEGORY_SLUGS.includes(source.categorySlug)) return "source-not-a-weapon"
  if (!CROSS_SELL_ACCESSORY_CATEGORY_SLUGS.includes(candidate.categorySlug)) return "not-an-accessory"
  if (LEGAL_CATEGORY_RANK[candidate.legalCategory] > LEGAL_CATEGORY_RANK[source.legalCategory]) {
    return "stricter-legal-category"
  }
  return null
}

export function canAttachCrossSell(source: CrossSellSource, candidate: CrossSellCandidate): boolean {
  return rejectCrossSell(source, candidate) === null
}

/**
 * Un article dépublié ou épuisé n'est pas une suggestion : c'est une déception.
 * Un article dont le stock n'est pas suivi est toujours disponible.
 */
export function isCrossSellBuyable(candidate: CrossSellCandidate): boolean {
  if (!candidate.published) return false
  return candidate.trackStock ? candidate.stockQty > 0 : true
}

/**
 * Ce que la fiche publique montre, dans l'ordre choisi par l'admin.
 *
 * ⚠️ Les règles sont réappliquées à l'affichage, pas seulement à la saisie :
 * une arme qui change de catégorie légale après coup ne doit pas continuer à
 * proposer un accessoire devenu trop exigeant pour elle.
 */
export function displayableCrossSells<T extends CrossSellCandidate>(source: CrossSellSource, candidates: T[]): T[] {
  return candidates
    .filter((c) => isCrossSellBuyable(c) && canAttachCrossSell(source, c))
    .slice(0, MAX_CROSS_SELLS_PER_PRODUCT)
}
