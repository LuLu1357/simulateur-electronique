"""DEL et potentiomètre : modèle partagé, puis preuves électriques ngspice."""
from copy import deepcopy
import shutil

import pytest

from backend.domain import Store, catalog, circuit_fingerprint, new_project, topology, validate_project
from backend.examples import example_projects
from backend.simulation import build_netlist, simulate


requires_spice = pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice requis, aucun calcul de remplacement")


def measured(project):
    result = simulate(project)
    assert result["status"] == "success", result
    return result


def terminal_voltage(result, project, terminal):
    return result["voltages"][topology(project)["terminal_to_net"][terminal]]


def test_catalog_exposes_explicit_led_and_potentiometer_contract():
    entries = catalog()
    assert [pin["name"] for pin in entries["led"]["pins"]] == ["a", "k"]
    assert {model["id"] for model in entries["led"]["models"]} == {
        "generic_led_red", "generic_led_green", "generic_led_blue",
    }
    assert [pin["name"] for pin in entries["potentiometer"]["pins"]] == ["p", "w", "n"]
    assert entries["potentiometer"]["default_position"] == 0.5
    assert entries["potentiometer"]["unit"] == "Ω"


def test_new_parts_create_with_defaults_and_valid_models():
    store = Store(new_project(empty=True))
    state = store.transact(0, [{"type": "add_component", "kind": "led"}, {"type": "add_component", "kind": "potentiometer", "position": 0.25}])
    led, pot = state["project"]["components"]
    assert led["id"] == "LED1" and led["model"] == "generic_led_red"
    assert pot["id"] == "RV1" and pot["value"] == 10000 and pot["position"] == 0.25
    for model in ("generic_led_green", "generic_led_blue"):
        state = store.transact(state["project"]["revision"], [{"type": "set_model", "id": "LED1", "model": model}])
        assert state["project"]["components"][0]["model"] == model


@pytest.mark.parametrize("position", [-0.01, 1.01, True, None, "0.5", float("inf"), 10 ** 1000])
def test_invalid_cursor_position_rejects_import_and_transaction_atomically(position):
    project = example_projects()["potentiometer"]
    store = Store(project)
    before = store.get_state()
    with pytest.raises(ValueError):
        store.transact(0, [{"type": "set_title", "title": "Ne doit pas survivre"}, {"type": "set_position", "id": "RV1", "position": position}])
    assert store.get_state() == before
    next(component for component in project["components"] if component["id"] == "RV1")["position"] = position
    with pytest.raises(ValueError):
        validate_project(project)


def test_cursor_operation_is_previewable_undoable_and_electrical():
    store = Store(example_projects()["potentiometer"])
    before = circuit_fingerprint(store.project)
    store.simulation = {"status": "success", "circuit_fingerprint": before, "project_revision": 0}
    preview = store.transact(0, [{"type": "set_position", "id": "RV1", "position": 0.8}], preview=True)
    assert preview["simulation"]["stale"]
    assert circuit_fingerprint(store.project) == before
    changed = store.transact(0, [{"type": "set_position", "id": "RV1", "position": 0.8}])
    assert changed["simulation"]["stale"]
    assert circuit_fingerprint(store.project) != before
    assert store.undo(1)["simulation"]["stale"] is False
    assert store.redo(2)["simulation"]["stale"] is True
    with pytest.raises(ValueError):
        store.transact(3, [{"type": "set_position", "id": "V1", "position": 0.5}])


def test_absent_default_cursor_matches_explicit_half_position():
    project = example_projects()["potentiometer"]
    before = circuit_fingerprint(project)
    next(component for component in project["components"] if component["id"] == "RV1").pop("position")
    validate_project(project)
    assert circuit_fingerprint(project) == before


def test_duplication_can_preserve_capacitor_initial_voltage():
    store = Store(new_project(empty=True))
    state = store.transact(0, [{"type": "add_component", "kind": "capacitor", "initial_voltage": 2.5}])
    assert state["project"]["components"][0]["initial_voltage"] == 2.5
    with pytest.raises(ValueError):
        store.transact(1, [{"type": "add_component", "kind": "resistor", "initial_voltage": 2.5}])


def test_move_junction_is_atomic_visual_and_undoable():
    store = Store()
    store.transact(0, [{"type": "add_junction", "id": "J1", "x": 100, "y": 200}, {"type": "connect", "a": "J1", "b": "R1.p"}])
    signature = circuit_fingerprint(store.project)
    store.transact(1, [{"type": "move_junction", "id": "J1", "x": 230, "y": 340}])
    assert store.project["junctions"][0] == {"id": "J1", "x": 230, "y": 340}
    assert circuit_fingerprint(store.project) == signature
    before = deepcopy(store.project)
    with pytest.raises(ValueError):
        store.transact(2, [{"type": "move_junction", "id": "J1", "x": float("inf"), "y": 400}])
    assert store.project == before
    with pytest.raises(ValueError):
        store.transact(2, [{"type": "move_junction", "id": "absent", "x": 1, "y": 2}])
    assert store.undo(2)["project"]["junctions"][0]["x"] == 100


@pytest.mark.parametrize("name", ["led", "potentiometer"])
def test_extended_examples_layout_preserves_all_nets_and_places_every_pin(name):
    store = Store(example_projects()[name])
    before = {frozenset(net["points"]) for net in topology(store.project)["nets"]}
    state = store.transact(0, [{"type": "layout_breadboard"}])
    assert {frozenset(net["points"]) for net in state["topology"]["nets"]} == before
    assert len(state["project"]["breadboard"]["placements"]) == sum(len(component["pins"]) for component in store.project["components"])
    validate_project(state["project"])


def test_unapproved_led_model_is_rejected_in_netlist():
    project = example_projects()["led"]
    next(component for component in project["components"] if component["kind"] == "led")["model"] = ".include evil"
    with pytest.raises(ValueError):
        build_netlist(project)


@requires_spice
def test_led_colors_have_distinct_real_forward_drops_and_balanced_currents():
    project = example_projects()["led"]
    led = next(component for component in project["components"] if component["kind"] == "led")
    drops = []
    for model in ("generic_led_red", "generic_led_green", "generic_led_blue"):
        led["model"] = model
        result = measured(project)
        current = result["currents"]["LED1"]
        assert 0.002 < current < 0.012
        assert result["currents"]["R1"] == pytest.approx(current, abs=1e-9)
        drops.append(terminal_voltage(result, project, "LED1.a"))
        assert not any(diagnostic.get("code") == "led_overcurrent" for diagnostic in result["diagnostics"])
        assert not result["flow_diagnostics"]
    assert 1.7 < drops[0] < drops[1] < drops[2] < 3.3


@requires_spice
def test_led_overcurrent_is_reported_only_for_actual_excess_forward_current():
    project = example_projects()["led"]
    resistor = next(component for component in project["components"] if component["id"] == "R1")
    resistor["value"] = 47
    result = measured(project)
    assert result["currents"]["LED1"] > 0.020
    warnings = [diagnostic for diagnostic in result["diagnostics"] if diagnostic.get("code") == "led_overcurrent"]
    assert len(warnings) == 1 and warnings[0]["targets"] == ["LED1"]
    project["components"][0]["value"] = -5
    reverse = measured(project)
    assert abs(reverse["currents"]["LED1"]) < 1e-7
    assert not any(diagnostic.get("code") == "led_overcurrent" for diagnostic in reverse["diagnostics"])


@requires_spice
def test_led_overcurrent_retains_a_real_transient_peak_after_current_decays():
    store = Store(new_project(empty=True))
    store.transact(0, [
        {"type": "add_component", "kind": "voltage_source", "id": "V1", "value": 5},
        {"type": "add_component", "kind": "resistor", "id": "R1", "value": 47},
        {"type": "add_component", "kind": "led", "id": "LED1"},
        {"type": "add_component", "kind": "capacitor", "id": "C1", "value": 1e-6},
        {"type": "add_component", "kind": "ground", "id": "G1"},
        {"type": "connect", "a": "V1.p", "b": "R1.p"},
        {"type": "connect", "a": "R1.n", "b": "LED1.a"},
        {"type": "connect", "a": "LED1.k", "b": "C1.p"},
        {"type": "connect", "a": "C1.n", "b": "G1.g"},
        {"type": "connect", "a": "V1.n", "b": "G1.g"},
    ])
    result = simulate(store.project, {"kind": "tran", "step": 1e-6, "stop": 0.001})
    assert result["status"] == "success", result
    curve = next(curve for curve in result["curves"] if curve["id"] == "I:LED1")
    assert max(curve["values"]) > 0.020
    assert result["currents"]["LED1"] < 0.020
    warning = next(diagnostic for diagnostic in result["diagnostics"] if diagnostic.get("code") == "led_overcurrent")
    assert warning["measured_peak_current"] == max(curve["values"])
    assert warning["limit_current"] == 0.020


@requires_spice
@pytest.mark.parametrize("position,expected", [(0, 5), (0.25, 3.75), (0.5, 2.5), (0.75, 1.25), (1, 0)])
def test_potentiometer_unloaded_sweep_and_endpoint_floor(position, expected):
    project = example_projects()["potentiometer"]
    next(component for component in project["components"] if component["id"] == "RV1")["position"] = position
    result = measured(project)
    assert terminal_voltage(result, project, "RV1.w") == pytest.approx(expected, abs=1e-6)
    assert result["probe_voltages"]["P1"] == pytest.approx(expected, abs=1e-6)
    terminals = result["terminal_currents"]["RV1"]
    assert terminals["w"] == pytest.approx(0, abs=1e-9)
    assert sum(terminals.values()) == pytest.approx(0, abs=1e-12)
    assert not result["flow_diagnostics"]


@requires_spice
def test_loaded_potentiometer_wiper_current_is_not_assumed_zero():
    store = Store(example_projects()["potentiometer"])
    store.transact(0, [{"type": "add_component", "kind": "resistor", "id": "RL", "value": 1000}, {"type": "connect", "a": "RL.p", "b": "RV1.w"}, {"type": "connect", "a": "RL.n", "b": "RV1.n"}])
    result = measured(store.project)
    expected_voltage = 5 * (5000 * 1000 / 6000) / (5000 + 5000 * 1000 / 6000)
    assert terminal_voltage(result, store.project, "RV1.w") == pytest.approx(expected_voltage, rel=1e-8)
    terminals = result["terminal_currents"]["RV1"]
    assert terminals["w"] == pytest.approx(-result["currents"]["RL"], abs=1e-12)
    assert terminals["p"] == pytest.approx(result["currents"]["RV1"], abs=1e-12)
    assert sum(terminals.values()) == pytest.approx(0, abs=1e-12)
    assert result["terminal_currents_flat"]["RV1.w"] == terminals["w"]
    assert not result["flow_diagnostics"]
