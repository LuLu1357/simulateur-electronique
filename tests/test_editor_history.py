from copy import deepcopy

import pytest

from backend.domain import Store


def value(store):
    return next(c['value'] for c in store.project['components'] if c['id'] == 'R1')


def test_selecting_and_changing_view_do_not_create_undo_entries():
    store = Store()
    for operation in [{'type':'set_ui','selected':['R1']}, {'type':'set_ui','view':'breadboard'}, {'type':'set_ui','highlights':['V1.p']}]:
        state = store.transact(store.project['revision'], [operation])
        assert not state['history']['can_undo'] and not state['history']['can_redo']
    assert store.project['revision'] == 3


def test_undo_targets_last_edit_and_preserves_recent_valid_selection_and_view():
    store = Store()
    store.transact(0, [{'type':'set_value','id':'R1','value':2000}])
    store.transact(1, [{'type':'set_ui','selected':['V1'],'view':'breadboard','highlights':['V1.p']}])
    state = store.undo(2)
    assert value(store) == 1000
    assert state['project']['ui']['selected'] == ['V1']
    assert state['project']['ui']['view'] == 'breadboard'
    assert state['project']['ui']['highlights'] == ['V1.p']


def test_selection_after_undo_does_not_discard_redo():
    store = Store()
    store.transact(0, [{'type':'set_value','id':'R1','value':2000}])
    store.undo(1)
    state = store.transact(2, [{'type':'set_ui','selected':['R1'],'view':'schematic'}])
    assert state['history']['can_redo']
    state = store.redo(3)
    assert value(store) == 2000
    assert state['project']['ui']['selected'] == ['R1'] and state['project']['ui']['view'] == 'schematic'


def test_mixed_transaction_remains_one_complete_undoable_edit():
    store = Store()
    before = deepcopy(store.project)
    store.transact(0, [{'type':'set_value','id':'R1','value':2000}, {'type':'set_ui','selected':['R1']}])
    result = store.undo(1)['project']
    assert {**result,'revision':0} == before
    assert value(store) == 1000
    store.redo(2)
    assert store.project['ui']['selected'] == ['R1'] and value(store) == 2000


def test_undo_creation_clears_selection_of_removed_objects():
    store = Store()
    store.transact(0, [{'type':'add_component','kind':'resistor','id':'R2'}])
    store.transact(1, [{'type':'set_ui','selected':['R2'],'highlights':['R2.p']}])
    state = store.undo(2)
    assert state['project']['ui']['selected'] == [] and state['project']['ui']['highlights'] == []
    assert not any(c['id'] == 'R2' for c in state['project']['components'])


def test_presentation_preview_and_failed_change_do_not_affect_history():
    store = Store()
    store.transact(0, [{'type':'set_value','id':'R1','value':2000}])
    store.transact(1, [{'type':'set_ui','selected':['V1']}], preview=True)
    before = store.get_state()
    with pytest.raises(ValueError):
        store.transact(1, [{'type':'set_ui','view':'breadboard'}, {'type':'remove_component','id':'missing'}])
    assert store.get_state() == before
    assert store.undo(1)['project']['ui']['view'] == 'split'
