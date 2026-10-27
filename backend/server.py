"""API locale : toutes les vues et le pont MCP partagent un seul Store."""
from __future__ import annotations

import asyncio
import copy
import json
import math
import os
import secrets
import shutil
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .domain import Store, catalog, circuit_fingerprint, new_project, topology, validate_topology
from .examples import example_projects
from .project_library import ProjectLibrary
from .sweep import prepare_sweep, run_parameter_sweep
from .simulation import run_truth_table, simulate

ROOT = Path(__file__).resolve().parent.parent


def _finite_number(value: Any) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except (OverflowError, ValueError):
        return False


def create_app(store: Store | None = None, runtime_dir: Path | None = None) -> FastAPI:
    runtime = runtime_dir or ROOT / '.runtime'
    runtime.mkdir(parents=True, exist_ok=True)
    token_file = runtime / 'token'
    runtime.chmod(0o700)
    try:
        descriptor = os.open(token_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        token_file.chmod(0o600)
        token = token_file.read_text(encoding='utf8').strip()
        if len(token) < 32:
            token = secrets.token_urlsafe(32)
            token_file.write_text(token, encoding='utf8')
    else:
        token = secrets.token_urlsafe(32)
        with os.fdopen(descriptor, 'w', encoding='utf8') as output:
            output.write(token)
    state_store = store or Store(path=runtime / 'project.json')
    application = FastAPI(title='Atelier Électronique — API locale', version='0.1.0')
    application.state.store = state_store
    application.state.token = token
    application.state.runtime_dir = runtime
    application.state.simulation_guard = threading.Lock()
    application.state.cancel_event = threading.Event()
    application.state.last_success = None
    application.state.last_truth_table = None
    application.state.running = False
    application.state.worker_tasks = set()
    project_library = ProjectLibrary(runtime)

    @application.middleware('http')
    async def local_security(request: Request, call_next):
        try:
            host = urlsplit('http://' + request.headers.get('host', '')).hostname
        except ValueError:
            return JSONResponse({'error': 'Hôte local invalide.'}, status_code=403)
        allowed = {'127.0.0.1', 'localhost', '::1'}
        if runtime_dir is not None:
            allowed.add('testserver')
        if host not in allowed:
            return JSONResponse({'error': 'Hôte refusé : service local uniquement.'}, status_code=403)
        origin = request.headers.get('origin')
        expected_origin = f'{request.url.scheme}://{request.headers.get("host")}'
        if origin and origin != expected_origin:
            return JSONResponse({'error': 'Origine refusée : ouvrez directement l’application locale.'}, status_code=403)
        if request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse({'error': 'Requête provenant d’un autre site refusée.'}, status_code=403)
        length = request.headers.get('content-length', '0')
        try:
            if int(length) > 2_000_000:
                return JSONResponse({'error': 'Projet trop volumineux (limite 2 Mo).'}, status_code=413)
        except ValueError:
            return JSONResponse({'error': 'Longueur de requête invalide.'}, status_code=400)
        if request.url.path.startswith('/api/') and request.method not in {'GET', 'HEAD'}:
            if len(await request.body()) > 2_000_000:
                return JSONResponse({'error': 'Projet trop volumineux (limite 2 Mo).'}, status_code=413)
            supplied = request.headers.get('x-atelier-token', '')
            if not secrets.compare_digest(supplied, token):
                return JSONResponse({'error': 'Jeton local absent ou invalide.'}, status_code=403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Cache-Control'] = 'no-store'
        return response

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        fields = [str(error['loc'][-1]) for error in exc.errors()]
        return JSONResponse({'error': 'Corps JSON invalide : un objet avec les champs attendus est requis.', 'fields': fields}, status_code=422)

    @application.exception_handler(ValueError)
    async def value_error(request: Request, exc: ValueError):
        message = str(exc)
        status = 409 if any(word in message.lower() for word in ('révision', 'revision', 'conflit')) else 422
        return JSONResponse({'error': message, 'state': get_state()}, status_code=status)

    def get_state() -> dict:
        result = state_store.get_state()
        simulation = result.get('simulation')
        if isinstance(simulation, dict):
            simulation['running'] = application.state.running
        result['last_success'] = copy.deepcopy(application.state.last_success)
        if result['last_success']:
            fingerprint = result['last_success'].get('circuit_fingerprint')
            result['last_success']['stale'] = fingerprint != circuit_fingerprint(result['project']) if isinstance(fingerprint, str) else result['last_success'].get('project_revision') != result['project']['revision']
        result['running'] = application.state.running
        return result

    def revision(body: dict) -> int:
        value = body.get('expected_revision')
        if type(value) is not int:
            raise ValueError('La révision attendue (expected_revision entier) est obligatoire.')
        return value

    @application.get('/api/health')
    def health():
        return {'status': 'ok', 'server_started': True, 'ngspice_available': bool(shutil.which('ngspice')),
                'mcp': {'transport': 'stdio', 'client_connected': None, 'tools_accessible': None,
                        'status_note': 'La connexion stdio n’est pas observable depuis le serveur HTTP. Le rapport MCP daté prouve le dernier essai.'},
                'revision': state_store.get_state()['project']['revision']}

    @application.get('/api/session')
    def session():
        return {'token': token}

    @application.get('/api/state')
    def read_state():
        return get_state()

    @application.post('/api/transaction')
    def transaction(body: dict = Body(...)):
        if type(body.get('preview', False)) is not bool:
            raise ValueError('preview doit être un booléen vrai ou faux.')
        outcome = state_store.transact(revision(body), body.get('operations', []), preview=body.get('preview', False))
        if body.get('preview'):
            return outcome
        return get_state()

    @application.post('/api/undo')
    def undo(body: dict = Body(...)):
        state_store.undo(revision(body))
        return get_state()

    @application.post('/api/redo')
    def redo(body: dict = Body(...)):
        state_store.redo(revision(body))
        return get_state()

    @application.get('/api/examples')
    def examples():
        return [{'id': key, 'title': value['title']} for key, value in example_projects().items()]

    @application.post('/api/load-example')
    def load_example(body: dict = Body(...)):
        projects = example_projects()
        project_id = body.get('id')
        if not isinstance(project_id, str) or project_id not in projects:
            raise ValueError('Exemple inconnu.')
        state_store.replace(projects[project_id], revision(body))
        return get_state()

    @application.post('/api/new')
    def new_circuit(body: dict = Body(...)):
        project = new_project(empty=True)
        project['title'] = body.get('title', 'Nouveau circuit')
        state_store.replace(project, revision(body))
        return get_state()

    @application.post('/api/import')
    def import_project(body: dict = Body(...)):
        project = body.get('project')
        if not isinstance(project, dict):
            raise ValueError('Le projet doit être un objet JSON versionné.')
        state_store.replace(project, revision(body))
        return get_state()

    @application.get('/api/export')
    def export_project():
        return JSONResponse(state_store.get_state()['project'], headers={'Content-Disposition': 'attachment; filename="circuit.atelier.json"'})

    @application.post('/api/save')
    def save_project(body: dict = Body(default={})):
        with state_store.lock:
            if 'expected_revision' in body and revision(body) != state_store.project['revision']:
                raise ValueError('Conflit de révision : relisez le circuit avant de sauvegarder.')
            project = copy.deepcopy(state_store.project)
            target = runtime / 'project.json'
            temporary = runtime / 'project.json.tmp'
            temporary.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding='utf8')
            temporary.replace(target)
            return {'saved': True, 'project_id': project['id'], 'revision': project['revision'], 'state': get_state()}

    @application.get('/api/validate')
    def validate():
        project = state_store.get_state()['project']
        return {'revision': project['revision'], 'diagnostics': validate_topology(project)}

    def library_body(body: dict, fields: set[str]) -> None:
        if set(body) != fields:
            raise ValueError('Champs de bibliothèque invalides : utilisez uniquement les champs attendus.')

    @application.get('/api/projects')
    def list_saved_projects():
        return project_library.list()

    @application.get('/api/projects/export/{identifier}')
    def export_project_snapshot(identifier: str):
        return JSONResponse(project_library.get(identifier), headers={'Content-Disposition': 'attachment; filename="circuit.atelier.json"'})

    @application.post('/api/projects/save')
    def save_project_snapshot(body: dict = Body(...)):
        library_body(body, {'expected_revision'})
        expected = revision(body)
        with state_store.lock:
            if expected != state_store.project['revision']:
                raise ValueError('Conflit de révision : relisez le circuit avant de le conserver dans la bibliothèque.')
            return project_library.save(state_store.project)

    @application.post('/api/projects/load')
    def load_project_snapshot(body: dict = Body(...)):
        library_body(body, {'id', 'expected_revision'})
        expected = revision(body)
        if application.state.running:
            raise HTTPException(409, 'Attendez la fin du calcul avant d’ouvrir un autre projet.')
        with state_store.lock:
            project = project_library.get(body.get('id'))
            state_store.replace_project(project, expected)
            return get_state()

    @application.post('/api/projects/delete')
    def delete_project_snapshot(body: dict = Body(...)):
        library_body(body, {'id'})
        return project_library.delete(body.get('id'))

    async def run_calculation(request: Request, operation, publish):
        """Le thread conserve le verrou jusqu'à sa sortie, même si le client part.

        Le corps JSON a déjà été consommé par FastAPI. Attendre receive() ici
        observe donc seulement la déconnexion. is_disconnected() n'est pas utilisé :
        sa sonde annulée peut être absorbée par le BaseHTTPMiddleware de sécurité.
        """
        if not application.state.simulation_guard.acquire(blocking=False):
            raise HTTPException(409, 'Un calcul est déjà en cours. Arrêtez-le ou attendez son résultat.')
        cancel_event = threading.Event()
        application.state.cancel_event = cancel_event
        application.state.running = True

        def work():
            try:
                result = operation(cancel_event)
                publish(result)
                return result
            finally:
                # Ne jamais rendre ce verrou depuis la coroutine HTTP : to_thread
                # continue tant que le moteur n'a pas réellement fini son arrêt.
                application.state.running = False
                application.state.simulation_guard.release()

        worker = asyncio.create_task(asyncio.to_thread(work))
        application.state.worker_tasks.add(worker)
        def worker_finished(task):
            application.state.worker_tasks.discard(task)
            if not task.cancelled():
                task.exception()  # récupère aussi l'erreur si le client est parti
        worker.add_done_callback(worker_finished)

        async def watch_disconnect():
            while True:
                message = await request.receive()
                if message['type'] == 'http.disconnect':
                    cancel_event.set()
                    return
        watcher = asyncio.create_task(watch_disconnect())
        try:
            return await asyncio.shield(worker)
        except asyncio.CancelledError:
            cancel_event.set()
            raise
        finally:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)

    @application.post('/api/simulate')
    async def start_simulation(request: Request, body: dict = Body(default={})):
        analysis = body.get('analysis')
        if analysis is not None and not isinstance(analysis, dict):
            raise ValueError('analysis doit être un objet JSON, par exemple {kind: op}.')
        if isinstance(analysis, dict):
            if analysis.get('kind', 'op') not in ('op', 'tran'):
                raise ValueError('Analyse inconnue : choisir op ou tran.')
            if 'startup' in analysis and type(analysis['startup']) is not bool:
                raise ValueError('startup doit être un booléen.')
            for key in ('step', 'stop'):
                if key in analysis and (not _finite_number(analysis[key]) or analysis[key] <= 0):
                    raise ValueError(f'{key} doit être un nombre fini strictement positif en secondes.')
        project = copy.deepcopy(state_store.get_state()['project'])
        def publish(result):
            result.setdefault('circuit_fingerprint', circuit_fingerprint(project))
            with state_store.lock:
                state_store.simulation = result
            if result.get('status') == 'success':
                application.state.last_success = copy.deepcopy(result)
        await run_calculation(request, lambda event: simulate(project, analysis, event), publish)
        return get_state()

    @application.post('/api/stop')
    def stop_simulation(body: dict = Body(default={})):
        application.state.cancel_event.set()
        return {'stop_requested': True, 'running': application.state.running}

    @application.get('/api/results')
    def read_results():
        current = get_state()
        return {'simulation': current.get('simulation'), 'last_success': current.get('last_success'),
                'truth_table': application.state.last_truth_table, 'running': application.state.running}

    @application.post('/api/parameter-sweep')
    async def parameter_sweep(request: Request, body: dict = Body(...)):
        if set(body) - {'expected_revision', 'component_id', 'values', 'probe'}:
            raise ValueError('Champs de balayage inconnus.')
        expected = revision(body)
        with state_store.lock:
            if expected != state_store.project['revision']:
                raise ValueError('Conflit de révision : relisez le circuit avant le balayage.')
            project = copy.deepcopy(state_store.project)
        component_id = body.get('component_id')
        if not isinstance(component_id, str):
            raise ValueError('Choisissez un composant à balayer.')
        values = body.get('values')
        probe = body.get('probe')
        prepare_sweep(project, component_id, values, probe)
        return await run_calculation(request, lambda event: run_parameter_sweep(project, component_id, values, probe, event), lambda result: None)

    @application.post('/api/truth-table')
    async def truth_table(request: Request, body: dict = Body(default={})):
        project = copy.deepcopy(state_store.get_state()['project'])
        if body.get('example') not in (None, 'subtractor'):
            raise ValueError('Seul l’exemple subtractor est accepté ici; sinon omettez example pour tester le circuit ouvert.')
        if body.get('example') == 'subtractor':
            project = example_projects()['subtractor']
        spec = project.get('truth_table', {})
        inputs = body.get('inputs', spec.get('inputs'))
        outputs = body.get('outputs', spec.get('outputs'))
        cases = body.get('cases', spec.get('cases'))
        if not isinstance(inputs, dict) or not inputs or not isinstance(outputs, dict) or not outputs or not isinstance(cases, list):
            raise ValueError('Fournissez inputs, outputs et cases, ou chargez un circuit avec truth_table.')
        if not 1 <= len(cases) <= 32:
            raise ValueError('Une table contient de 1 à 32 essais.')
        if not all(isinstance(label, str) and isinstance(point, str) for mapping in (inputs, outputs) for label, point in mapping.items()):
            raise ValueError('inputs et outputs doivent associer des noms à des identifiants de sources ou de bornes.')
        for case in cases:
            if not isinstance(case, dict) or not isinstance(case.get('inputs'), dict) or not isinstance(case.get('expected'), dict):
                raise ValueError('Chaque essai doit être un objet avec inputs et expected sous forme d’objets.')
            if set(case['inputs']) != set(inputs) or set(case['expected']) != set(outputs):
                raise ValueError('Chaque essai doit définir toutes les entrées et toutes les sorties attendues.')
            if any(type(bit) is not int or bit not in (0, 1) for mapping in (case['inputs'], case['expected']) for bit in mapping.values()):
                raise ValueError('Les entrées et sorties attendues doivent être les entiers 0 ou 1.')
        thresholds = body.get('thresholds', spec.get('thresholds', {'low': 1.5, 'high': 3.5}))
        if not isinstance(thresholds, dict):
            raise ValueError('thresholds doit être un objet avec low et high en volts.')
        low, high = thresholds.get('low', 1.5), thresholds.get('high', 3.5)
        if any(not _finite_number(value) for value in (low, high)) or not 0 <= low < high <= 5:
            raise ValueError('Les seuils doivent respecter 0 ≤ low < high ≤ 5 V.')
        return await run_calculation(
            request,
            lambda event: run_truth_table(project, inputs, outputs, cases, thresholds, event),
            lambda result: setattr(application.state, 'last_truth_table', result),
        )

    @application.get('/api/inspect/{component_id}')
    def inspect_component(component_id: str):
        state = get_state()
        project = state['project']
        component = next((c for c in project['components'] if c['id'] == component_id), None)
        if component is None:
            raise HTTPException(404, 'Composant inconnu.')
        terminal_nets = state['topology']['terminal_to_net']
        result = state.get('simulation') or {}
        measurement_source = 'current'
        if result.get('status') != 'success' and state.get('last_success'):
            result = state['last_success']
            measurement_source = 'last_success'
        return {'revision': project['revision'], 'component': component,
                'measurement_revision': result.get('project_revision'), 'measurement_source': measurement_source,
                'pins': {name: {'id': pin, 'net': terminal_nets.get(pin),
                                'voltage': result.get('voltages', {}).get(terminal_nets.get(pin)),
                                'current': result.get('terminal_currents', {}).get(component_id, {}).get(name),
                                'hole': project['breadboard']['placements'].get(pin)} for name, pin in component['pins'].items()},
                'current': result.get('currents', {}).get(component_id),
                'terminal_currents': result.get('terminal_currents', {}).get(component_id, {}),
                'measurements_stale': result.get('stale', True), 'catalog': state['catalog'].get(component['kind'])}

    @application.get('/api/net/{point}')
    def follow_net(point: str):
        state = get_state()
        topo = state['topology']
        net_id = topo['terminal_to_net'].get(point) or topo['hole_to_net'].get(point) or point
        net = next((n for n in topo['nets'] if n['id'] == net_id), None)
        if net is None:
            raise HTTPException(404, 'Réseau ou point inconnu.')
        result = state.get('simulation') or {}
        measurement_source = 'current'
        if result.get('status') != 'success' and state.get('last_success'):
            result = state['last_success']
            measurement_source = 'last_success'
        return {'revision': state['project']['revision'], 'net': net,
                'voltage': result.get('voltages', {}).get(net_id),
                'measurement_revision': result.get('project_revision'),
                'measurement_source': measurement_source,
                'measurements_stale': result.get('stale', True)}

    @application.get('/api/continuity')
    def continuity(a: str, b: str):
        state = get_state()
        topo = state['topology']
        def resolve(point):
            return topo['terminal_to_net'].get(point) or topo['hole_to_net'].get(point)
        na, nb = resolve(a), resolve(b)
        if na is None or nb is None:
            raise ValueError('Point ou trou inconnu.')
        return {'revision': state['project']['revision'], 'a': a, 'b': b, 'net_a': na, 'net_b': nb,
                'continuous': na == nb, 'explanation': 'Même réseau électrique : continuité idéale démontrée.' if na == nb else 'Réseaux distincts : aucun fil ou groupe de trous ne les relie.'}

    static = ROOT / 'frontend' / 'dist'
    if (static / 'assets').exists():
        application.mount('/assets', StaticFiles(directory=static / 'assets'), name='assets')

    @application.get('/favicon.svg')
    def favicon():
        icon = static / 'favicon.svg'
        if not icon.is_file():
            raise HTTPException(404, 'Icône indisponible.')
        return FileResponse(icon, media_type='image/svg+xml')

    @application.get('/')
    def index():
        if (static / 'index.html').exists():
            return FileResponse(static / 'index.html')
        return JSONResponse({'message': 'Interface à construire : cd frontend && npm install && npm run build', 'api': '/docs'})

    return application


app = create_app()
