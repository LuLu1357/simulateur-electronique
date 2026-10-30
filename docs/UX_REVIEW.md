# U1 — Revue ergonomique desktop

Date : **30 octobre 2026**. Branche : `codex/ux-review-2026-10-30`.
Base examinée : [`8ba014f2ac5cc305a6ed455ec6479f7a66c9b0e3`](https://github.com/LuLu1357/simulateur-electronique/commit/8ba014f2ac5cc305a6ed455ec6479f7a66c9b0e3), récupérée depuis `work` avant création de la branche.

**Trois obstacles à traiter en premier : les raccourcis d’édition actifs hors
du canevas, l’empilement des ajouts par clic et la pause involontaire de la
relecture au survol du graphe.** Ils sont reproduits avec le vrai composant
racine React et une API isolée. Les mesures électriques des essais viennent
de ngspice ; aucune correction produit n’est incluse dans ce rapport.

## Périmètre et niveau de preuve

Les quatre documents demandés ont été lus : `AGENTS.md`, `docs/SUIVI.md`,
`docs/REPRISE.md`, `CONTRACT.md`. Cette revue reste dans U1 ; le pilote conserve
R1–R5 et l’intégration. Les constats portent sur cette base, avant ses éventuels
correctifs ultérieurs.

- **Instance réellement lancée :** FastAPI sur `127.0.0.1:8783`, magasin de projet
  indépendant, runtime dans le répertoire de travail ignoré de cette branche.
  `/api/health` répond `status: ok`, `ngspice_available: true` ; `/` sert le HTML
  de production après compilation TypeScript/Vite réussie. Python 3.12, Node 24,
  ngspice 47. Aucune requête n’a visé le service utilisateur sur 8765 ; son
  `.runtime` n’a pas été utilisé.
- **Observation d’application, marquée A :** application React complète montée
  sous **jsdom**, événements DOM et vrais appels HTTP vers cette instance.
  États, textes, attributs de focus et données API sont relevés après les actions.
  Ce sont des constats fonctionnels, pas des observations de rendu à l’écran.
- **Hypothèse de code, marquée H :** déduction statique à vérifier dans un vrai
  navigateur avant décision. Les références de lignes ci-dessous visent la base
  indiquée ; elles peuvent se décaler après intégration des travaux du pilote.
- **Limite majeure : aucun outil de navigateur connecté ou cloud n’était
  disponible dans cette session.** Pas de revue visuelle, de mesure de contraste,
  de hauteur rendue ou de fluidité, ni de capture d’écran. jsdom ne calcule pas
  la mise en page ; la géométrie SVG et certaines API de plateforme sont simulées
  pour envoyer les événements. Cela ne valide ni le ciblage réel à la souris,
  ni les dialogues natifs, ni un parcours complet avec lecteur d’écran.
- Aucun travail mobile, aucun benchmark direct de Tinkercad. La comparaison
  porte sur des critères de fluidité : premier circuit accessible, gestes
  prévisibles, contexte clavier, continuité entre montage et instruments.

## Parcours examinés

| Parcours | Manipulation et résultat constaté | Limite |
| --- | --- | --- |
| Ajouter → connecter → simuler | Circuit vide, clics Source/Résistance/Masse, déplacements au clavier, trois connexions par activation des bornes, Calculer OP : `I(R1)=0,005 A`, `I(V1)=-0,005 A` | Pas de validation du ciblage visuel des bornes |
| Lire et rejouer | Exemple Créneaux et RC ouvert par Exemples, Calculer TRAN : 1 859 points, panneau de relecture présent, lecture puis survol de l’oscilloscope | Pas de validation temporelle exhaustive R1–R5 |
| Plaques | Exemple Deux plaques, navigation 1/2, transfert de R1 vers `2:h15`/`2:h18`, six fils conservés ; ajout d’une troisième plaque vide puis retrait | Pas de jugement visuel sur l’implantation |
| Instruments | Mesures OP et RLC, oscilloscope RC/PULSE/soustracteur, ouverture Énergie et Carnet sur RLC | Pas de validation des exports ni de leur provenance ; réservée au pilote |
| Clavier et messages | Focus de boutons, flèches/Suppr, deux entrées Tab de la plaque, connexion en attente, durée TRAN invalide | Focus placé explicitement par le harnais ; ordre Tab natif à confirmer |

Les extraits de preuve sont inclus dans les constats. Les scripts exploratoires
restent dans `work/` ignoré ; ils ne sont pas livrés comme suite de tests. Les
reproductions ci-dessous servent à refaire les vérifications dans un navigateur.

## Priorités

P1 : obstacle direct au parcours principal ou geste inattendu qui modifie le
circuit/la lecture. P2 : effort de recherche, ambiguïté ou récupération difficile.
Aucun P0 démontré dans ce périmètre limité.

| ID | Priorité | Constat | Preuve |
| --- | --- | --- | --- |
| UX-01 | P1 | Des touches depuis la bibliothèque, les résultats ou la région de plaque éditent le schéma | A |
| UX-02 | P1 | Trois ajouts par clic occupent exactement la même position | A |
| UX-03 | P1 | Un survol sans clic met la relecture globale en pause | A |
| UX-04 | P2 | L’oscilloscope présente 270 canaux sans recherche sur un exemple fourni | A ; ampleur visuelle non mesurée |
| UX-05 | P2 | Une durée invalide produit un message technique sans erreur liée au champ | A |
| UX-06 | P2 | « Hors plaque » désigne aussi une patte bien implantée sur une autre plaque | A |
| UX-07 | P2 | L’aide TRAN et les commandes enseignent deux modèles temporels différents | A pour les textes ; risque de confusion à tester |
| UX-08 | P2 | L’instruction de connexion près des outils reste générique pendant le câblage | A pour les textes ; gêne visuelle à confirmer |
| H-01 | P2 à confirmer | Le cadrage complet d’une plaque paraît difficile sur desktop courant | H |
| H-02 | P2 à confirmer | Terminer un fil sur une jonction paraît inaccessible au clavier | H |

## Constats reproduits dans l’application via DOM

### UX-01 — Les raccourcis n’ont pas de contexte d’édition

**Reproduction :** ajouter un composant, garder sa sélection, puis donner le
focus au bouton « Ajouter : Résistance » sans l’activer. Presser → puis Suppr.
Autre reproduction : sélectionner R1, ouvrir Oscilloscope et focaliser un bouton
de canal ; presser → en suivant l’aide « ← → pour affiner ».

**Preuve :** avec le focus sur `Ajouter : Résistance`, G1 passe de `x=450` à
`x=460`, puis Suppr retire G1. Avec le focus sur un canal de l’oscilloscope, R1
passe de `x=300` à `x=310`. L’action change le montage alors que le contrôle
focalisé appartient à un autre panneau. La suppression est annulable ; ce
n’est pas une perte irréversible.

La plaque accentue le problème : son conteneur « Plaque à plat défilable
horizontalement » et son SVG ont chacun `tabindex=0`. Sur le premier, → déplace
R1 dans le schéma (`300 → 310`) ; sur le SVG suivant, → conserve sa position.
Le gestionnaire de ce SVG prévoit la navigation entre trous ; l’essai n’a pas
relevé la nouvelle cible de trou. L’aide dit seulement « tabule jusqu’à la plaque ».

**Source :** `frontend/src/main.tsx:1411–1494` (écoute globale),
`frontend/src/interactions.ts:14–32,55–107` (champs exclus, boutons non exclus),
`frontend/src/components/BreadboardView.tsx:1312–1352` (deux points d’entrée).

**Proposition :** réserver déplacement, rotation et suppression au contexte du
canevas focalisé. Garder les raccourcis globaux de navigation explicitement
choisis. Pour la plaque, offrir une seule entrée clavier qui active le bon
contrôleur, avec défilement distinct et accessible.

**Critère de fin :** flèches/Suppr sur les boutons de bibliothèque, canaux et
zoom ne modifient pas le projet ; elles continuent d’éditer depuis le schéma.
Une seule entrée Tab permet les actions annoncées sur la plaque.

### UX-02 — Les premiers ajouts s’empilent

**Reproduction :** partir d’un circuit vide, cliquer Source de tension,
Résistance puis Masse, sans changer la vue ni déplacer les éléments.

**Preuve API après les trois clics :**

```text
V1 : x=450, y=180, rotation=0
R1 : x=450, y=180, rotation=0
G1 : x=450, y=180, rotation=0
Sélection : G1
```

Les corps partagent donc le même emplacement SVG. Leur masquage exact à l’écran
n’a pas été photographié ; le coût potentiel avant le premier câblage est
directement lié à ces coordonnées identiques.

**Source :** `frontend/src/main.tsx:1027–1051`, position au centre inchangée à
chaque clic, sans recherche d’emplacement libre.

**Proposition :** pour l’ajout par clic, choisir une case libre sur la grille à
proximité du centre, avec un espacement qui laisse les bornes accessibles.
Conserver le glisser-déposer pour un placement précis et l’annulation par ajout.

**Critère de fin :** après les trois clics, les composants sont distincts,
visibles dans le cadre et leurs bornes peuvent être atteintes sans déplacement
préalable ; vérifier le résultat visuellement à 1366×768 et 1440×900.

### UX-03 — Le survol de l’oscilloscope interrompt la relecture

**Reproduction :** ouvrir Créneaux et RC, calculer TRAN, lancer « Lire » dans
« Le montage, instant par instant », puis passer au-dessus du graphe sans clic.

**Preuve :** après un `pointermove` avec `buttons=0`, la commande repasse de
« Mettre la relecture en pause » à « Lire les échantillons du montage » et
l’indice visé change. Le graphe est annoncé « Survole pour mesurer », mais le
survol prend désormais le contrôle du temps global.

**Source :** `frontend/src/components/Oscilloscope.tsx:193–216,365–370`,
`frontend/src/main.tsx:3537–3543`,
`frontend/src/useSimulationPlayback.ts:169–179` (sélection manuelle ⇒ pause).

**Proposition :** garder un aperçu local au survol ; réserver le déplacement
global à un clic, un glisser explicite ou une commande clavier. L’aperçu doit
être nommé comme tel et ne pas être capturé comme une mesure globale.

**Critère de fin :** traverser le graphe sans bouton enfoncé laisse la relecture
active et son instant inchangé par le survol ; une action explicite peut la
mettre en pause et choisir un point. À coordonner avec le pilote R1–R4.

### UX-04 — Choisir une mesure devient une recherche parmi 270 boutons

**Reproduction :** ouvrir le Soustracteur à 2 bits, choisir TRAN avec une durée
de `0,0001 s`, calculer puis chercher le courant de base d’un transistor précis.

**Preuve :** calcul réussi, **106 composants, 270 courbes et 270 boutons de
canaux**, trois sélectionnés initialement, aucun champ de recherche dans
l’instrument. Premiers libellés : `V(net_03d71039e7)`, `V(net_04cb3a7da9)`, etc.
Le nombre est observé ; le nombre de lignes rendues et le temps nécessaire pour
retrouver un canal ne sont pas mesurés.

**Source :** `frontend/src/components/Oscilloscope.tsx:277–303` (liste complète
avant les graphes), `frontend/src/oscilloscope.css:50–65` (retour à la ligne),
`backend/simulation.py:365–369` (courbes supplémentaires des bornes BJT).

**Proposition :** garder les canaux sélectionnés près du graphe et proposer
« Ajouter une mesure » avec recherche par composant, borne ou réseau nommé et
filtres V/A. Montrer un libellé pédagogique, puis l’identifiant technique en
complément. Préserver la possibilité de consulter toutes les courbes.

**Critère de fin :** retrouver un courant de base donné sans parcourir les
270 boutons ; l’état de sélection et les unités restent immédiatement lisibles.

### UX-05 — L’erreur de durée n’aide pas à corriger le champ

**Reproduction :** sur un circuit connecté, choisir TRAN, saisir `0` dans
Durée puis cliquer Calculer TRAN.

**Preuve du texte affiché :**

```text
Error: stop doit être un nombre fini strictement positif en secondes.
```

Le champ conserve `0` et aucun champ TRAN n’a `aria-invalid=true` ni de message
d’erreur associé. Le bouton de calcul reste activable. La valeur est bien
refusée par l’API : le problème concerne la récupération et le vocabulaire,
pas l’acceptation d’une simulation invalide.

**Source :** `frontend/src/main.tsx:1231–1235,1254–1257,2550–2577,4174–4189`.

**Proposition :** valider Durée/Pas avant l’appel, afficher sous le champ
« La durée doit être supérieure à 0 s », associer le message au contrôle,
marquer l’erreur et focaliser le premier champ invalide. Conserver une erreur
globale pour les défaillances de service ; retirer le préfixe `Error:`.

**Critère de fin :** le champ fautif est identifié et corrigeable immédiatement,
sans comprendre le nom interne `stop` ; aucune requête de simulation invalide.

### UX-06 — « Hors plaque » confond absence et autre emplacement

**Reproduction :** ouvrir Deux plaques, sélectionner R1 sur la plaque 1, puis
afficher la plaque 2 sans transférer le composant.

**Preuve :** les contrôles affichent « Transférer sur la plaque 2 »,
« P · hors plaque » et « N · hors plaque », alors que le panneau des liaisons
indique simultanément `R1.n · plaque 1 a1`. Le transfert explicite fonctionne
ensuite : R1 arrive à `2:h15`/`2:h18` et le projet conserve ses six fils.

**Source :** `frontend/src/components/BreadboardView.tsx:130–135,1242–1250` :
le texte utilise les placements filtrés sur la seule plaque active.

**Proposition :** afficher l’emplacement global : « N · plaque 1, a1 » avec
une action « Voir la plaque 1 ». Réserver « Non implantée » aux bornes réellement
sans trou ; garder « Transférer sur la plaque 2 » comme action explicite.

**Critère de fin :** le même libellé distingue une patte non implantée, une patte
sur la plaque active et une patte sur une autre plaque.

### UX-07 — Temps rejoué et animation des charges se confondent dans l’aide

**Reproduction :** calculer un TRAN puis lire l’aide de l’analyse, le panneau
de relecture et le bouton d’animation des courants.

**Preuve des textes simultanés :**

- Aide TRAN : « les points illustrent le dernier instant calculé ».
- Panneau de relecture : « Les valeurs du schéma et des plaques suivent les
  points calculés », avec un temps affiché sélectionnable.
- Commandes distinctes : « Lire/Pause » et « Animer les courants/Pause des points ».

La confusion d’un débutant est une hypothèse à tester ; la contradiction entre
« dernier instant » et un instant sélectionnable est observable dans les textes.

**Source :** `frontend/src/main.tsx:2371–2404`,
`frontend/src/components/SimulationPlayback.tsx:35–49,103–105`.

**Proposition :** nommer les actions « Rejouer l’évolution » et « Animation des
charges ». Dire : « Le curseur choisit l’instant affiché ; les points illustrent
le courant à cet instant, avec une vitesse symbolique. » Préserver OP/TRAN et
leurs explications pédagogiques ; ne pas masquer les conventions scientifiques.

**Critère de fin :** le texte distingue calcul de la série, choix de l’instant
et animation symbolique, avec un vocabulaire cohérent dans les trois zones.

### UX-08 — Le guidage de connexion près des outils ne suit pas le geste

**Reproduction :** choisir la première borne V1.p puis lire la barre de
sélection située avant les outils du schéma.

**Preuve :** son texte reste « 1 élément sélectionné · Maj+clic pour compléter ».
L’instruction « Borne V1.p choisie : active une autre borne […] Échap annule »
est dans son attribut `title`. Une instruction existe bien dans le pied de page
et une légende sous le schéma ; il ne s’agit donc pas d’une absence générale
de retour. Leur visibilité pendant le geste reste à évaluer dans un navigateur.

**Source :** `frontend/src/main.tsx:1752–1764,2228–2236,3216–3219,4125–4130`.

**Proposition :** pendant le câblage, remplacer l’invitation générique près des
outils par « Départ V1.p → choisir l’arrivée · Échap pour annuler ». Restaurer
le compte de sélection après le geste ; conserver les messages existants.

**Critère de fin :** l’état de câblage est lisible à proximité des outils sans
survol prolongé ; le nombre de sélections ne masque pas l’action attendue.

## Hypothèses tirées du code, non observées à l’écran

### H-01 — Prévoir un cadrage complet de la plaque sur desktop courant

**Scénario à vérifier :** fenêtre 1366×768 puis 1440×900, bibliothèque et
inspecteur ouverts, afficher Montage puis Agrandir la breadboard, rechercher
deux bornes aux extrémités opposées.

**Indices :** `frontend/src/breadboard.css:95–111` impose `min-width:820px`
et un défilement horizontal ; `frontend/src/workbench.css:76–78,142–144,283–284`
réserve aussi de la largeur au rail et aux panneaux. « Agrandir » change la
vue, pas ces panneaux (`BreadboardView.tsx:1046–1064`). Les règles responsive
existent ; aucun débordement rendu n’a été mesuré ici.

**Proposition conditionnelle :** si le cadrage reste insuffisant, ajouter
« Cadrer toute la plaque », un zoom explicite et la possibilité de replier les
panneaux. Garder l’échelle et les noms de trous lisibles ; ne pas réduire
automatiquement les cibles au point de gêner le placement.

**Preuve nécessaire :** captures réelles aux deux résolutions et nombre de
défilements requis avant/après ; ne pas traiter la gêne comme confirmée sans cela.

### H-02 — Vérifier le câblage des jonctions au clavier

**Scénario à vérifier :** circuit possédant une jonction explicite ; activer une
borne avec Entrée puis tenter de terminer le fil sur la jonction sans souris.
Essayer également de la retrouver via Repérer.

**Indices :** `frontend/src/main.tsx:2903–2930` expose des événements pointeur et
clic sur les jonctions, sans rôle, `tabIndex` ou gestion Entrée/Espace. Les bornes
ont ce contrat à `3057–3075`. L’ouverture de Repérer annule explicitement la
connexion en attente ; sa sélection focalise ensuite le SVG global
(`1404–1408`). La recherche ne fournit donc pas un contournement conservant
le départ du fil dans cette version.

**Proposition si confirmé :** fournir aux jonctions le même contrat clavier
qu’aux bornes, avec nom accessible, focus visible et activation Entrée/Espace.
La recherche peut offrir « Relier ici » lorsqu’un départ est en attente.

**Preuve nécessaire :** parcours Tab réel et activation sur une jonction dans
un navigateur ; conserver la distinction entre jonction et simple croisement.

## Ce qu’il faut préserver

Le chemin pédagogique est déjà utile : valeurs SI, analyse réelle avec résultat
de 5 mA vérifié, distinction courant conventionnel/animation, textes de provenance
et hypothèses. Les liens inter-plaques et le transfert explicite fonctionnent
dans les manipulations ci-dessus ; le nommage des trous évite une connexion
implicite entre plaques. Les instruments séparent V/A et le panneau de relecture
distingue temps visé et temps affiché pendant une lecture réseau.

Conserver l’identité d’établi en français et les conventions expliquées. Les
propositions visent la prévisibilité des gestes, l’accès aux mesures et la
localisation des messages ; aucune refonte esthétique générale n’est justifiée
par cette revue sans navigateur.

## Transmission au pilote

1. Reprendre UX-01 et UX-02 pour le prochain lot d’ergonomie ; UX-03 doit être
   coordonné avec R1–R4 pour éviter deux modifications concurrentes des curseurs.
2. Regrouper UX-05/06/07/08 dans un lot de messages et d’états explicites ;
   traiter UX-04 comme un sélecteur de mesures adapté aux grands circuits.
3. Compléter la revue dans un vrai navigateur desktop avant de fermer U1 :
   parcours souris et Tab, focus visible, zoom navigateur 100 % et 125 %, contraste,
   lisibilité des graphes, panneaux à 1366×768 et 1440×900. Confirmer H-01/H-02
   puis joindre des captures réelles si elles étayent une décision.

**État de U1 : constats fonctionnels et audit de code remis ; volet visuel
desktop restant ouvert.** Le suivi et la note de reprise ne sont pas modifiés
par cette branche. Seul ce rapport est destiné à être intégré dans `work`.
