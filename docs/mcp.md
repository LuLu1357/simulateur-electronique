# Connexion MCP locale

Le serveur MCP emploie le SDK Python officiel (`mcp` 2.x), avec le transport `stdio`. Le client lance le processus, puis lui parle par entrée/sortie standard. Les outils transmettent exclusivement des opérations à l’API fixe `http://127.0.0.1:8765`. Ils partagent ainsi **exactement le circuit ouvert** dans l’interface, son historique et ses mesures.

## Lancement et configuration

1. Installer les dépendances puis démarrer l’application locale (voir le README).
2. Ajouter l’entrée de `mcp-config.example.json` à la configuration du client MCP. Remplacer `/path/to/simulateur-electronique` par le chemin absolu du dossier sur votre machine.
3. Reconnecter le client et demander la liste des outils.

Exemple pour un client acceptant le format JSON usuel :

```json
{
  "mcpServers": {
    "atelier-electronique": {
      "command": "/path/to/simulateur-electronique/.venv/bin/python",
      "args": ["-m", "backend.mcp_server"],
      "cwd": "/path/to/simulateur-electronique"
    }
  }
}
```

Pour un client utilisant TOML, traduire la même commande, les mêmes arguments et le même dossier de travail. Le test livré n’installe et ne modifie aucune configuration personnelle du client.

Les réglages visuels de couleur des fils et d’animation sont des préférences locales du navigateur. Ils ne modifient pas le modèle électrique, les valeurs simulées ni les outils MCP.

## Trois états distincts

- **Serveur HTTP démarré** : `GET /api/health` répond; cela ne prouve aucune connexion MCP.
- **Client MCP connecté** : la négociation du protocole entre le SDK client et `backend.mcp_server` a réussi.
- **Outils accessibles** : le client a reçu `tools/list` puis a effectivement appelé `circuit_read` et d’autres outils. Le rapport d’intégration distingue les trois étapes.

L’application affiche `null` pour la présence d’un client qu’elle ne peut pas prouver. La vérification automatisée utilise un **véritable client SDK dans un processus séparé**, pas un appel direct des fonctions Python :

```sh
.venv/bin/python scripts/test_mcp.py
```

Ce test nécessite l’application démarrée. Il effectue des modifications de démonstration puis restaure le contenu du projet initial (sa révision augmente). Éviter de modifier le circuit manuellement pendant cet essai; une révision concurrente est refusée au lieu d’être écrasée. Le résultat détaillé se trouve dans `docs/results-mcp.json`, dont les 16 essais du soustracteur avec leurs tensions réellement calculées.

## Outils

| Outil | Fonction |
| --- | --- |
| `circuit_read` | Projet complet, révision, topologie, catalogue, état du calcul |
| `component_inspect` | Bornes, brochage explicite, valeurs, modèle, trous, mesures |
| `selection_read` | Vue affichée, sélection, annotations, surlignages |
| `net_trace` | Tous les points d’un réseau, à partir d’un réseau/borne/trou, avec provenance et validité de la mesure |
| `breadboard_continuity` | Continuité idéale entre deux points, rails coupés compris |
| `models_read` | Modèles et hypothèses, correspondances bornes/boîtier |
| `topology_validate` | Diagnostics de connexion, hypothèses à vérifier |
| `simulation_run` / `simulation_stop` | Point de fonctionnement ou transitoire / arrêt |
| `measurements_read` / `voltage_measure` / `branch_current_measure` | Courbes, tensions, courants / tension différentielle / courant de branche |
| `truth_table_test` | Liste de combinaisons et comparaison aux sorties attendues |
| `transaction_preview` / `transaction_apply` | Prévisualisation / transaction atomique validée |
| `history_undo` / `history_redo` | Annuler / rétablir avec révision croissante |
| `interface_highlight` / `annotation_add` | Explication visible dans l’interface |
| `example_load` | Charger un exemple autorisé, annulable |
| `project_new` / `project_import` / `project_save` | Projet vide / contenu JSON validé / sauvegarde à emplacement fixe |

Une mutation retourne l’état réellement obtenu. Elle exige `expected_revision` lu préalablement dans `circuit_read`. Une erreur de validation invalide toute la transaction et conserve le circuit. Les révisions augmentent aussi pour annuler/rétablir : une ancienne commande ne peut pas redevenir valide après un aller-retour dans l’historique.

Les outils exposent leurs schémas JSON et leurs descriptions françaises à travers MCP. Pour connaître toutes les opérations autorisées, consulter la description de `transaction_apply` et le contrat `CONTRACT.md`.

## Essai pédagogique complet

1. `circuit_read` pour obtenir la révision.
2. `example_load` avec `example_id="ohm"` et la révision attendue.
3. `simulation_run` avec `analysis={"kind":"op"}`; lire le courant de la résistance, 5 mA.
4. `transaction_preview` puis `transaction_apply` avec `operations=[{"type":"set_value","id":"R1","value":2000}]` en reprenant la révision courante.
5. Observer le changement dans l’interface puis relancer `simulation_run` : 2,5 mA.
6. `example_load` avec `example_id="subtractor"`, puis `truth_table_test` sans argument pour tester le circuit courant et ses 16 combinaisons.

`truth_table_test(example="subtractor")` permet aussi d’essayer l’exemple sans remplacer le circuit ouvert. Un essai ne remplace jamais ses tensions par le résultat mathématique attendu. Le résultat 2 bits est **modulo 4**, accompagné de l’emprunt final; il n’est pas un entier signé.

## Accès et limites

L’API écoute uniquement sur la boucle locale. Elle vérifie le Host, l’Origin et les requêtes issues d’un autre site. Les écritures requièrent un jeton aléatoire conservé dans `.runtime/token` (droits `0600`). L’interface de même origine récupère son jeton par `/api/session`; le pont MCP lit ce même fichier fixe. Aucun outil ne reçoit de commande shell, de chemin de fichier ni d’URL arbitraire. Aucun serveur MCP HTTP n’est exposé.

Le simulateur impose des limites de taille de projet, nombre de cas, durée/points de calcul, avec annulation du processus. Après échec, le circuit est conservé et `last_success` identifie explicitement le dernier calcul réussi. `stale=true` indique des mesures obtenues sur un état électrique différent. Une empreinte électrique ignore la sélection, les déplacements visuels, le titre et les notes; ces changements gardent les mesures valides. La révision du calcul reste disponible pour la traçabilité. Les simulations et les brochages génériques ne valident jamais le montage physique.

Documentation officielle consultée : [SDK Python MCP — exécuter un serveur](https://py.sdk.modelcontextprotocol.io/run/), [déclarer les outils](https://py.sdk.modelcontextprotocol.io/servers/tools/), [client MCP](https://py.sdk.modelcontextprotocol.io/client/).


Les transactions partagent aussi les extensions de l’atelier : `set_position` pour le potentiomètre, `set_waveform` pour les créneaux typés et `set_wire_style` pour la couleur/les points de passage. Le tracé du fil est visuel ; le curseur et le signal modifient l’empreinte électrique. Les trois modèles DEL sont accessibles via `set_model`. Lire le catalogue et la révision avant toute modification ; aucune directive SPICE libre n’est acceptée.

Le pont expose aussi `parameter_sweep`, `project_library_list`, `project_library_save` et `project_library_load`. La bibliothèque reste celle du service local. Les transactions `set_board_count` créent jusqu’à quatre plaques ; les trous hors première plaque sont préfixés (`2:a1`). Transférer un corps demande une transaction groupant toutes ses pattes, pour éviter un composant réparti entre plaques.
