# GPT #2 — Espace de sélection des mesures

Mission démarrée le **30 octobre 2026** sur `codex/ux-measurement-workbench`,
créée depuis `work` à `f6cb3ad`. Responsable : GPT #2 (`/root`).

**Bilan fonctionnel livré et vérifié : A à F.** PR
[#2](https://github.com/LuLu1357/simulateur-electronique/pull/2), non fusionnée.
Le seul volet d’évaluation restant dans cette mission est la revue visuelle
desktop et le parcours clavier natif, bloqués par l’absence d’un navigateur réel.
Les contrôles DOM ne sont pas présentés comme cette revue.

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
| B — Lecture | Vérifié en DOM | Couleurs identiques aux tracés, légendes V/A et libellés complets ; revue visuelle ouverte |
| C — Clavier | Vérifié en DOM | Contrôles natifs nommés, focus et événements isolés localement ; vrai parcours Tab restant à vérifier |
| D — Robustesse | Vérifié | Quatorze scénarios couvrent absents/OP/TRAN, une valeur, mesures manquantes, disparitions et données précédentes |
| E — Validation | Vérifié, hors visuel | Dix-huit scénarios DOM, 218 tests Node, TypeScript et build réussis ; reproduction autonome documentée ci-dessous |
| F — Finition | Vérifié en DOM | Focus après disparition, pagination mémorisée bornée, choix plus compacts et action pour vider le graphe |

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

### B/C — Légendes, couleurs et commandes locales

- Responsable : GPT #2 ; scénario versionné par `measurement_dom_scenarios`.
- Fichiers : nouveau `MeasurementLegend.tsx`, sélecteur, styles et uniquement
  présentation de l’oscilloscope ; nouveaux `tests/browser/measurementWorkbench.html`
  et `.tsx`, réexécutables après installation normale du projet.
- Couleur issue de l’ordre du catalogue source dans les quatre zones : catalogue,
  choix, légende et tracé. Une recherche, une pagination ou un retrait ne change
  pas ce lien. Après un nouvel ordre source, les quatre zones restent cohérentes.
- Les libellés complets, identifiants et unités sont consultables dans les choix
  et légendes, avec retours à la ligne et titres explicites. V/A gardent leurs
  graphes et légendes distincts. Les tableaux et valeurs ne sont pas réécrits.
- Ouverture : focus sur la recherche. Échap : fermeture et retour au bouton.
  Retrait focalisé : focus sur une commande voisine ou sur Ajouter une mesure.
  Aucun reset de requête ou de focus sur un rafraîchissement compatible.
- Clavier et copy/cut/paste sont contenus dans le nouveau sélecteur et ses
  légendes, sans `preventDefault` sauf Échap. Les actions natives restent possibles ;
  elles ne déclenchent plus les handlers d’édition du schéma depuis cette zone.
  **UX-01 reste ouvert ailleurs** : les listeners globaux dans `main.tsx`
  (`handleEditorKey`, écoute copy/paste de `.studio`) relèvent toujours du pilote.
- Contrôles : TypeScript, build et **neuf scénarios React/DOM réussis**, dont couleurs,
  libellés longs, focus et événements locaux. Le scénario vérifie aussi les
  270 accès paginés, StrictMode, désélection totale, disparitions, curseur,
  zoom, statistiques et CSV avec tous les points. Réseau interdit dans ce test.
- Essai supplémentaire App/HTTP/ngspice isolé sur 8785 : vrai soustracteur,
  106 composants et 270 courbes ; recherche du courant de base `I:N20_QB.b`,
  choix de la mesure, flèches/Suppr/copy/paste dans le sélecteur : **zéro écriture**,
  projet, sélection, topologie, historique et simulation strictement identiques.
- Limites : jsdom ne prouve ni rendu ni Tab natif ; les neuf scénarios ne sont
  pas annoncés comme une revue navigateur. Les sélections restent en mémoire
  pendant le montage du composant, comme auparavant ; aucun stockage ajouté.
- Publication A vérifiée : `2a515d7`, PR [#2](https://github.com/LuLu1357/simulateur-electronique/pull/2)
  en brouillon. Publication B/C : commit portant cette entrée, à pousser puis vérifier.
- Prochaine action : compléter les cas de résultat absent, OP, indisponible et
  précédent (D), puis contrôles finaux/reproduction (E) et finition (F).

### D — Résultats absents, précédents et incomplets

- Responsable : GPT #2, scénario complété par `measurement_dom_scenarios`.
- Fichiers : les deux fichiers du scénario versionné ; présentation du type de
  mesure dans `Oscilloscope.tsx` (une unité autre que V/A est annoncée « Mesure »,
  sans être assimilée à tort à un courant). Aucune nouvelle interprétation physique.
- **Quatorze scénarios React/DOM réussis**, TypeScript application et scénario
  strict réussis, `git diff --check` réussi. Couverture ajoutée : absence, OP et
  échec sans séries, premier TRAN, série d’un point, NaN/Infinity/données tronquées,
  CSV laissant des cases vides et conservant les vrais zéros, page filtrée après
  réduction du catalogue, choix disparus et unités supplémentaires via Tous.
- Les résultats précédents restent marqués par `stale` pendant recherche et
  sélection. Dans le contrat actuel, `main.tsx` fournit ce booléen pour édition,
  calcul en cours et dernier calcul échoué ; le sélecteur ne prétend pas en
  distinguer la cause ni transformer un dernier succès en résultat courant.
- Nouvel essai App/HTTP/ngspice, projet isolé 8785 : composant `N20_QB` réellement
  sélectionné avant le contrôle, puis recherche/choix de sa courbe de base,
  flèche/Suppr/copy/paste : projet complet, sélection, connexions, topologie,
  historique et simulation identiques, aucune écriture API. Après retrait de la
  masse sur ce seul projet d’essai, le vrai calcul échoue ; les courbes précédentes
  sont toujours explicitement marquées avec leur révision source.
- Publications précédentes vérifiées : `2a515d7` (A), `c1ccc98` (B/C). Les tests
  restent sur des données indépendantes ; aucun service utilisateur sollicité.
- Limite : volet visuel/Tab natif toujours ouvert. Les scripts App/API exploratoires
  de `work/qa/` ne constituent pas une suite depuis un clone ; le scénario de
  composant versionné fournit la reproduction autonome sans service API.
- Prochaine action : finition locale (F), instructions de reproduction et contrôle
  complet final (E), puis actualisation finale de la PR #2 sans fusion.

### F — Finition sur les défauts du nouveau sélecteur

- Responsable : GPT #2 ; revue indépendante par `measurement_boundary_review`,
  compléments du scénario par `measurement_dom_scenarios`.
- Défaut reproduit : après disparition de la ligne focalisée, le focus retombait
  sur `BODY`, hors de la protection locale. Les références de contrôles rendent
  maintenant le focus à une commande encore présente avant leur retrait du DOM.
  Même vérification pour un bouton de retrait, la pagination et une légende dont
  le groupe disparaît. Un rafraîchissement compatible ne vole pas le focus.
- Le numéro de page mémorisé est borné uniquement lorsque le catalogue rétrécit :
  le retour à 270 canaux ne ressuscite plus une ancienne page 13 après la page 1.
- Action explicite **Vider le graphe** : garde les mesures dans le catalogue,
  conserve la sélection vide au prochain résultat compatible et rend le focus.
  Les choix utilisent une grille compacte avec libellés complets, sans nouvelle
  règle mobile et sans masquer des données.
- Échap pendant une composition de texte reste une commande native de saisie ;
  le catalogue ne se ferme qu’en dehors de cette composition. Ce cas est simulé
  dans le scénario clavier, sans prétendre reproduire un clavier natif réel.
- Fichiers : sélecteur, légende, styles, raccordement du seul vidage de sélection
  dans `Oscilloscope.tsx`, deux fichiers du scénario.
- Contrôles finaux : **18/18 scénarios React/DOM**, **11/11 tests ciblés**,
  **218/218 tests frontend**, TypeScript application et scénario strict, build et
  `git diff --check` réussis ; aucun test Node ignoré. Le dernier essai App/API
  reprend aussi le vidage du graphe : zéro écriture et aucun changement du projet,
  de la sélection partagée, des connexions, de l’historique ou des résultats.
- Contrôle de périmètre : comparaison syntaxique de quinze déclarations de
  l’oscilloscope avec `f6cb3ad` : curseur/temps, tracés, zoom, statistiques et CSV
  inchangés. Aucun fichier réservé au pilote modifié.
- Limite : la compacité est implémentée et les comportements sont vérifiés en
  DOM ; rendu, contraste et parcours Tab réels restent à examiner dans un navigateur.
- Publications A/B-C/D vérifiées : `2a515d7`, `c1ccc98`, `4879349`. Publication F :
  commit portant cette entrée, avec vérification du SHA distant après push.
- Prochaine action : consigner la reproduction autonome, fermer E et publier le
  bilan final de la PR, en gardant le volet visuel explicitement ouvert.

### E — Reproduction autonome et bilan final

- Responsable : GPT #2. Les trois agents de ce lot ont terminé leurs tâches.
- Le scénario versionné utilise le **vrai composant Oscilloscope** et ses nouveaux
  composants avec des résultats synthétiques indépendants, figés et sans réseau.
  Il ne fait pas de simulation électrique. Les essais supplémentaires sur le
  soustracteur utilisent séparément la vraie API et ngspice, dans le seul runtime QA.
- Page et module du scénario servis avec succès par Vite sur 8882 (HTTP 200).
  Exécution de la même source sous jsdom : **18/18 cas réussis, zéro appel réseau**.
- Contrôles finaux exécutés après toutes les corrections de F :

| Commande / contrôle | Résultat |
| --- | --- |
| `node --test frontend/tests/measurementChannels.test.mjs` | 11/11 réussis |
| `npm test --prefix frontend` | 218/218 réussis, aucun ignoré ; inclut les 11 tests ciblés |
| `npm run check --prefix frontend` | Réussi |
| `npm run build --prefix frontend` | Réussi |
| Typage strict du scénario avec `tsc` (commande ci-dessous) | Réussi |
| Scénario React/DOM versionné, exécuté sous jsdom | 18/18 réussis ; pas de réseau |
| App/API/ngspice isolés : soustracteur, recherche, choix, vidage, clavier et presse-papiers | Zéro écriture ; projet, sélection, topologie, historique et résultat inchangés |
| `git diff --check` | Réussi |

#### Rejouer depuis un clone

Prérequis de ces vérifications frontend : Node/npm aux versions prises en charge
par le dépôt. **Aucun backend, ngspice ou projet utilisateur nécessaire** pour le
scénario versionné. Après récupération de la branche :

```sh
git clone --branch codex/ux-measurement-workbench https://github.com/LuLu1357/simulateur-electronique.git
cd simulateur-electronique
npm ci --prefix frontend
node --test frontend/tests/measurementChannels.test.mjs
npm test --prefix frontend
npm run check --prefix frontend
npm run build --prefix frontend
frontend/node_modules/.bin/tsc --noEmit --jsx react-jsx --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck --strict frontend/tests/browser/measurementWorkbench.tsx
git diff --check
npm run dev --prefix frontend -- --port 8882 --strictPort
```

Ouvrir `http://127.0.0.1:8882/tests/browser/measurementWorkbench.html`.
Le résumé doit annoncer **18/18**, `data-run-status="passed"` sur `#summary` et
`#app`, et la console `MEASUREMENT_WORKBENCH_RESULT` avec `networkCalls: 0`.
Recharger rejoue les cas. La page bloque les appels réseau de l’instrument ; les
modules de développement restent servis normalement par Vite.

Le chargeur TypeScript/jsdom exploratoire de cette session n’est pas une nouvelle
dépendance du dépôt. La page HTML et le scénario TSX sont la reproduction livrée
depuis un clone, utilisable dans un navigateur sans ajouter jsdom.

#### Fichiers livrés

- `frontend/src/measurementChannels.ts` et son test Node : recherche et sélection
  pures, sans lecture/modification des échantillons.
- `frontend/src/components/MeasurementChannelSelector.tsx` : recherche, filtres,
  pages, choix indépendants de la recherche, commandes et focus.
- `frontend/src/components/MeasurementLegend.tsx` et `measurementChannels.css` :
  correspondance des couleurs, libellés complets et présentation locale.
- `frontend/src/components/Oscilloscope.tsx` : intégration de la sélection, de la
  légende et de textes de présentation ; les quinze déclarations protégées de
  traitement des mesures sont identiques à la base.
- `frontend/tests/browser/measurementWorkbench.html` et `.tsx` : dix-huit cas
  reproductibles. Aucun fichier installé ou généré n’est publié.
- `docs/SUIVI_GPT2.md` : ce journal ; aucun document partagé du pilote modifié.

#### Limites et raccordement avec le pilote

- Recherche fondée sur les seules métadonnées réellement reçues : par exemple
  R1 retrouve `I:R1`/`I(R1)`. Une tension `V(net_x)` n’est pas associée artificiellement
  à un composant ou à un nom de réseau. Aucun raccordement supplémentaire n’est
  nécessaire pour la livraison actuelle. Pour enrichir ultérieurement ces noms,
  le pilote devra fournir un contexte explicite par identifiant de courbe,
  correspondant à la même empreinte électrique que la série, y compris pour les
  mesures précédentes ; ne pas appliquer les noms du nouveau circuit à un ancien
  résultat. Aucun contexte de ce type n’est inventé ou ajouté ici.
- `stale` reste le contrat de provenance fourni par l’application ; la cause
  exacte (édition/échec/en cours) n’est pas déduite du dernier succès.
- Les couleurs sont cohérentes entre les zones pour un catalogue donné ; la
  palette existante est conservée. Les choix sont mémorisés pendant le montage
  du composant et réconciliés par identifiant, sans nouveau stockage persistant.
- UX-01 en dehors du sélecteur/légendes et UX-03 au survol du graphe restent des
  sujets du pilote ; aucun changement de `main.tsx` ou du contrôleur n’est proposé.
- Revue visuelle restante : application desktop complète à 1366×768 et 1440×900,
  densité, contraste, libellés longs et vrai parcours Tab/Espace/Entrée. Pas de
  capture fabriquée, pas de travail mobile, pas de parité Tinkercad revendiquée.

Publications fonctionnelles vérifiées sur GitHub : `2a515d7` (A), `c1ccc98` (B/C),
`4879349` (D), `35059ba` (F). Le dernier point finalise le clavier et clôt E ; son commit
identifie le bilan final. Les services QA 8785 et Vite 8882 ont été arrêtés ; le
lien temporaire de dépendances est retiré. Contrôle de fusion sans mutation avec
`work` à `511578b` : aucun conflit détecté ; les modifications du pilote ne sont
pas reprises dans les changements de cette branche. Aucun push direct sur
`work`/`main`, aucune fusion et
aucune réécriture d’historique. La PR UX-06 #1 est restée séparée.
