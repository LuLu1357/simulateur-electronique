"""Flux des conducteurs : conservation et distinction mesure / illustration."""
from __future__ import annotations

import copy

import pytest

from backend.domain import new_project
from backend.examples import Builder, transistor
from backend.flow import calculate_wire_flows, component_terminal_currents


def ohm_without_board():
    project = new_project()
    project["breadboard"]["placements"] = {}
    return project


def ohm_result():
    return {"status": "success", "currents": {"V1": -0.005, "R1": 0.005}, "terminal_currents": {}}


def test_series_bridges_have_unique_oriented_currents():
    project = ohm_without_board()
    before = copy.deepcopy(project)
    result = ohm_result()
    derived = calculate_wire_flows(project, result)
    assert derived["wire_currents"] == pytest.approx({"W1": 0.005, "W2": 0.005, "W3": -0.005})
    assert set(derived["wire_current_status"].values()) == {"unique"}
    assert derived["wire_flow_hints"] == pytest.approx(derived["wire_currents"])
    assert project == before
    assert "wire_currents" not in result


def test_parallel_wire_cycle_is_underdetermined_but_upstream_bridge_unique():
    project = ohm_without_board()
    project["junctions"] = [{"id": "J1", "x": 100, "y": 100}, {"id": "J2", "x": 150, "y": 150}]
    project["wires"] = [w for w in project["wires"] if w["id"] != "W1"]
    project["wires"].extend([
        {"id": "Wsource", "a": "V1.p", "b": "J1"},
        {"id": "Wstraight", "a": "J1", "b": "R1.p"},
        {"id": "Walternate1", "a": "J1", "b": "J2"},
        {"id": "Walternate2", "a": "J2", "b": "R1.p"},
    ])
    flow = calculate_wire_flows(project, ohm_result())
    assert flow["wire_currents"]["Wsource"] == pytest.approx(0.005)
    for wire in ("Wstraight", "Walternate1", "Walternate2"):
        assert flow["wire_currents"][wire] is None
        assert flow["wire_current_status"][wire] == "underdetermined"
    assert flow["wire_flow_hints"]["Wstraight"] == pytest.approx(0.005)
    assert flow["wire_flow_hints"]["Walternate1"] == pytest.approx(0)
    assert flow["wire_flow_hints"]["Walternate2"] == pytest.approx(0)
    assert flow["wire_flow_hint_kind"] == "pedagogical_path"
    # L'arbre choisi conserve la charge à CHAQUE borne / jonction.
    for point in set(flow["terminal_currents_flat"]) | {"J1", "J2"}:
        outgoing = sum((1 if w["a"] == point else -1) * flow["wire_flow_hints"][w["id"]]
                       for w in project["wires"] if point in (w["a"], w["b"]))
        assert outgoing + flow["terminal_currents_flat"].get(point, 0) == pytest.approx(0, abs=1e-12)


def test_breadboard_metal_parallel_to_wire_makes_current_ambiguous():
    project = new_project()  # V1.p a4 et R1.p e4 partagent une bande.
    flow = calculate_wire_flows(project, ohm_result())
    assert flow["wire_currents"]["W1"] is None
    assert flow["wire_current_status"]["W1"] == "underdetermined"
    assert flow["wire_flow_hints"]["W1"] == pytest.approx(0.005)


def test_split_rail_does_not_create_false_alternative_path():
    project = ohm_without_board()
    project["breadboard"]["placements"] = {"V1.p": "rail_top_p1", "R1.p": "rail_top_p30"}
    split = calculate_wire_flows(project, ohm_result())
    assert split["wire_current_status"]["W1"] == "unique"
    assert split["wire_currents"]["W1"] == pytest.approx(0.005)
    project["breadboard"]["rail_splits"] = False
    continuous = calculate_wire_flows(project, ohm_result())
    assert continuous["wire_current_status"]["W1"] == "underdetermined"
    assert continuous["wire_currents"]["W1"] is None


def test_zero_current_bridge_is_zero_but_zero_cycle_still_ambiguous():
    project = ohm_without_board()
    result = ohm_result()
    result["currents"] = {"V1": 0, "R1": 0}
    flow = calculate_wire_flows(project, result)
    assert all(value == 0 for value in flow["wire_currents"].values())
    project["wires"].append({"id": "Wparallel", "a": "V1.p", "b": "R1.p"})
    flow = calculate_wire_flows(project, result)
    assert flow["wire_currents"]["W1"] is None
    assert flow["wire_current_status"]["W1"] == "underdetermined"
    assert flow["wire_flow_hints"]["W1"] == 0


def test_resistive_parallel_branches_are_each_determined():
    builder = Builder("parallel", "Deux branches", "Test")
    builder.add("voltage_source", "V1", {"p": "vcc", "n": "gnd"}, 5)
    builder.add("resistor", "R1", {"p": "vcc", "n": "gnd"}, 1000)
    builder.add("resistor", "R2", {"p": "vcc", "n": "gnd"}, 1000)
    builder.add("ground", "G1", {"g": "gnd"})
    project = builder.finish()
    project["breadboard"]["placements"] = {}
    result = {"status": "success", "currents": {"V1": -0.010, "R1": 0.005, "R2": 0.005}}
    flow = calculate_wire_flows(project, result)
    assert set(flow["wire_current_status"].values()) == {"unique"}
    assert flow["wire_currents"]["W1"] == pytest.approx(0.005)
    assert flow["wire_currents"]["W2"] == pytest.approx(0.005)
    assert not flow["flow_diagnostics"]


@pytest.mark.parametrize("pnp", [False, True])
def test_bjt_all_three_terminal_currents_participate_in_flow(pnp):
    project = transistor(pnp)
    project["breadboard"]["placements"] = {}
    sign = -1 if pnp else 1
    # Le collecteur et la base PNP ont un courant entrant négatif.
    ic, ib, ie = sign * 0.004, sign * 0.00004, -sign * 0.00404
    currents = {"Q1": ic, "RB": ib, "RC": 0.004, "Vin": -ib,
                "V1": -0.00404 if pnp else -0.004}
    result = {"status": "success", "currents": currents, "terminal_currents": {"Q1": {"c": ic, "b": ib, "e": ie}}}
    flow = calculate_wire_flows(project, result)
    assert not flow["flow_diagnostics"]
    assert flow["terminal_currents_flat"]["Q1.c"] == ic
    assert flow["terminal_currents_flat"]["Q1.b"] == ib
    assert flow["terminal_currents_flat"]["Q1.e"] == ie
    base_wire = next(w for w in project["wires"] if {w["a"], w["b"]} == {"RB.n", "Q1.b"})
    assert abs(flow["wire_currents"][base_wire["id"]]) == pytest.approx(abs(ib))
    assert set(flow["wire_current_status"].values()) == {"unique"}


def test_virtual_ground_connection_is_part_of_conductor_graph():
    project = ohm_without_board()
    project["components"].append({"id": "G2", "kind": "ground", "pins": {"g": "G2.g"}, "value": 0, "model": None})
    project["wires"] = [w for w in project["wires"] if w["id"] != "W3"]
    project["wires"].append({"id": "W3", "a": "V1.n", "b": "G2.g"})
    flow = calculate_wire_flows(project, ohm_result())
    assert not flow["flow_diagnostics"]
    assert flow["wire_currents"]["W2"] == pytest.approx(0.005)
    assert flow["wire_currents"]["W3"] == pytest.approx(-0.005)


def test_failed_simulation_or_missing_current_does_not_fabricate_flow():
    project = ohm_without_board()
    failure = calculate_wire_flows(project, {"status": "error"})
    assert set(failure["wire_current_status"].values()) == {"unavailable"}
    assert all(value is None for value in failure["wire_currents"].values())
    missing = calculate_wire_flows(project, {"status": "success", "currents": {"V1": -0.005}})
    assert set(missing["wire_current_status"].values()) == {"unavailable"}
    assert missing["flow_diagnostics"]


def test_bad_kirchhoff_balance_hides_wire_results():
    result = ohm_result()
    result["currents"]["R1"] = 0.010  # Incompatible avec la source à 5 mA.
    flow = calculate_wire_flows(ohm_without_board(), result)
    assert all(value is None for value in flow["wire_currents"].values())
    assert flow["flow_diagnostics"]
    assert all(value is None for value in flow["wire_flow_hints"].values())


def test_tiny_solver_residual_is_tolerated_without_changing_measured_currents():
    result = ohm_result()
    result["currents"]["R1"] += 1e-12
    flow = calculate_wire_flows(ohm_without_board(), result)
    assert not flow["flow_diagnostics"]
    assert flow["terminal_currents_flat"]["R1.p"] == result["currents"]["R1"]
    assert flow["wire_currents"]["W1"] == pytest.approx(0.005, abs=2e-12)


def test_pin_current_sign_convention_for_diode_and_ideal_voltmeter():
    project = {"components": [{"id": "D", "kind": "diode", "pins": {"a": "D.a", "k": "D.k"}},
                              {"id": "P", "kind": "voltage_probe", "pins": {"p": "P.p", "n": "P.n"}}]}
    currents = component_terminal_currents(project, {"currents": {"D": 0.003}})
    assert currents == {"D.a": 0.003, "D.k": -0.003, "P.p": 0, "P.n": 0}
