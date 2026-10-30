# Progrès et répartition des tâches

Mis à jour le **30 octobre 2026**, reprise active après récupération de `work` (`c6ff77e`).

## Coordination active — 30 octobre 2026

Le pilote local reprend R1 à R5. Les tests de validation sont de nouveau demandés
par l’utilisateur. Le circuit et le service utilisateur sur 8765 sont préservés :
les essais mutables utilisent des runtimes et services isolés.

| Lot | Responsable effectif | Fichiers possédés / prochaine action | État |
| --- | --- | --- | --- |
| R1, intégration R5 | Pilote local `/root` | Curseur global, scénario `scripts/playback_review.py`, documentation ; finir la revue instruments/lecture complète | DEL PULSE ON/OFF, schéma, plaque 2 et oscilloscope vérifiés ; suite visuelle restante |
| R2 | Agent `/root/playback_races`, terminé | `playback.ts`, tests purs et scénario React/DOM versionné ; mesures tardives et provenance | 10/10 scénarios navigateur déterministes ; validation des tables de courants renforcée |
| R3 | Agent `/root/mcp_validation`, terminé | `tests/test_mcp_stdio_frames.py` ; 28 outils, SDK stdio, vrai HTTP/ngspice isolés | Validé : aucune mutation ni relance ; UID, indices et obsolescence vérifiés |
| R4 | Agent `/root/capture_instruments`, code terminé ; pilote pour QA | Carnet, oscilloscope, SVG, énergie et tests ; capture au point réellement affiché | Capture JSON téléchargée vérifiée ; provenance SVG testée unitairement, téléchargement SVG restant |
| U1 | GPT #2 de l’utilisateur | Rapport `docs/UX_REVIEW.md`, branche `codex/ux-review-2026-10-30`, commit `a8fff27` | Rapport publié, intégration par le pilote à suivre ; observations DOM et hypothèses distinguées, revue visuelle ouverte |

Un seul éditeur de `main.tsx` : le pilote local. Le second ChatGPT mène une revue
en lecture seule du produit et publie son rapport sur sa branche dédiée ; le
pilote intégrera ce rapport sur `work` avant U2. Il ne modifie pas les fichiers
fonctionnels, le suivi partagé ou le projet actif. Aucun travail mobile demandé.

Jalon de coordination : consignes lues, copie locale propre mise à jour sans
réécriture d’historique. Contrôle de ce jalon documentaire : `git diff --check`.
Les résultats du 29 octobre ci-dessous restent historiques. Le nouveau jalon est
documenté dans [VALIDATION_RELECTURE.md](VALIDATION_RELECTURE.md) : **207 tests Node,
342 tests Python et 106 sous-tests réussis**, aucun ignoré ; TypeScript, build et
`git diff --check` réussis. Les rapports historiques sont préservés à l’identique.

Corrections du jalon : instruments sur `displayIndex` (point affiché), curseur
global conservé hors fenêtre zoomée, capture autorisée pendant l’attente mais
liée au point affiché, UID/empreinte/révision source dans carnet et SVG, remise à
zéro des instruments autonomes au changement d’UID et tables de courants strictes.
Les DEL et animations ne traitent plus un dernier succès après échec comme courant.

Preuve UI : PULSE réel, 1 233 points ; au point 247 (394,4 µs), DEL à 9,259 mA,
schéma allumé, plaque 2 et oscilloscope cohérents. Pendant la demande du point 493,
une capture conserve le point 247 ; son JSON téléchargé confirme UID, empreinte,
révision source 0, indice 246 et 1 233 points. Au point 493 (743,8 µs), la DEL
est éteinte dans les deux vues. Aucune manipulation du service utilisateur 8765.

**Prochaines actions P0 :** télécharger et inspecter les vrais SVG schéma/plaque
pendant une lecture retardée, terminer la revue visuelle Énergie, lecture/pause/
retour final et fenêtre zoomée. Les tests déterministes de ces interactions ne
ferment pas à eux seuls la revue visuelle. Le téléchargement du carnet a bloqué
l’outil navigateur ; conserver des délais d’outil bornés pour les essais suivants.
Intégrer ensuite le rapport GPT #2, puis traiter UX-01/02/03 par lots validés.

## Point de reprise

- Dépôt : <https://github.com/LuLu1357/simulateur-electronique>.
- Branche partagée : [`work`](https://github.com/LuLu1357/simulateur-electronique/tree/work).
- Dernier jalon fonctionnel validé avant le chantier de relecture : `f26a706`
  (navigation et recherche dans le circuit).
- La publication de relais contient également la relecture transitoire en cours.
  Son code compile ; sa validation de bout en bout dans l’application reste à faire.
- Le relais du 29 octobre est repris le 30 octobre ; les responsables actifs et
  les fichiers réservés sont précisés dans la section de coordination ci-dessus.

Lire aussi [REPRISE.md](REPRISE.md) pour les fichiers, le démarrage et les pièges,
et [PROMPT_REPRISE.md](PROMPT_REPRISE.md) pour le message prêt à transmettre.

## Fonctionnalités déjà livrées

| Domaine | Progrès | État au relais |
| --- | --- | --- |
| Éditeur | Sélection multiple, déplacements et rotations groupés, duplication, annuler/rétablir, fils routables, saisie SI | Validé avant le chantier en cours |
| Bibliothèque | Recherche, filtres, expériences, 14 types de composants dont inductance, DEL, potentiomètre et transistors | Livré |
| Plaques | Jusqu’à quatre plaques indépendantes, transferts et fils inter-plaques, implantation prévisualisée | Validé avec vraie API/ngspice |
| Projets | Bibliothèque persistante de 12 copies indépendantes, export/import | Validé ; stockage local au service |
| Mesures | PULSE et analyses OP/TRAN réelles, oscilloscope, CSV, statistiques de fenêtre, vue Énergie | Validé avant curseur global |
| Balayage | Résistance, source DC ou potentiomètre, 2 à 16 calculs OP sans modifier le circuit actif | Validé |
| Carnet | 12 captures, comparaison et provenance, repli en cas de stockage refusé | Validé ; provenance temporelle étendue dans ce relais |
| Partage | SVG autonomes et presse-papiers de fragments validés | Validé avant provenance du point rejoué |
| Navigation | Ctrl/Cmd+K, composants/fils/jonctions/réseaux, sélection et cadrage | Validé, commit `f26a706` |
| Physique | RL/RLC, courants signés, bilans de bornes et fils uniques/indéterminés | Tests avec ngspice réel |

## Chantier transmis : relecture transitoire

**Implémenté, validation d’intégration restante.** Le curseur global sélectionne
des échantillons réellement calculés ; lecture, pause et retour au dernier point
ne relancent pas SPICE. Le schéma et les plaques utilisent les mesures du point,
les instruments conservent leurs séries complètes. Les lectures réseau sont
sérialisées, les points mis en cache et les réponses d’un ancien calcul rejetées.

| Lot | Responsable au relais | Statut et résultat |
| --- | --- | --- |
| API des échantillons et courbes de bornes BJT | Agent backend précédent, terminé | `simulation_frames.py`, route GET et tests présents |
| Contrôleur et panneau de lecture | Pilote précédent, transmis | Implémenté ; tests purs et essai du hook réussis |
| Curseurs oscilloscope/Énergie | Agent instruments précédent, terminé | Mode contrôlé ajouté en préservant l’usage autonome |
| Carnet et provenance temporelle | Agent carnet précédent, terminé | Métadonnées du point et comparaisons testées |
| Pont MCP de lecture | Agent de préparation du relais, terminé | Indices stricts et annotations du SDK vérifiés ; test stdio réel restant |
| Suivi, consignes et prompt | Pilote de ce relais | Documents versionnés avec le code |

## File de tâches pour la reprise

Attribuer les noms effectifs dans cette table avant de commencer. Les priorités
P0 doivent être terminées avant d’ajouter une autre fonctionnalité produit.

| ID | Priorité | Tâche et critère de fin | Responsable proposé | Fichiers / coordination |
| --- | --- | --- | --- | --- |
| R1 | P0 | Vérifier la relecture dans l’application complète avec un vrai TRAN PULSE : DEL allumée/éteinte, valeurs, courants et plaques au même point ; tester lecture/pause/retour final | Pilote + QA interface | `main.tsx`, `useSimulationPlayback.ts`, composants ; un seul éditeur de `main.tsx` |
| R2 | P0 | Tester calcul remplacé, édition électrique, édition visuelle, erreur et réponse tardive ; aucune ancienne mesure ne doit être présentée comme courante | QA intégration | Contrôleur, provenance et API ; partager les anomalies avec le pilote |
| R3 | P0 | Vérifier le nouveau `simulation_frame_read` via le client MCP officiel en stdio, ses 28 outils et l’absence de mutation/relance SPICE | QA backend/MCP | Serveur de test isolé ; `backend/mcp_server.py` et tests dédiés |
| R4 | P0 | Vérifier que capture du carnet et SVG portent l’instant effectivement affiché, y compris pendant une requête lente | QA interface | Carnet, SVG, contrôleur ; ne pas confondre point demandé et point affiché |
| R5 | P1 | Versionner un scénario d’intégration reproductible pour la relecture ; documenter le contrat/API, MCP et validation finale | Pilote + QA | Les anciens scripts DOM de `work/` ne sont pas dans GitHub |
| U1 | P1 | Revue dans un vrai navigateur : lisibilité, disposition, focus, clavier, tactile et ralentissement réseau | Agent UX/QA | Capturer les défauts observés avant de corriger |
| U2 | P2 | Choisir le prochain progrès d’ergonomie à partir des défauts observés et d’un scénario utilisateur concret | Prochain pilote | Mettre à jour ce suivi avant de lancer le lot |

## Vérifications de cette publication

Résultats des contrôles du **29 octobre 2026** :

- Frontend : **198 tests Node réussis**, aucun ignoré.
- Production : **compilation TypeScript/Vite réussie**.
- Python/ngspice : **340 tests et 106 sous-tests réussis**, aucun ignoré.
- MCP ciblé : **9 tests réussis** pour le nouvel outil, ses indices stricts et
  ses annotations sérialisées. Le nouveau parcours stdio n’a pas été exécuté.
- Essai local React/DOM du hook : regroupement des requêtes, cache, remplacement
  du calcul, rejet de provenance, reprise après erreur et lecture/pause réussis.
  Cet outil exploratoire réside dans `work/` ignoré et n’est pas reproductible
  depuis un simple clone ; les tests unitaires Python/Node sont versionnés.

Les intégrations antérieures (DOM + vraie API + ngspice, ainsi que MCP réel pour
les 27 outils précédents) sont décrites dans [VALIDATION.md](VALIDATION.md).
Elles précèdent le curseur global. **La revue visuelle et le nouveau parcours
global de relecture ne sont pas validés.** Aucune parité Tinkercad n’est annoncée.

## Cadence de suivi et de publication

L’utilisateur demande de publier régulièrement pour permettre le travail d’un
autre ChatGPT. Pendant une session active :

1. Réserver la tâche ici avec le responsable effectif et les fichiers possédés.
2. À chaque jalon, consigner le résultat, les tests réellement exécutés et le
   prochain point ouvert. Publier un commit cohérent sur `work`.
3. Pour un long chantier, publier aussi des points intermédiaires explicitement
   inachevés ; ne pas attendre la fin de tout le plan pour sauvegarder sur GitHub.
4. Avant de passer le relais ou de s’arrêter, mettre à jour ce document et le
   prompt, pousser et vérifier le SHA distant. L’historique Git identifie les
   commits exacts sans inscrire dans un commit son propre SHA.

Pas de force-push, pas d’écrasement du travail concurrent. Les fichiers `.runtime/`
(circuit ouvert, bibliothèque, jeton) et les captures du navigateur ne sont pas
transférés par un push du code. Aucun travail autonome après l’arrêt n’est programmé.

## Journal des jalons

| Référence | Livraison |
| --- | --- |
| `67f834d` | Édition, instruments et bibliothèque persistante |
| `71b4c0d` | Balayages paramétriques non destructifs |
| `8a9d658` | Réactivité des éditions, gestes et historique |
| `7e0c79a` | Quatre plaques et liaisons inter-plaques |
| `52e26d8` | Exports SVG autonomes |
| `d6a9616` | Copier/coller de fragments de circuit |
| `9ecd4c7` | Inductances et expérience RLC |
| `88eae62` | Mesures de fenêtre, moyenne/RMS pondérées par le temps |
| `f26a706` | Recherche et navigation dans le circuit |
| Publication du 29 octobre 2026 | Code de relecture en cours, tests et documents de relais ; voir le commit portant cette entrée |
| `8ba014f` | Réservation des tâches R1–R5 et revue UX parallèle |
| Jalon du 30 octobre 2026 | Synchronisation sur le point affiché, provenance, MCP stdio et scénarios reproductibles ; validation visuelle encore partielle, voir le commit portant cette entrée |
