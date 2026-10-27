"""Contrôles HTTP indépendants de l’interface et de la connexion MCP."""
import copy
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.domain import Store
from backend.server import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(Store(), tmp_path)
    with TestClient(app) as api:
        yield api


def credentials(client):
    return {'X-Atelier-Token': client.get('/api/session').json()['token']}


def revision(client):
    return client.get('/api/state').json()['project']['revision']


def test_security_requires_local_host_origin_and_token(client):
    assert client.get('/api/state', headers={'host': 'evil.example'}).status_code == 403
    assert client.get('/api/session', headers={'origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/session', headers={'sec-fetch-site': 'cross-site'}).status_code == 403
    assert client.post('/api/transaction', json={'expected_revision': 0, 'operations': []}).status_code == 403
    assert client.get('/api/health').json()['server_started'] is True


def test_mutation_preview_atomicity_revision_undo_redo(client):
    headers = credentials(client)
    state = client.get('/api/state').json()
    project = state['project']
    resistor = next(c for c in project['components'] if c['kind'] == 'resistor')
    original = resistor['value']
    body = {'expected_revision': project['revision'], 'operations': [{'type': 'set_value', 'id': resistor['id'], 'value': 2200}]}
    preview = client.post('/api/transaction', json={**body, 'preview': True}, headers=headers)
    assert preview.status_code == 200
    assert client.get('/api/state').json()['project'] == project
    changed = client.post('/api/transaction', json=body, headers=headers)
    assert changed.status_code == 200
    assert next(c for c in changed.json()['project']['components'] if c['id'] == resistor['id'])['value'] == 2200
    assert client.post('/api/transaction', json=body, headers=headers).status_code == 409
    before = client.get('/api/state').json()['project']
    failed = client.post('/api/transaction', json={'expected_revision': before['revision'], 'operations': [
        {'type': 'set_value', 'id': resistor['id'], 'value': 3300}, {'type': 'remove_component', 'id': 'INEXISTANT'}]}, headers=headers)
    assert failed.status_code == 422
    assert client.get('/api/state').json()['project'] == before
    undone = client.post('/api/undo', json={'expected_revision': before['revision']}, headers=headers)
    assert undone.status_code == 200
    assert next(c for c in undone.json()['project']['components'] if c['id'] == resistor['id'])['value'] == original
    redone = client.post('/api/redo', json={'expected_revision': undone.json()['project']['revision']}, headers=headers)
    assert redone.status_code == 200
    assert next(c for c in redone.json()['project']['components'] if c['id'] == resistor['id'])['value'] == 2200


def test_save_import_and_new_are_fixed_scope_and_undoable(client, tmp_path):
    headers = credentials(client)
    initial = client.get('/api/state').json()['project']
    saved = client.post('/api/save', json={'expected_revision': initial['revision']}, headers=headers)
    assert saved.status_code == 200
    assert json.loads((tmp_path / 'project.json').read_text()) == initial
    exported = client.get('/api/export').json()
    assert exported == initial
    new = client.post('/api/new', json={'expected_revision': revision(client), 'title': 'Mon essai'}, headers=headers)
    assert new.status_code == 200
    assert new.json()['project']['components'] == []
    imported = client.post('/api/import', json={'expected_revision': revision(client), 'project': exported}, headers=headers)
    assert imported.status_code == 200
    assert imported.json()['project']['components'] == initial['components']
    invalid = {**exported, 'schema_version': 999}
    failed = client.post('/api/import', json={'expected_revision': revision(client), 'project': invalid}, headers=headers)
    assert failed.status_code == 422


def test_continuity_and_explicit_component_inspection(client):
    state = client.get('/api/state').json()
    resistor = next(c for c in state['project']['components'] if c['kind'] == 'resistor')
    details = client.get('/api/inspect/' + resistor['id']).json()
    assert set(details['pins']) == {'p', 'n'}
    connected = client.get('/api/continuity', params={'a': 'a1', 'b': 'e1'}).json()
    assert connected['continuous'] is True
    gap = client.get('/api/continuity', params={'a': 'a1', 'b': 'f1'}).json()
    assert gap['continuous'] is False
    rail = client.get('/api/continuity', params={'a': 'rail_top_p1', 'b': 'rail_top_p30'}).json()
    assert rail['continuous'] is False


def test_stop_responds_while_simulation_runs(client, monkeypatch):
    import backend.server as module
    entered = threading.Event()
    def controlled_simulation(project, analysis, cancel_event):
        entered.set()
        assert cancel_event.wait(3), 'stop doit être traité pendant le calcul'
        return {'status': 'cancelled', 'project_revision': project['revision'], 'voltages': {}, 'currents': {}, 'curves': [], 'time': [], 'diagnostics': []}
    monkeypatch.setattr(module, 'simulate', controlled_simulation)
    headers = credentials(client)
    with ThreadPoolExecutor(max_workers=1) as pool:
        request = pool.submit(client.post, '/api/simulate', json={'analysis': {'kind': 'op'}}, headers=headers)
        assert entered.wait(2)
        assert client.get('/api/state').json()['running'] is True
        assert client.post('/api/stop', json={}, headers=headers).json()['stop_requested'] is True
        assert request.result(3).json()['simulation']['status'] == 'cancelled'


def test_failed_simulation_preserves_last_success_and_marks_stale(client, monkeypatch):
    import backend.server as module
    def success(project, analysis, cancel_event):
        return {'status': 'success', 'project_revision': project['revision'], 'voltages': {'0': 0, 'n1': 5}, 'currents': {'R1': .005}, 'curves': [], 'time': [], 'diagnostics': []}
    monkeypatch.setattr(module, 'simulate', success)
    headers = credentials(client)
    done = client.post('/api/simulate', json={}, headers=headers).json()
    assert done['last_success']['voltages']['n1'] == 5
    state = client.get('/api/state').json()
    resistor = next(c for c in state['project']['components'] if c['kind'] == 'resistor')
    change = client.post('/api/transaction', json={'expected_revision': state['project']['revision'], 'operations': [{'type': 'set_value', 'id': resistor['id'], 'value': 2200}]}, headers=headers).json()
    assert change['simulation']['stale'] is True
    def fail(project, analysis, cancel_event):
        return {'status': 'error', 'project_revision': project['revision'], 'voltages': {}, 'currents': {}, 'curves': [], 'time': [], 'diagnostics': [{'category': 'solver', 'message': 'Échec simulé du solveur pour ce test'}]}
    monkeypatch.setattr(module, 'simulate', fail)
    failure = client.post('/api/simulate', json={}, headers=headers).json()
    assert failure['simulation']['status'] == 'error'
    assert failure['last_success']['voltages']['n1'] == 5
    assert failure['last_success']['stale'] is True


@pytest.mark.parametrize('route', ['transaction', 'undo', 'redo', 'load-example', 'new', 'import', 'save', 'simulate', 'stop', 'truth-table'])
@pytest.mark.parametrize('payload', [[], ['unexpected'], 'unexpected', 42])
def test_non_object_payload_is_rejected_without_server_error(client, route, payload):
    response = client.post('/api/' + route, json=payload, headers=credentials(client))
    assert response.status_code == 422, (route, payload, response.text)
    assert 'error' in response.json()


@pytest.mark.parametrize('route,payload', [
    ('load-example', {'id': [], 'expected_revision': 0}),
    ('transaction', {'expected_revision': 0, 'operations': [], 'preview': 'false'}),
    ('simulate', {'analysis': ['op']}),
    ('simulate', {'analysis': 'op'}),
    ('simulate', {'analysis': {'kind': 'tran', 'startup': 'yes'}}),
    ('simulate', {'analysis': {'kind': 'tran', 'step': '0.1'}}),
    ('simulate', {'analysis': {'kind': 'tran', 'step': 10 ** 1000}}),
    ('simulate', {'analysis': {'kind': 'tran', 'stop': 10 ** 1000}}),
    ('truth-table', {'inputs': ['A'], 'outputs': {'D': 'R1.n'}, 'cases': [{}]}),
    ('truth-table', {'inputs': {'A': []}, 'outputs': {'D': 'R1.n'}, 'cases': [{}]}),
    ('truth-table', {'inputs': {'A': 'V1'}, 'outputs': {'D': 'R1.n'}, 'cases': [None]}),
    ('truth-table', {'inputs': {'A': 'V1'}, 'outputs': {'D': 'R1.n'}, 'cases': [{'inputs': {'A': 0}, 'expected': {'D': 0}}], 'thresholds': []}),
    ('truth-table', {'inputs': {'A': 'V1'}, 'outputs': {'D': 'R1.n'}, 'cases': [{'inputs': {'A': 0}, 'expected': {'D': 0}}], 'thresholds': {'low': 0, 'high': 10 ** 1000}}),
    ('truth-table', {'example': []}),
])
def test_nested_payload_errors_are_useful_and_do_not_mutate(client, route, payload):
    before = client.get('/api/state').json()['project']
    response = client.post('/api/' + route, json=payload, headers=credentials(client))
    assert response.status_code == 422, response.text
    assert response.json()['error']
    assert client.get('/api/state').json()['project'] == before


def test_malformed_json_is_useful_and_mcp_status_does_not_claim_connection(client):
    invalid = client.post('/api/transaction', content='{incomplete', headers={**credentials(client), 'Content-Type': 'application/json'})
    assert invalid.status_code == 422
    assert 'JSON' in invalid.json()['error']
    health = client.get('/api/health').json()
    assert health['mcp']['transport'] == 'stdio'
    assert health['mcp']['client_connected'] is None
    assert health['mcp']['tools_accessible'] is None


def test_visual_changes_preserve_measurements_but_electrical_changes_mark_stale(client, monkeypatch):
    import backend.server as module
    def success(project, analysis, cancel_event):
        return {'status': 'success', 'project_revision': project['revision'], 'voltages': {'0': 0}, 'currents': {}, 'curves': [], 'time': [], 'diagnostics': []}
    monkeypatch.setattr(module, 'simulate', success)
    headers = credentials(client)
    result = client.post('/api/simulate', json={}, headers=headers).json()
    resistor = next(c for c in result['project']['components'] if c['kind'] == 'resistor')
    visual = client.post('/api/transaction', json={'expected_revision': result['project']['revision'], 'operations': [
        {'type': 'set_ui', 'selected': [resistor['id']], 'highlights': [resistor['id']], 'view': 'breadboard'},
        {'type': 'move_component', 'id': resistor['id'], 'x': 510, 'y': 250},
        {'type': 'set_title', 'title': 'Un nouveau nom'}]}, headers=headers).json()
    assert visual['simulation']['stale'] is False
    assert visual['last_success']['stale'] is False
    assert visual['simulation']['project_revision'] != visual['project']['revision']
    changed = client.post('/api/transaction', json={'expected_revision': visual['project']['revision'], 'operations': [
        {'type': 'set_value', 'id': resistor['id'], 'value': 4700}]}, headers=headers).json()
    assert changed['simulation']['stale'] is True
    assert changed['last_success']['stale'] is True
    undone = client.post('/api/undo', json={'expected_revision': changed['project']['revision']}, headers=headers).json()
    assert undone['simulation']['stale'] is False
    assert undone['last_success']['stale'] is False


def test_truth_table_timeout_keeps_partial_report_and_releases_guard(client, monkeypatch):
    import backend.server as module
    partial = {'status': 'timeout', 'project_revision': 0, 'cases': [{'inputs': {'A0': 0}, 'voltages': {'D0': 0.04}, 'passed': True}],
               'completed': 1, 'total': 16, 'passed': 1,
               'diagnostics': [{'code': 'table_timeout', 'message': 'Délai total atteint.'}]}
    monkeypatch.setattr(module, 'run_truth_table', lambda *args: copy.deepcopy(partial))
    response = client.post('/api/truth-table', json={'example': 'subtractor'}, headers=credentials(client))
    assert response.status_code == 200
    assert response.json() == partial
    assert client.get('/api/results').json()['truth_table'] == partial
    assert client.get('/api/state').json()['running'] is False
    assert not client.app.state.simulation_guard.locked()


def test_stop_interrupts_truth_table_while_it_is_in_flight(client, monkeypatch):
    import backend.server as module
    entered = threading.Event()
    def controlled_table(project, inputs, outputs, cases, thresholds, cancel_event):
        entered.set()
        assert cancel_event.wait(3), 'stop doit atteindre la table en cours'
        return {'status': 'cancelled', 'project_revision': project['revision'], 'cases': [], 'completed': 0, 'total': len(cases), 'passed': 0}
    monkeypatch.setattr(module, 'run_truth_table', controlled_table)
    headers = credentials(client)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, '/api/truth-table', json={'example': 'subtractor'}, headers=headers)
        assert entered.wait(2)
        assert client.get('/api/state').json()['running'] is True
        assert client.post('/api/stop', json={}, headers=headers).json()['stop_requested'] is True
        assert pending.result(3).json()['status'] == 'cancelled'
    assert client.get('/api/state').json()['running'] is False
    assert not client.app.state.simulation_guard.locked()


@pytest.mark.parametrize('termination', ['disconnect', 'coroutine_cancel'])
def test_request_termination_cancels_worker_without_releasing_guard_early(tmp_path, monkeypatch, termination):
    """Vrai échange ASGI passant par le middleware qui met le corps en cache."""
    import asyncio
    import httpx
    import backend.server as module
    entered, cancellation_seen, finish_allowed = (threading.Event() for _ in range(3))
    worker_events = []
    def controlled_simulation(project, analysis, cancel_event):
        worker_events.append(cancel_event)
        entered.set()
        assert cancel_event.wait(3), 'la terminaison HTTP doit annuler le calcul'
        cancellation_seen.set()
        assert finish_allowed.wait(3), 'le test autorise ensuite la sortie réelle du thread'
        return {'status': 'cancelled', 'project_revision': project['revision'], 'voltages': {}, 'currents': {}, 'curves': [], 'time': [], 'diagnostics': []}
    monkeypatch.setattr(module, 'simulate', controlled_simulation)

    async def scenario():
        app = create_app(Store(), tmp_path)
        messages = asyncio.Queue()
        body = b'{"analysis":{"kind":"op"}}'
        messages.put_nowait({'type': 'http.request', 'body': body, 'more_body': False})
        scope = {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.3'}, 'http_version': '1.1',
                 'method': 'POST', 'scheme': 'http', 'path': '/api/simulate', 'raw_path': b'/api/simulate',
                 'query_string': b'', 'root_path': '', 'client': ('127.0.0.1', 41000), 'server': ('127.0.0.1', 8765),
                 'headers': [(b'host', b'127.0.0.1:8765'), (b'content-type', b'application/json'),
                             (b'content-length', str(len(body)).encode()), (b'x-atelier-token', app.state.token.encode())]}
        sent = []
        async def send(message):
            sent.append(message)
        request_task = asyncio.create_task(app(scope, messages.get, send))
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            first_event = app.state.cancel_event
            if termination == 'disconnect':
                messages.put_nowait({'type': 'http.disconnect'})
            else:
                request_task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await request_task
            assert await asyncio.to_thread(cancellation_seen.wait, 2)
            assert app.state.running is True
            assert app.state.simulation_guard.locked()
            assert first_event.is_set()
            # Un autre calcul ne peut ni démarrer ni effacer le signal d’arrêt.
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8765') as client:
                refused = await client.post('/api/simulate', json={}, headers={'X-Atelier-Token': app.state.token})
                assert refused.status_code == 409
            assert app.state.cancel_event is first_event and first_event.is_set()
            finish_allowed.set()
            if termination == 'disconnect':
                await asyncio.wait_for(request_task, 2)
            if app.state.worker_tasks:
                await asyncio.wait_for(asyncio.gather(*app.state.worker_tasks), 2)
            assert app.state.running is False
            assert not app.state.simulation_guard.locked()
            assert app.state.store.get_state()['simulation']['status'] == 'cancelled'
            # Un nouveau travail reçoit son propre Event; l’ancien reste annulé.
            def immediate(project, analysis, cancel_event):
                assert cancel_event is not first_event and not cancel_event.is_set()
                return {'status': 'success', 'project_revision': project['revision'], 'voltages': {}, 'currents': {}, 'curves': [], 'time': [], 'diagnostics': []}
            monkeypatch.setattr(module, 'simulate', immediate)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8765') as client:
                done = await client.post('/api/simulate', json={}, headers={'X-Atelier-Token': app.state.token})
                assert done.status_code == 200
            assert first_event.is_set()
        finally:
            finish_allowed.set()
            if not request_task.done():
                request_task.cancel()
                await asyncio.gather(request_task, return_exceptions=True)
    asyncio.run(scenario())
