# Plan de présentation — Démo SCS Firearm

> Public : **client / porteur métier** (armurier + Gun Art). Angle : valeur
> métier, parcours réglementé de bout en bout, conformité, et sérieux
> d'exécution. Durée cible : **20-30 min de démo + questions**.
> Runbook de démo cliquable + checklist pré-démo + questions à trancher.

---

## 0. Pitch d'ouverture (~1 min)

> « SCS Firearm, c'est **une maison, deux univers** sur une même plateforme :
> une **armurerie de précision** entièrement encadrée par la réglementation
> française (armes, munitions, optiques), et **Gun Art**, une galerie de tirages
> d'art en édition limitée. La difficulté du métier — vendre de l'arme en
> ligne **légalement** — est traitée de bout en bout : catégories légales,
> pièces justificatives, validation, traçabilité. Je vous montre le parcours
> complet, côté client puis côté back-office. »

---

## 1. Checklist pré-démo (à faire AVANT, pour que rien ne plante)

- [ ] **Docker up** : `pnpm docker:up` (Postgres dev) — vérifier `pg_isready`.
- [ ] **DB seedée** : `pnpm db:seed` (données de référence + admin). Vérifier
      que la boutique et la collection ont des articles.
- [ ] **API** up : `pnpm dev:api` (port 8081) → `curl localhost:8081/health`.
- [ ] **Web** up : `pnpm dev:web` (port 3000).
- [ ] **Paiement CB** : `stripe listen --forward-to localhost:8081/api/...` +
      carte test **4242 4242 4242 4242** (date future, CVC quelconque).
- [ ] **Admin** : connu (`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` du `.env`),
      testé sur `/admin/login`.
- [ ] **Compte client de démo** créé à l'avance via `/inscription` (évite de
      taper un mot de passe en live) — mais **garder l'inscription montrable**.
- [ ] Onglets pré-ouverts : `/`, `/admin`, un terminal `stripe listen`.
- [ ] Fenêtre en **desktop large** (méga-menu) + un **format mobile** prêt
      (responsive / DevTools) pour montrer le burger.

---

## 2. Déroulé de la démo

> Fil rouge : on suit **un client** qui achète dans les deux univers, puis on
> passe **derrière le comptoir** (admin) pour traiter la commande réglementée.

### Acte 1 — L'accueil & les deux univers (`/`)
- Montrer l'**accueil unifié** : héro « Armurerie de précision & Gun Art »,
  les **2 cartes univers**, la sélection de chaque monde.
- Ouvrir le **méga-menu Armurerie** (survol) → catégories + catégories légales.
- Basculer en **mobile** → burger plein écran + accordéon 2 univers.
- *Message : une seule marque, deux mondes lisibles, navigation soignée.*

### Acte 2 — Gun Art, la galerie (`/collection` → `/collection/:slug`)
- Grille des œuvres, badge **édition limitée / disponibilité**.
- Fiche œuvre : artiste, **tirage numéroté ≤ 25**, formats, certificat
  d'authenticité, prix TTC → **Ajouter au panier**.
- *Message : l'objet élevé au rang d'œuvre, rareté maîtrisée.*

### Acte 3 — L'armurerie réglementée (`/boutique` → `/boutique/:slug`)
- Filtres : catégorie, **catégorie légale (B/C/D / vente libre)**, prix.
- Fiche produit : **mentions légales** (catégorie, âge minimum, documents
  requis), restrictions, prix TTC → **Ajouter au panier**.
- *Message : la conformité est visible dès la fiche produit.*

### Acte 4 — Compte client (`/inscription`, `/connexion`, `/compte`)
- Montrer rapidement l'**inscription** (validations, anti-énumération) puis se
  connecter avec le compte de démo.
- *Message : parcours client complet, sécurité soignée.*

### Acte 5 — Panier & tunnel d'achat (`/panier` → `/commande`)
- Panier mixant **une œuvre + une arme** ; récap TTC.
- **Remise VIP** affichée le cas échéant (1ʳᵉ arme neuve débloque le statut).
- Choix des **adresses** (carnet), puis le point clé : le **split de paiement**
  — **CB** autorisée pour le Gun Art, **virement** pour l'arme réglementée.
- Création de la commande.

### Acte 6 — Paiement (`/commande/:id`)
- Régler la part **CB via Stripe** (carte test 4242) → confirmation.
- Montrer la part **virement** (IBAN / référence) en attente.
- *Message : chaque univers a le moyen de paiement adapté à sa contrainte.*

### Acte 7 — Le workflow légal **(LE différenciateur)** (`/compte/commandes/:id`)
- Sur la commande contenant l'arme : **checklist légale par commande**,
  statut par document, **upload des pièces** (CNI, permis, autorisation…).
- Montrer un document en attente de vérification.
- *Message : c'est ici que se joue la légalité de la vente — géré nativement.*

### Acte 8 — Le back-office **(derrière le comptoir)** (`/admin`)
- **`/admin/metrics`** : tableau de bord (ventes, activité).
- **`/admin/legal-docs`** : file de validation triée par **échéance SLA 48h** ;
  **accepter** un document / **rejeter avec motif** (le client peut réuploader).
- **`/admin/orders/:id`** : suivi des statuts ; une fois **docs validés + payé**,
  la commande passe **`completed`** (cycle légal/paiement recomposé).
- **`/admin/payments/virements`** : rapprochement des virements reçus.
- **`/admin/blog`** : éditeur **WYSIWYG** (contenu SEO / éditorial).
- *Message : l'exploitant a tout l'outillage pour opérer en conformité.*

### Acte 9 — Découvrabilité (rapide, en clôture) (`/recherche`, `/blog`)
- Recherche globale (œuvres + armes), **SSR + SEO** (méta, JSON-LD, pages
  indexables), blog éditorial pour le référencement.
- *Message : pensé pour être trouvé — clients humains **et** agents.*

---

## 3. Points forts à marteler (métier)

1. **Conformité de bout en bout** : catégorie légale → documents → validation
   SLA → traçabilité, sans outil externe.
2. **Deux univers, une marque** cohérente (armurerie + Gun Art).
3. **Sérieux d'exécution** : sécurité *by design* (mots de passe argon2id,
   contrôles d'accès, paiement signé Stripe, antivirus sur les pièces jointes),
   tests automatisés, quarantaine des dépendances, CI verte avant mise en ligne.
4. **Prêt à opérer** : back-office complet, backups automatisés, plan de mise en
   ligne documenté (Hetzner + Cloudflare).

---

## 4. Questions à trancher avec le client (fin de présentation)

> Détail complet et statut dans `docs/CLARIFICATIONS_A_TRANCHER.md`. Les plus
> impactantes à poser demain :

- **Workflow virement** : délai d'attente avant annulation auto ? IBAN unique
  ou par commande ? (§D2)
- **Validation légale** : qui valide (toi seul / plusieurs admins) ? SLA visé ?
  Motifs de rejet à cadrer ? (§C1)
- **VIP** : un seul niveau ou plusieurs (Bronze/Argent/Or) ? critères ? (§E1)
- **Livraison** : transporteurs, assurance (Gun Art de valeur), qui paie ? (§B3)
- **Facturation Henrri** : quand émettre la facture, TVA, rapprochement ? (§F)
- **Go-live / infra** : registrar du domaine, Cloudflare proxy + TLS, R2 vs S3,
  relais SMTP. (§J + `docs/DEPLOY.md §7`)

---

## 5. Hors périmètre de la démo (à cadrer les attentes)

- **Variantes produit** (finition/munition/couleur par SKU) — différées.
- **Monitoring uptime** (Story 8.5) — approche à trancher.
- **Mise en ligne** (migration OVH → Hetzner + Cloudflare) — planifiée, checklist
  prête (`docs/DEPLOY.md §7`), pas encore exécutée.
- **`justfile` d'ops** (Story 8.7) — au go-live.
