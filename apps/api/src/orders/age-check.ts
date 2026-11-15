// Story 12.13c (Franck and Fred, 2026-11-15) — an article reserved to adults
// (its own age, else its legal category's; every knife at least 18) asks the
// customer to certify on their honour that they are of age: a ticked box,
// recorded with the order, no date of birth kept. Organisation accounts are
// exempt once approved (the buyer is a legal entity; a pending request
// attaches the organisation at once, so it does not count). For weapons the
// identity documents of categories B/C remain the real check.

import { requiredAge } from "@armurier/shared"
import { eq, inArray } from "drizzle-orm"
import { db } from "../db/client.js"
import { legalCategories, organisations, productCategories, products, productVariants, users } from "../db/schema.js"

export type AgeCheck =
  /** `declared`: the order records the declaration (adultDeclaredAt). */
  | { ok: true; declared: boolean }
  | { ok: false; status: 422; error: "AdultDeclarationRequired"; message: string; requiredAge: number }

/** The highest age the cart's articles require (0 when none does). */
async function cartRequiredAge(variantIds: string[]): Promise<number> {
  if (variantIds.length === 0) return 0
  const rows = await db
    .select({
      ageMinRequired: products.ageMinRequired,
      legalMinAge: legalCategories.minAge,
      categorySlug: productCategories.slug,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(productCategories, eq(productCategories.id, products.categoryId))
    .leftJoin(legalCategories, eq(legalCategories.id, products.legalCategoryId))
    .where(inArray(productVariants.id, variantIds))
  return Math.max(0, ...rows.map(requiredAge))
}

/** Whether `userId` may order these variants, given whether they ticked the adult declaration. */
export async function checkOrderAge(
  userId: string,
  variantIds: string[],
  adultDeclaration: boolean,
): Promise<AgeCheck> {
  const needed = await cartRequiredAge(variantIds)
  if (needed === 0) return { ok: true, declared: false }
  const [user] = await db
    .select({ organisationStatus: organisations.status })
    .from(users)
    .leftJoin(organisations, eq(organisations.id, users.organisationId))
    .where(eq(users.id, userId))
  if (user?.organisationStatus === "approved") return { ok: true, declared: false }
  if (!adultDeclaration) {
    return {
      ok: false,
      status: 422,
      error: "AdultDeclarationRequired",
      message: "Certify that you are of age to order these articles",
      requiredAge: needed,
    }
  }
  return { ok: true, declared: true }
}
