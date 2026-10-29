# Consignes de travail et de relais

## Commencer ici

Lire [docs/SUIVI.md](docs/SUIVI.md), puis [docs/REPRISE.md](docs/REPRISE.md) et
[CONTRACT.md](CONTRACT.md). Le suivi décrit l’état réel, les tâches et les limites
de validation. L’objectif utilisateur est de faire progresser cet atelier
électronique original vers la qualité d’usage de Tinkercad. Ne pas annoncer une
parité qui n’a pas été démontrée.

## Coordination

- Tenir `docs/SUIVI.md` à jour au début d’un lot, à sa validation et avant tout
  relais : responsable, statut, fichiers concernés, résultat des contrôles et
  prochaine action. Distinguer « implémenté » de « validé dans l’interface ».
- Répartir les tâches indépendantes par domaine et par fichiers. Un fichier
  partagé a un seul responsable à la fois ; le pilote intègre les interfaces
  communes et les changements de `frontend/src/main.tsx`.
- Les rôles proposés dans le suivi ne constituent pas des agents en cours
  d’exécution. Nommer les responsables effectifs lors de la reprise.
- Maintenir `docs/PROMPT_REPRISE.md` lorsque les priorités du relais changent.
- Respecter toute demande d’arrêt. Préserver le travail en cours avec un état
  explicite et les contrôles restants, puis passer le relais.

## Publications GitHub régulières

L’utilisateur a demandé des publications régulières pour permettre à un autre
ChatGPT de reprendre. Pendant le travail actif :

1. Publier un commit à chaque jalon cohérent et vérifié, puis avant un relais ou
   un arrêt. Pour un chantier long, publier aussi des étapes intermédiaires
   clairement désignées comme inachevées, avec leurs limites dans le suivi.
2. Exécuter les contrôles adaptés, mettre à jour le suivi et vérifier le diff
   avant de commiter. Ne pas annoncer de succès pour un contrôle non exécuté.
3. Utiliser la branche de travail `work` et `git push origin work`. Vérifier que
   le SHA distant correspond au commit publié. Si le dépôt a évolué, examiner
   les changements et les intégrer sans écraser le travail de l’autre agent.
4. Ne pas faire de force-push ni publier directement sur `main`. Ne jamais
   versionner des jetons, `.runtime/`, `.venv/`, `work/`, `node_modules/` ou `dist/`.

Cette cadence concerne les sessions de travail actives ; aucun processus de
publication permanent n’est fourni par ce dépôt.

## Contraintes techniques

- Les mesures doivent provenir de ngspice. Garder les conventions de signe, les
  diagnostics, l’obsolescence et la provenance des résultats.
- Les mutations restent atomiques, soumises à la révision attendue et annulables.
  Un changement visuel ne doit pas modifier le circuit électrique.
- Tester les opérations destructrices et le protocole MCP sur un projet et un
  service de test isolés, jamais sur le projet actif de l’utilisateur.
- Le service de production reste local sur `127.0.0.1:8765`. Ne pas introduire de
  netlist libre, de shell distant ou d’exposition réseau pour faciliter un test.
- Les tests DOM ne remplacent pas une revue visuelle dans un vrai navigateur.

Commandes principales, avec ngspice dans le `PATH` :

```sh
.venv/bin/python -m pytest -q
npm test --prefix frontend
npm run build --prefix frontend
git diff --check
```
