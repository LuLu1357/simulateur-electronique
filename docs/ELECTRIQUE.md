# Moteur et exemples vérifiés

`backend/simulation.py` compile le modèle partagé en netlist ngspice. Les coordonnées du dessin ne participent pas aux calculs. Les fils et les bandes métalliques de breadboard fusionnent les mêmes bornes dans `backend.domain.topology`. Des lignes qui se croisent ne fusionnent jamais implicitement les réseaux.

Le moteur est exécuté en sous-processus dans un répertoire temporaire fermé, avec `ngspice -n -b` ; un petit lanceur dédié `backend/spice_worker.py` fixe ses propres limites de ressources puis appelle `os.execv`, sans `preexec_fn` dans le serveur multithread. `-n` ignore les fichiers d'initialisation personnels. Les noms SPICE sont générés et les valeurs numériques validées. Le client ne peut pas transmettre de directives `.include`, de script ngspice, de modèle arbitraire ni de chemin de fichier. Le fichier RAW ASCII contient les tensions et les courants réellement calculés. Le résultat conserve la netlist et le journal même en cas d'échec.

Sources officielles consultées le 27 octobre 2026 : [documentation ngspice](https://ngspice.sourceforge.io/docs.html), [tutoriel du langage de contrôle](https://ngspice.sourceforge.io/ngspice-control-language-tutorial.html), [format de sortie RAW](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf). Le moteur installé et utilisé pour les tests est ngspice 47.

## Conventions et hypothèses

Toutes les valeurs du projet sont en unités SI : ohms, farads et volts. Les courants retournés sont en ampères. Une source qui fournit de l'énergie a un courant négatif avec la convention p → n. Pour une diode, le sens positif est A → K. Pour un transistor, le courant principal est le courant entrant au collecteur ; `terminal_currents` donne les courants entrants C, B et E, dont la somme vérifie la loi des nœuds.

La diode est générique : Is = 10 fA, N = 1, Rs = 0,1 Ω. Les NPN/PNP sont génériques : Is = 1 fA, β nominal = 100, VAF = 100 V, température = 27 °C. Aucune de ces valeurs ne représente une fiche constructeur certifiée. Chaque boîtier pédagogique déclare ses bornes ; sa silhouette ne définit jamais un brochage réel.

Les interrupteurs et boutons fermés valent 0,01 Ω, ouverts 10¹² Ω : cette fuite explicite évite de prétendre à une isolation infinie. Les condensateurs sont ouverts au point de fonctionnement continu. Le transitoire démarre par défaut avec UIC et la tension initiale déclarée sur chaque condensateur (0 V si absente). `startup:false` demande un départ depuis le point de fonctionnement DC, où un condensateur alimenté depuis longtemps peut être déjà chargé.

Les fils et contacts de breadboard sont idéaux. Le calcul omet leurs résistances, parasites, tolérances, échauffements et limites de puissance. Une simulation ne valide pas automatiquement un montage physique.

## Exemples

- **Loi d'Ohm** : 5 V et 1 kΩ, courant calculé 5,000 mA.
- **Pont diviseur** : 1 kΩ + 1 kΩ sous 5 V, milieu à 2,500 V ; sonde différentielle disponible.
- **Diode** : résistance de 1 kΩ en série ; conduction directe d'environ 4,307 mA et courant inverse inférieur à 10 nA à −5 V avec ce modèle.
- **NPN / PNP** : résistance de base de 10 kΩ et charge collecteur de 1 kΩ ; commande active d'environ 4,929 mA et blocage contrôlé par une seconde source.
- **RC** : 1 kΩ, 1 µF, τ = 1 ms ; comparaison numérique à `5 × (1 − exp(−t/τ))`.
- **Soustracteur à deux bits** : 20 NAND, chacune avec deux NPN en série, rappel de 1 kΩ et deux résistances de base de 47 kΩ. Le circuit complet contient 106 composants. Les 16 combinaisons sont de véritables calculs analogiques indépendants ; Python calcule seulement la colonne attendue. Les seuils d'interprétation sont ≤ 1,5 V pour 0, ≥ 3,5 V pour 1, intervalle intermédiaire indéterminé. Les sorties observées sont environ 0,251 V ou 5 V dans ces essais. Le résultat D1 D0 est modulo 4 et l'emprunt final est séparé : pour A = 0, B = 1, le résultat est D1 D0 = 11 et emprunt = 1.

Le soustracteur dépasse une breadboard unique de 30 colonnes. Les bornes qui ne rentrent pas restent explicitement hors plaque (`breadboard_note`) ; elles ne sont pas arbitrairement superposées dans un trou. Le schéma électrique garde le circuit complet. Étendre l'éditeur à plusieurs plaques constitue une suite nécessaire avant une reproduction physique intégrale.

## Limites d'exécution

Maximum : 300 composants, 12 s de temps réel par calcul, 8 s CPU, 512 Mio de mémoire résidente surveillée, 24 Mio par fichier, 6 000 échantillons de sortie, durée transitoire 10 s. L'annulation termine le groupe du sous-processus. Une table de vérité contient de 1 à 32 cas et peut être arrêtée entre les cas ou pendant un calcul. Les seuils invalides et les modèles non autorisés sont refusés.

## Résultats reproductibles

Depuis le dossier du projet :

```sh
.venv/bin/python -m pytest tests/test_electrical.py -q
```

Le rapport détaillé des 16 cas est écrit dans `docs/results-electric.json` ; il conserve entrées appliquées, tensions, seuils, interprétation logique, attente, observation et convergence. Les projets JSON du dossier `examples` peuvent être importés dans l'application.

## Couleur de tension et déplacement pédagogique

`backend/flow.py` utilise les courants réellement calculés aux bornes des composants et applique la loi des nœuds au graphe conducteur complet : fils, placements, bandes de breadboard et masses communes. Le champ `wire_currents` donne un courant orienté de l'extrémité `a` vers l'extrémité `b` uniquement lorsque celui-ci est déterminé de façon unique. Cela correspond aux fils qui sont des ponts du graphe conducteur. Le champ `wire_current_status` distingue `unique`, `underdetermined` et `unavailable`.

Dans une boucle de conducteurs idéaux, connaître la tension commune et les courants des composants ne détermine pas la répartition entre les chemins parallèles. Le programme retourne donc `null`, jamais une fausse mesure à 0 A. C'est notamment le cas lorsqu'un fil explicite double déjà une bande métallique de la plaque.

Pour illustrer malgré tout le trajet du courant, `wire_flow_hints` choisit un arbre privilégiant les fils explicites, puis applique la même loi des nœuds. Le champ `wire_flow_hint_kind` vaut `pedagogical_path` : ces valeurs définissent un trajet illustratif compatible avec les courants des composants, pas des mesures de courant de chaque fil. Elles ne doivent pas être utilisées pour dimensionner un montage. Le déplacement des électrons dans les métaux est opposé au courant conventionnel ; sa vitesse d'animation ne représente pas une vitesse microscopique réelle. Les flux correspondent au dernier point calculé (`flow_sample: last_calculated_point`) ; un transitoire peut donc afficher le flux final tandis que ses courbes conservent toute l'évolution.

Tests dédiés : `tests/test_flow.py` vérifie les signes, les dérivations, les fils en pont, les boucles indéterminées, les rails coupés, les masses communes, les trois courants C/B/E et le respect de la conservation sur le trajet pédagogique. Si un courant manque ou si le bilan numérique est insuffisant, les flux concernés restent indisponibles avec diagnostic explicite.
