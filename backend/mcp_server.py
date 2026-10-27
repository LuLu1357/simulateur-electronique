"""Serveur MCP stdio officiel. Pont limité à l’API locale de l’atelier."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

ROOT = Path(__file__).resolve().parent.parent
API_URL = 'http://127.0.0.1:8765'
STOP_TIMEOUT_SECONDS = 2.0
mcp = MCPServer('Atelier électronique', log_level='WARNING', instructions=(
    'Simulateur pédagogique local. Lire circuit_read avant une mutation; transmettre expected_revision. '
    'Utiliser transaction_preview pour expliquer puis transaction_apply pour appliquer atomiquement. '
    'Les courants sont conventionnels; les modèles génériques ne valident jamais un montage physique. '
    'Les outils n’accèdent qu’au circuit de l’application locale déjà démarrée.'
))


async def api(method: str, route: str, payload: dict | None = None, params: dict | None = None) -> dict:
    """Transport fixe, sans URL ni chemin de fichier contrôlables par l’assistant."""
    headers = {}
    if method != 'GET':
        try:
            headers['X-Atelier-Token'] = (ROOT / '.runtime' / 'token').read_text(encoding='utf8').strip()
        except FileNotFoundError:
            raise ToolError('L’application locale n’est pas démarrée. Lancez ./scripts/run.sh dans son dossier.')
    async with httpx.AsyncClient(base_url=API_URL, timeout=180, trust_env=False) as client:
        try:
            response = await client.request(method, route, json=payload, params=params, headers=headers)
        except httpx.TimeoutException as exc:
            if method == 'POST' and route in {'/api/simulate', '/api/truth-table'}:
                stop_note = 'Une demande d’arrêt a été transmise.'
                try:
                    async with asyncio.timeout(STOP_TIMEOUT_SECONDS):
                        stopped = await client.post('/api/stop', json={}, headers=headers, timeout=STOP_TIMEOUT_SECONDS)
                        stopped.raise_for_status()
                except (httpx.HTTPError, TimeoutError):
                    # Délai total borné, sans remplacer la cause du timeout initial.
                    stop_note = 'L’arrêt n’a pas pu être confirmé; la déconnexion demande aussi l’annulation au serveur.'
                raise ToolError(f'Délai de réponse du calcul dépassé. {stop_note} Relisez les résultats avant de relancer.') from exc
            raise ToolError('Délai de réponse de l’API locale dépassé. Réessayez après avoir vérifié le service local.') from exc
        except httpx.ConnectError:
            raise ToolError('API locale indisponible : démarrez l’application sur 127.0.0.1:8765.')
    result = response.json()
    if response.status_code >= 400:
        current = result.get('state', {}).get('project', {}).get('revision')
        message = result.get('error', result.get('detail', 'Requête refusée.'))
        raise ToolError(f'HTTP {response.status_code} : {message}. Révision actuelle : {current}. Aucune modification appliquée.')
    return result


@mcp.tool()
async def circuit_read() -> dict:
    """Lire le projet complet, sa révision, les réseaux, le catalogue et les mesures courantes."""
    return await api('GET', '/api/state')


@mcp.tool()
async def component_inspect(component_id: str) -> dict:
    """Inspecter bornes explicites, boîtier, modèle, trous, réseaux, tensions et courant d’un composant."""
    from urllib.parse import quote
    return await api('GET', '/api/inspect/' + quote(component_id, safe=''))


@mcp.tool()
async def selection_read() -> dict:
    """Lire la vue affichée, la sélection, les surlignages et annotations visibles dans l’interface."""
    state = await api('GET', '/api/state')
    return {'revision': state['project']['revision'], **state['project']['ui']}


@mcp.tool()
async def net_trace(point: str) -> dict:
    """Suivre un identifiant de réseau, de borne ou de trou; obtenir tous ses points et sa tension."""
    from urllib.parse import quote
    return await api('GET', '/api/net/' + quote(point, safe=''))


@mcp.tool()
async def breadboard_continuity(a: str, b: str) -> dict:
    """Prouver la continuité entre deux trous ou bornes, en tenant compte des rails coupés et des fils."""
    return await api('GET', '/api/continuity', params={'a': a, 'b': b})


@mcp.tool()
async def models_read() -> dict:
    """Lire les valeurs, modèles génériques/constructeur et correspondances électriques-boîtier explicites."""
    state = await api('GET', '/api/state')
    return {'revision': state['project']['revision'], 'catalog': state['catalog'], 'components': state['project']['components']}


@mcp.tool()
async def topology_validate() -> dict:
    """Lire les erreurs démontrées, avertissements numériques et hypothèses pédagogiques de connexion."""
    return await api('GET', '/api/validate')


@mcp.tool()
async def simulation_run(analysis: dict | None = None) -> dict:
    """Lancer ngspice sur le circuit courant: analysis={kind:'op'} ou {kind:'tran',step:0.0001,stop:0.01}."""
    return await api('POST', '/api/simulate', {'analysis': analysis or {'kind': 'op'}})


@mcp.tool()
async def simulation_stop() -> dict:
    """Demander l’arrêt du processus ngspice ou de la table d’essais en cours."""
    return await api('POST', '/api/stop', {})


@mcp.tool()
async def measurements_read() -> dict:
    """Lire tensions, courants, courbes, diagnostics et dernier succès; vérifier le marqueur stale."""
    return await api('GET', '/api/results')


@mcp.tool()
async def voltage_measure(positive: str, negative: str = '0') -> dict:
    """Mesurer V(positive)-V(negative) depuis les tensions réellement calculées; points=bornes, trous ou réseaux."""
    state = await api('GET', '/api/state')
    result = state.get('simulation') or {}
    if result.get('status') != 'success':
        result = state.get('last_success') or {}
    def resolve(point):
        return state['topology']['terminal_to_net'].get(point) or state['topology']['hole_to_net'].get(point) or point
    pa, pb = resolve(positive), resolve(negative)
    volts = result.get('voltages', {})
    if pa not in volts or pb not in volts:
        raise ToolError('Mesure indisponible : lancez une simulation et choisissez deux points calculés.')
    return {'positive': positive, 'negative': negative, 'voltage': volts[pa] - volts[pb], 'unit': 'V',
            'project_revision': result.get('project_revision'), 'stale': result.get('stale', result.get('project_revision') != state['project']['revision'])}


@mcp.tool()
async def truth_table_test(inputs: dict | None = None, outputs: dict | None = None,
                           cases: list[dict] | None = None, thresholds: dict | None = None,
                           example: str | None = None) -> dict:
    """Simuler chaque combinaison par ngspice et comparer les niveaux calculés aux sorties attendues.

    example='subtractor' teste les 16 couples A/B du soustracteur 2 bits (emprunt entrée=0).
    Sinon inputs={A0:'sourceId'}, outputs={D0:'terminalId'}, cases=[{inputs:{A0:0},expected:{D0:1}}].
    Seuils par défaut low=1.5V high=3.5V; entre les seuils le niveau est indéterminé.
    """
    payload = {key: value for key, value in {'inputs': inputs, 'outputs': outputs, 'cases': cases,
               'thresholds': thresholds, 'example': example}.items() if value is not None}
    return await api('POST', '/api/truth-table', payload)


@mcp.tool()
async def transaction_preview(expected_revision: int, operations: list[dict]) -> dict:
    """Prévisualiser un groupe d’opérations validées, sans changer le circuit, sa révision ni son historique.

    Types: add_component, move_component, set_value, set_model, connect, remove_component,
    set_position, set_waveform, set_wire_style, remove_wire, add_junction, move_junction,
    remove_junction, place_pin, set_board_count (1 à 4), layout_breadboard,
    set_rail_splits, set_ui, annotate, set_title. Trou plaque 2 : '2:a1' ; plaque 1 : 'a1'.
    """
    return await api('POST', '/api/transaction', {'expected_revision': expected_revision, 'operations': operations, 'preview': True})


@mcp.tool()
async def transaction_apply(expected_revision: int, operations: list[dict]) -> dict:
    """Appliquer atomiquement un groupe d’opérations au circuit partagé. En cas d’erreur rien ne change.

    Exemples: {type:'set_value',id:'R1',value:2000}; {type:'connect',a:'V1.p',b:'R1.p'};
    {type:'add_component',kind:'resistor',value:1000,x:320,y:200};
    {type:'place_pin',terminal:'R1.p',hole:'a1'}; {type:'move_component',id:'R1',x:400,y:250}.
    expected_revision obligatoire empêche d’écraser une modification récente.
    """
    return await api('POST', '/api/transaction', {'expected_revision': expected_revision, 'operations': operations})


@mcp.tool()
async def parameter_sweep(expected_revision: int, component_id: str, values: list[float], probe: dict | None = None) -> dict:
    """Balayer 2 à 16 valeurs SI sur des copies du circuit, sans modifier son modèle ni ses mesures.

    Cible : résistance, tension d’une source sans créneau ou position 0..1 d’un potentiomètre.
    Chaque point est un vrai calcul OP. probe optionnel {p:'R1.p',n:'0'} définit la tension différentielle.
    Retourne courants, tensions et convergence, au plus 45 s. simulation_stop interrompt aussi cette série.
    """
    body = {'expected_revision': expected_revision, 'component_id': component_id, 'values': values}
    if probe is not None:
        body['probe'] = probe
    return await api('POST', '/api/parameter-sweep', body)


@mcp.tool()
async def project_library_list() -> dict:
    """Lister les copies locales enregistrées, avec leurs identifiants, titres et dates, sans modifier le circuit."""
    return await api('GET', '/api/projects')


@mcp.tool()
async def project_library_save(expected_revision: int) -> dict:
    """Conserver une copie indépendante du circuit courant dans la bibliothèque locale (12 maximum)."""
    return await api('POST', '/api/projects/save', {'expected_revision': expected_revision})


@mcp.tool()
async def project_library_load(expected_revision: int, snapshot_id: str) -> dict:
    """Ouvrir une copie choisie dans project_library_list ; remplace le circuit actif et reste annulable."""
    return await api('POST', '/api/projects/load', {'expected_revision': expected_revision, 'id': snapshot_id})


@mcp.tool()
async def history_undo(expected_revision: int) -> dict:
    """Annuler la dernière édition; la révision reste croissante et le circuit réellement obtenu est retourné."""
    return await api('POST', '/api/undo', {'expected_revision': expected_revision})


@mcp.tool()
async def history_redo(expected_revision: int) -> dict:
    """Rétablir la dernière édition annulée, avec contrôle de révision."""
    return await api('POST', '/api/redo', {'expected_revision': expected_revision})


@mcp.tool()
async def interface_highlight(expected_revision: int, targets: list[str], view: str | None = None) -> dict:
    """Surligner composants, réseaux ou points d’un trajet dans les deux vues; vue facultative split/schematic/breadboard."""
    operation: dict[str, Any] = {'type': 'set_ui', 'highlights': targets}
    if view is not None:
        operation['view'] = view
    return await transaction_apply(expected_revision, [operation])


@mcp.tool()
async def annotation_add(expected_revision: int, text: str, targets: list[str] | None = None) -> dict:
    """Ajouter une annotation pédagogique persistante attachée aux composants/réseaux indiqués."""
    return await transaction_apply(expected_revision, [{'type': 'annotate', 'text': text, 'targets': targets or []}])


@mcp.tool()
async def example_load(expected_revision: int, example_id: str) -> dict:
    """Charger un exemple autorisé ohm/divider/diode/npn/pnp/rc/subtractor. Opération annulable."""
    return await api('POST', '/api/load-example', {'expected_revision': expected_revision, 'id': example_id})


@mcp.tool()
async def project_save(expected_revision: int) -> dict:
    """Sauvegarder le projet courant dans l’emplacement de l’application; aucun chemin arbitraire accepté."""
    return await api('POST', '/api/save', {'expected_revision': expected_revision})


@mcp.tool()
async def branch_current_measure(component_id: str) -> dict:
    """Lire le courant conventionnel calculé dans une branche; BJT: courant entrant au collecteur."""
    details = await component_inspect(component_id)
    return {'component_id': component_id, 'current': details.get('current'), 'unit': 'A',
            'stale': details.get('measurements_stale'), 'revision': details['revision'],
            'project_revision': details.get('measurement_revision'), 'measurement_source': details.get('measurement_source'),
            'convention': 'De la première borne à la seconde; BJT: courant entrant au collecteur.'}


@mcp.tool()
async def project_import(expected_revision: int, project: dict) -> dict:
    """Importer le contenu JSON d’un projet versionné et validé. Aucun chemin de fichier n’est accepté; annulable."""
    return await api('POST', '/api/import', {'expected_revision': expected_revision, 'project': project})


@mcp.tool()
async def project_new(expected_revision: int, title: str = 'Nouveau circuit') -> dict:
    """Créer un projet vide, avec validation de révision et possibilité d’annuler."""
    return await api('POST', '/api/new', {'expected_revision': expected_revision, 'title': title})


if __name__ == '__main__':
    mcp.run()
