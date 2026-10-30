# GPT #2 — Espace de sélection des mesures

Mission démarrée le **30 octobre 2026** sur `codex/ux-measurement-workbench`,
créée depuis `work` à `f6cb3ad`. Responsable : GPT #2 (`/root`).

Objectif : retrouver et lire les canaux de l’oscilloscope sans une liste de
270 boutons avant le graphe, en conservant les séries, unités et conventions
pédagogiques. Aucun travail mobile.

## Coordination et périmètre

- Documents lus : `AGENTS.md`, `SUIVI.md`, `REPRISE.md`, `CONTRACT.md` et
  `UX_REVIEW.md`. Les consignes de cette mission priment sur la mise à jour des
  documents partagés : seul ce journal sera actualisé par GPT #2.
- PR UX-06 [#1](https://github.com/LuLu1357/simulateur-electronique/pull/1)
  vérifiée : ouverte, non fusionnée, branche distincte. Son contenu n’est pas
  repris dans ce chantier.
- Réservés au pilote : `main.tsx`, `BreadboardView.tsx`, backend, MCP, calculs,
  carnet, contrôleur de relecture et logique de curseur/zoom/statistiques/
  provenance. Les modifications d’`Oscilloscope.tsx` resteront dans la sélection
  des canaux et leur présentation.
- Nouvelle interface et helpers dédiés ; aucun ajout de dépendance prévu.
- Aucun navigateur réel disponible via les outils de cette session. Le volet
  visuel desktop restera explicitement ouvert si cet accès ne change pas.
- Les manipulations éventuelles utiliseront un service et des projets isolés.
  Le service utilisateur sur 8765 et son `.runtime` sont exclus.

## Répartition effective

| Responsable | Fichiers possédés | Tâche |
| --- | --- | --- |
| GPT #2 / pilote de ce lot | Nouveau sélecteur, styles, intégration de sélection dans `Oscilloscope.tsx`, journal et scénario React/DOM | Intégration, validation et publications |
| Agent `measurement_search_helpers` | `measurementChannels.ts`, `measurementChannels.test.mjs` | Recherche, filtres, sélection initiale et réconciliation non destructive |
| Agent `measurement_boundary_review` | Lecture seule | Vérifier les frontières de données et les dépendances avec le pilote |

## Jalons

| Jalon | État | Livraison / prochaine action |
| --- | --- | --- |
| A — Sélection | Vérifié | Recherche, filtres, catalogue de 20 lignes par page sans perte de courbes, mesures choisies conservées à part |
| B — Lecture | À faire | Cohérence des couleurs avec les tracés, légende et libellés complets, conservation des choix |
| C — Clavier | À faire | Contrôles natifs nommés, focus et navigation prévisibles, protection locale contre les raccourcis d’édition |
| D — Robustesse | À faire | Résultats absents/OP/TRAN, 270 canaux, remplacements, données précédentes et mesures manquantes |
| E — Validation | À faire | Scénario React/DOM versionné, commandes de contrôle et instructions depuis un clone |
| F — Finition | À faire | Corriger les défauts observés dans le sélecteur, puis livrer un bilan complet dans la PR |

## Décisions et limites de données

- La recherche utilisera l’identifiant, le libellé et l’unité réellement fournis
  dans les courbes. `I:R1` et `I:Q1.b` permettent de retrouver ces références.
  Aucun nom de réseau ou lien entre une tension nodale et un composant ne sera
  inventé sans contexte supplémentaire fourni par le pilote.
- Le sélecteur ne changera ni les valeurs ni les tableaux ngspice. Les exports
  existants conserveront leur source et leurs conventions.
- UX-01 reste un défaut global du gestionnaire clavier de `main.tsx`. Une
  protection locale du nouveau sélecteur ne constituera pas sa résolution globale.

## Journal des vérifications et publications

### Initialisation

- Branche créée dans un worktree séparé ; copie de départ propre.
- Accès distant vérifié, état de la PR #1 lu sans mutation.
- Contrôles produit : non encore exécutés pour ce nouveau chantier.
- Publication : en attente du premier jalon fonctionnel vérifié.
- Prochaine action : livrer et tester le sélecteur de canaux (A), puis enchaîner
  les jalons B à F sans attendre une nouvelle demande.

### A — Catalogue et choix de mesures

- Responsables : GPT #2 pour l’interface ; agent `measurement_search_helpers`
  pour les fonctions pures ; revue de frontière par `measurement_boundary_review`.
- Fichiers : `MeasurementChannelSelector.tsx`, `measurementChannels.css`,
  `measurementChannels.ts`, tests ciblés et intégration de sélection dans
  `Oscilloscope.tsx`. Les calculs de curseur, tracés, zoom, statistiques et CSV
  restent inchangés.
- Recherche sur identifiant/libellé/unité et références déjà présentes ; filtres
  Tous/Tensions/Courants ; compte et état vide. Pagination explicite de 20 lignes,
  tous les canaux accessibles. Les mesures choisies restent au-dessus du catalogue.
- Réconciliation par identifiant : une désélection totale reste vide, les canaux
  disparus ne déclenchent pas l’ajout automatique d’autres courbes. Initialisation
  seulement au premier catalogue non vide, compatible avec StrictMode.
- Contrôles : **11 tests ciblés et 218 tests frontend réussis** ;
  `npm run check --prefix frontend`, `npm run build --prefix frontend` et
  `git diff --check` réussis. Essai React/DOM exploratoire : 270 canaux, recherche,
  ajout sans perte des autres choix, aucun déplacement du curseur ni modification
  des données, focus conservé lors d’un rafraîchissement compatible.
- Limites : cet essai exploratoire local n’est pas encore versionné ; la revue
  visuelle reste ouverte. Le clavier des boutons hérite encore d’UX-01 jusqu’au
  jalon C ; ce premier point est une étape intermédiaire du chantier.
- Publication : commit portant cette entrée sur la branche dédiée ; SHA distant
  à vérifier après push. Aucun contenu de la PR #1 repris.
- Prochaine action : légende et relation entre couleurs/libellés/tracés (B),
  puis isolation locale du clavier et des événements de presse-papiers (C).
