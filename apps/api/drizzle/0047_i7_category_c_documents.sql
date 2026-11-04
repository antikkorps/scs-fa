-- I7 — decision Franck 2026-11-04 (answer of Fred and Steph): a category C
-- weapon asks an identity document and EITHER a hunting licence validated for
-- the season OR a sport-shooting licence; the SIA number is no longer asked.
-- A group of alternatives is a nested list (one approved document is enough).
-- Separate from 0046: a new enum value cannot be used in the migration that adds it.
UPDATE "legal_categories"
SET "required_doc_types" = '["cni", ["permis_chasse", "licence_tir"]]'::jsonb
WHERE "category" = 'C';
