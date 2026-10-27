# Atelier Électronique

Une application locale en français pour construire un circuit, l’éditer dans un schéma et des breadboards synchronisés, le calculer avec **ngspice**, et le faire inspecter ou modifier par un véritable client **MCP**.

## Ouvrir l’application

Après installation, double-cliquez **lancer.command** sur macOS, ou lancez depuis la racine du dépôt :

```sh
./scripts/run.sh --open
```

Adresse : **http://127.0.0.1:8765**. Le terminal reste ouvert pendant l’utilisation. `Ctrl+C` arrête le service. Les projets sont enregistrés automatiquement dans `.runtime/project.json` à chaque transaction réussie. Le bouton Sauvegarder réécrit ce fichier ; Exporter crée une copie JSON transportable. Une importation ou un chargement d’exemple est annulable pendant la session. L’historique des 100 dernières éditions reste en mémoire jusqu’à l’arrêt du service. Les sélections, changements de vue et surlignages restent synchronisés sans ajouter d’étape Annuler ni effacer Rétablir.

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

## Manipuler comme sur un établi

La bibliothèque contient **13 types de composants**, dont une DEL à trois modèles de couleur et un potentiomètre à trois bornes. Un clic ajoute le composant au centre de la vue ; un glisser-déposer le place dans le schéma ou directement sur la plaque après validation de toutes ses pattes.

Trace un rectangle dans le fond du schéma pour sélectionner plusieurs éléments. **Maj+clic** complète la sélection, les **flèches** la déplacent de 10 unités (**Maj+flèches** : 1 unité), **⌘/Ctrl+A** sélectionne tout et **⌘/Ctrl+D** duplique les composants avec leurs fils internes. Les connexions externes et les placements sur la plaque ne sont pas copiés. Les masses restent la référence 0 V commune. **Espace+glisser** dans le schéma ou le bouton du milieu déplace la vue ; le zoom garde son point d’ancrage.

Double-clique un fil pour ajouter un point de passage. Ses poignées se déplacent à la souris ou au clavier ; Suppr sur une poignée retire ce point. L’inspecteur permet de changer la couleur ou de revenir au tracé automatique. Les couleurs choisies deviennent visibles lorsque **Couleur = tension** est désactivé. Le tracé et la couleur restent purement visuels ; un déplacement groupé des deux extrémités emporte les points de passage.

Les valeurs acceptent les unités et préfixes : **4,7 kΩ**, **100 nF**, **1 µF**, **5 V**. Les préréglages accélèrent les essais. L’**Assistant de montage** repère les défauts topologiques démontrés et propose une action adaptée. Le **Calcul automatique**, facultatif, recalcule après une modification électrique ; il ne relance pas le moteur pour une sélection, une couleur ou un déplacement du schéma.

## Explorer une plage de réglages

L’onglet **Balayage** fait varier une résistance, la tension d’une source continue ou la position d’un potentiomètre. Choisis un départ, une arrivée, 2 à 16 points et les deux bornes de la mesure différentielle. L’espacement peut être linéaire ou logarithmique ; le logarithme exige des valeurs strictement positives.

Chaque point lance un véritable calcul **OP** sur une copie indépendante. Le circuit actif et ses dernières mesures sont conservés. Le graphique peut montrer le courant entrant par P ou la tension différentielle ; les flèches permettent de parcourir les points et le CSV conserve leurs valeurs SI exactes. Les points qui n’ont pas convergé restent sans mesure et interrompent les segments du graphe. Le calcul est borné à 45 secondes et le bouton Arrêter interrompt la série.

Les résultats restent visibles avec leur provenance quand le circuit change. Ce balayage ne fait pas d’analyse temporelle, de tolérances statistiques ou de validation physique : les condensateurs sont ouverts en OP et les autres sources à créneaux restent à leur niveau bas. Pour balayer une source, rétablis d’abord son mode continu.

## Répartir un montage sur plusieurs plaques

Le navigateur de plaques permet d’ajouter jusqu’à **quatre breadboards** indépendantes dans le même circuit. La première conserve les noms de trous habituels (`a1`) ; les suivantes portent un préfixe (`2:a1`, `3:a1`, `4:a1`). Un même nom local ou une même couleur de rail ne relie jamais deux plaques.

Sélectionner un composant depuis le schéma retrouve sa plaque. Pour le transférer, choisis une autre plaque puis **Transférer sur la plaque…** et un trou : toutes ses pattes sont déplacées atomiquement, les fils restent attachés. Un corps physique ne peut pas être réparti entre deux plaques. Les sources, masses et sondes restent des raccordements externes pédagogiques.

Le mode **Cavalier rigide** permet de choisir un trou, changer de plaque puis choisir l’autre extrémité. Le panneau **Liaisons entre plaques** retrouve ces fils sans les dessiner à tort sur des coordonnées locales superposées. Une plaque occupée ne peut pas être supprimée ; seule la dernière plaque vide peut être retirée. Le réglage de coupure des rails à la colonne 15 s’applique à toutes les plaques, dont les bandes restent indépendantes.

**Implanter depuis le schéma** répartit jusqu’à douze composants par plaque en conservant tous les réseaux. L’aperçu permet de consulter chaque plaque avant d’appliquer le plan. Le soustracteur dépasse encore cette capacité automatique et ne prétend pas disposer d’une implantation physique complète. L’exemple **Deux plaques · un pont diviseur** fournit un montage directement vérifiable à 2,5 V.

## Garder plusieurs circuits

**Mes circuits → Conserver une copie** enregistre un instantané indépendant dans la bibliothèque du service, avec sa date et son nombre de composants. Les **12 copies** survivent au redémarrage du serveur dans le même environnement. La bibliothèque est stockée dans `.runtime/projects.json`, séparément du circuit actif. À la limite, une nouvelle copie est refusée plutôt qu’une ancienne effacée.

Ouvrir une copie remplace le circuit actif et reste annulable. Chaque copie peut être exportée sans l’ouvrir. Supprimer une copie ne modifie pas le circuit ouvert. Ces fichiers résident sur la machine qui exécute l’application : dans une session cloud, ils restent dans cet environnement ; aucune synchronisation GitHub ou publication externe n’est automatique. **Exporter** conserve une copie JSON transportable sur l’appareil de l’utilisateur.

## Première expérience : vérifier la loi d’Ohm

1. Ouvrir l’exemple **Loi d’Ohm · 5 V / 1 kΩ**. Les deux vues présentent le même modèle électrique.
2. Cliquer **Calculer OP** : la résistance conduit **5 mA**. Le courant de la source est négatif, car la convention positive entre par sa borne `p` et la source fournit de l’énergie. **Animer les courants** / **Pause des points** pilote ensuite la lecture visuelle, indépendamment du calcul.
3. Cliquer R1 ou sa carte de mesure, changer sa valeur à **2000** et appliquer avec ✓. Les valeurs précédentes sont signalées comme obsolètes.
4. Recalculer : **2,5 mA**. Le voltmètre différentiel mesure entre deux bornes au choix.
5. Annuler pour retrouver la valeur précédente. Déplacer ou sélectionner un composant n’invalide pas les résultats électriques.

Cliquer une borne puis une autre crée un fil. Une jonction explicite permet de réunir plusieurs branches. Un croisement de traits ne crée jamais de connexion. `W` active le câblage, `V` la sélection, `R` tourne la sélection de 90° dans le schéma (`Maj+R` en sens inverse), `Échap` annule le geste ; Suppr supprime la sélection ; `⌘Z`/`Ctrl+Z` annule, Maj rétablit. La rotation est aussi disponible dans la barre d’outils et l’inspecteur. Le zoom et le bouton Centrer permettent d’explorer un grand schéma.

La breadboard est une vue plane : glisser le corps déplace toutes les pattes, glisser une patte la déplace seule. On peut aussi choisir une borne puis cliquer un trou, utiliser les flèches au clavier, ou saisir le nom du trou. **A–E** sont reliés par colonne, **F–J** constituent un autre groupe. Le canal central isole les deux côtés. Les quatre rails peuvent être coupés après la colonne 15. Une couleur de rail ne crée aucune connexion entre ses segments. **Cavalier rigide** relie deux trous par des jonctions et un fil du modèle, dessiné avec des angles droits. Une rotation qui réunirait des pattes auparavant séparées sur une même bande est refusée.

**Implanter depuis le schéma** propose un placement espacé et prévisualisable, à appliquer ou annuler. Cette opération conserve tous les réseaux, y compris les connexions qui reposaient uniquement sur les bandes métalliques, en ajoutant les cavaliers nécessaires. Elle accueille jusqu’à 12 composants physiques par plaque, sur 1 à 4 plaques ; les alimentations, masses et sondes sont des raccordements externes. Déplacer ensuite un composant peut changer les contacts physiques : les bornes et les fils restent partagés entre les deux vues, mais les positions du schéma et de la plaque sont indépendantes.

Les bandes de breadboard participent réellement au calcul. Une liaison par une bande, sans fil explicite, apparaît en pointillés dans le schéma. Survoler un trou montre le réseau commun ; sélectionner un composant le retrouve dans les deux vues. Les modèles indiquent explicitement les bornes électriques et le brochage pédagogique : aucune silhouette n’est interprétée comme une fiche constructeur.

## Couleurs et animation des électrons

La barre de visualisation propose **Couleur = tension**, une échelle réglable (±5 V par défaut), le sens **Électrons −** ou **Courant conventionnel +**, la vitesse visuelle et la pause. Vert indique un potentiel positif par rapport à la masse, gris 0 V, bleu un potentiel négatif ; une tension inconnue est grise avec un fil pointillé. La couleur sature aux limites de l’échelle ; les valeurs numériques restent exactes.

Les points sont une représentation symbolique du transport des charges. Dans les conducteurs métalliques, les électrons vont à l’opposé du courant conventionnel. Le réglage de vitesse ne décrit aucune vitesse physique de dérive ni propagation. Les courants inférieurs à 1 nA sont masqués, et une mesure devenue obsolète suspend l’animation jusqu’au recalcul. Le réglage système de réduction des animations impose la pause au démarrage ; l’utilisateur peut ensuite activer explicitement la lecture.

**OP** calcule l’état continu stabilisé : les points peuvent défiler si un courant existe, sans maintenir ngspice en fonctionnement. Un condensateur est ouvert dans cet état. **TRAN** calcule l’évolution temporelle, par exemple sa charge sous une source continue. Les courbes représentent cette évolution ; les points utilisent les courants du dernier instant calculé. **Arrêter le calcul** interrompt uniquement un calcul en cours ; **Pause des points** interrompt l’animation.

Les courants des composants proviennent du calcul ngspice. Pour un **fil idéal dans une boucle de conducteurs**, la répartition peut ne pas être unique : `wire_currents` reste alors nul au sens JSON (`null`), avec un statut explicite `underdetermined`. Des trajets indicatifs conservant le bilan de courant servent seulement à l’animation. Les fils dont le courant est déterminé par le bilan sont identifiés `unique`. Le survol et la légende distinguent ces cas ; un trajet d’animation n’est jamais présenté comme une mesure supplémentaire.

## Exemples et mesures

### Explorer et garder une trace

Le bouton **Explorer les expériences** ouvre onze fiches illustrées : loi d’Ohm, pont diviseur, charge RC, diode, DEL, potentiomètre, créneaux RC, NPN, PNP, montage sur deux plaques et soustracteur. Chaque fiche propose une prédiction théorique et une modification à essayer. Les filtres permettent de choisir les premiers pas, les transistors ou la logique. Charger une expérience est annulable avec **Annuler** dans l’atelier.

La bibliothèque possède une recherche insensible aux accents et des filtres **Tous**, **Essentiels** et **Actifs**. Cliquer un composant l’ajoute au circuit.

Le **Carnet de labo**, accessible dans les résultats ou la barre latérale, conserve les tensions et courants d’un calcul réussi avec une note facultative. Capture une référence, change une valeur, recalcule, puis lis les écarts signés. Deux captures enregistrées peuvent aussi être comparées. Les connexions, le type d’analyse et, en temporel, l’instant et les conditions initiales doivent correspondre ; les mesures obsolètes ne peuvent pas être capturées.

Les **12 captures les plus récentes**, tous projets confondus, restent dans ce navigateur. Elles sont distinctes du fichier projet et exportables en JSON. Si le stockage est indisponible, elles restent accessibles pendant la session et un message invite à les exporter. La suppression d’une capture libère sa place.

Onze projets importables dans `examples/` : loi d’Ohm, diviseur, diode, DEL, potentiomètre, NPN, PNP, charge RC, créneaux RC, diviseur sur deux plaques et soustracteur 2 bits. L’exemple RC choisit une analyse temporelle ; les courbes peuvent être activées individuellement. Les tensions et les courants ont des graphes avec des échelles distinctes. Les mesures temporelles de l’inspecteur sont celles du dernier instant calculé.

L’oscilloscope possède un **curseur** à la souris, au toucher et au clavier (flèches, Début, Fin), avec lecture exacte des échantillons. Le zoom se centre sur ce curseur ; Réinitialiser retrouve toute la durée. L’export CSV contient tous les échantillons des courbes sélectionnées, même lorsque le graphe est zoomé. Les tensions et courants conservent des graphes séparés.

La **DEL** utilise un courant calculé par ngspice. La luminosité est symbolique et suspendue lorsque les mesures sont obsolètes. Un dépassement du seuil pédagogique de **20 mA**, y compris un pic transitoire, apparaît dans les diagnostics ; aucun modèle thermique ou de destruction n’est simulé. Le **potentiomètre linéaire** expose les courants entrants P, W et N ; sa valeur affichée est la résistance totale, son curseur va de 0 à 100 %.

Dans l’inspecteur d’une source, **Signal → Créneau** configure niveaux bas/haut, montée, descente, plateau, période et retard. Appliquer le signal modifie le modèle ; choisir **TRAN** permet d’observer ses impulsions réelles. **OP** utilise son niveau bas. Seuls ces paramètres numériques typés sont acceptés, sans directive SPICE libre.

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

## Limites actuelles

- Boîtiers pédagogiques à bornes libres ; pas de contrainte mécanique de pas, d’encombrement ou d’orientation d’un véritable boîtier TO-92. Jusqu’à quatre breadboards ; coupure des rails uniquement au milieu, réglage commun à toutes les plaques.
- Routage orthogonal simple ; un grand schéma reste dense. Pas de bibliothèque constructeur importable, de sous-circuits repliables ou de modèle thermique.
- Sources continues ou créneaux périodiques ; commutateurs statiques pendant une analyse, sans rebond de bouton ni programme de microcontrôleur. Le transitoire démarre par défaut avec condensateurs déchargés, hypothèse indiquée dans les résultats.
- Point continu et transitoire ; animation symbolique des charges, sans calcul microscopique des électrons. Pas d’AC, d’analyse de tolérances ou d’oscilloscope déclenché.
- Synchronisation UI/MCP par interrogation toutes les secondes ; un seul projet actif autorisé, un seul calcul à la fois. L’historique et les résultats ne survivent pas au redémarrage ; le circuit oui.
- Limites moteur : 300 composants, 12 s par calcul, 8 s CPU, 512 Mio, fichier RAW 24 Mio, 6 000 points conservés, analyse jusqu’à 10 s avec au plus 5 900 intervalles demandés, 32 cas par table.

Prochaines étapes : contraintes de boîtiers constructeur, sous-circuits pédagogiques, modèles constructeur documentés, autres formes de stimuli et microcontrôleurs. **Une simulation ne valide pas automatiquement un montage physique.**

Documentation officielle consultée pour cette intégration : [ngspice et manuel actuel](https://ngspice.sourceforge.io/docs.html), [mode batch](https://nmg.gitlab.io/ngspice-manual/analysesandoutputcontrol_batchmode.html), [SDK MCP Python et transports](https://py.sdk.modelcontextprotocol.io/run/).
