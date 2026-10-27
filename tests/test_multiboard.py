from copy import deepcopy
import shutil

import pytest

from backend.domain import Store, breadboard_groups, circuit_fingerprint, new_project, topology, validate_project
from backend.examples import example_projects
from backend.simulation import simulate


def two_board_ohm():
    project = new_project()
    project['wires'] = []
    project['breadboard']['board_count'] = 2
    project['breadboard']['placements']['R1.p'] = '2:e4'
    project['breadboard']['placements']['R1.n'] = '2:e12'
    return project


def test_same_named_holes_and_rails_on_two_boards_remain_independent():
    project = two_board_ohm()
    nets = topology(project)['hole_to_net']
    assert len(nets) == 840
    assert nets['a1'] != nets['2:a1']
    assert nets['2:a1'] == nets['2:e1'] and nets['2:a1'] != nets['2:f1']
    assert nets['rail_top_p1'] != nets['2:rail_top_p1']
    assert nets['2:rail_top_p1'] != nets['2:rail_top_p16']
    project['breadboard']['rail_splits'] = False
    nets = topology(project)['hole_to_net']
    assert nets['2:rail_top_p1'] == nets['2:rail_top_p30']
    assert nets['2:rail_top_p1'] != nets['rail_top_p1']


@pytest.mark.parametrize('count', [0, 5, True, 1.5, '2', None])
def test_invalid_board_count_is_rejected_for_import_and_operation(count):
    store = Store()
    before = store.get_state()
    with pytest.raises(ValueError):
        store.transact(0, [{'type':'set_board_count','count':count}])
    assert store.get_state() == before
    project = deepcopy(store.project)
    project['breadboard']['board_count'] = count
    with pytest.raises(ValueError):
        validate_project(project)


def test_component_transfer_is_atomic_and_partial_cross_board_body_rejected():
    store = Store()
    store.transact(0, [{'type':'set_board_count','count':2}])
    before = deepcopy(store.project)
    with pytest.raises(ValueError, match='composant entier'):
        store.transact(1, [{'type':'place_pin','terminal':'R1.p','hole':'2:e4'}])
    assert store.project == before
    store.transact(1, [{'type':'place_pin','terminal':'R1.p','hole':'2:e4'}, {'type':'place_pin','terminal':'R1.n','hole':'2:e12'}])
    assert store.project['components'] == before['components']
    assert store.project['breadboard']['placements']['R1.n'] == '2:e12'
    with pytest.raises(ValueError, match='encore des bornes'):
        store.transact(2, [{'type':'set_board_count','count':1}])
    assert store.undo(2)['project']['breadboard']['placements']['R1.p'] == 'e4'


def test_empty_board_addition_preserves_electrical_results_and_is_undoable():
    store = Store()
    fingerprint = circuit_fingerprint(store.project)
    store.simulation = {'status':'success','project_revision':0,'circuit_fingerprint':fingerprint}
    state = store.transact(0, [{'type':'set_board_count','count':4}])
    assert not state['simulation']['stale'] and len(state['topology']['hole_to_net']) == 1680
    assert circuit_fingerprint(store.project) == fingerprint
    assert store.undo(1)['project']['breadboard'].get('board_count',1) == 1


def test_missing_board_or_alias_holes_are_never_silently_accepted():
    store = Store()
    for hole in ['2:a1','1:a1','02:a1','5:a1']:
        with pytest.raises(ValueError):
            store.transact(0,[{'type':'place_pin','terminal':'R1.p','hole':hole}])


@pytest.mark.skipif(not shutil.which('ngspice'),reason='ngspice réel requis')
def test_explicit_interboard_jumpers_power_real_resistor_on_second_board():
    store = Store(two_board_ohm())
    before = topology(store.project)['terminal_to_net']
    assert before['R1.p'] != before['V1.p']
    state = store.transact(0,[{'type':'connect','a':'V1.p','b':'R1.p','id':'Wcross1'}, {'type':'connect','a':'R1.n','b':'V1.n','id':'Wcross2'}])
    measured = simulate(state['project'])
    assert measured['status'] == 'success',measured
    assert measured['currents']['R1'] == pytest.approx(.005,rel=1e-6)
    assert abs(measured['wire_currents']['Wcross1']) == pytest.approx(.005,rel=1e-6)


def test_layout_uses_two_boards_and_preserves_every_electrical_network():
    store = Store(new_project(empty=True))
    store.transact(0,[{'type':'set_board_count','count':2}]+[{'type':'add_component','kind':'resistor','id':f'R{i}'} for i in range(13)])
    before = {frozenset(net['points']) for net in topology(store.project)['nets']}
    state = store.transact(1,[{'type':'layout_breadboard'}])
    assert len(state['project']['breadboard']['placements']) == 26
    assert any(hole.startswith('2:') for hole in state['project']['breadboard']['placements'].values())
    assert {frozenset(net['points']) for net in state['topology']['nets']} == before


@pytest.mark.skipif(not shutil.which('ngspice'),reason='ngspice réel requis')
def test_two_board_divider_example_measures_two_point_five_volts():
    project = example_projects()['two_boards']
    validate_project(project)
    result = simulate(project)
    assert result['status'] == 'success', result
    mapping = topology(project)['terminal_to_net']
    assert result['voltages'][mapping['P1.p']] - result['voltages'][mapping['P1.n']] == pytest.approx(2.5,abs=1e-6)
    assert result['currents']['R1'] == pytest.approx(.0025,rel=1e-6)
