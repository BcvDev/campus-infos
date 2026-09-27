# Formulaire de candidature — L'Œil du Campus 100% Natitingou

## Installation

```bash
npm install
npm start
```

Le formulaire est accessible sur http://localhost:3000

## Structure

- `server.js` — serveur Express (routes, upload, insertion en base)
- `db.js` — connexion et schéma SQLite (`candidatures.db`, créé automatiquement)
- `views/accueil.ejs` — page vitrine (reprend le visuel du flyer), route `/`
- `views/form.ejs` — formulaire de candidature, route `/candidature`
- `views/merci.ejs` — page de confirmation
- `views/admin.ejs` — liste des candidatures reçues (avec liens vers les fichiers)
- `public/accueil.css` — style de la page vitrine
- `public/style.css` — identité visuelle du formulaire (masthead navy + rouge presse)
- `public/dropzone.js` — gestion des zones de dépôt de fichiers (clic + glisser-déposer)
- `uploads/` — fichiers envoyés par les candidats (créé automatiquement)

## Paiement des frais d'inscription

Le paiement est **manuel** pour l'instant : le formulaire affiche les numéros de contact,
le candidat paie de son côté (Mobile Money ou autre) puis renseigne le numéro utilisé et
une preuve (capture d'écran) directement dans le formulaire. La vérification se fait
ensuite à la main via `/admin/candidatures`.

*(Une automatisation via l'API MTN MoMo Collection a été testée mais laissée de côté :
l'endpoint `requesttopay` renvoyait un blocage intermittent difficile à isoler de façon
fiable au moment du développement. À reprendre plus tard si besoin, en repartant des
identifiants MTN déjà obtenus.)*

## Espace admin

`/admin/candidatures` est protégé par une vraie page de connexion (`/admin/login`), avec session côté serveur — pas la popup grise du navigateur.

1. Copier `.env.example` en `.env`
2. Définir `ADMIN_USER`, `ADMIN_PASSWORD` et `SESSION_SECRET` (une longue chaîne aléatoire, ex. `openssl rand -hex 32`)
3. Redémarrer le serveur

Sans `ADMIN_PASSWORD` défini, l'espace admin refuse l'accès (erreur 500) plutôt que de rester ouvert. La session dure 8h ; un bouton "Déconnexion" est disponible dans l'espace admin.

Depuis l'espace admin : recherche instantanée (nom, section, téléphone, email), stats en un coup d'œil, et export CSV de toutes les candidatures via le bouton "Exporter en CSV" (ou directement `/admin/export.csv`).

## Points à adapter avant mise en prod

- **Numéros de paiement** : ceux affichés dans le formulaire sont ceux du flyer (01 53 82 20 32 / 01 45 21 19 48) — à confirmer avec le Coordonnateur Général.
- **Date limite** : fixée au 18 octobre 2026 dans `server.js` (`DATE_LIMITE`) — passé cette date, le formulaire se ferme automatiquement.
- **Hébergement et persistance des fichiers** :
  - `candidatures.db` (base SQLite) et `uploads/` (documents des candidats) sont de simples fichiers sur disque. Ça fonctionne tel quel sur un serveur classique **à condition que le disque soit persistant** : VPS, Render (avec un "Persistent Disk" attaché — le disque éphémère par défaut de Render efface tout à chaque redéploiement/redémarrage), Railway (volume attaché).
  - **Vercel et le serverless en général sont à éviter tels quels** : le système de fichiers y est jetable, donc `uploads/` et `candidatures.db` disparaîtraient à tout moment. Pour héberger là-dessus, il faudrait remplacer `better-sqlite3` par une base externe (Postgres, etc.) et stocker les fichiers sur un service externe (S3, Cloudinary) — non fait dans cette version.
  - Dans tous les cas : **sauvegarder régulièrement** `candidatures.db` et le dossier `uploads/` (ex. export automatique vers un stockage externe), car ce sont les seules copies des données et des pièces jointes.
