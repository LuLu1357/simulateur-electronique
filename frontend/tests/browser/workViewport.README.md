# Stabilisation de la vue pendant une édition

Ce scénario monte le vrai hook `useWorkViewport` avec React/DOM dans une page
longue. Les panneaux schéma/plaque/résultats servent de surfaces géométriques :
ce n’est pas un montage électrique, et aucune API ou donnée utilisateur n’est lue.

Depuis la racine, après installation des dépendances :

```sh
npm run dev --prefix frontend -- --port 8879 --strictPort
```

Ouvrir <http://127.0.0.1:8879/tests/browser/workViewport.html> dans un vrai navigateur.
Le statut final doit être `10/10 scénarios réussis · 0 requête API` et
`#summary[data-run-status="passed"]`. Recharger rejoue le scénario.

Le cas principal retire un panneau au premier rendu, puis un formulaire dans un
`useEffect` au deuxième rendu, comme le nettoyage de la borne sélectionnée après
suppression. Chaque rendu doit conserver le même panneau à moins d’un pixel,
sans remontage et en gardant son défilement horizontal. Les autres cas vérifient
le sondage de même révision, les changements de projet/vue, une réponse retardée
après défilement utilisateur et l’arrêt immédiat de la stabilisation sur
wheel/touchmove/pointerdown/keydown.

L’ancrage automatique CSS est désactivé pour isoler les effets du hook. Les
défilements et rectangles DOM sont réels ; les événements d’interruption sont
synthétiques et la réponse retardée est une promesse contrôlée, sans réseau.
Ce scénario complète les tests purs `workViewport.test.mjs` et la reproduction
dans l’application complète ; il ne remplace pas cette dernière.
