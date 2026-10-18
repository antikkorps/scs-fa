# Registre des activités de traitement — SCS Firearms

> Registre tenu au titre de l'**article 30 du RGPD**, sur le modèle de la CNIL.
> Il décrit les traitements réalisés par le site SCS Firearms (armurerie et
> galerie Gun Art) et son back-office. Rédigé à partir du code au 2026-10-19 ;
> les mentions **[À compléter]** dépendent du client et de ses contrats.
>
> Le registre est un document interne, à présenter à la CNIL sur demande. La
> page publique `/confidentialite` en est la version destinée aux personnes
> concernées : les deux doivent rester cohérentes. À mettre à jour à chaque
> nouveau traitement, nouveau prestataire ou nouvelle durée.

## Responsable du traitement

| | |
|---|---|
| Organisme | [À compléter : raison sociale, forme juridique, SIRET] |
| Adresse | [À compléter] |
| Représentant légal | [À compléter] |
| Contact pour les données personnelles | [À compléter : adresse e-mail dédiée, la même que sur `/confidentialite`] |
| Délégué à la protection des données | Aucun désigné (non obligatoire pour cette activité) [À confirmer] |

## Sous-traitants

| Prestataire | Rôle | Données concernées | Localisation |
|---|---|---|---|
| Hetzner | Hébergement du site et de la base de données | Toutes les données du site | Allemagne (UE) |
| Cloudflare | Acheminement et protection du site (DNS, anti-attaques) | Adresse IP, requêtes ; cookie technique `__cf_bm` (30 minutes) quand la protection anti-robots est active | Mondial — transferts encadrés [À vérifier : clauses contractuelles types] |
| Scaleway | Stockage des fichiers (pièces justificatives chiffrées, images) et des sauvegardes | Pièces justificatives, sauvegardes de la base | France (UE) |
| Stripe | Paiement par carte bancaire | Données de carte (saisies chez Stripe), montant, e-mail | UE et États-Unis — transferts encadrés [À vérifier] |
| Henrri (groupe Rivalis) | Établissement et conservation des factures et avoirs | Nom, adresse de facturation, détail et règlement de la commande (pas l'e-mail) | France (UE) [À vérifier] |
| Brevo | Envoi des e-mails de service et de la lettre d'information ; rapports de remise | E-mail, contenu des e-mails, contacts abonnés confirmés | UE [À vérifier : lieu d'hébergement dans le contrat] |
| La Poste (Colissimo), Mondial Relay | Livraison des colis | Nom, adresse de livraison, numéro de suivi | France (UE) |

Pour chaque prestataire : contrat ou conditions de sous-traitance (article 28)
signés au nom du client **[À compléter : date et référence de chaque contrat]**.

## Traitements

### 1. Gestion des comptes

| | |
|---|---|
| Finalité | Créer et gérer les comptes clients ; comptes du personnel (administrateurs) |
| Base légale | Exécution du contrat (clients) ; intérêt légitime (personnel) |
| Personnes concernées | Clients, administrateurs |
| Données | Nom, prénom, e-mail, téléphone, mot de passe haché (Argon2id, jamais en clair), adresses, rôle, date et version du consentement à la politique de confidentialité |
| Destinataires | Personnel habilité de SCS Firearms ; Hetzner |
| Durée | [À compléter : par exemple 3 ans après la dernière activité du client] |

### 2. Commandes, livraison et facturation

| | |
|---|---|
| Finalité | Traiter les commandes, les expédier, les facturer, gérer retours et remboursements |
| Base légale | Exécution du contrat ; obligation légale (comptabilité) |
| Personnes concernées | Clients |
| Données | Articles commandés, montants, adresses de livraison et de facturation, version des CGV acceptée, colis et numéros de suivi, remboursements |
| Destinataires | Personnel habilité ; Henrri (factures, avoirs) ; La Poste, Mondial Relay ; Brevo (e-mails de confirmation, d'expédition, de facture) |
| Durée | 10 ans (article L123-22 du Code de commerce) |

### 3. Encaissement des paiements

| | |
|---|---|
| Finalité | Encaisser par carte ou par virement, rapprocher les virements, rembourser |
| Base légale | Exécution du contrat |
| Personnes concernées | Clients |
| Données | Carte : saisie chez Stripe, le site ne garde que la marque et les 4 derniers chiffres. Virement : IBAN émetteur déclaré, référence, montant et date de réception |
| Destinataires | Personnel habilité ; Stripe |
| Durée | 10 ans, avec la commande |

### 4. Vérification réglementaire des acheteurs d'armes

| | |
|---|---|
| Finalité | Vérifier qu'un client peut légalement acquérir une arme soumise à autorisation ou à déclaration |
| Base légale | Obligation légale (Code de la sécurité intérieure) |
| Personnes concernées | Clients achetant une arme réglementée |
| Données | Pièces justificatives déposées (pièce d'identité, permis de chasser, licence de tir, autorisation préfectorale, numéro SIA, certificat d'expertise), numéros et dates de validité, résultat et motif de la vérification, administrateur qui a vérifié |
| Destinataires | Personnel chargé de la vérification ; Scaleway (stockage chiffré) ; autorités administratives et judiciaires dans les cas prévus par la loi |
| Durée | [À compléter selon les obligations de l'armurier] |
| Mesures particulières | Analyse antivirus au dépôt ; stockage chiffré au repos ; accès par liens signés valables quelques minutes, réservés aux administrateurs |

### 5. Lettre d'information

| | |
|---|---|
| Finalité | Envoyer les nouveautés aux personnes qui l'ont demandé |
| Base légale | Consentement (double confirmation), retirable à tout moment |
| Personnes concernées | Abonnés |
| Données | E-mail, thèmes choisis, preuve du consentement (date, adresse IP et navigateur à l'inscription et à la confirmation) |
| Destinataires | Brevo (uniquement les contacts dont l'inscription est confirmée) |
| Durée | Jusqu'à la désinscription ; l'adresse est alors effacée, seules une empreinte non réversible et les dates du consentement sont gardées comme preuve. Inscription non confirmée : lien valable 72 heures |

### 6. E-mails de service et suivi de leur remise

| | |
|---|---|
| Finalité | Envoyer les e-mails liés au compte et aux commandes, et pouvoir répondre « l'e-mail est-il bien parti, et arrivé ? » |
| Base légale | Exécution du contrat ; intérêt légitime (preuve et assistance) |
| Personnes concernées | Clients, abonnés en cours d'inscription |
| Données | Adresse du destinataire, type d'e-mail, identifiant SMTP du message, issue (envoyé, refusé, remis, rejeté, signalé comme spam) |
| Destinataires | Brevo ; personnel habilité (onglet « Historique » des commandes) |
| Durée | Avec l'historique de la commande (10 ans) ; 1 an pour les e-mails sans commande |

### 7. Journal des opérations sensibles

| | |
|---|---|
| Finalité | Garder la trace des opérations sur les commandes, les paiements, les documents et les comptes, pour la sécurité, la preuve et l'assistance aux clients |
| Base légale | Intérêt légitime : sécurité du site et preuve des opérations |
| Personnes concernées | Clients, administrateurs |
| Données | Nature de l'opération, date, auteur (client, administrateur ou système), commande concernée, issue et code d'erreur court, identifiant de requête. Adresse IP et navigateur **seulement** pour les opérations hors commande (connexions, sécurité) |
| Destinataires | Administrateurs (onglet « Historique ») |
| Durée | Historique d'une commande : 10 ans à compter de la date de la commande, sans adresse IP ni navigateur. Tout le reste (connexions, sécurité, e-mails hors commande, actions des administrateurs hors commande) : 1 an. Purge automatique quotidienne |
| Minimisation | Jamais de contenu de document, de donnée bancaire, de mot de passe ou de jeton ; codes d'erreur courts, jamais de texte libre |

### 8. Journaux techniques et erreurs du navigateur

| | |
|---|---|
| Finalité | Diagnostiquer les pannes du site, y compris les erreurs survenues dans le navigateur du client sur le panier, la commande et le paiement |
| Base légale | Intérêt légitime : bon fonctionnement et sécurité du site |
| Personnes concernées | Visiteurs, clients |
| Données | Adresse IP, navigateur, page, identifiant de requête, message et pile d'erreur (adresses e-mail et suites de chiffres masquées ; jamais de valeur saisie dans un formulaire) |
| Destinataires | Le prestataire technique du site (accès au serveur) |
| Durée | 14 jours (journald du serveur), puis suppression automatique |

### 9. Mesure d'audience

| | |
|---|---|
| Finalité | Mesurer la fréquentation du site |
| Base légale | Consentement, recueilli par le bandeau et modifiable à tout moment |
| Personnes concernées | Visiteurs ayant accepté |
| Données | Pages vues, site de provenance, type d'appareil et de navigateur, pays et ville déduits de l'adresse IP ; aucun cookie |
| Destinataires | Aucun : Umami est hébergé sur le serveur du site |
| Durée | 25 mois, puis suppression automatique (tâche quotidienne du conteneur `backup`, `infra/backup/umami-purge.sh`) |

### 10. Partenaires : artistes, bénéficiaires, fournisseurs

| | |
|---|---|
| Finalité | Gérer les artistes et bénéficiaires Gun Art (présentation, parts à reverser) et les fournisseurs du catalogue |
| Base légale | Exécution du contrat ; intérêt légitime |
| Personnes concernées | Artistes, bénéficiaires, contacts chez les fournisseurs |
| Données | Nom, e-mail et téléphone de contact, notes de paiement, parts dues ; biographie publique des artistes |
| Destinataires | Personnel habilité ; biographies publiées sur le site |
| Durée | [À compléter : durée de la relation, puis 10 ans pour les pièces comptables des reversements] |

### 11. Sauvegardes

| | |
|---|---|
| Finalité | Pouvoir restaurer le site en cas d'incident |
| Base légale | Intérêt légitime : continuité du service |
| Données | Copie complète de la base de données |
| Destinataires | Scaleway (stockage) |
| Durée | Les 14 dernières sauvegardes quotidiennes, les plus anciennes supprimées au fur et à mesure |

## Mesures de sécurité communes

- Site servi exclusivement en HTTPS ; serveur limité à SSH, HTTP et HTTPS.
- Mots de passe hachés (Argon2id) ; sessions portées par des cookies inaccessibles aux scripts ; jetons de session jamais exposés au navigateur.
- Fichiers déposés chiffrés au repos ; pièces justificatives analysées par un antivirus.
- Accès au back-office réservé aux administrateurs ; actions sensibles tracées (traitement 7).
- Secrets (clés Stripe, Henrri, Brevo) hors du code, dans la configuration du serveur ; jamais écrits dans les journaux.
- Sauvegardes quotidiennes ; une restauration complète est à tester avant la mise en production (checklist de `docs/DEPLOY.md`).

## Historique du registre

| Date | Modification |
|---|---|
| 2026-10-19 | Création, à partir du site et de la politique de confidentialité (story 12.7e) |
| 2026-10-19 | Mesure d'audience : conservation fixée à 25 mois, purge automatique ; cookie `__cf_bm` de Cloudflare déclaré |
