# Prompt à transmettre à l’autre ChatGPT

**Actualisation du 30 octobre :** lire d’abord les sections actives de SUIVI et
REPRISE. Les tests passent désormais à 207 Node / 342 Python + 106 sous-tests et
le nouveau MCP stdio a été validé. Finir les vérifications visuelles restantes de
VALIDATION_RELECTURE avant de clore R1/R4. GPT #2 a publié sa revue UX sur
`codex/ux-review-2026-10-30` ; coordonner son intégration et les fichiers réservés.
Le prompt ci-dessous décrit l’objectif général et le relais initial.

Copier le texte ci-dessous dans une nouvelle conversation disposant d’un accès
au dépôt et d’un environnement de développement.

```text
Reprends le développement d’Atelier Électronique sur GitHub :
https://github.com/LuLu1357/simulateur-electronique/tree/work
Branche : work.

Mon objectif est un simulateur électronique original en français, avec une
qualité d’usage qui progresse vers Tinkercad. Travaille concrètement et conserve
les fonctions existantes. Ne prétends pas avoir atteint la parité sans preuve.

Commence par lire AGENTS.md, docs/SUIVI.md, docs/REPRISE.md et CONTRACT.md sur
la branche work. Inspecte le dépôt et l’historique avant d’éditer. Le suivi est
la source commune : actualise les progrès, les responsables, les tests vraiment
exécutés, les limites et la prochaine action au début et à la fin de chaque lot.

Priorité : terminer et valider la relecture transitoire déjà implémentée.
1. Vérifie le parcours complet avec vrai ngspice et source PULSE commandant une
   DEL : schéma, plaques, valeurs, courants, oscilloscope et énergie doivent
   correspondre au point réellement affiché. Teste lecture, pause et retour final.
2. Vérifie requêtes lentes, nouveau calcul, erreur et modifications électriques
   ou visuelles. Ne présente jamais les mesures d’un ancien calcul comme courantes.
3. Vérifie que le carnet et les SVG conservent le bon instant, et que le nouvel
   outil simulation_frame_read fonctionne via le client MCP officiel en stdio
   sans modifier le projet ni relancer SPICE. Utilise des données de test isolées.
4. Versionne un scénario d’intégration reproductible, mets à jour contrat,
   documentation MCP et validation, puis effectue une vraie revue navigateur.

Le relais a 340 tests Python + 106 sous-tests, 198 tests Node et un build réussi.
Les essais complets du nouveau curseur global et le nouveau parcours MCP stdio
restent à faire. Les tests DOM ne constituent pas une validation visuelle.

Répartis les travaux indépendants entre agents si possible : un pilote pour
l’intégration, un responsable backend/MCP et un responsable QA/interface.
Inscris les responsables effectifs et les fichiers possédés dans docs/SUIVI.md.
Évite les éditions concurrentes d’un même fichier, notamment main.tsx.

Publie régulièrement sur GitHub : commit et push sur work à chaque jalon
cohérent vérifié, étapes intermédiaires explicites si le chantier est long,
et mise à jour du suivi avant chaque arrêt ou relais. Vérifie le SHA distant.
L’autorisation de publier sur cette branche est donnée. Pas de force-push,
pas de publication directe sur main, aucun secret ou fichier .runtime dans Git.
N’annonce jamais un push, un test ou une revue qui n’a pas réellement eu lieu.

Après ces vérifications, choisis le prochain lot d’ergonomie à partir des défauts
observés, consigne ton plan dans le suivi et poursuis par étapes. Respecte toute
demande d’arrêt et laisse un relais à jour avant de terminer.
```
