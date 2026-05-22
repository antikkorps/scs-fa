# CLARIFICATIONS À TRANCHER - Armurier E-commerce

## A. GUN ART - PRICING & TRACKING

### A1. Pricing dynamique

- [ ] Le prix **augmente** au fur et à mesure que les tirages **diminuent**? (rareté croissante)
  - Exemple: 1/100 = 50€, 2/100 = 51€, ..., 100/100 = 149€?
  - Ou un autre système?
- [ ] Y a-t-il des **exceptions** (prix fixe pour certaines oeuvres, rabais si achat en lot)?
- [ ] Comment tu gères les **décimales** (si increment 1.50€, etc.)?

### A2. Tracking des numéros

- [ ] **Approche 1**: Chaque tirage 1/100, 2/100, etc. créé **d'avance** au lancement?
  - Pro: simple, assignation déterministe
  - Con: faut créer 100 lignes DB par artwork
- [ ] **Approche 2**: Numéro assigné **au moment de l'achat** (dynamique)?
  - Pro: DB plus légère, prix calculé à la commande
  - Con: faut une logique "prochain tirage dispo"
- [ ] Quelle approche préfères-tu?

### A3. Certificat d'authenticité

- [ ] Le certificat est **généré automatiquement** à la vente ou **créé manuellement**?
- [ ] Format: PDF numérique + physique? Ou juste numérique?
- [ ] Infos sur le certificat: numéro tirage, artiste, date, série, dimensions, S/N?

### A4. Formats & détails produit

- [ ] Quels **formats** proposes-tu? (tableau, poster, tirage photo encadré, canvas, etc.)
- [ ] Faut-il des **variantes** (ex: même artwork en différentes tailles = prix différents)?
- [ ] Faut-il des **options** (ex: cadre inclus oui/non)?

---

## B. PAIEMENT & LIVRAISON

### B1. Paiement Gun Art vs Armes

- [ ] Gun Art: paiement **carte + virement**?
- [ ] Armes: **virement uniquement** (pas carte)?
- [ ] Existe-t-il des **restrictions** (ex: Gun Art livré au monde, Armes seulement FR)?

### B2. Paiement carte

- [ ] Quel **provider** préfères-tu? (Stripe, Mangopay, autre?)
- [ ] Besoin de **3D Secure**? (obligatoire pour certains montants)
- [ ] Gestion des **remboursements** si commande annulée?

### B3. Livraison

- [ ] **Modes de livraison**: Colissimo, Mondial Relay, DHL, custom?
- [ ] Tarif **fixe ou calculé** (au poids, à la distance)?
- [ ] **Assurance expédition** incluse? (important pour Gun Art de valeur)
- [ ] Qui paie la livraison (client ou absorption)?

---

## C. ARMES - RÉGLEMENTAIRE & STOCK

### C1. Vérification légale

- [ ] **Qui valide** les documents légaux? (toi seul ou aussi d'autres admins?)
- [ ] **Délai de réaction** attendu? (X jours max pour répondre client?)
- [ ] **Raisons de rejet possibles** à documenter?
  - Exemple: "Permis expiré", "Document non lisible", "Age insuffisant"?

### C2. Restriction par type d'arme

- [ ] Certaines armes = **accès VIP seulement**?
- [ ] Certaines armes = **interdiction de vente à certains profils** (mineurs, étrangers)?
- [ ] Faut-il une \***\*liste blanche** de professions autorisées\*\*? (chasseurs, tir sportif, collectionneurs, etc.)

### C3. Armes anciennes

- [ ] **Critères d'expertise** (qui détermine "authentic"?)?
- [ ] **Durée de validité** du certificat d'authenticité?
- [ ] Faut-il une **photo 360°** ou des **vidéos** pour certaines pièces?

### C4. Stock

- [ ] **Approche 1**: Tracking à la variante (sku-variant, ex: "Fn1900-noir-9mm")
  - Pro: granularité max, mais 50+ variantes par produit c'est lourd
- [ ] **Approche 2**: Stock "global" par produit (user choisit options au checkout)
  - Pro: plus simple, mais perte de granularité
- [ ] Réservation de stock: si client **panier → abandon**, ça libère en **X temps**?
  - Exemple: 30 min? 1h? ou au moment checkout?

### C5. Alertes stock

- [ ] Notification **admin** quand stock < seuil d'alerte?
- [ ] Notification **client** si un produit de sa wishlist repasse en stock?

---

## D. COMMANDES & WORKFLOW

### D1. Statuts de commande

- [ ] Workflow légal pour **armes uniquement** ou **tout produit**?
  - Actuellement: armes → vérif légale requise
  - Gun Art & munitions → pas de vérif? ou vérification simplifiée?
- [ ] Si client **rejeté légalement**, peut-il **réupload docs** ou commande **supprimée**?

### D2. Paiement virement

- [ ] **IBAN unique** ou **IBAN par commande**?
- [ ] **Référence virement** (ex: "ORDER-12345" ou numéro libre)?
- [ ] **Délai d'attente** avant dépassement (15j? 30j?)?
- [ ] Si pas de virement après X jours, **annulation auto** ou **notification manuelle**?

### D3. Expédition

- [ ] Après **payment_received**, qui crée le **bon de commande** pour le magasin?
  - Workflow: admin valide paiement → crée BdC → prépare colis → scan tracking → envoie client?
- [ ] Intégration **Colissimo/tracking** auto ou manuelle?

### D4. Retours & remboursements

- [ ] **Délai de rétractation** (14j légal en FR)?
- [ ] **Frais de retour** à charge du client?
- [ ] Processus: client demande RMA → admin valide → crée label retour → traite marchandise?

---

## E. UTILISATEURS & VIP

### E1. Profils VIP

- [ ] **Critères** d'accès VIP? (achat min, parrainage, invitation manuelle?)
- [ ] **Niveaux VIP** ou **un seul niveau**?
  - Exemple: Bronze (5% réduc), Argent (10%), Or (15%)?
- [ ] **Remise globale** sur panier ou **remise par fournisseur**?

### E2. Données client sensibles

- [ ] Faut-il **chiffrer** les documents légaux en S3? (actuellement juste ACL + HTTPS)
- [ ] **Droit à l'oubli** RGPD: après suppression, combien de temps avant purge totale de S3?
- [ ] **Audit logs** à conserver combien de temps? (2 ans? 7 ans?)

### E3. Authentification

- [ ] Besoin de **2FA** (authentification double facteur)?
- [ ] **OAuth** (Google, Facebook login) ou simple email/password?
- [ ] **Sessions courtes** pour produits réglementés? (ex: 30min inactivité = déconnexion)

---

## F. INTÉGRATION HENRRI

### F1. Synchronisation factures

- [ ] **Quand** créer la facture Henrri?
  - Après virement reçu? Après expédition? Après confirmation client?
- [ ] **Données minimum** requises par Henrri? (structure API/format encore à vérifier)
- [ ] **Retry logic** si sync échoue? (X tentatives avec backoff exponentiel?)

### F2. TVA & déclaration

- [ ] **Régime TVA**: Normal, micro-entreprise, franchise?
- [ ] Faut-il **génération automatique de déclaration de CA** vers Henrri?
- [ ] Gestion TVA sur **ventes internationales** (EU/hors-EU)?

### F3. Rapprochement paiements

- [ ] **Format d'export** pour rapprochement bancaire? (CSV, XML?)
- [ ] Faut-il un **module de rapprochement** dans l'admin ou export simple?

---

## G. BLOG

### G1. Contenu

- [ ] Rubriques fixes: maintenance, histoire, réglementation, news, autre?
- [ ] Besoin de **commentaires**? (modérés ou publiés auto?)
- [ ] Besoin de **partage social** (boutons Twitter/LinkedIn/Facebook)?

### G2. SEO & trafic

- [ ] Faut-il **sitemap XML**, **robots.txt**, **schema.org**?
- [ ] **Analytics** (Google Analytics intégré)?
- [ ] **Pagination** ou **infinite scroll**?

---

## H. DEPLOYMENT & INFRASTRUCTURE

### H1. Backup & récupération

- [ ] **Fréquence** des backups DB? (quotidien, hebdo?)
- [ ] **Durée de rétention** (30j? 90j? 1 an?)
- [ ] **RTO/RPO** (combien de temps pour redémarrer? données acceptables de perdre?)

### H2. Monitoring & alertes

- [ ] Besoin de **monitoring** (CPU, RAM, disque, erreurs app)?
- [ ] **Alertes** si serveur down, erreur DB, quota S3 dépassé?

### H3. Certificats & HTTPS

- [ ] **Certificat SSL** (Caddy Auto via Let's Encrypt ok?)
- [ ] **Domaine**: armurier.fr ou subdomain (shop.armurier.fr)?

---

## I. PERFORMANCE & UX

### I1. SEO & vitesse

- [ ] **Target pagespeed**: <3s (standard), <1s (premium)?
- [ ] Faut-il **CDN** pour images (CloudFlare, autre)?
- [ ] Cache du **panier/catalogue** côté browser (localStorage, Service Worker)?

### I2. Expérience utilisateur

- [ ] **Wishlist** / sauvegarde d'articles?
- [ ] **Historique** de consultations?
- [ ] **Recommandations** (similaires, best-sellers, nouveau, etc.)?

### I3. Admin

- [ ] Faut-il un **dashboard analytics** (ventes, top produits, tendances)?
- [ ] **Export commandes** par plage de dates?
- [ ] **Bulk actions** (changer prix de 10 produits en 1 clic)?

---

## RÉSUMÉ - PRIORITÉ POUR DÉMARRAGE

**Bloquants (à trancher avant coding):**

1. A1 + A2 (pricing Gun Art & tracking numéros)
2. B1 (paiement carte vs virement par catégorie)
3. C1 (qui valide docs légaux, délais, raisons rejet)
4. D2 (workflow virement: IBAN, délais, auto-annulation?)

**Importants (mais on peut livrer MVP sans):**

- A3, A4 (certificats, formats, variantes)
- E1 (profils VIP, niveaux)
- F1 (Henrri sync exact)
- I2, I3 (UX avancée, analytics)

**Nice-to-have (phase 2):**

- E3 (2FA, OAuth)
- H2 (monitoring avancé)
- I1 (CDN, Service Worker)
- G1 (commentaires, partage social)
