// Story 12.13c (decisions Franck 2026-11-15) — an article reserved to adults
// (its own age, else its legal category's; every knife at least 18) asks the
// customer's date of birth, once, at the order. Under the age, the order is
// refused and the date is not kept. Organisation accounts are exempt: the buyer
// is a legal entity. Self-declared: the identity documents of categories B/C
// remain the real check for weapons.

import { ageOn, isPlausibleBirthDate, parisToday, requiredAge } from "@armurier/shared"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../db/client.js"
import { legalCategories, productCategories, products, productVariants, users } from "../db/schema.js"

export type AgeCheck =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 422; error: string; message: string; requiredAge?: number }

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

/** Whether `userId` may order these variants, recording a first valid date of birth. */
export async function checkOrderAge(
  userId: string,
  variantIds: string[],
  givenBirthDate: string | undefined,
  now = new Date(),
): Promise<AgeCheck> {
  const today = parisToday(now)
  if (givenBirthDate !== undefined && !isPlausibleBirthDate(givenBirthDate, today)) {
    return { ok: false, status: 400, error: "InvalidBirthDate", message: "This is not a valid date of birth" }
  }
  const needed = await cartRequiredAge(variantIds)
  if (needed === 0) return { ok: true }
  const [user] = await db
    .select({ birthDate: users.birthDate, organisationId: users.organisationId })
    .from(users)
    .where(eq(users.id, userId))
  if (!user || user.organisationId) return { ok: true }

  // A date already on the account wins: an order never replaces it.
  const birthDate = user.birthDate ?? givenBirthDate
  if (!birthDate) {
    return {
      ok: false,
      status: 422,
      error: "BirthDateRequired",
      message: "Date of birth required",
      requiredAge: needed,
    }
  }
  if (ageOn(birthDate, today) < needed) {
    return {
      ok: false,
      status: 403,
      error: "AgeRequirementNotMet",
      message: "Age requirement not met",
      requiredAge: needed,
    }
  }
  if (!user.birthDate) {
    await db
      .update(users)
      .set({ birthDate })
      .where(and(eq(users.id, userId), isNull(users.birthDate)))
  }
  return { ok: true }
}
