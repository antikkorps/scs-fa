-- Story 11.9 — a category B FIREARM is delivered in two parcels (weapon and
-- parts apart). New products get the preset from the API (`defaultParcelCount`);
-- this brings the firearms already in the catalogue in line. Category B
-- ammunition is not split. Only rows still on the column default are touched,
-- so re-running it can never undo a manual choice.
UPDATE "products"
SET "parcel_count" = 2
WHERE "parcel_count" = 1
  AND "legal_category_id" IN (SELECT "id" FROM "legal_categories" WHERE "category" = 'B')
  AND "category_id" IN (
    SELECT "id" FROM "product_categories" WHERE "slug" IN ('arme-poing', 'arme-longue', 'arme-defense')
  );
