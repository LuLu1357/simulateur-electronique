# Reprendre Atelier Électronique

## Mise à jour active — 30 octobre 2026

Le pilote local a repris R1–R5 avec trois agents ; responsables et résultats dans
[SUIVI.md](SUIVI.md). Le jalon de synchronisation/provenance passe **207 tests Node,
342 tests Python et 106 sous-tests**, TypeScript et build. Le MCP stdio à 28 outils
est maintenant vérifié en réel sur des données isolées. Un scénario complet est
versionné dans `scripts/playback_review.py` et le scénario du hook dans
`frontend/tests/browser/`, sans dépendance supplémentaire.

Lire [VALIDATION_RELECTURE.md](VALIDATION_RELECTURE.md) : la DEL PULSE, les deux
vues, l’oscilloscope et la capture JSON pendant une lecture lente ont été observés
dans un vrai navigateur. La vérification visuelle Énergie/lecture complète et les
vrais SVG téléchargés restent ouvertes. Ne pas annoncer R1/R4 entièrement terminés.
Le rapport UX de GPT #2 (`a8fff27`) est intégré dans [UX_REVIEW.md](UX_REVIEW.md).
UX-01/02/03 sont les premières corrections à préparer ; aucune correction UX de
ce rapport n’est encore annoncée comme validée. Aucun travail mobile demandé.

La section suivante conserve le contexte du relais initial du 29 octobre.

État du relais : **29 octobre 2026**, branche
[`work`](https://github.com/LuLu1357/simulateur-electronique/tree/work).
Lire d’abord [AGENTS.md](../AGENTS.md) et [SUIVI.md](SUIVI.md).
Le suivi est le document partagé pour les progrès, responsables, tests et tâches.

## Objectif et état

Améliorer cet atelier électronique local en français vers une qualité d’usage
comparable à Tinkercad, en gardant son identité propre. React/TypeScript fournit
le schéma et les breadboards ; FastAPI et ngspice calculent les mesures. Le pont
MCP permet à un client local de travailler sur le même circuit.

Le commit `f26a706` termine le dernier jalon validé dans l’application : recherche
et navigation dans le circuit. Les étapes précédentes comprennent 14 types de
composants, RLC, quatre plaques indépendantes, historique, bibliothèque de projets,
balayages, presse-papiers de fragments, SVG, carnet et instruments.

La publication de relais transmet **la relecture transitoire implémentée mais
encore à valider de bout en bout dans l’application**. L’utilisateur a demandé
l’arrêt du développement puis la publication pour permettre ce relais. Aucun
agent de développement ne poursuit le chantier après ce relais.

## Obtenir et lancer le code

```sh
git clone --branch work https://github.com/LuLu1357/simulateur-electronique.git
cd simulateur-electronique
./scripts/install.sh
./scripts/run.sh --open
```

Prérequis : Python 3.11+, Node.js 20.19+ ou 22.12+, npm et ngspice dans le `PATH`.
Installer ngspice avec `brew install ngspice` sur macOS ou
`sudo apt install ngspice` sur Debian/Ubuntu. Les dépendances Python/npm sont
verrouillées ; aucun compte cloud n’est nécessaire au fonctionnement local.

Adresse : `http://127.0.0.1:8765`. Dans un dépôt déjà cloné, examiner `git status`
et les changements distants avant d’intégrer la branche partagée. Ne pas effacer
le travail local pour repartir d’un clone propre.

Le relais a été vérifié avec Python 3.12, Node 24 et ngspice 47. L’exécutable
ngspice utilisé ici était extrait dans `work/ngspice/usr/bin`, répertoire ignoré :
il ne sera pas présent dans un nouveau clone. Il faut installer son propre
ngspice. Les scripts exploratoires, `.venv`, `node_modules` et `dist` ne sont pas
transférés non plus ; les scripts d’installation recréent les dépendances.

## Carte du chantier transmis

| Fichiers | Rôle |
| --- | --- |
| `backend/simulation_frames.py` | Lit un point réel d’une série existante, reconstitue tensions/courants de bornes et flux de fils sans simulation |
| `backend/server.py` | Attribue un `simulation_id` au résultat ; expose `GET /api/results/frame` |
| `backend/simulation.py` | Ajoute les séries réelles des courants de base/émetteur BJT, nécessaires au bilan instantané |
| `backend/mcp_server.py` | Outil de lecture `simulation_frame_read`, indices entiers stricts, annotations de lecture seule |
| `frontend/src/playback.ts` | Contrat et validation de provenance ; fusionne un point avec la série conservée |
| `frontend/src/useSimulationPlayback.ts` | Curseur, lecture/pause, requête unique à la fois, cache de 64 points, annulation au changement de calcul |
| `frontend/src/components/SimulationPlayback.tsx`, `frontend/src/playback.css` | Commandes de lecture et distinction temps visé/temps affiché |
| `frontend/src/main.tsx` | Intègre les mesures rejouées au schéma et aux plaques, synchronise les instruments |
| `Oscilloscope.tsx`, `EnergyPanel.tsx` | Curseurs contrôlés facultatifs ; les usages autonomes conservent un curseur local |
| `notebook.ts`, `NotebookPanel.tsx`, `BreadboardView.tsx` | Provenance temporelle des captures et exports ; le schéma est exporté depuis `main.tsx` |
| `tests/test_simulation_frames.py`, `tests/test_mcp_frames.py` | Tests du point, de l’API, des mesures physiques et du pont MCP |
| `frontend/tests/playback.test.mjs`, `notebook.test.mjs` | Tests purs du rejeu et des captures temporelles |

Les noms de composants sans préfixe dans cette table se trouvent dans
`frontend/src/components/` ; `notebook.ts` se trouve dans `frontend/src/`.
Les autres contrats sont décrits dans [CONTRACT.md](../CONTRACT.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [ELECTRIQUE.md](ELECTRIQUE.md) et
[mcp.md](mcp.md). La documentation générale du nouveau point devra être finalisée
après les essais d’intégration.

## Contrat du point temporel

`GET /api/results/frame?simulation_id=<uid>&index=<indice>` utilise le contrôle
d’accès local existant. L’UID est celui du calcul courant, 32 caractères hexadécimaux
minuscules ; l’indice entier commence à zéro et vise `simulation.time[index]`.

Réponse : `project_id`, `project_revision` courante, `source_revision` du calcul,
`simulation_id`, `circuit_fingerprint`, `index`, `time` en secondes, `sample_count`
et `simulation` contenant les mesures au point. Ce dernier objet est un
instantané, avec séries vides : le frontend conserve les séries du calcul
complet pour les instruments. Ne pas remplacer le résultat du service par cet
instantané.

Le point est refusé si le résultat n’est plus courant, s’il est obsolète, si le
circuit électrique a changé, si une analyse tourne ou si l’analyse est OP.
Les révisions purement visuelles restent compatibles. Les paramètres malformés
sont rejetés ; les tests couvrent les erreurs 409/422. Ni le circuit, ni
l’historique, ni le résultat source ne sont modifiés, et ngspice n’est pas relancé.

Le frontend vérifie UID, empreinte, révision source, indice, temps et taille.
Pendant une lecture lente, le point demandé et le point effectivement affiché
peuvent différer : conserver cette distinction dans les captures et exports.
Un nouveau calcul invalide les anciennes requêtes et restaure son dernier point.
Les diagnostics du calcul complet restent associés à l’analyse entière, même
quand les valeurs instantanées affichées changent.

`simulation_frame_read(simulation_id, index)` expose la même lecture au MCP.
Obtenir l’UID et la série dans `measurements_read`. Cet outil ne déplace pas le
curseur local de l’interface. Il porte le total à 28 outils ; son parcours réel
en stdio reste à vérifier.

## Vérifications et prochaine action

Commandes, avec ngspice disponible :

```sh
.venv/bin/python -m pytest -q
npm test --prefix frontend
npm run build --prefix frontend
git diff --check
```

Au relais : **340 tests Python et 106 sous-tests réussis**, **198 tests Node
réussis**, compilation TypeScript/Vite réussie, aucun test ignoré. Les tests du
point utilisent le vrai ngspice, notamment RC, DEL PULSE, RLC, BJT et potentiomètre.
Le test MCP ciblé vérifie aussi la validation stricte et les annotations
sérialisées du SDK 2.3.0.

Un essai exploratoire React/DOM du hook a vérifié regroupement, cache,
changement d’UID, provenance invalide, reprise et lecture/pause. Les intégrations
antérieures DOM/API/ngspice et MCP réel sont consignées dans
[VALIDATION.md](VALIDATION.md). Les scripts exploratoires locaux de `work/` ne
sont pas versionnés et ne constituent pas un scénario reproductible depuis GitHub.

**Commencer par les tâches R1 à R4 du suivi** : application complète avec vraie
DEL commandée par PULSE, synchronisation schéma/plaques/instruments, captures et
SVG au bon instant, obsolescence et réponses tardives, puis vrai client MCP stdio.
Versionner ensuite un scénario d’intégration réexécutable. Ces parcours n’ont pas
été exécutés pour le nouveau curseur global. Aucune revue visuelle récente dans
un vrai navigateur n’a été réalisée.

`scripts/test_mcp.py` fait des mutations temporaires sur le service auquel il se
connecte. Le lire et préparer un service et des données de test isolés avant
usage ; ne pas l’exécuter contre le projet actif de l’utilisateur.

## Sauvegarde et coordination

Le code et ces documents sont partagés sur `work`. Les données `.runtime/`
(circuit ouvert, bibliothèque, jeton local) et le carnet conservé dans le
navigateur ne font pas partie du dépôt. Ne jamais publier de jeton.

Attribuer les tâches et leurs fichiers dans le suivi avant de travailler à
plusieurs. Publier chaque jalon vérifié, ainsi que les étapes intermédiaires
d’un long chantier, puis mettre à jour le suivi et pousser avant chaque relais.
Ne pas faire de force-push ou modifier `main` directement. Les consignes ne
mettent pas en place un processus permanent après l’arrêt de la session.

L’application reste locale et pédagogique : pas d’Arduino, d’AC, de tolérances
statistiques ou d’oscilloscope déclenché. Les modèles et boîtiers ne qualifient
pas un montage physique. La qualité comparable à Tinkercad reste un objectif.
