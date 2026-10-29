"""Relecture fidèle d'un résultat ngspice, sans modifier ni recalculer le circuit."""
from copy import deepcopy
import math
import re
import shutil

import pytest
from fastapi.testclient import TestClient

from backend.domain import Store, topology
from backend.examples import example_projects
from backend.server import create_app
from backend.simulation import simulate
from backend.simulation_frames import FrameUnavailableError, simulation_frame


pytestmark = pytest.mark.skipif(not shutil.which('ngspice'), reason='ngspice requis ; aucun solveur de remplacement')
UID = 'a' * 32


def measured(project, analysis=None):
    result = simulate(project, analysis or project.get('default_analysis'))
    assert result['status'] == 'success', result
    result['simulation_id'] = UID
    return result


def nearest(result, target):
    return min(range(len(result['time'])), key=lambda i: abs(result['time'][i] - target))


@pytest.fixture(scope='module')
def rc_pair():
    project = example_projects()['rc']
    return project, measured(project)


@pytest.fixture
def frame_client(tmp_path, rc_pair):
    project, result = rc_pair
    store = Store(project)
    store.simulation = deepcopy(result)
    app = create_app(store, tmp_path)
    app.state.last_success = deepcopy(result)
    with TestClient(app) as client:
        yield client, app, store


def request_frame(client, uid=UID, index=0):
    return client.get('/api/results/frame', params={'simulation_id': uid, 'index': index})


def credentials(client):
    return {'X-Atelier-Token': client.get('/api/session').json()['token']}


def test_rc_frame_beginning_charge_and_end_follow_independent_exponential(rc_pair):
    project, result = rc_pair
    net = topology(project)['terminal_to_net']['C1.p']
    before = deepcopy((project, result))
    frames = []
    for target in (0, 0.001, 0.004, result['time'][-1]):
        index = nearest(result, target)
        frame = simulation_frame(project, result, UID, index)
        sample = frame['simulation']
        time = result['time'][index]
        assert frame['time'] == time
        assert frame['index'] == index
        assert frame['sample_count'] == len(result['time'])
        assert sample['sample_index'] == index and sample['sample_time'] == time
        assert sample['sample_count'] == len(result['time'])
        assert sample['time'] == [] and sample['curves'] == []
        assert sample['voltages']['0'] == 0
        assert sample['voltages'][net] == pytest.approx(5 * (1 - math.exp(-time / 0.001)), abs=0.002)
        assert sample['currents']['R1'] == pytest.approx(0.005 * math.exp(-time / 0.001), abs=2e-6)
        assert sample['terminal_currents_flat']['R1.p'] == sample['currents']['R1']
        assert sample['terminal_currents_flat']['R1.n'] == -sample['currents']['R1']
        frames.append(sample)
    assert frames[0]['currents']['R1'] > 100 * frames[-1]['currents']['R1']
    assert frames[1]['wire_flow_hints'] != frames[-1]['wire_flow_hints']
    assert frames[1]['flow_sample'] != 'last_calculated_point'
    assert (project, result) == before


def test_snapshot_is_independent_of_source_dictionaries_and_arrays(rc_pair):
    project, original = rc_pair
    source = deepcopy(original)
    before = deepcopy(source)
    frame = simulation_frame(project, source, UID, 0)
    frame['simulation']['voltages']['0'] = 17
    frame['simulation']['assumptions'].append('local annotation')
    frame['simulation']['analysis']['step'] = 123
    frame['simulation']['terminal_currents'].clear()
    assert source == before


def test_led_pulse_frames_retain_real_on_and_off_currents():
    project = example_projects()['led']
    source = next(c for c in project['components'] if c['id'] == 'V1')
    source['waveform'] = {'kind': 'pulse', 'low': 0, 'high': 5, 'delay': 0.0001,
                          'rise': 1e-6, 'fall': 1e-6, 'width': 0.0004, 'period': 0.001}
    result = measured(project, {'kind': 'tran', 'step': 2e-6, 'stop': 0.002})
    on = simulation_frame(project, result, UID, nearest(result, 0.0003))['simulation']
    off = simulation_frame(project, result, UID, nearest(result, 0.0008))['simulation']
    assert 0.008 < on['currents']['LED1'] < 0.011
    assert abs(off['currents']['LED1']) < 1e-7
    assert on['currents']['R1'] == pytest.approx(on['currents']['LED1'], abs=1e-10)
    assert on['terminal_currents_flat']['LED1.a'] > 0
    assert on['terminal_currents_flat']['LED1.k'] < 0
    assert on['wire_flow_hints'] != off['wire_flow_hints']


def test_rlc_frame_preserves_reversed_inductor_current_and_source_energy_return():
    project = example_projects()['rlc']
    result = measured(project)
    current = next(curve['values'] for curve in result['curves'] if curve['id'] == 'I:L1')
    index = min((i for i, t in enumerate(result['time']) if 0.0005 < t < 0.0007), key=lambda i: current[i])
    sample = simulation_frame(project, result, UID, index)['simulation']
    assert sample['currents']['L1'] < -0.015
    assert sample['currents']['R1'] == pytest.approx(sample['currents']['L1'], abs=1e-10)
    assert sample['currents']['C1'] == pytest.approx(sample['currents']['L1'], abs=1e-10)
    assert sample['currents']['V1'] > 0.015
    assert sample['terminal_currents_flat']['L1.p'] < 0
    assert sample['terminal_currents_flat']['L1.n'] > 0


@pytest.mark.parametrize('kind', ['npn', 'pnp'])
def test_bjt_base_and_emitter_series_are_real_and_balance_each_sample(kind):
    project = example_projects()[kind]
    result = measured(project, {'kind': 'tran', 'step': 1e-6, 'stop': 0.0001})
    curves = {curve['id']: curve for curve in result['curves']}
    assert curves['I:Q1.b']['unit'] == 'A' and curves['I:Q1.e']['unit'] == 'A'
    for index in (0, len(result['time']) // 2, len(result['time']) - 1):
        sample = simulation_frame(project, result, UID, index)['simulation']
        currents = sample['terminal_currents']['Q1']
        assert set(currents) == {'c', 'b', 'e'}
        assert currents['c'] == sample['currents']['Q1']
        assert currents['b'] == curves['I:Q1.b']['values'][index]
        assert currents['e'] == curves['I:Q1.e']['values'][index]
        assert sum(currents.values()) == pytest.approx(0, abs=1e-9)
        assert abs(currents['b']) > 1e-5
        assert (currents['c'] < 0) is (kind == 'pnp')
        for pin in ('c', 'b', 'e'):
            assert sample['terminal_currents_flat'][f'Q1.{pin}'] == currents[pin]


def test_loaded_potentiometer_frames_preserve_nonzero_wiper_current():
    store = Store(example_projects()['potentiometer'])
    store.transact(0, [
        {'type': 'add_component', 'kind': 'resistor', 'id': 'RL', 'value': 1000},
        {'type': 'connect', 'a': 'RL.p', 'b': 'RV1.w'},
        {'type': 'connect', 'a': 'RL.n', 'b': 'RV1.n'},
    ])
    result = measured(store.project, {'kind': 'tran', 'step': 1e-6, 'stop': 0.0001})
    sample = simulation_frame(store.project, result, UID, len(result['time']) // 2)['simulation']
    expected = 5 / 7
    assert sample['probe_voltages']['P1'] == pytest.approx(expected, abs=1e-8)
    terminals = sample['terminal_currents']['RV1']
    assert terminals['p'] == pytest.approx((5 - expected) / 5000, abs=1e-12)
    assert terminals['n'] == pytest.approx(-expected / 5000, abs=1e-12)
    assert terminals['w'] == pytest.approx(-expected / 1000, abs=1e-12)
    assert sum(terminals.values()) == pytest.approx(0, abs=1e-12)


@pytest.mark.parametrize('index', [-1, 999999, True, 0.5, None, '1', float('inf')])
def test_helper_rejects_non_integer_or_outside_index(rc_pair, index):
    project, result = rc_pair
    with pytest.raises(ValueError):
        simulation_frame(project, result, UID, index)


@pytest.mark.parametrize('uid', ['', None, 'a' * 31, '../token', 'g' * 32])
def test_helper_rejects_malformed_uid(rc_pair, uid):
    project, result = rc_pair
    with pytest.raises(ValueError):
        simulation_frame(project, result, uid, 0)


def test_helper_rejects_wrong_source_stale_failed_running_and_op(rc_pair):
    project, result = rc_pair
    with pytest.raises(FrameUnavailableError):
        simulation_frame(project, result, 'b' * 32, 0)
    with pytest.raises(FrameUnavailableError):
        simulation_frame(project, result, UID, 0, running=True)
    failed = {**result, 'status': 'error'}
    with pytest.raises(FrameUnavailableError):
        simulation_frame(project, failed, UID, 0)
    changed = deepcopy(project)
    next(c for c in changed['components'] if c['id'] == 'R1')['value'] = 2000
    with pytest.raises(FrameUnavailableError):
        simulation_frame(changed, result, UID, 0)
    op = measured(project, {'kind': 'op'})
    with pytest.raises(FrameUnavailableError):
        simulation_frame(project, op, UID, 0)


@pytest.mark.parametrize('corrupt', ['missing_voltage', 'missing_current', 'nonfinite_value', 'short_curve', 'duplicate_time', 'nonfinite_time'])
def test_corrupted_series_never_fall_back_to_last_point(rc_pair, corrupt):
    project, original = rc_pair
    result = deepcopy(original)
    net = topology(project)['terminal_to_net']['C1.p']
    if corrupt == 'missing_voltage':
        result['curves'] = [curve for curve in result['curves'] if curve['id'] != net]
    elif corrupt == 'missing_current':
        result['curves'] = [curve for curve in result['curves'] if curve['id'] != 'I:R1']
    elif corrupt == 'nonfinite_value':
        next(curve for curve in result['curves'] if curve['id'] == 'I:R1')['values'][0] = float('nan')
    elif corrupt == 'short_curve':
        next(curve for curve in result['curves'] if curve['id'] == 'I:R1')['values'].clear()
    elif corrupt == 'duplicate_time':
        result['time'][1] = result['time'][0]
    elif corrupt == 'nonfinite_time':
        result['time'][1] = float('inf')
    with pytest.raises(ValueError):
        simulation_frame(project, result, UID, 0)


def test_api_reading_frames_changes_no_state_or_history_and_runs_no_solver(frame_client, monkeypatch):
    client, app, store = frame_client
    import backend.server as server_module
    def forbidden(*args, **kwargs):
        pytest.fail('Une lecture d’échantillon ne doit jamais relancer ngspice.')
    monkeypatch.setattr(server_module, 'simulate', forbidden)
    before = client.get('/api/state').json()
    private_before = deepcopy((store.project, store.simulation, store._undo, store._redo, app.state.last_success))
    for index in (0, len(store.simulation['time']) // 2, len(store.simulation['time']) - 1):
        reply = request_frame(client, index=index)
        assert reply.status_code == 200, reply.text
        result = reply.json()
        assert result['simulation_id'] == UID
        assert result['source_revision'] == before['simulation']['project_revision']
        assert result['project_revision'] == before['project']['revision']
        assert result['project_id'] == before['project']['id']
    assert client.get('/api/state').json() == before
    assert (store.project, store.simulation, store._undo, store._redo, app.state.last_success) == private_before


@pytest.mark.parametrize('params', [
    {}, {'simulation_id': UID}, {'index': 0}, {'simulation_id': '', 'index': 0},
    {'simulation_id': 'g' * 32, 'index': 0}, {'simulation_id': UID, 'index': -1},
    {'simulation_id': UID, 'index': 999999}, {'simulation_id': UID, 'index': 'true'},
    {'simulation_id': UID, 'index': '1.25'}, {'simulation_id': UID, 'index': 'NaN'},
])
def test_api_rejects_invalid_query_without_mutation(frame_client, params):
    client, _, _ = frame_client
    before = client.get('/api/state').json()
    response = client.get('/api/results/frame', params=params)
    assert response.status_code == 422, response.text
    assert client.get('/api/state').json() == before


def test_api_current_source_only_and_visual_revisions_remain_usable(frame_client):
    client, app, store = frame_client
    assert request_frame(client, uid='b' * 32).status_code == 409
    store.transact(store.project['revision'], [{'type': 'move_component', 'id': 'R1', 'x': 900, 'y': 750}])
    frame = request_frame(client).json()
    assert frame['project_revision'] == 1 and frame['source_revision'] == 0
    app.state.running = True
    assert request_frame(client).status_code == 409
    app.state.running = False
    store.transact(store.project['revision'], [{'type': 'set_value', 'id': 'R1', 'value': 2000}])
    assert request_frame(client).status_code == 409
    store.simulation['status'] = 'error'
    assert app.state.last_success['status'] == 'success'
    assert request_frame(client).status_code == 409


def test_api_uid_changes_each_calculation_and_never_reuses_last_success(frame_client):
    client, app, store = frame_client
    headers = credentials(client)
    first = client.post('/api/simulate', json={'analysis': {'kind': 'tran', 'step': 1e-5, 'stop': 0.006}}, headers=headers).json()
    first_uid = first['simulation']['simulation_id']
    assert re.fullmatch('[0-9a-f]{32}', first_uid)
    second = client.post('/api/simulate', json={'analysis': {'kind': 'tran', 'step': 1e-5, 'stop': 0.006}}, headers=headers).json()
    second_uid = second['simulation']['simulation_id']
    assert first_uid != second_uid
    assert second['last_success']['simulation_id'] == second_uid
    assert request_frame(client, uid=first_uid).status_code == 409
    assert request_frame(client, uid=second_uid).status_code == 200
    failure = client.post('/api/simulate', json={'analysis': {'kind': 'tran', 'step': 1e-12, 'stop': 0.006}}, headers=headers).json()
    assert failure['simulation']['status'] == 'error'
    failed_uid = failure['simulation']['simulation_id']
    assert failed_uid not in (first_uid, second_uid)
    assert failure['last_success']['simulation_id'] == second_uid
    assert request_frame(client, uid=second_uid).status_code == 409
    assert request_frame(client, uid=failed_uid).status_code == 409
