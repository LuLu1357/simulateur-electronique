# Relecture temporelle — validation du 30 octobre 2026

Ce jalon corrige la synchronisation et la provenance. La revue visuelle reste
partiellement ouverte ; les contrôles ci-dessous distinguent les niveaux de preuve.

## Rejouer l’intégration complète sur des données isolées

Prérequis : dépendances du projet installées et vrai ngspice dans le PATH.
Depuis la racine, choisir un dossier de compilation temporaire pour ne pas
remplacer l’interface éventuellement servie à l’utilisateur sur 8765 :

```sh
npm run build --prefix frontend -- --outDir /tmp/atelier-playback-review-dist
.venv/bin/python scripts/playback_review.py \
  --dist /tmp/atelier-playback-review-dist --port 8876 --frame-delay-ms 1200
```

Ouvrir `http://127.0.0.1:8876/`. Le script copie le package backend dans un dossier
temporaire avant son import, utilise un runtime temporaire, refuse le port 8765
et écoute seulement sur la boucle locale. Il ne lit ni ne remplace `.runtime/`.
Ctrl+C termine ce serveur et supprime son runtime. Les captures du navigateur et
les fichiers téléchargés restent à nettoyer séparément si souhaité.

Le montage comporte une DEL rouge, 330 Ω en série et 10 nF en parallèle sur la
DEL, deux plaques et une source PULSE 0/5 V. Aucune mesure n’est préfabriquée.
Cliquer **Calculer TRAN** produit les données avec ngspice.

1. Vérifier le dernier point, puis déplacer **Instant du montage** vers 300–400 µs.
   Le schéma, la plaque 2, les mesures et l’oscilloscope doivent montrer la DEL
   conductrice (environ 9,259 mA), au même temps et au même indice affichés.
2. Ouvrir le carnet, demander un point vers 750–800 µs puis capturer pendant
   « lecture du point demandé ». Tant que la réponse manque, toutes les valeurs
   et les captures doivent rester au précédent point **affiché**.
3. Exporter le carnet. Vérifier `simulationId`, `circuitFingerprint`,
   `sourceRevision`, `sampleIndex` (base zéro), `sampleTime` et `sampleCount`.
4. Après la réponse, vérifier l’extinction de la DEL dans le schéma et la plaque.
5. Vérifier Énergie (½CU²), lecture/pause, retour final, puis zoomer l’oscilloscope
   hors du point global : son readout garde ce point et annonce « hors fenêtre ».
6. Exporter les SVG du schéma et de la plaque pendant une nouvelle lecture lente.
   Leur `<desc>` doit identifier le point réellement dessiné, son UID, son
   empreinte et sa révision source. Les animations symboliques sont omises.

Les actions 1–4 ont été exécutées dans un vrai navigateur. La capture JSON du
point 247 a été vérifiée après téléchargement alors que le point 493 était visé :
indice 246, temps 0,0003943744541668686 s, 1 233 points, révision source 0,
UID et empreinte identiques au calcul. La DEL était allumée à 9,259 mA, puis
éteinte au point 493 (743,8 µs). L’oscilloscope a affiché 394,4 µs et 1,945 V
sur la DEL ; les plaques utilisent les mêmes valeurs rejouées.

**Restant pour clôturer R1/R4 :** actions 5–6 dans l’application complète,
notamment les vrais téléchargements SVG. Leur logique pure est testée ; cela
ne constitue pas une preuve de rendu ou de téléchargement.

## Contrôles automatisés et protocole réel

```sh
npm run check --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
.venv/bin/python -m pytest -q
git diff --check
```

Résultats du jalon : **207 tests Node**, **342 tests Python et 106 sous-tests**,
aucun ignoré ; TypeScript et compilation Vite réussis. La compilation réellement
exécutée a ciblé un dossier temporaire avec `--outDir`. Les rapports électriques
et MCP historiques ont été restaurés à l’identique après la suite Python.

- `tests/test_mcp_stdio_frames.py` : vrai client SDK MCP 2.3.0 en stdio,
  HTTP loopback éphémère et ngspice 47, avec backend/runtime copiés et isolés.
  Vérifie les 28 outils, annotations de lecture seule, indices stricts, DEL
  PULSE ON/OFF, provenance, édition visuelle compatible, obsolescence électrique,
  remplacement d’UID et absence de mutation/relance de SPICE pendant les lectures.
- `tests/test_playback_review.py` : montage et contacts sur les deux plaques.
- `frontend/tests/browser/` : vrai React/DOM et hook, horloge et transport
  contrôlés, sans nouvelle dépendance ; **10/10 scénarios réussis dans le navigateur**.
  Voir son README pour lancer sur 8878. Couvre cache, regroupement, retour final
  pendant une requête, réponse tardive après remplacement, éditions visuelles/
  électriques, erreur/reprise et lecture/pause, sans attente temporelle longue.
- Tests purs : provenance carnet/SVG, courant malformé rejeté, curseur contrôlé
  hors fenêtre et remise à zéro des instruments autonomes au changement d’UID.

Ces résultats ne prétendent ni à une parité Tinkercad ni à une validation matérielle.
