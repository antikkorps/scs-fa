<script setup lang="ts">
import { LEGAL_IDENTITY, SITE_HOST } from "@armurier/shared"
import { EDITORIAL_PAGES } from "#shared/utils/editorialPages"

/**
 * Legal notice (story 12.1) — what the LCEN (loi n° 2004-575, art. 6 III)
 * requires a commercial site to state. The seller's identity comes from
 * shared/utils/legalIdentity.ts; what is still missing shows highlighted.
 *
 * ⚠️ Drafted in the codebase, to be read by the client and a lawyer: until the
 * flag is flipped in shared/utils/editorialPages.ts the page shows a draft
 * notice, is noindex and is not in the sitemap.
 */
const REVIEWED = EDITORIAL_PAGES.mentionsLegales.reviewed
const UPDATED_ON = "29 septembre 2026"

usePageSeo({
  title: "Mentions légales",
  description:
    "Éditeur, directeur de la publication, hébergeur et propriété intellectuelle du site SCS Firearm, armurerie et galerie Gun Art.",
  path: "/mentions-legales",
  noindex: !REVIEWED,
})

const id = LEGAL_IDENTITY
</script>

<template>
  <LegalPage
    crumb="Mentions légales"
    eyebrow="Informations légales"
    title="Mentions légales"
    :updated-on="UPDATED_ON"
    draft-subject="Cette page"
    :reviewed="REVIEWED"
  >
    <h2>Éditeur du site</h2>
    <p>
      Le site SCS Firearm est édité par <LegalFact :value="id.companyName" label="raison sociale" />,
      <LegalFact :value="id.legalForm" label="forme juridique" /> au capital de
      <LegalFact :value="id.shareCapital" label="capital" />.
    </p>
    <ul>
      <li>Siège social : <LegalFact :value="id.address" label="adresse postale" /></li>
      <li>Immatriculation : <LegalFact :value="id.registration" label="RCS ville et numéro" /></li>
      <li>SIRET : <LegalFact :value="id.siret" label="SIRET" /></li>
      <li>TVA intracommunautaire : <LegalFact :value="id.vatNumber" label="numéro de TVA" /></li>
      <li>Téléphone : <LegalFact :value="id.phone" label="téléphone" /></li>
      <li>E-mail : <LegalFact :value="id.email" label="adresse e-mail de contact" /></li>
    </ul>

    <h2>Activité réglementée</h2>
    <p>
      Le commerce des armes, de leurs éléments et de leurs munitions est une activité réglementée par le Code de la
      sécurité intérieure. SCS Firearm l'exerce sous couvert de l'autorisation
      <LegalFact :value="id.firearmsTradeAuthorisation" label="référence et préfecture de l'autorisation" />. Les
      conditions propres à l'achat d'un article réglementé sont détaillées dans nos
      <NuxtLink to="/cgv">conditions générales de vente</NuxtLink> et dans notre
      <NuxtLink to="/reglementation">guide de la réglementation</NuxtLink>.
    </p>

    <h2>Directeur de la publication</h2>
    <p><LegalFact :value="id.publicationDirector" label="nom du directeur de la publication" /></p>

    <h2>Hébergement</h2>
    <p>
      Le site est hébergé par {{ SITE_HOST.name }}, {{ SITE_HOST.address }} — téléphone {{ SITE_HOST.phone }} —
      <a :href="SITE_HOST.url" rel="noopener" target="_blank">{{ SITE_HOST.url.replace("https://", "") }}</a>.
    </p>

    <h2>Propriété intellectuelle</h2>
    <p>
      La structure du site, ses textes, sa charte graphique et ses logos sont la propriété de SCS Firearm. Les œuvres de
      la galerie Gun Art et leurs reproductions sont protégées par le droit d'auteur et appartiennent à
      <NuxtLink to="/collection/artiste">leur artiste</NuxtLink>. Toute reproduction ou diffusion, totale ou
      partielle, sans autorisation écrite préalable est interdite (articles L122-4 et L335-2 du Code de la propriété
      intellectuelle).
    </p>
    <p>
      L'achat d'un tirage transfère la propriété de l'objet, pas les droits d'exploitation de l'œuvre : il n'autorise
      pas sa reproduction.
    </p>

    <h2>Données personnelles et cookies</h2>
    <p>
      Le traitement de vos données et l'usage des cookies sont décrits dans notre
      <NuxtLink to="/confidentialite">politique de confidentialité</NuxtLink>. Vous pouvez revenir à tout moment sur
      vos choix depuis le lien « Gestion des cookies » en bas de chaque page.
    </p>

    <h2>Nous contacter</h2>
    <p>
      Pour toute question sur le site : <LegalFact :value="id.email" label="adresse e-mail de contact" />.
    </p>
  </LegalPage>
</template>
