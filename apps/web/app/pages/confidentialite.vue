<script setup lang="ts">
import { EDITORIAL_PAGES } from "#shared/utils/editorialPages"

/**
 * Privacy policy (story 9.6). Written from what the code actually does
 * (personal-data inventory of 2026-09-24); what only the client knows — legal
 * identity, contact, retention periods not yet decided — is marked
 * <mark class="todo"> and must be supplied before go-live.
 *
 * ⚠️ Validation is tracked in shared/utils/editorialPages.ts: until the flag is
 * flipped there, the page shows a draft notice, is noindex and is not in the sitemap.
 */
const REVIEWED = EDITORIAL_PAGES.confidentialite.reviewed
const UPDATED_ON = "24 septembre 2026"

usePageSeo({
  title: "Politique de confidentialité",
  description:
    "Quelles données SCS Firearm collecte, pourquoi, combien de temps elles sont conservées, avec qui elles sont partagées et comment exercer vos droits.",
  path: "/confidentialite",
  noindex: !REVIEWED,
})
</script>

<template>
  <article class="container legal">
    <AppBreadcrumbs :items="[{ name: 'Accueil', to: '/' }, { name: 'Confidentialité' }]" />
    <p class="eyebrow">Informations légales</p>
    <h1 class="legal__title">Politique de confidentialité</h1>
    <p class="legal__updated">Dernière mise à jour : {{ UPDATED_ON }}</p>

    <DraftNotice v-if="!REVIEWED" what="Cette politique" />

    <div class="prose">
      <p>
        Cette page explique quelles données personnelles SCS Firearm traite lorsque vous visitez le site, créez un
        compte, passez commande ou vous abonnez à nos envois, pourquoi, pendant combien de temps, et comment exercer vos
        droits. Elle s'applique aux deux univers du site : l'armurerie et la galerie Gun Art.
      </p>

      <h2>Responsable du traitement</h2>
      <p>
        <mark class="todo">[À compléter : raison sociale, forme juridique, capital]</mark>, immatriculée sous le numéro
        <mark class="todo">[SIRET]</mark>, dont le siège est situé
        <mark class="todo">[adresse postale]</mark>. Pour toute question relative à vos données :
        <mark class="todo">[adresse e-mail dédiée]</mark>.
      </p>

      <h2>Données traitées et finalités</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Pourquoi</th>
              <th scope="col">Quelles données</th>
              <th scope="col">Base légale</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Gérer votre compte client</td>
              <td>Nom, prénom, e-mail, téléphone, mot de passe (stocké haché, jamais en clair), adresses</td>
              <td>Exécution du contrat</td>
            </tr>
            <tr>
              <td>Traiter vos commandes, les expédier et les facturer</td>
              <td>
                Articles commandés, adresses de livraison et de facturation, montant, mode de paiement, numéro de suivi
                du colis
              </td>
              <td>Exécution du contrat ; obligations comptables</td>
            </tr>
            <tr>
              <td>Encaisser vos paiements</td>
              <td>
                Carte bancaire : saisie chez notre prestataire de paiement, nous ne conservons que la marque et les
                quatre derniers chiffres. Virement : l'IBAN émetteur et la référence, pour rapprocher le paiement
              </td>
              <td>Exécution du contrat</td>
            </tr>
            <tr>
              <td>Vérifier que vous pouvez légalement acquérir une arme soumise à autorisation ou à déclaration</td>
              <td>
                Pièces justificatives que vous déposez (pièce d'identité, permis de chasser, licence de tir,
                autorisation préfectorale, numéro SIA, certificat d'expertise), leur numéro et leurs dates de validité,
                le résultat de notre vérification
              </td>
              <td>Obligation légale (Code de la sécurité intérieure)</td>
            </tr>
            <tr>
              <td>Vous adresser nos nouveautés, si vous le demandez</td>
              <td>
                E-mail, thèmes choisis, preuve de votre consentement (date, adresse IP et navigateur au moment de
                l'inscription et de la confirmation)
              </td>
              <td>Consentement, retirable à tout moment</td>
            </tr>
            <tr>
              <td>Sécuriser le site et garder la trace des opérations sensibles</td>
              <td>
                Adresse IP, navigateur, actions effectuées (connexion, modification d'une commande, validation d'un
                document…)
              </td>
              <td>Intérêt légitime : sécurité du site et preuve des opérations</td>
            </tr>
            <tr>
              <td>Mesurer l'audience du site, si vous l'acceptez</td>
              <td>
                Pages vues, site de provenance, type d'appareil et de navigateur, pays et ville déduits de l'adresse IP
              </td>
              <td>Consentement, demandé par le bandeau et modifiable à tout moment</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Les pièces justificatives sont analysées par un antivirus dès leur dépôt, stockées chiffrées, et ne sont
        accessibles qu'aux personnes chargées de la vérification, par des liens valables quelques minutes.
      </p>

      <h2>Mesure d'audience</h2>
      <p>
        Avec votre accord seulement, nous mesurons la fréquentation du site avec
        <a href="https://umami.is" rel="noopener" target="_blank">Umami</a>, un outil libre que nous hébergeons nous-mêmes.
        Il ne dépose aucun cookie, ne vous suit pas d'un site à l'autre, et ses statistiques ne sont ni revendues ni
        croisées avec d'autres données. Tant que vous n'avez pas répondu au bandeau, ou si vous refusez, rien n'est
        mesuré. Vous pouvez changer d'avis à tout moment depuis le lien « Gestion des cookies » en bas de chaque page.
      </p>

      <h2>Cookies et stockage local</h2>
      <p>Le site n'utilise aucun cookie publicitaire. Il dépose uniquement :</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Rôle</th>
              <th scope="col">Durée</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>scs_token</code>, <code>scs_refresh</code></td>
              <td>Vous garder connecté ; inaccessibles aux scripts de la page</td>
              <td>7 jours</td>
            </tr>
            <tr>
              <td><code>scs_user</code></td>
              <td>Afficher votre prénom et votre espace une fois connecté</td>
              <td>7 jours</td>
            </tr>
            <tr>
              <td><code>scs_consent</code></td>
              <td>Retenir votre choix sur la mesure d'audience</td>
              <td>6 mois</td>
            </tr>
            <tr>
              <td>Cookies de notre prestataire de paiement</td>
              <td>Sécuriser le paiement par carte et prévenir la fraude, sur la page de paiement uniquement</td>
              <td>Fixée par le prestataire</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Ces cookies sont indispensables au fonctionnement du site et ne nécessitent pas votre consentement. Si vous
        refusez la mesure d'audience, le navigateur garde aussi l'indication <code>umami.disabled</code>, qui empêche
        toute mesure.
      </p>

      <h2>Destinataires et sous-traitants</h2>
      <p>
        Vos données sont traitées par l'équipe de SCS Firearm. Nous ne les vendons pas. Nous faisons appel aux
        prestataires suivants, qui n'agissent que sur nos instructions :
      </p>
      <ul>
        <li><strong>Hetzner</strong> — hébergement du site et de la base de données (Allemagne) ;</li>
        <li>
          <strong>Cloudflare</strong> — acheminement et protection du site contre les attaques ; voit passer votre
          adresse IP ;
        </li>
        <li><strong>Scaleway</strong> — stockage des fichiers et des sauvegardes (France) ;</li>
        <li><strong>Stripe</strong> — paiement par carte bancaire ;</li>
        <li><strong>Brevo</strong> — envoi de la lettre d'information, si vous y êtes abonné ;</li>
        <li>
          <mark class="todo">[À compléter : prestataire d'envoi des e-mails de service (confirmation, réinitialisation
            du mot de passe, suivi de commande)]</mark> ;
        </li>
        <li><strong>La Poste (Colissimo) et Mondial Relay</strong> — livraison de vos colis : nom et adresse de livraison.</li>
      </ul>
      <p>
        Certains de ces prestataires peuvent traiter des données hors de l'Union européenne. Ces transferts sont alors
        encadrés par les garanties prévues par le RGPD (décision d'adéquation ou clauses contractuelles types de la
        Commission européenne). <mark class="todo">[À vérifier pour chaque prestataire lors de la signature des
          contrats]</mark>
      </p>
      <p>
        Les autorités administratives et judiciaires peuvent obtenir communication des informations relatives aux
        ventes d'armes dans les cas prévus par la loi.
      </p>

      <h2>Durées de conservation</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Données</th>
              <th scope="col">Durée</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Compte client</td>
              <td><mark class="todo">[À compléter : par exemple 3 ans après votre dernière activité]</mark></td>
            </tr>
            <tr>
              <td>Pièces justificatives réglementaires</td>
              <td><mark class="todo">[À compléter selon les obligations de l'armurier]</mark></td>
            </tr>
            <tr>
              <td>Commandes et factures</td>
              <td>10 ans, au titre des obligations comptables (article L123-22 du Code de commerce)</td>
            </tr>
            <tr>
              <td>Journal des opérations sensibles</td>
              <td><mark class="todo">[À compléter]</mark></td>
            </tr>
            <tr>
              <td>Abonnement à la lettre d'information</td>
              <td>
                Jusqu'à votre désinscription. Votre adresse est alors effacée ; seules une empreinte non réversible et
                les dates de votre consentement sont conservées, pour pouvoir prouver qu'il a existé
              </td>
            </tr>
            <tr>
              <td>Inscription à la lettre non confirmée</td>
              <td>Le lien de confirmation expire au bout de 72 heures ; rien ne vous est envoyé sans confirmation</td>
            </tr>
            <tr>
              <td>Statistiques de fréquentation</td>
              <td><mark class="todo">[À compléter : par exemple 25 mois]</mark></td>
            </tr>
            <tr>
              <td>Sauvegardes</td>
              <td>Les 14 dernières sauvegardes quotidiennes, les plus anciennes étant supprimées au fur et à mesure</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Vos droits</h2>
      <p>
        Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation et d'opposition au traitement de
        vos données, d'un droit à leur portabilité, et du droit de définir des directives relatives à leur sort après
        votre décès. Vous pouvez retirer à tout moment un consentement donné, sans que cela remette en cause les
        traitements déjà effectués.
      </p>
      <ul>
        <li>Vos informations de profil et vos adresses se modifient directement depuis <NuxtLink to="/compte">votre compte</NuxtLink> ;</li>
        <li>la lettre d'information se quitte en un clic, depuis le lien présent dans chaque envoi ;</li>
        <li>
          pour tout le reste — obtenir une copie de vos données, supprimer votre compte — écrivez-nous à
          <mark class="todo">[adresse e-mail dédiée]</mark>. Nous répondons dans un délai d'un mois.
        </li>
      </ul>
      <p>
        Certaines données ne peuvent pas être effacées tant qu'une obligation légale impose de les conserver (factures,
        justificatifs d'une vente d'arme). Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une
        réclamation à la <a href="https://www.cnil.fr/fr/plaintes" rel="noopener" target="_blank">CNIL</a>.
      </p>

      <h2>Sécurité</h2>
      <p>
        Le site est servi exclusivement en HTTPS. Les mots de passe sont stockés sous forme hachée, les sessions sont
        portées par des cookies inaccessibles aux scripts, les fichiers déposés sont chiffrés au repos, et l'accès aux
        données est réservé aux personnes qui en ont besoin.
      </p>
    </div>
  </article>
</template>

<style scoped>
.legal {
  padding-top: clamp(2.5rem, 7vw, 5rem);
  padding-bottom: clamp(2rem, 6vw, 4rem);
  max-width: 840px;
}
.legal__title {
  font-size: var(--fs-3xl);
  margin: 0.6rem 0 0.5rem;
}
.legal__updated {
  color: var(--paper-faint);
  font-size: var(--fs-sm);
  margin: 0 0 2rem;
}
</style>
