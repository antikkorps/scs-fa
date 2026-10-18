# Que regarder quand on me remonte un problème

> Pour **Fred et Stéphane** (administrateurs) : la première partie se fait
> entièrement depuis le back-office. La seconde est pour **Franck**, quand il
> faut descendre dans les journaux techniques du serveur. Story 12.7.

## 1. Depuis le back-office : l'onglet « Historique »

Ouvrir **Commandes**, retrouver la commande (par sa référence, ex. `0B7D1F3E`,
ou par le client), puis l'onglet **Historique**. Il raconte la commande dans
l'ordre : ce qui s'est passé, quand, qui l'a fait (le client, un admin, ou
« Automatique » quand c'est le site, Stripe ou Henrri). Une ligne marquée
**Échec** en rouge dit aussi pourquoi.

### « Je n'ai pas reçu l'e-mail »

Chercher la ligne **E-mail de … envoyé à …** :

| Ce qu'on voit | Ce que ça veut dire | Que faire |
|---|---|---|
| **envoyé à** une adresse avec une faute | Le client s'est trompé d'adresse | Corriger l'adresse du compte avec lui |
| **envoyé**, puis **remis à la boîte de …** | L'e-mail est arrivé chez son fournisseur de messagerie | Lui demander de regarder ses indésirables / « Promotions » |
| **refusé par la boîte de …** | Adresse inexistante ou boîte fermée | Lui demander une autre adresse |
| **bloqué par Brevo** | Brevo n'écrit plus à cette adresse (anciens rejets ou signalement spam) | Le signaler à Franck, qui peut la débloquer chez Brevo |
| **signalé comme spam** | Le client a lui-même classé un de nos e-mails en spam | Lui demander de le retirer des spams |
| **non envoyé** | Le site n'a pas réussi à le confier au serveur d'envoi | Le signaler à Franck avec la référence de commande |
| Aucune ligne d'e-mail | L'e-mail n'est jamais parti (ou la commande date d'avant la story 12.7) | Le signaler à Franck |

Les e-mails sans commande (mot de passe oublié, document validé ou refusé,
newsletter) n'apparaissent pas dans une commande : demander à Franck.

### « Mon paiement est resté bloqué »

- **Paiement par carte lancé** sans **reçu** ensuite : le client n'est pas allé
  au bout, ou Stripe ne nous a pas encore répondu. Après quelques minutes sans
  rien, prévenir Franck.
- **Paiement par carte refusé** : la raison suit (fonds insuffisants, carte
  expirée…). C'est à la banque du client de voir ; il peut réessayer avec une
  autre carte.
- **Paiement par carte : montant insuffisant** : Stripe a encaissé moins que le
  total. Le site n'a pas validé la commande. Prévenir Franck.
- **Virement déclaré par le client** sans **Virement rapproché** : le virement
  n'est pas encore pointé. À rapprocher dans **Virements** dès réception.

### « Je n'ai pas ma facture »

- **Facture … émise** : la facture existe dans Henrri, et l'e-mail
  « facture disponible » est juste après (voir plus haut si le client ne l'a pas).
- **Facture bloquée** : la raison est affichée. Une fois corrigée, cliquer
  **Relancer la facturation** dans l'onglet **Détail**, panneau
  *Facturation (Henrri)*.
- **Facture émise — à vérifier** : la facture existe, mais son règlement n'a pas
  pu être enregistré dans Henrri. À enregistrer à la main dans Henrri.

### « Où est mon colis ? »

**Colis préparé**, **Colis expédié**, **Colis livré**, puis
**Expédition : …** pour la commande entière. Le numéro de suivi est dans
l'onglet **Détail**.

### « Ma commande n'avance pas »

Les lignes **Conformité : …** suivent les documents légaux (attendus, en
vérification, validés, refusés) ; **Paiement : …** et **Expédition : …**
suivent le reste. Une commande avec des armes réglementées attend que les
documents **et** le paiement soient validés.

### Ce que l'historique ne montre pas

Une page qui plante dans le navigateur du client, un site injoignable : c'est
pour Franck (partie 2). Lui transmettre la **référence de la commande**, l'**heure
approximative** et, si une ligne de l'historique est concernée, l'**identifiant
gris** en fin de ligne (identifiant de requête).

## 2. Pour Franck : les journaux techniques

Mise en place et commandes de base : `docs/DEPLOY.md`, § *Logs*. Les journaux
sont gardés **14 jours**.

```bash
just journal 0b7d1f3e            # tout ce qui concerne une commande (référence en minuscules)
just journal <reqId>             # une requête précise : l'identifiant gris de l'historique
just journal "Browser error"     # erreurs vues dans le navigateur (panier, tunnel, paiement)
just journal "Brevo report"      # retours Brevo reçus, et ceux qu'on n'a pas su rattacher
journalctl -t scs-firearm-api-1 -p warning --since today   # avertissements et erreurs du jour
```

- **Erreurs navigateur** (story 12.7d) : une ligne `warn` « Browser error » par
  erreur et par page, avec le chemin, le message (adresses e-mail et numéros
  masqués), la pile d'appels et le navigateur du client. Seuls `/panier` et
  `/commande…` sont surveillés.
- **Rapports Brevo** (story 12.7c) : « Brevo report for an e-mail we did not
  journal » veut dire qu'un retour Brevo ne correspond à aucun envoi journalisé
  (e-mail antérieur à la 12.7c, ou `Message-ID` non transmis par Brevo — voir la
  vérification dans `docs/DEPLOY.md`).
- **Henrri, Stripe, colis** (story 12.7a) : une ligne par document émis ou
  bloqué, par événement Stripe reçu, par colis livré, toujours avec l'`orderId`.
- **Base de données** : l'historique est la table `audit_logs` (`order_id`,
  `req_id`, `result`, `error`, `message_id`).

## 3. Combien de temps on garde quoi

| Données | Durée | Qui l'applique |
|---|---|---|
| Journaux techniques du serveur | 14 jours | journald (`infra/journald/scs-firearm.conf`) |
| Historique d'une commande, e-mails compris | 10 ans à compter de la date de la commande | purge quotidienne de l'API (`audit/retention.ts`) |
| Connexions, sécurité, e-mails hors commande, actions admin hors commande | 1 an | purge quotidienne de l'API |

Ces durées sont publiées dans `/confidentialite` (ligne « Journal des opérations
sensibles ») et au registre des traitements (`docs/REGISTRE_TRAITEMENTS_RGPD.md`, traitements 7 et 8).
