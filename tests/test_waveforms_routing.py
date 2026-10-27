"""Stimulus typé SPICE et tracés purement visuels, partagés UI/MCP."""
from copy import deepcopy
import shutil

import pytest

from backend.domain import Store, circuit_fingerprint, topology, validate_project, validate_source_waveform
from backend.examples import example_projects
from backend.simulation import build_netlist, simulate


def pulse():
    return {"kind": "pulse", "low": 0, "high": 5, "delay": 0, "rise": 1e-5, "fall": 1e-5, "width": .003, "period": .006}


@pytest.mark.parametrize("patch", [{"kind": "PULSE(unsafe)"}, {"high": float("inf")}, {"low": True}, {"period": 0}, {"rise": -1}, {"delay": -1}, {"width": .007}, {"high": 1e6 + 1}, {"extra": ".control"}])
def test_invalid_stimulus_rejected_atomically(patch):
    store = Store()
    original = deepcopy(store.project)
    with pytest.raises(ValueError):
        store.transact(0, [{"type": "set_title", "title": "ne pas conserver"}, {"type": "set_waveform", "id": "V1", "waveform": {**pulse(), **patch}}])
    assert store.project == original


def test_waveform_roundtrip_fingerprint_preview_and_undo():
    store = Store()
    original = circuit_fingerprint(store.project)
    preview = store.transact(0, [{"type": "set_waveform", "id": "V1", "waveform": pulse()}], preview=True)
    assert circuit_fingerprint(preview["project"]) != original
    assert circuit_fingerprint(store.project) == original
    result = store.transact(0, [{"type": "set_waveform", "id": "V1", "waveform": pulse()}])
    validate_project(deepcopy(result["project"]))
    assert circuit_fingerprint(store.undo(1)["project"]) == original
    store.redo(2)
    assert store.project["components"][0]["waveform"] == pulse()
    store.transact(3, [{"type": "set_waveform", "id": "V1", "waveform": None}])
    assert circuit_fingerprint(store.project) == original


def test_pulse_netlist_is_typed_and_dc_uses_initial_level():
    project = example_projects()["pulse_rc"]
    op, _ = build_netlist(project, {"kind": "op"})
    tran, _ = build_netlist(project, project["default_analysis"])
    assert "PULSE(" not in op
    assert "DC 0" in op
    assert "PULSE(0 5 0 1e-05 1e-05 0.003 0.006)" in tran


@pytest.mark.skipif(not shutil.which("ngspice"), reason="vrai moteur ngspice requis")
def test_actual_pulse_rc_charge_and_discharge_three_cycles():
    project = example_projects()["pulse_rc"]
    result = simulate(project, project["default_analysis"])
    assert result["status"] == "success", result
    network = topology(project)["terminal_to_net"]
    source = next(c["values"] for c in result["curves"] if c["id"] == network["V1.p"])
    output = next(c["values"] for c in result["curves"] if c["id"] == network["C1.p"])
    def at(values, moment):
        return values[min(range(len(result["time"])), key=lambda i: abs(result["time"][i] - moment))]
    assert at(source, .0015) == pytest.approx(5, abs=1e-5)
    assert at(source, .0045) == pytest.approx(0, abs=1e-5)
    for cycle in [0, .006, .012]:
        assert at(output, cycle + .0025) > 4.5
        assert at(output, cycle + .0055) < .5
    assert simulate(project, {"kind": "op"})["voltages"][network["V1.p"]] == pytest.approx(0, abs=1e-9)


def test_wire_style_roundtrip_is_visual_and_undoable():
    store = Store()
    original = circuit_fingerprint(store.project)
    store.simulation = {"status": "success", "project_revision": 0, "circuit_fingerprint": original}
    style = {"color": "#eac06c", "waypoints": [{"x": 210, "y": 60}, {"x": 320, "y": 60}]}
    state = store.transact(0, [{"type": "set_wire_style", "id": "W1", **style}])
    assert not state["simulation"]["stale"]
    assert circuit_fingerprint(store.project) == original
    validate_project(deepcopy(store.project))
    assert store.project["wires"][0]["waypoints"] == style["waypoints"]
    assert "waypoints" not in store.undo(1)["project"]["wires"][0]
    assert store.redo(2)["project"]["wires"][0]["color"] == style["color"]


@pytest.mark.parametrize("style", [{"color": "url(evil)"}, {"color": "red"}, {"waypoints": [{"x": float("nan"), "y": 0}]}, {"waypoints": [{"x": 1e9, "y": 0}]}, {"waypoints": [{"x": 1, "y": 2, "other": 3}]}, {"waypoints": [{"x": 0, "y": 0}] * 33}])
def test_invalid_wire_style_preserves_circuit(style):
    store = Store()
    original = deepcopy(store.project)
    with pytest.raises(ValueError):
        store.transact(0, [{"type": "set_wire_style", "id": "W1", **style}])
    assert store.project == original
