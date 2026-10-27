# Architecture locale — v0.1

Le choix React/TypeScript + Python permet une interface interactive et un service électrique testable indépendamment du navigateur. ngspice fonctionne comme un processus isolé ; son échec ne détruit jamais le projet. Le MCP officiel stdio sert de pont vers le même service.

```text
React : schéma / breadboard / inspecteur / courbes
                  │ API locale JSON
Client MCP ─ SDK officiel stdio ─ pont HTTP
                  │
              FastAPI (127.0.0.1:8765)
                  │
      Store : projet canonique, révision, transactions
        │               │                 │
  positions SVG   trous physiques   union-find réseaux
                  │
         netlist typée, modèles autorisés
                  │
        processus ngspice + limites/arrêt
                  │
       RAW réel → mesures, courbes, diagnostics
```

## Séparation des responsabilités

| Module | Responsabilité |
| --- | --- |
| `backend/domain.py` | Schéma versionné, catalogue et bornes, graphe électrique, topologie physique, transactions, historique, sauvegarde |
| `project.schematic` | Positions, rotations, jonctions explicites ; aucun raccord déduit d’un croisement |
| `project.breadboard` | Affectation des bornes aux trous et configuration des coupures |
| `backend/examples.py` | Circuits et spécifications de tables de vérité reproductibles |
| `backend/simulation.py` | Compilation de la netlist typée, ngspice, lecture RAW, mesures, comparaisons logiques |
| `backend/flow.py` | Bilans de courant des fils, ambiguïtés des boucles idéales et trajets illustratifs séparés des mesures |
| `backend/server.py` | Service métier unique et sécurité HTTP, sauvegarde autorisée, coordination des calculs |
| `backend/project_library.py` | Copies persistantes bornées, fichier fixe, validation et remplacement atomique |
| `backend/mcp_server.py` | Outils MCP limités au simulateur ; transfert aux mêmes opérations HTTP |
| `frontend/src/types.ts` | Contrat TypeScript, conversions d’affichage, coordonnées des bornes |
| `frontend/src/connectivity.ts` | Routage visuel et représentation des connexions créées par les bandes |
| `frontend/src/visuals.ts` / `components/FlowParticles.tsx` | Couleurs de potentiel et points animés, sens des charges, vitesse symbolique |
| `frontend/src/api.ts` | Accès au service et jeton local |
| `frontend/src/main.tsx` | Orchestration de l’éditeur, gestes, sélection, calcul et intégration des panneaux |

Le projet JSON v1 est la source de vérité. Composants, bornes, fils et jonctions ont des identifiants stables. Les réseaux ont une identité déterministe ancrée sur une borne ; séparer ou fusionner des réseaux peut modifier cette identité, les bornes conservent leur ID. Un nom de réseau ne crée jamais à lui seul une connexion.

La continuité est l’union des fils explicites, des bandes métalliques, des affectations de bornes et des références de masse. Les deux vues interrogent le même graphe. Un changement de placement peut donc modifier le calcul ; un déplacement graphique du schéma ne le modifie pas.

## Révision, transactions et résultats

Une opération métier produit une copie candidate, applique toutes les opérations, valide l’ensemble puis remplace atomiquement l’état et le fichier sauvegardé. Le contrôle `expected_revision` refuse un écrasement concurrent. Une prévisualisation retourne le candidat sans modifier l’état ni son historique. Undo/redo conservent des révisions croissantes.

L’empreinte électrique porte sur composants/valeurs/modèles/connexions/placements/coupures/conditions initiales. Les résultats conservent leur révision d’origine et cette empreinte. Une sélection ou une annotation peut changer la révision sans rendre les mesures obsolètes ; une modification électrique les rend obsolètes. Après annulation, des résultats ayant la même empreinte redeviennent utilisables.

Un calcul utilise un instantané immuable. Les modifications et la demande d’arrêt restent accessibles pendant son exécution. Un résultat calculé sur l’ancien circuit conserve son origine et ne devient pas le résultat courant par simple arrivée tardive. Un échec conserve netlist, journal et diagnostics ; le dernier succès est accessible séparément.

## Frontière locale

HTTP écoute sur 127.0.0.1 ; Host et Origin sont vérifiés ; aucun CORS permissif ; requêtes de mutation protégées par un jeton aléatoire en fichier de droits 0600. Le navigateur obtient ce jeton depuis la même origine. Le serveur n’est pas une frontière de sécurité entre comptes/processus locaux ayant les mêmes droits.

Le pont MCP utilise un endpoint local fixe et le jeton du répertoire autorisé. Les projets sont échangés en contenu JSON, jamais par chemin arbitraire. La netlist utilise une liste fermée de composants et modèles ; aucune directive SPICE libre, inclusion, shell ou outil d’accès général au disque n’est exposé.

Le serveur MCP peut être lancé par un client sans port entrant supplémentaire ; seul le service HTTP de l’application demeure. La connexion d’un client MCP est vérifiée par ce client ; le service HTTP n’invente pas son statut à partir de la seule présence du programme.


## Instruments et édition avancée

`components/Oscilloscope.tsx` et `scope.ts` portent le curseur, le zoom et l’export CSV ; ils n’interpolent aucune mesure présentée comme un résultat exact. `coach.ts` interprète les diagnostics et les mesures réelles pour le panneau d’aide. `notebook.ts` conserve des captures bornées dans le navigateur, avec valeurs et provenance des modèles, curseurs et stimuli. Les anciens carnets restent lisibles ; une provenance manquante est signalée.

`editing.ts` calcule des transactions de déplacement et de duplication sans modifier le modèle vivant. `units.ts` parse une notation SI limitée sans évaluer d’expression. Les gestes de pointeur sont nettoyés à l’annulation, à la perte de focus et au changement de projet. Le calcul automatique est retardé et dédoublonné sur la signature électrique, avec une seule tentative par état en cas d’échec.

Les champs `wire.color` et `wire.waypoints` ne participent pas à l’empreinte électrique. `potentiometer.position` et `voltage_source.waveform`, eux, invalident les mesures. Les créneaux sont compilés depuis sept nombres contrôlés et une forme autorisée, jamais depuis une chaîne SPICE fournie par l’utilisateur.

La bibliothèque serveur (`.runtime/projects.json`) conserve douze copies au maximum, distinctes du circuit actif. Les routes `/api/projects`, `/api/projects/save`, `/api/projects/load` et `/api/projects/delete` utilisent les mêmes contrôles d’origine et de jeton. Sauvegarde et chargement vérifient la révision ; le chargement passe par l’historique transactionnel. Un fichier illisible empêche toute écriture pour préserver les copies existantes.
