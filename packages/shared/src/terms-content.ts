import { LEGAL_DOC_REVIEW_SLA_HOURS, UNIQUE_PIECE_HOLD_MINUTES } from "./constants.js"
import { LEGAL_IDENTITY, type LegalIdentity } from "./legal-identity.js"

/**
 * The text of the terms of sale (story 12.1), as data: the `/cgv` page and the
 * order confirmation e-mail both render it, so the customer receives on a
 * durable medium exactly the text they accepted (Code conso. art. L221-13 —
 * a link to a web page is not a durable medium).
 *
 * ⚠️ ANY change to the wording here bumps CURRENT_TERMS_VERSION (terms.ts).
 * The text is a draft until a lawyer has read it: `todo` marks what the client
 * or the lawyer must still settle.
 */

export type TermsInline =
  | string
  | { strong: string }
  /** A page of the site, by path — absolute URL in e-mails. */
  | { link: string; path: string }
  | { fact: keyof LegalIdentity; label: string }
  | { todo: string }

export type TermsBlock = { list: TermsInline[][] } | { paragraph: TermsInline[] }

export interface TermsSection {
  title: string
  blocks: TermsBlock[]
}

const p = (...content: TermsInline[]): TermsBlock => ({ paragraph: content })
const list = (...items: TermsInline[][]): TermsBlock => ({ list: items })
const b = (strong: string): TermsInline => ({ strong })
const a = (link: string, path: string): TermsInline => ({ link, path })
const f = (fact: keyof LegalIdentity, label: string): TermsInline => ({ fact, label })
const todo = (text: string): TermsInline => ({ todo: text })

const CONTACT_EMAIL = f("email", "adresse e-mail de contact")

export const TERMS_SECTIONS: TermsSection[] = [
  {
    title: "1. Objet et vendeur",
    blocks: [
      p(
        "Les présentes conditions régissent les ventes conclues sur le site SCS Firearms entre ",
        f("companyName", "raison sociale"),
        ", ",
        f("legalForm", "forme juridique"),
        ", SIRET ",
        f("siret", "SIRET"),
        ", dont le siège est situé ",
        f("address", "adresse postale"),
        " (« SCS Firearms »), et toute personne physique achetant en qualité de consommateur (« le client »). Leurs coordonnées complètes figurent dans les ",
        a("mentions légales", "/mentions-legales"),
        ".",
      ),
      p(
        "Le site réunit deux univers : l'",
        b("armurerie"),
        " (armes, munitions, accessoires, armes de collection), vendue par SCS Firearms, et la galerie ",
        b("Gun Art"),
        " (tirages d'art), vendue par SCS Firearms pour le compte de l'artiste. Les articles 1 à 11 s'appliquent à tous les achats ; l'article 12 ajoute les règles propres aux articles réglementés, l'article 13 celles propres aux tirages Gun Art.",
      ),
      p(
        "Le client accepte ces conditions en cochant la case prévue à cet effet avant de commander. La version acceptée est enregistrée avec la commande et lui est adressée avec la confirmation de commande : c'est elle qui s'applique à cette commande, même si le texte évolue ensuite.",
      ),
    ],
  },
  {
    title: "2. Qui peut acheter",
    blocks: [
      p(
        "Il faut être une personne physique majeure et disposer d'un compte client. Toute commande comportant une arme, un élément d'arme ou des munitions suppose d'avoir 18 ans révolus, quelle que soit la catégorie : une pièce d'identité est demandée pour le vérifier.",
      ),
      p(
        "Les ventes sont réservées aux livraisons en ",
        b("France métropolitaine, Corse comprise"),
        ". Les départements, régions et collectivités d'outre-mer ne sont pas desservis.",
      ),
    ],
  },
  {
    title: "3. Articles",
    blocks: [
      p(
        "Chaque fiche présente les caractéristiques essentielles de l'article, sa disponibilité et, pour une arme ou des munitions, sa ",
        b("catégorie légale"),
        " (A à D) et les pièces justificatives qu'elle exige. Les photos sont aussi fidèles que possible ; pour les armes de collection, qui sont des pièces uniques, elles montrent l'objet vendu lui-même.",
      ),
    ],
  },
  {
    title: "4. Prix",
    blocks: [
      p(
        "Les prix sont indiqués en euros, toutes taxes comprises. Les éventuelles remises (remise fidélité réservée aux clients qui en bénéficient, par exemple) apparaissent dans le récapitulatif avant la commande.",
      ),
      p(
        "Les ",
        b("frais de livraison"),
        " s'ajoutent au prix des articles ; leur montant et le prix total sont indiqués dans le récapitulatif, avant la validation de la commande. Ils sont forfaitaires : par colis pour une arme (envoi assuré, remis contre signature ; une arme de catégorie B est livrée en deux colis), un forfait unique par commande pour les munitions et accessoires — offert à partir du montant indiqué au panier —, et par tirage pour les œuvres Gun Art. La remise fidélité ne s'applique pas aux frais de livraison.",
      ),
      p(
        `Le prix appliqué est celui affiché au moment de la commande. Une pièce unique de l'armurerie placée dans le panier est réservée au client pendant ${UNIQUE_PIECE_HOLD_MINUTES} minutes, puis remise en vente ; un tirage Gun Art reste réservé tant qu'il est dans le panier.`,
      ),
    ],
  },
  {
    title: "5. Commande",
    blocks: [
      p(
        "Le client choisit ses articles, vérifie le récapitulatif (articles, prix, remises, total), choisit ses adresses de livraison et de facturation, accepte les présentes conditions puis clique sur « Commander avec obligation de paiement ». Ce clic vaut commande ferme. Un e-mail de confirmation en reprend le contenu, accompagné des présentes conditions et du formulaire de rétractation.",
      ),
      p(
        "Une commande comportant un article réglementé est en outre soumise à la vérification des pièces décrite à l'article 12 : elle n'est expédiée qu'une fois toutes les pièces validées.",
      ),
    ],
  },
  {
    title: "6. Paiement",
    blocks: [
      p("Le mode de paiement dépend des articles :"),
      list(
        [
          b("par carte bancaire"),
          ", pour les armes de catégorie D, les articles en vente libre et les tirages Gun Art. Le paiement est traité par notre prestataire Stripe : SCS Firearms n'a jamais connaissance des numéros de carte ;",
        ],
        [
          b("par virement bancaire"),
          ", pour les armes, éléments et munitions des catégories B et C. Les coordonnées bancaires et la référence à indiquer sont communiquées après la commande. Le virement doit nous parvenir sous ",
          todo("À compléter : délai de paiement, par exemple 10 jours"),
          ", faute de quoi la commande peut être annulée.",
        ],
      ),
      p(
        "Une commande qui mêle les deux types d'articles est réglée en deux parties, dont le détail s'affiche après la commande. Les articles restent la propriété de SCS Firearms (ou, pour un tirage Gun Art, de l'artiste) jusqu'au paiement complet de leur prix.",
      ),
    ],
  },
  {
    title: "7. Livraison",
    blocks: [
      p(
        "Les articles sont expédiés en colis suivi, par un transporteur choisi par nos soins (Colissimo ou Chronopost), à l'adresse indiquée lors de la commande, en France métropolitaine, Corse comprise. Le numéro de suivi est communiqué dès l'expédition, depuis l'espace client. La commande est expédiée sous ",
        todo("À compléter : délai d'expédition après paiement et, le cas échéant, validation des pièces"),
        " ; à défaut de délai indiqué, la livraison intervient au plus tard 30 jours après la commande (article L216-1 du Code de la consommation).",
      ),
      p(
        "Les risques de perte ou d'endommagement sont transférés au client lorsqu'il prend physiquement possession des articles (article L216-4). En cas de colis abîmé, le client est invité à émettre des réserves auprès du transporteur et à nous prévenir sans tarder.",
      ),
    ],
  },
  {
    title: "8. Droit de rétractation",
    blocks: [
      p(
        "Le client dispose de ",
        b("14 jours"),
        " à compter de la réception de l'article pour se rétracter, sans avoir à se justifier (article L221-18). Pour une commande livrée en plusieurs colis, le délai court à partir de la réception du dernier. Il suffit de nous adresser, avant l'expiration de ce délai, une déclaration dénuée d'ambiguïté — par exemple au moyen du formulaire de rétractation ci-après — à ",
        CONTACT_EMAIL,
        ".",
      ),
      p(
        "Le client renvoie l'article au plus tard 14 jours après nous avoir informés de sa décision, ",
        b("à ses frais"),
        ", complet et dans son emballage d'origine. Sa responsabilité n'est engagée qu'à l'égard de la dépréciation résultant de manipulations autres que celles nécessaires pour établir la nature, les caractéristiques et le bon fonctionnement de l'article (article L221-23) — une arme ayant tiré, par exemple. Le retour d'une arme ou de munitions obéit aux règles de transport de l'article 12.",
      ),
      p(
        "Nous remboursons la totalité des sommes versées, frais de livraison initiaux compris (sur la base du mode de livraison standard), au plus tard 14 jours après avoir été informés de la rétractation, par le même moyen de paiement que celui utilisé pour la commande. Nous pouvons différer ce remboursement jusqu'à la récupération de l'article ou jusqu'à la preuve de son expédition (article L221-24).",
      ),
      p(
        b("Exceptions."),
        " Le droit de rétractation ne s'applique pas aux biens confectionnés selon les spécifications du client ou nettement personnalisés (article L221-28, 3°). ",
        todo(
          "À confirmer : le site vend-il des articles personnalisés (gravure, réglage à la demande, tirage sur mesure) ? Si non, cette exception peut être retirée.",
        ),
        " Un tirage Gun Art numéroté issu d'une édition limitée n'est pas un bien personnalisé : il reste couvert par le droit de rétractation.",
      ),
    ],
  },
  {
    title: "9. Garanties légales",
    blocks: [
      p(
        "Tous les articles bénéficient de la ",
        b("garantie légale de conformité"),
        " (articles L217-3 et suivants du Code de la consommation) et de la ",
        b("garantie des vices cachés"),
        " (articles 1641 à 1649 du Code civil), indépendamment de toute garantie commerciale.",
      ),
      p(
        "Au titre de la garantie de conformité, le client dispose de deux ans à compter de la délivrance de l'article pour obtenir sa mise en conformité (réparation ou remplacement) ou, à défaut, une réduction du prix ou la résolution du contrat. Durant ce délai, il n'a pas à prouver que le défaut existait au moment de la délivrance. Pour une arme de collection vendue d'occasion, ce délai de présomption est de ",
        todo("À confirmer : 12 mois pour un bien d'occasion (article L217-7)"),
        ".",
      ),
      p(
        todo(
          "À compléter par le juriste : l'encadré d'information sur les garanties légales dans les termes exacts fixés par le décret n° 2022-946 du 29 juin 2022.",
        ),
      ),
    ],
  },
  {
    title: "10. Responsabilité",
    blocks: [
      p(
        "SCS Firearms n'est pas responsable de l'inexécution d'une commande due au client, au fait imprévisible et insurmontable d'un tiers, ou à un cas de force majeure. Le client reste seul responsable de l'usage, de la détention et du transport des articles achetés, dans le respect de la réglementation en vigueur.",
      ),
    ],
  },
  {
    title: "11. Données personnelles, litiges et droit applicable",
    blocks: [
      p(
        "Les données du client sont traitées conformément à notre ",
        a("politique de confidentialité", "/confidentialite"),
        ".",
      ),
      p(
        "En cas de litige, le client est invité à nous contacter d'abord à ",
        CONTACT_EMAIL,
        ". À défaut d'accord, il peut recourir gratuitement au médiateur de la consommation dont nous relevons : ",
        f("mediatorName", "nom du médiateur de la consommation"),
        " — ",
        f("mediatorUrl", "site du médiateur"),
        " (articles L612-1 et suivants).",
      ),
      p(
        "Les présentes conditions sont soumises au droit français. Le client consommateur peut saisir, à son choix, la juridiction du lieu où il demeurait au moment de la conclusion du contrat ou de la survenance du fait dommageable.",
      ),
    ],
  },
  {
    title: "12. Armes, éléments d'armes et munitions",
    blocks: [
      p(
        "Le commerce des armes est régi par le Code de la sécurité intérieure. Les règles ci-dessous s'ajoutent aux articles précédents ; notre ",
        a("guide de la réglementation", "/reglementation"),
        " les explique plus en détail.",
      ),
      list(
        [b("Catégorie A"), " : ces armes ne sont pas vendues sur le site."],
        [
          b("Catégories B et C"),
          ` : après la commande, le client dépose depuis son espace client les pièces demandées (pièce d'identité, autorisation préfectorale ou titre requis, identifiant SIA…). Elles sont vérifiées une à une, dans un délai visé de ${LEGAL_DOC_REVIEW_SLA_HOURS} heures. Une pièce refusée est motivée et peut être remplacée. La vente est enregistrée dans le Système d'information sur les armes (SIA).`,
        ],
        [
          b("Catégorie D"),
          " : l'acquisition et la détention sont libres pour un majeur, mais le port et le transport sont interdits sans motif légitime.",
        ],
        ["Les munitions suivent la catégorie de l'arme à laquelle elles sont destinées."],
      ),
      p(
        b("Refus de vente."),
        " SCS Firearms est tenu de refuser une vente lorsque les pièces fournies ne permettent pas d'établir que l'acheteur peut légalement acquérir l'article, ou lorsque la loi l'impose. Dans ce cas, la commande — ou la partie de la commande concernée — est annulée et les sommes correspondantes sont intégralement remboursées sous 14 jours. ",
        todo("À confirmer : délai laissé au client pour fournir ses pièces avant annulation."),
      ),
      p(
        b("Expédition."),
        " Une arme de catégorie B est expédiée en deux colis distincts : l'arme d'un côté, ses éléments essentiels de l'autre. ",
        todo("À confirmer : remise contre signature ?"),
        " Le retour d'un article réglementé, y compris au titre du droit de rétractation, se fait selon les mêmes modalités, après accord préalable avec SCS Firearms sur le mode d'envoi, afin que la vente puisse être annulée dans le SIA.",
      ),
    ],
  },
  {
    title: "13. Tirages Gun Art",
    blocks: [
      p(
        "Les tirages de la galerie Gun Art sont vendus par SCS Firearms pour le compte de leur artiste. ",
        todo("À confirmer par le juriste : qualification exacte de ce mandat de vente et mention qu'elle impose."),
        " Chaque tirage appartient à une édition limitée : son numéro dans l'édition et son format figurent sur la fiche. Lorsque la fiche l'indique, un certificat d'authenticité signé l'accompagne.",
      ),
      p(
        "L'achat d'un tirage transfère la propriété de l'objet, pas les droits d'auteur de l'œuvre : le client ne peut ni la reproduire ni l'exploiter sans l'autorisation écrite de l'artiste.",
      ),
    ],
  },
]

/** Model withdrawal form — annex to art. R221-1 of the Code de la consommation. */
export const WITHDRAWAL_FORM = {
  title: "Formulaire de rétractation",
  intro:
    "À compléter et renvoyer uniquement si vous souhaitez vous rétracter de votre commande (modèle prévu à l'annexe de l'article R221-1 du Code de la consommation).",
  lines: [
    [
      "À l'attention de ",
      f("companyName", "raison sociale"),
      ", ",
      f("address", "adresse postale"),
      ", ",
      CONTACT_EMAIL,
      " :",
    ],
    ["Je vous notifie par la présente ma rétractation du contrat portant sur la vente du bien ci-dessous :"],
    ["Commandé le : …………… / reçu le : ……………"],
    ["Numéro de commande : ……………"],
    ["Nom du client : ……………"],
    ["Adresse du client : ……………"],
    ["Signature du client (uniquement en cas de notification sur papier) : ……………"],
    ["Date : ……………"],
  ] satisfies TermsInline[][],
}

/** Escape free text interpolated into HTML (e-mail bodies). */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export interface TermsRenderOptions {
  /** Absolute origin used for links, without trailing slash. */
  siteUrl: string
  identity?: LegalIdentity
}

function inlineText(i: TermsInline, o: TermsRenderOptions): string {
  if (typeof i === "string") return i
  if ("strong" in i) return i.strong
  if ("link" in i) return `${i.link} (${o.siteUrl}${i.path})`
  if ("fact" in i) return (o.identity ?? LEGAL_IDENTITY)[i.fact] || `[${i.label}]`
  return `[${i.todo}]`
}

function inlineHtml(i: TermsInline, o: TermsRenderOptions): string {
  if (typeof i === "string") return escapeHtml(i)
  if ("strong" in i) return `<strong>${escapeHtml(i.strong)}</strong>`
  if ("link" in i) return `<a href="${escapeHtml(o.siteUrl + i.path)}">${escapeHtml(i.link)}</a>`
  if ("fact" in i) {
    const value = (o.identity ?? LEGAL_IDENTITY)[i.fact]
    return value ? escapeHtml(value) : `<mark>[${escapeHtml(i.label)}]</mark>`
  }
  return `<mark>[${escapeHtml(i.todo)}]</mark>`
}

/** A run of CGV-style text (facts, links, placeholders) as plain text. */
export function renderInlinesText(content: TermsInline[], o: TermsRenderOptions): string {
  return content.map((i) => inlineText(i, o)).join("")
}

/** A run of CGV-style text (facts, links, placeholders) as escaped HTML. */
export function renderInlinesHtml(content: TermsInline[], o: TermsRenderOptions): string {
  return content.map((i) => inlineHtml(i, o)).join("")
}

const joinText = renderInlinesText
const joinHtml = renderInlinesHtml

/** The CGV and the withdrawal form as plain text (text/plain part of an e-mail). */
export function renderTermsText(o: TermsRenderOptions): string {
  const sections = TERMS_SECTIONS.map((s) => {
    const blocks = s.blocks.map((block) =>
      "paragraph" in block
        ? joinText(block.paragraph, o)
        : block.list.map((item) => `- ${joinText(item, o)}`).join("\n"),
    )
    return `${s.title}\n\n${blocks.join("\n\n")}`
  })
  const form = `${WITHDRAWAL_FORM.title}\n\n${WITHDRAWAL_FORM.intro}\n\n${WITHDRAWAL_FORM.lines.map((l) => joinText(l, o)).join("\n")}`
  return [...sections, form].join("\n\n\n")
}

/** The CGV and the withdrawal form as an HTML fragment (e-mail body). */
export function renderTermsHtml(o: TermsRenderOptions): string {
  const sections = TERMS_SECTIONS.map((s) => {
    const blocks = s.blocks.map((block) =>
      "paragraph" in block
        ? `<p>${joinHtml(block.paragraph, o)}</p>`
        : `<ul>${block.list.map((item) => `<li>${joinHtml(item, o)}</li>`).join("")}</ul>`,
    )
    return `<h3>${escapeHtml(s.title)}</h3>${blocks.join("")}`
  })
  const form =
    `<h3>${escapeHtml(WITHDRAWAL_FORM.title)}</h3><p><em>${escapeHtml(WITHDRAWAL_FORM.intro)}</em></p>` +
    WITHDRAWAL_FORM.lines.map((l) => `<p>${joinHtml(l, o)}</p>`).join("")
  return sections.join("") + form
}
