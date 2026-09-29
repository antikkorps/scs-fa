<script setup lang="ts">
import { CURRENT_TERMS_VERSION, LEGAL_DOC_REVIEW_SLA_HOURS, UNIQUE_PIECE_HOLD_MINUTES } from "@armurier/shared"
import { EDITORIAL_PAGES } from "#shared/utils/editorialPages"
import { LEGAL_IDENTITY } from "#shared/utils/legalIdentity"
import { formatDate } from "~/utils/format"

/**
 * Terms of sale (story 12.1): one text for both universes — common terms, a
 * section on regulated articles, a section on Gun Art prints. Written from
 * what the checkout actually does (payment split, document review, parcels);
 * what only the client knows is highlighted, and the whole text must be read
 * by a lawyer before go-live.
 *
 * ⚠️ Every change to the WORDING bumps CURRENT_TERMS_VERSION
 * (packages/shared/src/terms.ts): each order stores the version it was placed
 * under. Validation is tracked in shared/utils/editorialPages.ts.
 */
const REVIEWED = EDITORIAL_PAGES.cgv.reviewed
const VERSION_LABEL = formatDate(CURRENT_TERMS_VERSION)

usePageSeo({
  title: "Conditions générales de vente",
  description:
    "Commande, paiement, livraison, droit de rétractation, garanties et conditions propres aux armes réglementées et aux tirages Gun Art vendus sur SCS Firearm.",
  path: "/cgv",
  noindex: !REVIEWED,
})

const id = LEGAL_IDENTITY
</script>

<template>
  <LegalPage
    crumb="CGV"
    eyebrow="Informations légales"
    title="Conditions générales de vente"
    :updated-on="`${VERSION_LABEL} (version en vigueur)`"
    draft-subject="Ce texte"
    :reviewed="REVIEWED"
  >
    <h2>1. Objet et vendeur</h2>
    <p>
      Les présentes conditions régissent les ventes conclues sur le site SCS Firearm entre
      <LegalFact :value="id.companyName" label="raison sociale" />,
      <LegalFact :value="id.legalForm" label="forme juridique" />, SIRET
      <LegalFact :value="id.siret" label="SIRET" />, dont le siège est situé
      <LegalFact :value="id.address" label="adresse postale" /> (« SCS Firearm »), et toute personne physique
      achetant en qualité de consommateur (« le client »). Leurs coordonnées complètes figurent dans les
      <NuxtLink to="/mentions-legales">mentions légales</NuxtLink>.
    </p>
    <p>
      Le site réunit deux univers : l'<strong>armurerie</strong> (armes, munitions, accessoires, armes de collection),
      vendue par SCS Firearm, et la galerie <strong>Gun Art</strong> (tirages d'art), vendue par SCS Firearm pour le
      compte de l'artiste. Les articles 1 à 11 s'appliquent à tous les achats ; l'article 12 ajoute les règles propres
      aux articles réglementés, l'article 13 celles propres aux tirages Gun Art.
    </p>
    <p>
      Le client accepte ces conditions en cochant la case prévue à cet effet avant de commander. La version acceptée
      est enregistrée avec la commande : c'est elle qui s'applique à cette commande, même si le texte évolue ensuite.
    </p>

    <h2>2. Qui peut acheter</h2>
    <p>
      Il faut être une personne physique majeure et disposer d'un compte client. Toute commande comportant une arme,
      un élément d'arme ou des munitions suppose d'avoir 18 ans révolus, quelle que soit la catégorie : une pièce
      d'identité est demandée pour le vérifier.
    </p>
    <p>
      Les ventes sont réservées aux livraisons en
      <mark class="todo">[À compléter : zone de livraison — France métropolitaine ? Corse, outre-mer ?]</mark>.
    </p>

    <h2>3. Articles</h2>
    <p>
      Chaque fiche présente les caractéristiques essentielles de l'article, sa disponibilité et, pour une arme ou des
      munitions, sa <strong>catégorie légale</strong> (A à D) et les pièces justificatives qu'elle exige. Les photos
      sont aussi fidèles que possible ; pour les armes de collection, qui sont des pièces uniques, elles montrent
      l'objet vendu lui-même.
    </p>

    <h2>4. Prix</h2>
    <p>
      Les prix sont indiqués en euros, toutes taxes comprises. Les éventuelles remises (remise fidélité réservée aux
      clients qui en bénéficient, par exemple) apparaissent dans le récapitulatif avant la commande. Les frais de
      livraison sont indiqués avant la validation de la commande.
      <mark class="todo">[À confirmer : grille des frais de port — le récapitulatif de commande n'en affiche pas
        aujourd'hui.]</mark>
    </p>
    <p>
      Le prix appliqué est celui affiché au moment de la commande. Une pièce unique de l'armurerie placée dans le
      panier est réservée au client pendant {{ UNIQUE_PIECE_HOLD_MINUTES }} minutes, puis remise en vente ; un tirage
      Gun Art reste réservé tant qu'il est dans le panier.
    </p>

    <h2>5. Commande</h2>
    <p>
      Le client choisit ses articles, vérifie le récapitulatif (articles, prix, remises, total), choisit ses adresses
      de livraison et de facturation, accepte les présentes conditions puis clique sur « Commander avec obligation de
      paiement ». Ce clic vaut commande ferme. Un e-mail en confirme la réception et en reprend le contenu.
      <mark class="todo">[À faire avant la mise en ligne : le site n'envoie pas encore cet e-mail de confirmation,
        obligatoire (article L221-13).]</mark>
    </p>
    <p>
      Une commande comportant un article réglementé est en outre soumise à la vérification des pièces décrite à
      l'article 12 : elle n'est expédiée qu'une fois toutes les pièces validées.
    </p>

    <h2>6. Paiement</h2>
    <p>Le mode de paiement dépend des articles :</p>
    <ul>
      <li>
        <strong>par carte bancaire</strong>, pour les armes de catégorie D, les articles en vente libre et les tirages
        Gun Art. Le paiement est traité par notre prestataire Stripe : SCS Firearm n'a jamais connaissance des numéros
        de carte ;
      </li>
      <li>
        <strong>par virement bancaire</strong>, pour les armes, éléments et munitions des catégories B et C. Les
        coordonnées bancaires et la référence à indiquer sont communiquées après la commande. Le virement doit nous
        parvenir sous <mark class="todo">[À compléter : délai de paiement, par exemple 10 jours]</mark>, faute de quoi
        la commande peut être annulée.
      </li>
    </ul>
    <p>
      Une commande qui mêle les deux types d'articles est réglée en deux parties, dont le détail s'affiche après la
      commande. Les articles restent la propriété de SCS Firearm (ou, pour un tirage Gun Art, de l'artiste) jusqu'au
      paiement complet de leur prix.
    </p>

    <h2>7. Livraison</h2>
    <p>
      Les articles sont expédiés en colis suivi, par un transporteur (Colissimo ou Chronopost), à l'adresse indiquée
      lors de la commande. Le numéro de suivi est communiqué dès l'expédition, depuis l'espace client. La commande est
      expédiée sous <mark class="todo">[À compléter : délai d'expédition après paiement et, le cas échéant,
        validation des pièces]</mark> ; à défaut de délai indiqué, la livraison intervient au plus tard 30 jours après
      la commande (article L216-1 du Code de la consommation).
    </p>
    <p>
      Les risques de perte ou d'endommagement sont transférés au client lorsqu'il prend physiquement possession des
      articles (article L216-4). En cas de colis abîmé, le client est invité à émettre des réserves auprès du
      transporteur et à nous prévenir sans tarder.
    </p>

    <h2>8. Droit de rétractation</h2>
    <p>
      Le client dispose de <strong>14 jours</strong> à compter de la réception de l'article pour se rétracter, sans
      avoir à se justifier (article L221-18). Pour une commande livrée en plusieurs colis, le délai court à partir de
      la réception du dernier. Il suffit de nous adresser, avant l'expiration de ce délai, une déclaration dénuée
      d'ambiguïté — par exemple au moyen du formulaire figurant en fin de page — à
      <LegalFact :value="id.email" label="adresse e-mail de contact" />.
    </p>
    <p>
      Le client renvoie l'article au plus tard 14 jours après nous avoir informés de sa décision, <strong>à ses
      frais</strong>, complet et dans son emballage d'origine. Sa responsabilité n'est engagée qu'à l'égard de la
      dépréciation résultant de manipulations autres que celles nécessaires pour établir la nature, les
      caractéristiques et le bon fonctionnement de l'article (article L221-23) — une arme ayant tiré, par exemple. Le
      retour d'une arme ou de munitions obéit aux règles de transport de l'article 12.
    </p>
    <p>
      Nous remboursons la totalité des sommes versées, frais de livraison initiaux compris (sur la base du mode de
      livraison standard), au plus tard 14 jours après avoir été informés de la rétractation, par le même moyen de
      paiement que celui utilisé pour la commande. Nous pouvons différer ce remboursement jusqu'à la récupération de
      l'article ou jusqu'à la preuve de son expédition (article L221-24).
    </p>
    <p>
      <strong>Exceptions.</strong> Le droit de rétractation ne s'applique pas aux biens confectionnés selon les
      spécifications du client ou nettement personnalisés (article L221-28, 3°).
      <mark class="todo">[À confirmer : le site vend-il des articles personnalisés (gravure, réglage à la demande,
        tirage sur mesure) ? Si non, cette exception peut être retirée.]</mark>
      Un tirage Gun Art numéroté issu d'une édition limitée n'est pas un bien personnalisé : il reste couvert par le
      droit de rétractation.
    </p>

    <h2>9. Garanties légales</h2>
    <p>
      Tous les articles bénéficient de la <strong>garantie légale de conformité</strong> (articles L217-3 et suivants
      du Code de la consommation) et de la <strong>garantie des vices cachés</strong> (articles 1641 à 1649 du Code
      civil), indépendamment de toute garantie commerciale.
    </p>
    <p>
      Au titre de la garantie de conformité, le client dispose de deux ans à compter de la délivrance de l'article pour
      obtenir sa mise en conformité (réparation ou remplacement) ou, à défaut, une réduction du prix ou la résolution
      du contrat. Durant ce délai, il n'a pas à prouver que le défaut existait au moment de la délivrance. Pour une arme
      de collection vendue d'occasion, ce délai de présomption est de
      <mark class="todo">[À confirmer : 12 mois pour un bien d'occasion (article L217-7)]</mark>.
    </p>
    <p>
      <mark class="todo">[À compléter par le juriste : l'encadré d'information sur les garanties légales dans les
        termes exacts fixés par le décret n° 2022-946 du 29 juin 2022.]</mark>
    </p>

    <h2>10. Responsabilité</h2>
    <p>
      SCS Firearm n'est pas responsable de l'inexécution d'une commande due au client, au fait imprévisible et
      insurmontable d'un tiers, ou à un cas de force majeure. Le client reste seul responsable de l'usage, de la
      détention et du transport des articles achetés, dans le respect de la réglementation en vigueur.
    </p>

    <h2>11. Données personnelles, litiges et droit applicable</h2>
    <p>
      Les données du client sont traitées conformément à notre
      <NuxtLink to="/confidentialite">politique de confidentialité</NuxtLink>.
    </p>
    <p>
      En cas de litige, le client est invité à nous contacter d'abord à
      <LegalFact :value="id.email" label="adresse e-mail de contact" />. À défaut d'accord, il peut recourir
      gratuitement au médiateur de la consommation dont nous relevons :
      <LegalFact :value="id.mediatorName" label="nom du médiateur de la consommation" /> —
      <LegalFact :value="id.mediatorUrl" label="site du médiateur" /> (articles L612-1 et suivants).
    </p>
    <p>
      Les présentes conditions sont soumises au droit français. Le client consommateur peut saisir, à son choix, la
      juridiction du lieu où il demeurait au moment de la conclusion du contrat ou de la survenance du fait
      dommageable.
    </p>

    <h2>12. Armes, éléments d'armes et munitions</h2>
    <p>
      Le commerce des armes est régi par le Code de la sécurité intérieure. Les règles ci-dessous s'ajoutent aux
      articles précédents ; notre <NuxtLink to="/reglementation">guide de la réglementation</NuxtLink> les explique
      plus en détail.
    </p>
    <ul>
      <li>
        <strong>Catégorie A</strong> : ces armes ne sont pas vendues sur le site.
      </li>
      <li>
        <strong>Catégories B et C</strong> : après la commande, le client dépose depuis son espace client les pièces
        demandées (pièce d'identité, autorisation préfectorale ou titre requis, identifiant SIA…). Elles sont vérifiées
        une à une, dans un délai visé de {{ LEGAL_DOC_REVIEW_SLA_HOURS }} heures. Une pièce refusée est
        motivée et peut être remplacée. La vente est enregistrée dans le Système d'information sur les armes (SIA).
      </li>
      <li>
        <strong>Catégorie D</strong> : l'acquisition et la détention sont libres pour un majeur, mais le port et le
        transport sont interdits sans motif légitime.
      </li>
      <li>Les munitions suivent la catégorie de l'arme à laquelle elles sont destinées.</li>
    </ul>
    <p>
      <strong>Refus de vente.</strong> SCS Firearm est tenu de refuser une vente lorsque les pièces fournies ne
      permettent pas d'établir que l'acheteur peut légalement acquérir l'article, ou lorsque la loi l'impose. Dans ce
      cas, la commande — ou la partie de la commande concernée — est annulée et les sommes correspondantes sont
      intégralement remboursées sous 14 jours.
      <mark class="todo">[À confirmer : délai laissé au client pour fournir ses pièces avant annulation.]</mark>
    </p>
    <p>
      <strong>Expédition.</strong> Une arme de catégorie B est expédiée en deux colis distincts : l'arme d'un côté, ses
      éléments essentiels de l'autre. <mark class="todo">[À confirmer : remise contre signature ?]</mark> Le retour d'un article réglementé, y
      compris au titre du droit de rétractation, se fait selon les mêmes modalités, après accord préalable avec SCS
      Firearm sur le mode d'envoi, afin que la vente puisse être annulée dans le SIA.
    </p>

    <h2>13. Tirages Gun Art</h2>
    <p>
      Les tirages de la galerie Gun Art sont vendus par SCS Firearm pour le compte de leur artiste.
      <mark class="todo">[À confirmer par le juriste : qualification exacte de ce mandat de vente et mention qu'elle
        impose.]</mark>
      Chaque tirage appartient à une édition limitée : son numéro dans l'édition et son format figurent sur la fiche.
      Lorsque la fiche l'indique, un certificat d'authenticité signé l'accompagne.
    </p>
    <p>
      L'achat d'un tirage transfère la propriété de l'objet, pas les droits d'auteur de l'œuvre : le client ne peut ni
      la reproduire ni l'exploiter sans l'autorisation écrite de l'artiste.
    </p>

    <template #after>
      <section class="withdrawal" aria-labelledby="withdrawal-h">
        <h2 id="withdrawal-h">Formulaire de rétractation</h2>
        <p class="withdrawal__intro">
          À compléter et renvoyer uniquement si vous souhaitez vous rétracter de votre commande (modèle prévu à l'annexe
          de l'article R221-1 du Code de la consommation).
        </p>
        <div class="withdrawal__form">
          <p>
            À l'attention de <LegalFact :value="id.companyName" label="raison sociale" />,
            <LegalFact :value="id.address" label="adresse postale" />,
            <LegalFact :value="id.email" label="adresse e-mail de contact" /> :
          </p>
          <p>
            Je vous notifie par la présente ma rétractation du contrat portant sur la vente du bien ci-dessous :
          </p>
          <p>Commandé le : …………… / reçu le : ……………</p>
          <p>Numéro de commande : ……………</p>
          <p>Nom du client : ……………</p>
          <p>Adresse du client : ……………</p>
          <p>Signature du client (uniquement en cas de notification sur papier) : ……………</p>
          <p>Date : ……………</p>
        </div>
      </section>
    </template>
  </LegalPage>
</template>

<style scoped>
.withdrawal {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid var(--ink-line);
}
.withdrawal h2 {
  font-size: var(--fs-lg);
  margin: 0 0 0.75rem;
}
.withdrawal__intro {
  color: var(--paper-dim);
  font-size: var(--fs-sm);
  margin: 0 0 1.25rem;
}
.withdrawal__form {
  padding: 1.25rem 1.4rem;
  background: var(--ink-soft);
  border: 1px solid var(--ink-line);
  border-radius: var(--radius);
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
}
.withdrawal__form p {
  margin: 0 0 0.6rem;
}
.withdrawal__form p:last-child {
  margin-bottom: 0;
}
</style>
