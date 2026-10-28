"""Inductance idéale : contrat et vérifications indépendantes avec ngspice."""
from copy import deepcopy
import math
from pathlib import Path
import json
import shutil

import pytest

from backend.domain import Store, catalog, circuit_fingerprint, new_project, topology, validate_project
from backend.examples import Builder, rlc
from backend.simulation import build_netlist, simulate


requires_spice = pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice requis, aucun solveur de remplacement")


def series_rl(resistance=100, inductance=0.01):
    builder = Builder("test_rl", "Essai RL", "Inductance idéale avec résistance série explicite.")
    builder.add("voltage_source", "V1", {"p": "input", "n": "gnd"}, 5)
    builder.add("resistor", "R1", {"p": "input", "n": "rl"}, resistance)
    builder.add("inductor", "L1", {"p": "rl", "n": "gnd"}, inductance)
    builder.add("ground", "G1", {"g": "gnd"})
    return builder.finish()


def successful(project, analysis=None):
    result = simulate(project, analysis)
    assert result["status"] == "success", result
    return result


def curve(result, identifier):
    return next(curve["values"] for curve in result["curves"] if curve["id"] == identifier)


def test_catalog_and_creation_declare_ideal_inductor_si_and_explicit_pins():
    entry = catalog()["inductor"]
    assert entry["unit"] == "H" and entry["default_value"] == 0.01
    assert [pin["name"] for pin in entry["pins"]] == ["p", "n"]
    assert any("saturation" in note for note in entry["assumptions"])
    store = Store(new_project(empty=True))
    created = store.transact(0, [{"type": "add_component", "kind": "inductor"}])["project"]["components"][0]
    assert created["id"] == "L1" and created["value"] == 0.01
    assert created["pins"] == {"p": "L1.p", "n": "L1.n"}
    assert created["model"] is None


@pytest.mark.parametrize("value", [0, -1, 1e-13, 1e7, True, None, "10mH", float("inf"), float("nan"), 10**1000])
def test_invalid_inductance_rejects_import_and_whole_edit_atomically(value):
    project = series_rl()
    store = Store(project)
    before = store.get_state()
    with pytest.raises(ValueError):
        store.transact(0, [{"type": "set_title", "title": "Ne doit pas survivre"}, {"type": "set_value", "id": "L1", "value": value}])
    assert store.get_state() == before
    next(component for component in project["components"] if component["id"] == "L1")["value"] = value
    with pytest.raises(ValueError):
        validate_project(project)


@pytest.mark.parametrize("value", [1e-12, 0.01, 1e6])
def test_accepted_inductance_bounds_are_compiled_consistently(value):
    project = series_rl(inductance=value)
    validate_project(project)
    netlist, info = build_netlist(project)
    assert any(line.startswith("l2 ") for line in netlist.splitlines())
    assert info["current_vectors"]["L1"] == "l2#branch"


def test_inductance_edits_are_electrical_previewable_and_undoable():
    store = Store(series_rl())
    before = circuit_fingerprint(store.project)
    preview = store.transact(0, [{"type": "set_value", "id": "L1", "value": 0.02}], preview=True)
    assert circuit_fingerprint(preview["project"]) != before
    assert circuit_fingerprint(store.project) == before
    state = store.transact(0, [{"type": "set_value", "id": "L1", "value": 0.02}])
    assert circuit_fingerprint(state["project"]) != before
    assert circuit_fingerprint(store.undo(1)["project"]) == before
    assert next(comp for comp in store.redo(2)["project"]["components"] if comp["id"] == "L1")["value"] == 0.02


def test_rlc_example_json_and_breadboard_preserve_the_canonical_circuit():
    project = rlc()
    validate_project(project)
    saved = json.loads((Path(__file__).parents[1] / "examples" / "rlc.json").read_text())
    assert saved == project
    original = deepcopy(project)
    before = {frozenset(net["points"]) for net in topology(project)["nets"]}
    state = Store(project).transact(0, [{"type": "layout_breadboard"}])
    assert {frozenset(net["points"]) for net in state["topology"]["nets"]} == before
    assert state["project"]["breadboard"]["footprints"]["L1"]["kind"] == "axial"
    assert len(state["project"]["breadboard"]["placements"]) == sum(len(comp["pins"]) for comp in project["components"])
    assert project == original


@requires_spice
def test_dc_inductor_short_circuit_has_real_fifty_milliamps_with_balanced_signs():
    project = series_rl()
    result = successful(project)
    mapping = topology(project)["terminal_to_net"]
    assert result["currents"]["L1"] == pytest.approx(0.05, abs=1e-12)
    assert result["currents"]["R1"] == pytest.approx(0.05, abs=1e-12)
    assert result["currents"]["V1"] == pytest.approx(-0.05, abs=1e-12)
    assert result["voltages"][mapping["L1.p"]] - result["voltages"][mapping["L1.n"]] == pytest.approx(0, abs=1e-12)
    assert result["terminal_currents_flat"]["L1.p"] == pytest.approx(0.05)
    assert result["terminal_currents_flat"]["L1.n"] == pytest.approx(-0.05)


@requires_spice
def test_rl_current_rise_matches_independent_l_over_r_exponential():
    project = series_rl()
    result = successful(project, {"kind": "tran", "step": 1e-6, "stop": 0.001, "startup": True})
    values = curve(result, "I:L1")
    for target in (0.000025, 0.0001, 0.0003, 0.0008):
        index = min(range(len(result["time"])), key=lambda index: abs(result["time"][index] - target))
        time = result["time"][index]
        expected = 0.05 * (1 - math.exp(-time / 0.0001))
        assert values[index] == pytest.approx(expected, abs=2e-5)
    assert values[0] < 1e-5
    assert values[-1] == pytest.approx(0.05, abs=5e-6)
    assert any("courant initial est 0 A" in note for note in result["assumptions"])


@requires_spice
def test_transient_without_uic_starts_from_the_real_dc_inductor_current():
    result = successful(series_rl(), {"kind": "tran", "step": 1e-6, "stop": 0.001, "startup": False})
    assert all(value == pytest.approx(0.05, abs=1e-12) for value in curve(result, "I:L1"))
    assert not any("Transitoire avec UIC" in note for note in result["assumptions"])


@requires_spice
def test_rlc_overshoot_frequency_decay_and_current_match_independent_second_order_response():
    project = rlc()
    result = successful(project, project["default_analysis"])
    times = result["time"]
    mapping = topology(project)["terminal_to_net"]
    volts = curve(result, mapping["C1.p"])
    current = curve(result, "I:L1")
    alpha, omega_d = 1500, math.sqrt(1 / (0.01 * 1e-6) - 1500**2)
    # Front de 1 µs : son centre est une approximation de l'échelon, indépendante du solveur.
    edge_centre = 0.0001005
    for target in (0.00015, 0.0002, 0.0003, 0.0005, 0.0008, 0.0015, 0.003):
        index = min(range(len(times)), key=lambda i: abs(times[i] - target))
        t = times[index] - edge_centre
        expected_voltage = 5 * (1 - math.exp(-alpha * t) * (math.cos(omega_d * t) + alpha / omega_d * math.sin(omega_d * t)))
        expected_current = 5 / (0.01 * omega_d) * math.exp(-alpha * t) * math.sin(omega_d * t)
        assert volts[index] == pytest.approx(expected_voltage, abs=0.015)
        assert current[index] == pytest.approx(expected_current, abs=0.0001)
    first_peak = max((i for i, t in enumerate(times) if 0.0002 < t < 0.0007), key=lambda i: volts[i])
    second_peak = max((i for i, t in enumerate(times) if 0.0008 < t < 0.0013), key=lambda i: volts[i])
    assert times[first_peak] == pytest.approx(edge_centre + math.pi / omega_d, abs=1e-5)
    assert volts[first_peak] == pytest.approx(5 * (1 + math.exp(-alpha * math.pi / omega_d)), abs=0.03)
    assert times[second_peak] - times[first_peak] == pytest.approx(2 * math.pi / omega_d, abs=1e-5)
    assert (volts[second_peak] - 5) / (volts[first_peak] - 5) == pytest.approx(math.exp(-alpha * 2 * math.pi / omega_d), rel=0.02)
    assert min(current[i] for i, t in enumerate(times) if 0.0005 < t < 0.0007) < -0.015
    resistor, capacitor = curve(result, "I:R1"), curve(result, "I:C1")
    assert max(abs(a - b) for a, b in zip(current, resistor)) < 1e-10
    assert max(abs(a - b) for a, b in zip(current, capacitor)) < 1e-10


@requires_spice
def test_increasing_series_resistance_to_critical_damping_removes_overshoot():
    project = rlc()
    next(comp for comp in project["components"] if comp["id"] == "R1")["value"] = 200
    result = successful(project, project["default_analysis"])
    volts = curve(result, topology(project)["terminal_to_net"]["C1.p"])
    plateau = [value for t, value in zip(result["time"], volts) if 0.000101 < t < 0.004]
    assert max(plateau) <= 5.0001
    assert plateau[-1] == pytest.approx(5, abs=1e-6)
    assert all(a <= b + 1e-8 for a, b in zip(plateau, plateau[1:]))
