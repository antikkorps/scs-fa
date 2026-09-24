// The regulation guide (story 9.6): one list feeds both the page and its
// FAQPage structured data, so what crawlers and agents read is exactly what
// the visitor reads.
//
// ⚠️ Drafted from the Code de la sécurité intérieure and from what this site
// requires at checkout (seeded legal categories); to be validated by Fred and
// Steph before publication — see shared/utils/editorialPages.ts. `todo` marks a
// point the draft could not settle on its own.

export interface FaqEntry {
  question: string
  /** Paragraphs of plain text — rendered as-is and reused verbatim in the structured data. */
  answer: string[]
  /** A point to confirm before publication, shown highlighted on the draft. */
  todo?: string
}

export interface FaqSection {
  title: string
  entries: FaqEntry[]
}

export const REGULATION_FAQ: FaqSection[] = [
  {
    title: "Les catégories d'armes",
    entries: [
      {
        question: "Comment les armes sont-elles classées en France ?",
        answer: [
          "Le Code de la sécurité intérieure range les armes en quatre catégories, de A à D, selon leur dangerosité. La catégorie décide de qui peut acheter une arme et des pièces à fournir.",
          "Catégorie A : armes interdites à l'acquisition et à la détention, sauf exceptions très encadrées. SCS Firearm ne les vend pas.",
          "Catégorie B : armes soumises à autorisation préfectorale.",
          "Catégorie C : armes soumises à déclaration.",
          "Catégorie D : armes dont l'acquisition et la détention sont libres pour les personnes majeures.",
          "Chaque article de la boutique affiche sa catégorie.",
        ],
      },
      {
        question: "Une arme de catégorie D peut-elle être portée ou transportée librement ?",
        answer: [
          "Non. Leur acquisition et leur détention sont libres pour un majeur, mais leur port et leur transport sont interdits sans motif légitime.",
        ],
      },
      {
        question: "Comment est classée une arme de collection ?",
        answer: [
          "La catégorie d'une arme ancienne dépend de son modèle et des munitions qu'elle tire : une arme ancienne n'est pas nécessairement en vente libre. Chaque fiche de nos armes de collection indique sa catégorie et les pièces qu'elle exige.",
        ],
      },
    ],
  },
  {
    title: "Ce qu'il faut pour acheter",
    entries: [
      {
        question: "Quel âge faut-il avoir ?",
        answer: [
          "18 ans révolus pour toute arme vendue sur le site, quelle que soit sa catégorie. Une pièce d'identité est demandée pour le vérifier.",
        ],
      },
      {
        question: "Que faut-il pour acheter une arme de catégorie B ?",
        answer: [
          "Une autorisation préfectorale d'acquisition et de détention à votre nom, en cours de validité et correspondant à l'arme achetée, une pièce d'identité, et votre identifiant SIA.",
        ],
      },
      {
        question: "Que faut-il pour acheter une arme de catégorie C ?",
        answer: [
          "Un permis de chasser accompagné de sa validation pour l'année en cours, une pièce d'identité, et votre identifiant SIA.",
        ],
        todo: "La licence de tir en cours de validité ouvre aussi l'achat d'une arme de catégorie C, mais le site ne propose aujourd'hui que le permis de chasser comme pièce : à confirmer, et à ajouter aux pièces acceptées le cas échéant.",
      },
      {
        question: "Qu'est-ce que le SIA ?",
        answer: [
          "Le Système d'information sur les armes est le service en ligne du ministère de l'Intérieur où chaque détenteur d'armes des catégories B et C dispose d'un compte personnel. L'armurier y enregistre la vente, qui rejoint alors votre compte.",
        ],
      },
      {
        question: "Les munitions sont-elles réglementées ?",
        answer: [
          "Oui : une munition suit la catégorie de l'arme à laquelle elle est destinée. Acheter des munitions pour une arme de catégorie B ou C demande donc les mêmes justificatifs que l'arme elle-même.",
        ],
      },
    ],
  },
  {
    title: "Acheter sur SCS Firearm",
    entries: [
      {
        question: "Comment se déroule un achat réglementé ?",
        answer: [
          "Vous passez commande comme pour n'importe quel article, puis vous déposez les pièces demandées depuis votre espace client. Elles sont analysées par un antivirus, puis vérifiées une à une par notre équipe.",
          "La commande n'est expédiée qu'une fois toutes les pièces validées. Si l'une d'elles est refusée, nous vous en indiquons le motif et vous pouvez en déposer une nouvelle.",
        ],
      },
      {
        question: "Comment une arme est-elle livrée ?",
        answer: [
          "En colis suivi. Une arme de catégorie B est expédiée en deux colis distincts : l'arme d'un côté, ses éléments essentiels de l'autre.",
        ],
      },
    ],
  },
]

/** schema.org FAQPage for the guide: the same questions and answers, as plain text. */
export function regulationFaqJsonLd(sections: FaqSection[] = REGULATION_FAQ) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: sections.flatMap((s) =>
      s.entries.map((e) => ({
        "@type": "Question",
        name: e.question,
        acceptedAnswer: { "@type": "Answer", text: e.answer.join("\n\n") },
      })),
    ),
  }
}
