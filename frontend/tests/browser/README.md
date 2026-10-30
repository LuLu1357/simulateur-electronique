# Intégration du hook de relecture

Ce scénario complète les tests purs de `playback.test.mjs` avec le vrai cycle
React/DOM du hook `useSimulationPlayback`. Les réponses réseau et l’horloge sont
contrôlées ; aucun service API, calcul ngspice ou projet utilisateur n’est utilisé.
Il ne remplace pas la validation de l’application complète et de ses instruments.

Après `npm ci --prefix frontend`, démarrer depuis la racine du dépôt :

```sh
npm run dev --prefix frontend -- --port 8878 --strictPort
```

Ouvrir <http://127.0.0.1:8878/tests/browser/playbackHook.html> dans un vrai navigateur.
Le résultat apparaît en haut ; `data-run-status="passed"` sur `#summary` indique
que tous les scénarios ont réussi. Recharger la page rejoue les vérifications.

Les cas couvrent le regroupement et la sérialisation des lectures, le cache,
le point demandé distinct du point affiché, le retour final pendant une requête,
un calcul remplacé, les éditions visuelles/électriques, les erreurs et leur
reprise, ainsi que lecture/pause. Les réponses volontairement retardées peuvent
arriver même après l’annulation du transport pour vérifier les gardes du hook.
L’horloge évite les attentes longues et rend l’enchaînement reproductible.
