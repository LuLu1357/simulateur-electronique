# Note de reprise

## Présentation

Atelier Électronique est une application locale en français pour construire et simuler des circuits discrets. L’interface React/TypeScript propose un schéma et une breadboard synchronisés. L’API FastAPI utilise ngspice pour les analyses électriques ; un serveur MCP Python permet à un client local d’inspecter et de modifier le circuit actif.

## Démarrage

Prérequis : Python 3.11+, Node.js 20.19+ ou 22.12+, npm et ngspice.

```sh
./scripts/install.sh
./scripts/run.sh --open
```

L’application écoute uniquement sur `127.0.0.1:8765`. Pour configurer un client MCP, copier `mcp-config.example.json` dans sa configuration et remplacer le chemin d’exemple par le chemin absolu du dépôt. Détails : [mcp.md](mcp.md).

## Structure utile

- `backend/` : domaine, validation, API HTTP, intégration ngspice et serveur MCP.
- `frontend/src/` : interface, schéma, breadboard, interactions et communication API.
- `examples/` : projets de démonstration importables.
- `tests/` et `frontend/tests/` : tests Python et JavaScript.
- `CONTRACT.md` : contrat et contraintes de l’API.
- `docs/ARCHITECTURE.md`, `docs/ELECTRIQUE.md` et `docs/VALIDATION.md` : architecture, hypothèses électriques et validation documentée.

## Vérifications

Les tests présents peuvent être exécutés avec :

```sh
.venv/bin/python -m pytest -q
npm run build --prefix frontend
npm test --prefix frontend
```

Le test de protocole MCP `scripts/test_mcp.py` requiert aussi que l’application soit démarrée ; il effectue des mutations temporaires sur le projet actif puis le restaure. Lire ses instructions avant exécution.

## Limites à garder en tête

- Les modèles de composants et la breadboard sont pédagogiques ; une simulation ne valide pas un montage physique.
- Le calcul électrique repose sur ngspice ; les animations de courant sont une visualisation et ne constituent pas une mesure.
- Le service est conçu pour un usage local, pas pour être exposé directement sur un réseau.
- La progression personnelle et les notes privées ne font pas partie du dépôt public.
