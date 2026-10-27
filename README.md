# Atelier Électronique

Une application locale en français pour construire un circuit, l’éditer dans un schéma et une breadboard synchronisés, le calculer avec **ngspice**, et le faire inspecter ou modifier par un véritable client **MCP**.

## Ouvrir l’application

Après installation, double-cliquez **lancer.command** sur macOS, ou lancez depuis la racine du dépôt :

```sh
./scripts/run.sh --open
```

Adresse : **http://127.0.0.1:8765**. Le terminal reste ouvert pendant l’utilisation. `Ctrl+C` arrête le service. Les projets sont enregistrés automatiquement dans `.runtime/project.json` à chaque transaction réussie. Le bouton Sauvegarder réécrit ce fichier ; Exporter crée une copie JSON transportable. Une importation ou un chargement d’exemple est annulable pendant la session. L’historique des 100 dernières transactions reste en mémoire jusqu’à l’arrêt du service.

Le service n’écoute que sur la boucle locale. Les fichiers et simulations restent sur cet ordinateur. L’interface compilée fonctionne sans accès Internet et utilise les polices du système.

## Installer sur une autre machine

Prérequis : **Python 3.11+**, **Node.js 20.19+ ou 22.12+**, npm et **ngspice** dans le PATH. Intégration vérifiée ici avec Python 3.14, ngspice 47 et SDK MCP officiel Python 2.3.0. Le worker de simulation utilise les limites POSIX ; macOS/Linux sont les systèmes pris en charge dans cette version.

```sh
# macOS, si nécessaire
brew install ngspice
# Debian / Ubuntu : sudo apt install ngspice
./scripts/install.sh
./scripts/run.sh --open
```

L’installation crée `.venv`, installe les dépendances verrouillées et compile React. Aucun service cloud et aucune inscription ne sont nécessaires.

Pour développer : `npm run dev --prefix frontend` et `.venv/bin/python -m uvicorn backend.server:app --host 127.0.0.1 --port 8765`. Utiliser de préférence la version compilée sur 8765 : le contrôle d’origine protège l’API. Le proxy Vite doit réécrire l’origine vers le service local.

## Première expérience : vérifier la loi d’Ohm

1. Ouvrir l’exemple **Loi d’Ohm · 5 V / 1 kΩ**. Les deux vues présentent le même modèle électrique.
2. Cliquer **Calculer OP** : la résistance conduit **5 mA**. Le courant de la source est négatif, car la convention positive entre par sa borne `p` et la source fournit de l’énergie. **Animer les courants** / **Pause des points** pilote ensuite la lecture visuelle, indépendamment du calcul.
3. Cliquer R1 ou sa carte de mesure, changer sa valeur à **2000** et appliquer avec ✓. Les valeurs précédentes sont signalées comme obsolètes.
4. Recalculer : **2,5 mA**. Le voltmètre différentiel mesure entre deux bornes au choix.
5. Annuler pour retrouver la valeur précédente. Déplacer ou sélectionner un composant n’invalide pas les résultats électriques.

Cliquer une borne puis une autre crée un fil. Une jonction explicite permet de réunir plusieurs branches. Un croisement de traits ne crée jamais de connexion. `W` active le câblage, `V` la sélection, `R` tourne la sélection de 90° dans le schéma (`Maj+R` en sens inverse), `Échap` annule le geste ; Suppr supprime la sélection ; `⌘Z`/`Ctrl+Z` annule, Maj rétablit. La rotation est aussi disponible dans la barre d’outils et l’inspecteur. Le zoom et le bouton Centrer permettent d’explorer un grand schéma.

La breadboard est une vue plane : glisser le corps déplace toutes les pattes, glisser une patte la déplace seule. On peut aussi choisir une borne puis cliquer un trou, utiliser les flèches au clavier, ou saisir le nom du trou. **A–E** sont reliés par colonne, **F–J** constituent un autre groupe. Le canal central isole les deux côtés. Les quatre rails peuvent être coupés après la colonne 15. Une couleur de rail ne crée aucune connexion entre ses segments. **Cavalier rigide** relie deux trous par des jonctions et un fil du modèle, dessiné avec des angles droits. Une rotation qui réunirait des pattes auparavant séparées sur une même bande est refusée.

**Implanter depuis le schéma** propose un placement espacé et prévisualisable, à appliquer ou annuler. Cette opération conserve tous les réseaux, y compris les connexions qui reposaient uniquement sur les bandes métalliques, en ajoutant les cavaliers nécessaires. Elle accueille jusqu’à 12 composants physiques sur cette plaque ; les alimentations, masses et sondes sont des raccordements externes. Déplacer ensuite un composant peut changer les contacts physiques : les bornes et les fils restent partagés entre les deux vues, mais les positions du schéma et de la plaque sont indépendantes.

Les bandes de breadboard participent réellement au calcul. Une liaison par une bande, sans fil explicite, apparaît en pointillés dans le schéma. Survoler un trou montre le réseau commun ; sélectionner un composant le retrouve dans les deux vues. Les modèles indiquent explicitement les bornes électriques et le brochage pédagogique : aucune silhouette n’est interprétée comme une fiche constructeur.

## Couleurs et animation des électrons

La barre de visualisation propose **Couleur = tension**, une échelle réglable (±5 V par défaut), le sens **Électrons −** ou **Courant conventionnel +**, la vitesse visuelle et la pause. Vert indique un potentiel positif par rapport à la masse, gris 0 V, bleu un potentiel négatif ; une tension inconnue est grise avec un fil pointillé. La couleur sature aux limites de l’échelle ; les valeurs numériques restent exactes.

Les points sont une représentation symbolique du transport des charges. Dans les conducteurs métalliques, les électrons vont à l’opposé du courant conventionnel. Le réglage de vitesse ne décrit aucune vitesse physique de dérive ni propagation. Les courants inférieurs à 1 nA sont masqués, et une mesure devenue obsolète suspend l’animation jusqu’au recalcul. Le réglage système de réduction des animations impose la pause au démarrage ; l’utilisateur peut ensuite activer explicitement la lecture.

**OP** calcule l’état continu stabilisé : les points peuvent défiler si un courant existe, sans maintenir ngspice en fonctionnement. Un condensateur est ouvert dans cet état. **TRAN** calcule l’évolution temporelle, par exemple sa charge sous une source continue. Les courbes représentent cette évolution ; les points utilisent les courants du dernier instant calculé. **Arrêter le calcul** interrompt uniquement un calcul en cours ; **Pause des points** interrompt l’animation.

Les courants des composants proviennent du calcul ngspice. Pour un **fil idéal dans une boucle de conducteurs**, la répartition peut ne pas être unique : `wire_currents` reste alors nul au sens JSON (`null`), avec un statut explicite `underdetermined`. Des trajets indicatifs conservant le bilan de courant servent seulement à l’animation. Les fils dont le courant est déterminé par le bilan sont identifiés `unique`. Le survol et la légende distinguent ces cas ; un trajet d’animation n’est jamais présenté comme une mesure supplémentaire.

## Exemples et mesures

Sept projets importables dans `examples/` : loi d’Ohm, diviseur, diode, NPN, PNP, charge RC, soustracteur 2 bits. L’exemple RC choisit une analyse temporelle ; les courbes peuvent être activées individuellement. Les tensions et les courants ont des graphes avec des échelles distinctes. Les mesures temporelles de l’inspecteur sont celles du dernier instant calculé.

La case Courant montre le **courant conventionnel calculé dans chaque composant**, avec le sens inverse si la valeur est négative. Pour un transistor, la flèche de branche représente le courant collecteur ; les courants C/B/E sont consultables par MCP. Il ne s’agit pas d’un traçage unique des courants dans les fils d’un réseau ramifié.

Les diagnostics distinguent `connection` (défaut topologique démontré), `solver` (problème numérique ou limite du moteur) et `hypothesis` (explication à tester). Une résistance de rappel sur un point peu chargé est une hypothèse à tester, pas une correction garantie. Les données du dernier calcul réussi restent disponibles après un échec avec leur provenance et leur état d’obsolescence.

## MCP : lire et modifier le même circuit

Voir **[docs/mcp.md](docs/mcp.md)** et les configurations fournies. Le pont stdio utilise le SDK officiel et se connecte au service local ; il ne crée jamais une copie indépendante du circuit.

- Serveur HTTP démarré : `/api/health` le confirme.
- Client MCP connecté : le client officiel l’observe après ouverture de sa connexion.
- Outils accessibles : `list_tools()` puis de vrais appels le vérifient.

Le test livré démontre ces trois étapes. Le simple démarrage du service ne signifie pas que Codex a chargé sa configuration MCP : cette configuration est fournie, mais n’est pas ajoutée automatiquement à la configuration personnelle de Codex.

```sh
# Avec l’application démarrée, le test modifie temporairement puis restaure le projet.
.venv/bin/python scripts/test_mcp.py
```

Le MCP peut inspecter, suivre un réseau, tester une continuité, valider, simuler, arrêter, mesurer, lancer les combinaisons, comparer une table de vérité, surligner, annoter et modifier le circuit. Toute mutation utilise une révision attendue ; une transaction est atomique, prévisualisable et annulable. Ni outil shell, ni netlist libre, ni chemin de fichier fourni par le client ne sont exposés.

## Soustracteur à deux bits

L’exemple contient **20 portes NAND à transistors NPN, soit 106 composants**. Les sorties observées proviennent des tensions calculées par ngspice. Python produit seulement les valeurs attendues pour la comparaison.

**A = A1 A0**, **B = B1 B0** ; emprunt d’entrée nul. **D1 D0 = (A − B) modulo 4** et **Borrow = 1 si A < B**. Par exemple, 0 − 1 donne `D1 D0 = 11` et `Borrow = 1` : le `11` affiché vaut 3 modulo 4 ; ce n’est pas un nombre signé.

L’onglet Table de vérité teste les **16 combinaisons sur une copie de l’exemple** ; pour tester le circuit courant modifié, utiliser l’outil MCP `truth_table_test` sans `example`. Chaque essai conserve entrées, tensions appliquées, tensions de sortie, seuils, interprétation, attendu, observé et convergence. Les seuils par défaut sont ≤ 1,5 V pour 0 et ≥ 3,5 V pour 1 ; la zone intermédiaire reste indéterminée. Le rapport JSON est exportable depuis l’interface. Les sorties ne sont pas qualifiées pour une charge physique.

Le circuit est plus grand qu’une seule breadboard de 30 colonnes. Les bornes non placées sont signalées ; aucune implantation physique complète n’est prétendue.

## Vérifier le projet

```sh
.venv/bin/python -m pytest -q
npm run build --prefix frontend
npm test --prefix frontend
# Service démarré : test de protocole réel, mutations et 16 combinaisons
.venv/bin/python scripts/test_mcp.py
```

Résultats et preuves : [docs/VALIDATION.md](docs/VALIDATION.md), [rapport électrique](docs/results-electric.json), [rapport MCP](docs/results-mcp.json). Architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Modèles et limites moteur : [docs/ELECTRIQUE.md](docs/ELECTRIQUE.md).

## Limites de cette première version

- Boîtiers pédagogiques à bornes libres ; pas de contrainte mécanique de pas, d’encombrement ou d’orientation d’un véritable boîtier TO-92. Une seule breadboard, rail coupé uniquement au milieu.
- Routage orthogonal simple ; un grand schéma reste dense. Pas de routage manuel multisegment, de bibliothèque constructeur importable, de sous-circuits repliables ou de modèle thermique.
- Sources continues et commutateurs statiques pendant une analyse ; pas encore de générateur de formes d’onde ou de rebonds de bouton. Le transitoire démarre par défaut avec condensateurs déchargés, hypothèse indiquée dans les résultats.
- Point continu et transitoire ; animation symbolique des charges, sans calcul microscopique des électrons. Pas d’AC, d’analyse de tolérances ou d’oscilloscope déclenché.
- Synchronisation UI/MCP par interrogation toutes les secondes ; un seul projet actif autorisé, un seul calcul à la fois. L’historique et les résultats ne survivent pas au redémarrage ; le circuit oui.
- Limites moteur : 300 composants, 12 s par calcul, 8 s CPU, 512 Mio, fichier RAW 24 Mio, 6 000 points conservés, analyse jusqu’à 10 s avec au plus 5 900 intervalles demandés, 32 cas par table.

Prochaines étapes : plusieurs plaques avec contraintes de boîtiers, routage éditable, sous-circuits pédagogiques, modèles constructeur documentés et stimuli temporels. **Une simulation ne valide pas automatiquement un montage physique.**

Documentation officielle consultée pour cette intégration : [ngspice et manuel actuel](https://ngspice.sourceforge.io/docs.html), [mode batch](https://nmg.gitlab.io/ngspice-manual/analysesandoutputcontrol_batchmode.html), [SDK MCP Python et transports](https://py.sdk.modelcontextprotocol.io/run/).
