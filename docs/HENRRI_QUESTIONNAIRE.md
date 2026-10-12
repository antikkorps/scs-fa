# Facturation Henrri — questions pour le client et son comptable

> **Réponses du client (2026-10-12)** : toutes les recommandations sont
> retenues, sauf Gun Art (point 6) où le choix est **la facture de SCS
> Firearms pour le prix total, l'artiste facturant ensuite sa part à SCS
> Firearms**. L'e-reporting passe **par Henrri**. Les décisions sont
> reportées dans le BACKLOG (story 12.6).

> Story 12.6. Chaque commande payée sur le site doit devenir une facture dans
> Henrri, sans ressaisie. Avant d'écrire la moindre ligne de code, neuf points
> doivent être tranchés. Pour chacun : la question, notre recommandation, et
> ce qu'elle implique. Il suffit de répondre « d'accord » ou de corriger.
>
> Le texte évite volontairement les tableaux : il peut être copié tel quel
> dans un e-mail.

## 1. À quel moment la facture est-elle créée ?

Une commande « mixte » se règle en deux fois : la carte bancaire pour les
articles en vente libre, le virement pour les armes réglementées (après
contrôle des pièces).

Recommandation : **une seule facture, quand la commande est entièrement
payée.**

- Plus simple à lire pour l'acheteur et à rapprocher pour le comptable.
- Moins coûteux : Henrri facture 8 crédits par facture finalisée.
- Question au comptable : pour un acheteur professionnel, un paiement reçu
  avant la livraison impose-t-il une facture d'acompte ? Si oui, il faudra
  une facture par paiement pour ces clients-là.

## 2. Qui numérote les factures ?

Recommandation : **Henrri, et lui seul.** Deux séries de numéros en parallèle
seraient une anomalie comptable. Le site garde sa référence de commande et
enregistre le numéro de facture Henrri à côté, affiché dans l'administration.

## 3. Que contient la facture ?

Recommandation : **les lignes de la commande** (désignation, référence,
quantité, prix HT, taux de TVA), **plus une ligne « frais de port ».** Les
montants sont ceux figés sur la commande au moment de l'achat.

Pas de synchronisation du catalogue vers Henrri : plusieurs milliers
d'articles à maintenir pour aucun bénéfice, puisque chaque ligne de facture
porte déjà sa désignation et son prix.

## 4. Les acheteurs sont-ils créés comme clients dans Henrri ?

Recommandation : **oui** (nom, adresse de facturation, e-mail). Une facture
doit de toute façon porter l'identité et l'adresse de l'acheteur, et Henrri
regroupe ainsi l'historique de chaque client.

Conséquence : Henrri devient **sous-traitant au sens du RGPD**. Nous
l'ajouterons à la politique de confidentialité et au registre des
traitements.

## 5. Les remboursements deviennent-ils des avoirs ?

Recommandation : **oui, automatiquement**, pour un remboursement total ou
partiel, dès qu'il est validé dans l'administration du site.

- Question à vérifier chez Henrri : un avoir consomme-t-il des crédits,
  comme une facture ?

## 6. Gun Art : comment facturer une vente pour le compte de l'artiste ?

Les CGV (article 13) précisent que les tirages Gun Art sont vendus par
SCS Firearms **pour le compte de l'artiste**. Plusieurs traitements sont
possibles et le choix appartient au comptable :

- facture au nom de l'artiste, émise par SCS Firearms comme mandataire, avec
  la mention correspondante ;
- facture de SCS Firearms pour le prix total, l'artiste facturant ensuite sa
  part à SCS Firearms ;
- facture de SCS Firearms limitée à sa commission.

Recommandation : **aucune de notre côté, à trancher par le comptable**,
y compris le régime de TVA applicable aux tirages d'art. Le site saura
produire n'importe laquelle des trois une fois le choix fait.

## 7. Qui envoie la facture à l'acheteur ?

- Option A : Henrri l'envoie par son propre e-mail.
- Option B : le site la met à disposition dans « Mes commandes » et ajoute
  un lien dans un e-mail SCS Firearms.

Recommandation : **option B**, si l'API Henrri permet de récupérer le PDF
(à vérifier dans sa documentation). L'acheteur reçoit des e-mails d'un seul
expéditeur, à l'image de la boutique, et retrouve toutes ses factures au même
endroit. À défaut, option A.

## 8. Quel pack Henrri ?

Les packs vont de 0 € (25 factures par mois) à 30 € (500 factures par mois),
en passant par 10 € (125) et 20 € (250).

Recommandation : **commencer par le pack gratuit**, et monter de palier si
le volume le demande. Un manque de crédits ne bloque jamais une vente : la
facture est simplement mise en attente et repart automatiquement, et le
tableau de bord signale les factures en souffrance.

- Question au client : combien de commandes par mois attendez-vous, au
  démarrage puis en rythme de croisière ?

## 9. Et les commandes passées avant la mise en service ?

Recommandation : **mettre la facturation Henrri en service avant
l'ouverture de la boutique**, pour qu'il n'y ait rien à rattraper. Si des
commandes devaient être passées avant, un rattrapage ponctuel est possible
sur demande.

## Une question en plus pour le comptable : l'e-reporting

Les ventes aux particuliers ne sont pas des factures électroniques, mais
elles relèvent de l'e-reporting (transmission des données de vente à
l'administration). Henrri annonce l'émission des factures électroniques
pour septembre 2027. Le comptable confirme-t-il que l'e-reporting des ventes
du site passera par Henrri, ou par un autre canal ?

## Ce dont nous avons besoin pour démarrer

- Un accès au **bac à sable** Henrri : `clientId` et `clientSecret`, créés
  dans le compte Henrri (avatar, puis « API & Intégrations »). Le bac à sable
  est gratuit et illimité : tout le développement s'y fait.
- Le lien vers la **documentation de l'API**, visible uniquement depuis le
  compte Henrri.
- Les réponses aux points ci-dessus.
- Plus tard : les identifiants de **production** et le choix du pack.
