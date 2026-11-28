// Story 12.16d — how to fill each column of the catalogue file, shown on the
// import page. Typed by column key: a column added to the import does not
// compile until it is explained here.
import type { CatalogImportColumnKey } from "@armurier/shared"

// What only lands on an existing product when « Remplacer les infos » is ticked.
const NEEDS_REPLACE = "Sur un produit déjà importé, ne change qu'avec « Remplacer les infos » coché."

export const IMPORT_COLUMN_HINTS: Record<CatalogImportColumnKey, string> = {
  import: "« oui » pour importer la ligne ; vide ou « non » l'ignore ; toute autre valeur est refusée.",
  active: "« oui » met en ligne, « non » retire de la vente. Vide : inchangé (hors ligne à la création).",
  proOnly: "« oui » : visible des seuls comptes professionnels validés. Vide : inchangé.",
  supplier: "Nom d'un fournisseur déclaré dans Fournisseurs ; un nom inconnu est refusé.",
  supplierSku:
    "La référence chez le fournisseur : c'est elle qui retrouve le produit d'un import à l'autre. Un zéro perdu en tête (« 00123 » devenu « 123 ») crée un nouveau produit.",
  ean: "Code-barres du produit. Un EAN illisible (« 4,00638E+12 ») fait refuser la ligne.",
  name: `Nom du produit sur le site. ${NEEDS_REPLACE}`,
  brand: "Marque. Sur un produit déjà importé, remplit seulement une marque vide, sauf avec « Remplacer les infos ».",
  category: `Nom ou slug d'une catégorie (« Armes longues » ou « arme-longue »). ${NEEDS_REPLACE}`,
  subcategory:
    "Nom ou slug d'une sous-catégorie de la catégorie (« Carabines »). Vide : inchangée ; « Aucune » la retire. Pour changer de catégorie et de sous-catégorie en même temps, cochez « Remplacer les infos ».",
  legalCategory: `A, B, C, D ou « Aucune ». ${NEEDS_REPLACE}`,
  tags: "Noms ou slugs séparés par des virgules (« Chasse, Occasion, .308 Win »), calibres compris. Vide : inchangés ; une liste remplace les tags du produit, case cochée ou non. Les tags se créent dans Catalogue → Tags.",
  supplierLegalClass: "Informatif : le classement annoncé par le fournisseur, ignoré à l'import.",
  costPriceHt:
    "Prix d'achat hors taxes, virgule ou point. Sur un produit déjà importé, remplit seulement un prix d'achat vide, sauf avec « Remplacer les infos ».",
  priceHt: `Prix de vente hors taxes, virgule ou point. ${NEEDS_REPLACE}`,
  vatPct: `Taux de TVA en %, 20 si vide à la création. ${NEEDS_REPLACE}`,
  stockQty: "Lu à la création seulement : un nouvel import ne modifie jamais le stock d'un produit existant.",
  description:
    "Texte court sous le nom. Sur un produit déjà importé, remplit seulement un texte vide, sauf avec « Remplacer les infos ».",
  longDescription:
    "Texte de la fiche produit. Sur un produit déjà importé, remplit seulement un texte vide, sauf avec « Remplacer les infos ».",
  imageUrls:
    "Adresses des images (https://…), séparées par un espace ou « | », 20 au plus ; la première est l'image principale. Prises seulement pour un produit qui n'a pas encore d'images.",
  sourceCategory: "Informatif : la famille du produit chez le fournisseur.",
  sourceUrl: "Page du produit chez le fournisseur.",
  matchStatus: "Informatif : écrit par le fichier de tri.",
  sku: "Notre référence, lue à la création seulement. Vide : composée à partir du fournisseur et de sa référence.",
  duplicates: "Informatif : écrit par l'export, ignoré à l'import.",
  version: "Écrite par l'export pour repérer une fiche modifiée au back-office depuis : ne pas la toucher.",
}
