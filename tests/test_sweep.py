from copy import deepcopy
import shutil
import threading

import pytest
from fastapi.testclient import TestClient

from backend.domain import Store
from backend.examples import example_projects
from backend.server import create_app
from backend.sweep import prepare_sweep, run_parameter_sweep


@pytest.mark.parametrize('values', [[], [1000], [1000]*17, [True, 1000], ['1k', 1000], [float('inf'), 1000], [0, 1000], [-1, 1000], [10**1000, 1000]])
def test_bad_resistance_ranges_reject_all_points_without_modifying_project(values):
    project = example_projects()['ohm']
    before = deepcopy(project)
    with pytest.raises(ValueError):
        prepare_sweep(project, 'R1', values)
    assert project == before


def test_sweep_parameter_and_probe_contract():
    project = example_projects()['potentiometer']
    trials, parameter, probe = prepare_sweep(project, 'RV1', [0, .5, 1])
    assert parameter['field'] == 'position' and parameter['unit'] == '%'
    assert probe == {'p': 'RV1.w', 'n': '0'}
    assert [next(c for c in trial['components'] if c['id'] == 'RV1')['position'] for trial in trials] == [0, .5, 1]
    with pytest.raises(ValueError):
        prepare_sweep(project, 'RV1', [-.1, 1])
    with pytest.raises(ValueError):
        prepare_sweep(project, 'RV1', [0, 1], {'p': 'missing', 'n': '0'})
    with pytest.raises(ValueError):
        prepare_sweep(example_projects()['pulse_rc'], 'V1', [0, 5])


def test_cancelled_sweep_never_fabricates_rows_or_changes_source():
    project = example_projects()['ohm']
    before = deepcopy(project)
    cancelled = threading.Event()
    cancelled.set()
    report = run_parameter_sweep(project, 'R1', [1000, 2000], cancel_event=cancelled)
    assert report['status'] == 'cancelled' and report['rows'] == [] and report['converged'] == 0
    assert report['total'] == 2 and project == before


@pytest.mark.skipif(not shutil.which('ngspice'), reason='ngspice réel requis')
def test_actual_ohm_and_pot_sweeps_are_independent_calculations():
    project = example_projects()['ohm']
    before = deepcopy(project)
    report = run_parameter_sweep(project, 'R1', [1000, 2000, 4000])
    assert report['status'] == 'success' and report['converged'] == 3
    assert [row['current'] for row in report['rows']] == pytest.approx([.005, .0025, .00125])
    assert [row['voltage'] for row in report['rows']] == pytest.approx([5, 5, 5])
    assert project == before
    report = run_parameter_sweep(example_projects()['potentiometer'], 'RV1', [.25, .5, .75])
    assert report['status'] == 'success'
    assert [row['voltage'] for row in report['rows']] == pytest.approx([3.75, 2.5, 1.25], abs=1e-5)


def test_failed_points_remain_unknown_instead_of_getting_zero():
    project = example_projects()['ohm']
    project['components'] = [c for c in project['components'] if c['kind'] != 'ground']
    project['wires'] = [w for w in project['wires'] if not w['a'].startswith('G1.') and not w['b'].startswith('G1.')]
    project['schematic'].pop('G1')
    project['breadboard']['placements'].pop('G1.g')
    report = run_parameter_sweep(project, 'R1', [1000, 2000])
    assert report['status'] == 'partial' and report['converged'] == 0
    assert all(row['voltage'] is None and row['current'] is None for row in report['rows'])


@pytest.mark.skipif(not shutil.which('ngspice'), reason='ngspice réel requis')
def test_api_sweep_requires_token_revision_and_preserves_active_measurements(tmp_path):
    app = create_app(Store(), tmp_path)
    with TestClient(app) as client:
        headers = {'X-Atelier-Token': client.get('/api/session').json()['token']}
        client.post('/api/simulate', json={'analysis': {'kind': 'op'}}, headers=headers)
        before = client.get('/api/state').json()
        body = {'expected_revision': 0, 'component_id': 'R1', 'values': [1000, 2000]}
        assert client.post('/api/parameter-sweep', json=body).status_code == 403
        assert client.post('/api/parameter-sweep', json={**body, 'expected_revision': 99}, headers=headers).status_code == 409
        response = client.post('/api/parameter-sweep', json=body, headers=headers)
        assert response.status_code == 200 and response.json()['status'] == 'success'
        after = client.get('/api/state').json()
        assert after['project'] == before['project'] and after['simulation'] == before['simulation']
        assert after['last_success'] == before['last_success'] and not after['running']
