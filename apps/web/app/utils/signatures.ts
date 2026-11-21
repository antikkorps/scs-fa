// Review of 12.15c (UI/UX): the house's two signatures sit at the end of the
// universes' row, set apart, and behave alike: a pitch and two ways in. The
// mobile menu shows them as cards above the universes.

export interface SignatureLink {
  to: string
  title: string
  sub: string
}

export interface Signature {
  key: string
  label: string
  /** The label where the row is narrow. */
  shortLabel: string
  to: string
  /** The line under the label on its mobile card. */
  tagline: string
  lede: string
  points: string[]
  ctas: SignatureLink[]
}

export const SIGNATURES: Signature[] = [
  {
    key: "collection",
    label: "Armes de collection",
    shortLabel: "Collection",
    to: "/armes-de-collection",
    tagline: "Pièces uniques expertisées",
    lede: "Des pièces uniques, expertisées et documentées, des armes anciennes d'avant 1900 aux pièces de guerre.",
    points: ["Provenance documentée", "État réel détaillé", "Vente encadrée par la réglementation"],
    ctas: [
      { to: "/armes-de-collection", title: "Les pièces disponibles", sub: "Chaque exemplaire est unique" },
      { to: "/armes-de-collection?vendues=1", title: "Les pièces vendues", sub: "Celles passées par la maison" },
    ],
  },
  {
    key: "gunart",
    label: "Gun Art",
    shortLabel: "Gun Art",
    to: "/collection",
    tagline: "Éditions d'art limitées",
    lede: "Des tirages photographiques d'exception, signés et numérotés, en édition strictement limitée.",
    points: ["Éditions limitées ≤ 25 exemplaires", "Signées & numérotées", "Certificat d'authenticité"],
    // The artist comes first: the house sells someone's work, and that is the
    // entry point into Gun Art (Franck, 2026-09-23). `/collection/artiste`
    // routes to the artist when there is one, and lists them once there are more.
    ctas: [
      { to: "/collection/artiste", title: "L'artiste", sub: "Celui dont vous accrochez le travail" },
      { to: "/collection", title: "Découvrir la galerie", sub: "Toutes les œuvres Gun Art" },
    ],
  },
]
