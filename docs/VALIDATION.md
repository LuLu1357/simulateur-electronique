# Validation de l’atelier étendu — 28 octobre 2026

Cette session a vérifié le projet dans un environnement cloud Debian 13, Python 3.12.14, Node 24.19.0 et ngspice 47 extrait dans un répertoire de travail.

- **292 tests Python et 106 sous-tests réussis**, sans simulation électrique de remplacement ni test ignoré.
- **164 tests frontend Node réussis**, et compilation TypeScript/Vite de production réussie.
- **MCP réel**, SDK 2.3.0 / protocole 2026-07-28 : connexion, outils, transactions, conflits, annulation/rétablissement, mesure réelle de 2,5 mA et 16 cas du soustracteur réussis. Projet du serveur d’essai restauré ; serveur de test indépendant des données utilisateur.
- **React + DOM et vraie API + ngspice**, sur un serveur isolé : saisie SI, sélection multiple, déplacement, duplication/suppression atomique, annulation de gestes, glisser-déposer vers le schéma et la plaque, modèles DEL, curseur du potentiomètre, calcul automatique dédoublonné et arrêt des répétitions après un échec.
- **Intégration des nouveaux instruments** : formulaire PULSE, rejet des timings invalides, charge/décharge RC réelle sur trois cycles, curseur/zoom/CSV, points de passage des fils, couleurs, bibliothèque persistante, ouverture annulable et suppression sans modifier le circuit actif.
- **Gestes rapides** : dix événements flèche successifs produisent dix déplacements, les rotations et annulations restent ordonnées, sélectionner puis dupliquer immédiatement utilise la sélection mise en file.

Les vérifications DOM ne remplacent pas une revue visuelle dans un navigateur ni un test utilisateur. Ces deux évaluations restent à effectuer pour juger la fluidité et l’ergonomie face à un produit comme Tinkercad.

Les tests du carnet vérifient aussi la compatibilité des anciennes captures, la provenance des modèles/curseurs/signaux, les mesures obsolètes et le stockage refusé. La bibliothèque serveur est testée face aux conflits de révision, fichiers corrompus, limites de capacité, erreurs d’écriture et identifiants de fichier non autorisés.

Le balayage paramétrique est également vérifié : I(1 kΩ)=5 mA, I(2 kΩ)=2,5 mA, I(4 kΩ)=1,25 mA sous 5 V ; positions du potentiomètre 25/50/75 % donnant 3,75/2,5/1,25 V sans charge. Les tests confirment que le circuit actif et son résultat précédent restent strictement identiques après la série. L’intégration React/API contrôle le graphique, son clavier, le CSV, l’état d’obsolescence et l’export direct d’une copie sauvegardée.

Les derniers essais ciblent aussi la fluidité : douze changements de position dans le schéma ne réexécutent pas le composant breadboard inchangé ; le zoom Ctrl/molette annule le zoom navigateur concurrent ; un pointeur secondaire ne peut déplacer, terminer ou annuler le geste principal. L’historique ignore les sélections et changements de vue, conserve Rétablir et retire proprement les sélections d’objets disparus lors d’une annulation.

La version multi-plaques vérifie les 420 trous par plaque, l’indépendance des bandes/rails, les transferts atomiques, le refus de corps répartis entre plaques et de suppression d’une plaque occupée, ainsi que l’implantation automatique de treize composants sur deux plaques sans changement de réseaux. Les liaisons inter-plaques alimentent une vraie résistance à 5 mA ; le nouvel exemple de diviseur mesure 2,5 V. Les essais DOM/API vérifient aussi le dépôt sur la bonne plaque, la navigation, le transfert complet et les cavaliers entre plaques.

L’export SVG est vérifié sur le véritable DOM de l’application : schéma et plaque sélectionnée produisent du XML valide, avec provenance et 420 trous ; les couches d’animation et de manipulation sont retirées, les références de marqueurs restent locales et les libellés spéciaux sont échappés. L’export ne modifie pas le circuit. Le rendu graphique de ces fichiers reste à contrôler dans un navigateur ou un éditeur vectoriel.

Le copier-coller de fragments est testé avec des événements de presse-papiers dans le DOM et la vraie API : après collage dans un projet vide, le RC à source PULSE produit un vrai transitoire ngspice ; collages répétés, décalage, identifiants, annuler/rétablir et champs de saisie sont vérifiés. Une copie immédiate pendant une mutation ne copie pas silencieusement un état ancien ; le bouton Copier attend la file. Les tests contrôlent aussi le focus après clic depuis un champ, la sélection de texte du navigateur, l’isolation des dialogues, les données malformées et les plafonds d’opérations/octet. L’accès au presse-papiers du système et ses permissions restent à vérifier dans les navigateurs cibles.

L’inductance idéale est testée en OP, en transitoire depuis 0 A et depuis le point continu. La réponse RL suit l’exponentielle L/R ; la réponse RLC est comparée à une solution analytique indépendante (première crête ≈8,104 V, fréquence amortie ≈1 573,54 Hz, courant signé et décroissance). R = 200 Ω supprime le dépassement du modèle idéal. L’exemple est implanté et ses réseaux restent identiques.

La vue Énergie utilise les vraies courbes de cet exemple dans l’intégration React/API : recherche « bobine », unités H, corps sur plaque, sélection d’un échantillon, calcul différentiel ½CU² et magnétique ½LI², maintien du curseur entre polls, export SI complet et nom avec révision. Les éditions visuelles conservent les mesures ; une édition électrique ou un calcul échoué masque les anciennes énergies. Les tests unitaires couvrent les données absentes, les séries tronquées, les temps non uniformes et les dépassements numériques ; un essai DOM contrôle les coordonnées SVG finies pour une énergie finie extrême.

## Historique de validation initiale


## Résultats exécutés

- **121 tests Python réussis, 90 sous-tests réussis**, sur le modèle, les entrées invalides, la connectivité, les transactions, la sécurité API, les vrais calculs électriques et les flux des fils.
- **9 tests TypeScript/Node réussis** : potentiels positifs/négatifs/nuls/inconnus, saturation de l’échelle, bornes de vitesse et inversion électrons/courant conventionnel.
- **Compilation TypeScript et production Vite réussies**.
- **Client MCP officiel 2.3.0** : négociation du protocole `2026-07-28`, 23 outils listés et 11 contrôles d’intégration réussis ; 16 vrais calculs analogiques du soustracteur réussis.

Environnement observé : macOS arm64, Python 3.14.6, ngspice 47. Les autres versions et systèmes n’ont pas été exécutés dans cette mission.

## Électricité, indépendamment du navigateur

Les tests utilisent le vrai exécutable ngspice et comparent ses résultats à des références indépendantes :

| Cas | Résultat vérifié |
| --- | --- |
| 5 V sur 1 kΩ | 5 mA |
| Diviseur de deux résistances égales | 2,5 V |
| Diode générique en direct/inverse | Conduction directe et blocage inverse |
| NPN et PNP | Commande active, blocage, courants C/B/E et bilan de Kirchhoff |
| RC 1 kΩ / 1 µF | Évolution comparée à l’exponentielle de charge, constante de temps 1 ms |
| Interrupteurs/boutons et sondes | États ouverts/fermés, courant et tension différentielle |
| Breadboard | Bandes A–E / F–J, canal, rails séparés/coupés et mise en correspondance des vues |
| Échecs et arrêt | Netlist/journal conservés, limites vérifiées, arrêt après lancement réel d’un processus |
| Soustracteur discret | 16/16 combinaisons, valeurs de sortie réellement calculées ; résultat modulo 4 et emprunt séparé |
| Flux des conducteurs | Courants uniques sur les ponts, ambiguïté des cycles et trajets illustratifs séparés |

Le rapport `results-electric.json` conserve les 16 entrées, tensions, seuils, résultats attendus/observés et statuts. Les modèles sont génériques ; ces vérifications ne qualifient aucun montage physique ni brochage constructeur.

## Chaîne observée dans l’interface

1. Création d’un circuit vide par le bouton Nouveau circuit.
2. Ajout à la souris d’une source continue, d’une résistance et d’une masse.
3. Connexion des trois branches par clics sur les bornes.
4. Simulation et observation de **5 mA** dans R1.
5. Modification visuelle d’une résistance de 1 kΩ à 2 kΩ, puis observation de **2,5 mA** après recalcul.
6. Modification et sélection du circuit par un vrai client MCP, puis affichage de son nom de réseau **VCC**, de R1 sélectionnée et des **5 mA** dans le navigateur. Trace : `results-ui-mcp.json`.
7. Affichage des fils selon leurs tensions, des points animés et de la légende des trajets indicatifs.
8. Contrôle des attributs SVG : à courant positif identique, `electrons` donne `reverse`, `conventional` donne `forward`. Le mode pause retire les groupes animés. Une source passée à −5 V produit le fil bleu `#55a1ff` et inverse le sens des points ; la source a ensuite été rétablie à +5 V.
9. Chargement de l’exemple RC, choix automatique du mode temporel, calcul et affichage de plusieurs courbes. Ajouter I(R1) affiche un graphe en ampères distinct du graphe en volts.
10. Lancement des essais du soustracteur depuis l’interface et observation de **16 lignes conformes**.

## Ce qui est prouvé par le test MCP

`results-mcp.json` distingue serveur démarré, client connecté et outils accessibles. Il conserve la liste des outils, les contrôles et la table complète. Le client utilise le transport stdio réel dans un processus distinct, puis les mêmes opérations API que l’interface.

Le test valide prévisualisation sans mutation, conflit de révision rejeté, annulation atomique sur une opération invalide, undo/redo, modification de valeur, mesure de 5 V et 2,5 mA, continuité et coupure des rails, annotation/surlignage visibles, maintien des mesures lors d’une modification visuelle et les 16 cas du soustracteur. Le contenu du projet initial est restauré à la fin.

La configuration personnelle de Codex n’a pas été modifiée : la configuration de connexion et les commandes nécessaires sont livrées dans `docs/mcp.md` et `mcp-config.example.json`.

## Limites de la preuve visuelle

L’animation est symbolique, liée au signe des courants du dernier point calculé ; elle ne simule pas des particules microscopiques et ne rejoue pas encore l’évolution complète d’un transitoire. Dans les boucles idéales, les trajets d’animation ne prétendent pas mesurer une répartition unique entre les fils.

La vérification navigateur a été menée dans le navigateur intégré local. Les tests ne constituent pas une validation de tous les navigateurs, écrans tactiles ou contraintes d’accessibilité. Les boîtiers rigides et l’implantation sur plusieurs plaques restent à développer.
