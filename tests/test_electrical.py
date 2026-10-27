"""Validation indépendante de React, par vraies analyses ngspice."""
from __future__ import annotations

import copy
import json
import math
from pathlib import Path
import shutil
import threading

import pytest

from backend.domain import topology, validate_project
from backend.examples import example_projects
from backend.simulation import build_netlist, simulate, run_truth_table

pytestmark = pytest.mark.skipif(not shutil.which("ngspice"), reason="ngspice doit être installé ; pas de solveur de substitution")


@pytest.fixture(scope="module")
def projects():
    return example_projects()


def voltage(result, project, terminal):
    return result["voltages"][topology(project)["terminal_to_net"][terminal]]


def successful(project, analysis=None):
    result = simulate(project, analysis)
    assert result["status"] == "success", result
    return result


def test_ohm_five_milliamps_and_sign(projects):
    p = projects["ohm"]
    r = successful(p)
    assert r["currents"]["R1"] == pytest.approx(0.005, rel=1e-8)
    assert r["currents"]["V1"] == pytest.approx(-0.005, rel=1e-8)
    assert voltage(r, p, "R1.p") == pytest.approx(5)
    assert voltage(r, p, "R1.n") == pytest.approx(0)


def test_divider_and_differential_probe(projects):
    p = projects["divider"]
    r = successful(p)
    assert voltage(r, p, "R2.p") == pytest.approx(2.5, rel=1e-8)
    assert r["probe_voltages"]["P1"] == pytest.approx(2.5)
    assert r["currents"]["R1"] == pytest.approx(r["currents"]["R2"], abs=1e-12)


def test_diode_forward_and_reverse(projects):
    p = copy.deepcopy(projects["diode"])
    forward = successful(p)
    assert 0.003 < forward["currents"]["D1"] < 0.005
    assert 0.5 < voltage(forward, p, "D1.a") < 0.9
    p["components"][0]["value"] = -5
    reverse = successful(p)
    assert abs(reverse["currents"]["D1"]) < 1e-8
    assert reverse["currents"]["D1"] < 0


@pytest.mark.parametrize("kind", ["npn", "pnp"])
def test_transistor_command_and_explicit_terminal_currents(projects, kind):
    p = copy.deepcopy(projects[kind])
    on = successful(p)
    assert 0.004 < abs(on["currents"]["Q1"]) < 0.0051
    assert set(on["terminal_currents"]["Q1"]) == {"c", "b", "e"}
    for comp in p["components"]:
        if comp["id"] == "Vin":
            comp["value"] = 5 if kind == "pnp" else 0
    off = successful(p)
    assert abs(off["currents"]["Q1"]) < 1e-7
    # Le courant collecteur d'un PNP est négatif avec notre convention entrante.
    assert (on["currents"]["Q1"] < 0) is (kind == "pnp")


def test_rc_charge_matches_independent_exponential(projects):
    p = projects["rc"]
    r = successful(p, p["default_analysis"])
    nid = topology(p)["terminal_to_net"]["C1.p"]
    curve = next(curve for curve in r["curves"] if curve["id"] == nid)
    index = min(range(len(r["time"])), key=lambda i: abs(r["time"][i] - 0.001))
    expected = 5 * (1 - math.exp(-r["time"][index] / 0.001))
    assert curve["values"][index] == pytest.approx(expected, abs=0.015)
    assert curve["values"][0] < 0.01
    assert curve["values"][-1] > 4.98
    assert len(r["time"]) == len(curve["values"])
    assert any("UIC" in note for note in r["assumptions"])


def test_voltage_probe_between_non_ground_points(projects):
    p = copy.deepcopy(projects["divider"])
    probe = next(c for c in p["components"] if c["id"] == "P1")
    # Déconnecter entièrement la borne négative de son ancien réseau puis
    # la raccorder au haut de R1 : le voltmètre doit afficher -2,5 V.
    terminal = probe["pins"]["n"]
    p["wires"] = [w for w in p["wires"] if terminal not in (w["a"], w["b"])]
    p["breadboard"]["placements"].pop(terminal)
    p["wires"].append({"id": "Wextra", "a": terminal, "b": "R1.p"})
    r = successful(p)
    assert r["probe_voltages"]["P1"] == pytest.approx(-2.5)


def test_all_examples_valid_and_views_share_topology(projects):
    for p in projects.values():
        validate_project(p)
        schematic_only = copy.deepcopy(p)
        schematic_only["breadboard"]["placements"] = {}
        a = topology(p)["terminal_to_net"]
        b = topology(schematic_only)["terminal_to_net"]
        # Les placements ne doivent ajouter aucune connexion contradictoire.
        assert a == b


def test_two_bit_subtractor_all_16_analog_cases_and_report(projects):
    p = projects["subtractor"]
    original = copy.deepcopy(p)
    result = run_truth_table(p, **p["truth_table"])
    assert p == original, "Les tests de combinaisons ne modifient jamais le projet courant."
    assert result["status"] == "success"
    assert result["passed"] == 16
    assert len(result["cases"]) == 16
    for row in result["cases"]:
        a = row["inputs"]["A0"] + 2 * row["inputs"]["A1"]
        b = row["inputs"]["B0"] + 2 * row["inputs"]["B1"]
        assert row["convergence"] == "success"
        assert row["observed_modulo_4"] == (a - b) % 4
        assert row["observed"]["Borrow"] == int(a < b)
        assert set(row["voltages"]) == {"D0", "D1", "Borrow"}
        assert all(math.isfinite(v) for v in row["voltages"].values())
    report = {"engine": "ngspice", "test": "20 NAND à deux NPN chacune, 106 composants", "result": result}
    (Path(__file__).parents[1] / "docs" / "results-electric.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))


def test_truth_table_detects_wrong_expected_data(projects):
    p = projects["subtractor"]
    spec = copy.deepcopy(p["truth_table"])
    spec["cases"] = spec["cases"][:1]
    spec["cases"][0]["expected"]["D0"] = 1
    result = run_truth_table(p, **spec)
    assert result["status"] == "failed"
    assert result["cases"][0]["observed"]["D0"] == 0
    assert not result["cases"][0]["passed"]


def test_cancellation_before_launch(projects):
    event = threading.Event()
    event.set()
    result = simulate(projects["ohm"], cancel_event=event)
    assert result["status"] == "cancelled"
    assert result["voltages"] == {}


def test_temporal_limits_and_rejected_model(projects):
    with pytest.raises(ValueError, match="limitée"):
        build_netlist(projects["rc"], {"kind": "tran", "step": 1e-8, "stop": 1})
    p = copy.deepcopy(projects["diode"])
    next(c for c in p["components"] if c["kind"] == "diode")["model"] = "bad\n.include /etc/passwd"
    result = simulate(p)
    assert result["status"] == "error"
    assert result["voltages"] == {}


def test_missing_ground_keeps_project_and_diagnostics(projects):
    p = copy.deepcopy(projects["ohm"])
    p["components"] = [c for c in p["components"] if c["kind"] != "ground"]
    original = copy.deepcopy(p)
    result = simulate(p)
    assert result["status"] == "error"
    assert result["netlist"]
    assert p == original
    assert any(d["category"] == "connection" for d in result["diagnostics"])


@pytest.mark.parametrize("kind", ["switch", "button"])
def test_switch_button_and_series_current_probe(kind):
    from backend.examples import Builder
    b = Builder("switch_probe", "Interrupteur et ampèremètre", "Test indépendant")
    b.add("voltage_source", "V1", {"p": "vcc", "n": "gnd"}, 5)
    b.add("resistor", "R1", {"p": "vcc", "n": "res_out"}, 1000)
    b.add(kind, "S1", {"p": "res_out", "n": "switch_out"}, 1)
    b.add("current_probe", "I1", {"p": "switch_out", "n": "gnd"})
    b.add("ground", "G1", {"g": "gnd"})
    p = b.finish()
    closed = successful(p)
    assert closed["currents"]["I1"] == pytest.approx(5 / 1000.01, rel=1e-6)
    assert closed["currents"]["S1"] == pytest.approx(closed["currents"]["I1"], abs=1e-9)
    next(c for c in p["components"] if c["id"] == "S1")["value"] = 0
    opened = successful(p)
    assert abs(opened["currents"]["I1"]) < 1e-8


def test_bjt_terminal_currents_obey_kirchhoff(projects):
    for kind in ("npn", "pnp"):
        r = successful(projects[kind])
        currents = r["terminal_currents"]["Q1"]
        assert sum(currents.values()) == pytest.approx(0, abs=1e-8)


def test_shorted_source_reports_proven_connection_error(projects):
    p = copy.deepcopy(projects["ohm"])
    p["wires"].append({"id": "Short", "a": "V1.p", "b": "V1.n"})
    result = simulate(p)
    assert result["status"] == "error"
    assert any(d["code"] == "shorted_source" and d["category"] == "connection" for d in result["diagnostics"])
    assert result["netlist"]
    assert result["voltages"] == {}


def test_cancel_running_subprocess_without_preexec_fn(projects, monkeypatch):
    import backend.simulation as engine
    launched = threading.Event()
    processes = []
    actual_popen = engine.subprocess.Popen
    def capture_popen(*args, **kwargs):
        assert kwargs.get("preexec_fn") is None
        process = actual_popen(*args, **kwargs)
        if "spice_worker.py" in str(args[0]):
            processes.append(process)
            launched.set()
        return process
    monkeypatch.setattr(engine.subprocess, "Popen", capture_popen)
    cancel = threading.Event()
    results = []
    task = threading.Thread(target=lambda: results.append(engine.simulate(projects["subtractor"], {"kind": "tran", "step": 1e-6, "stop": 0.005}, cancel)))
    task.start()
    assert launched.wait(3), "Le calcul doit avoir lancé son vrai sous-processus."
    cancel.set()
    task.join(timeout=4)
    assert not task.is_alive(), "Le processus et le thread doivent s'arrêter rapidement."
    assert processes and all(process.poll() is not None for process in processes)
    assert results[0]["status"] == "cancelled"
    assert results[0]["voltages"] == {}


def test_ngspice_success_exposes_flow_measurement_provenance(projects):
    result = successful(projects["ohm"])
    assert result["wire_currents"]["W1"] is None  # Fil parallèle à une bande métallique.
    assert result["wire_current_status"]["W1"] == "underdetermined"
    assert result["wire_flow_hints"]["W1"] == pytest.approx(0.005)
    assert result["wire_flow_hint_kind"] == "pedagogical_path"
    assert result["flow_sample"] == "last_calculated_point"
    assert result["terminal_currents_flat"]["R1.p"] == pytest.approx(0.005)


def test_rc_op_has_no_steady_current_but_tran_has_initial_charging_current(projects):
    """OP et TRAN d'une même source DC répondent à deux questions physiques."""
    project = projects["rc"]
    original = copy.deepcopy(project)
    steady = successful(project, {"kind": "op"})
    # En continu établi, le condensateur idéal est chargé à 5 V et ne conduit plus.
    assert voltage(steady, project, "C1.p") == pytest.approx(5, abs=1e-8)
    assert abs(steady["currents"]["R1"]) < 1e-9
    assert abs(steady["currents"]["C1"]) < 1e-9
    assert all(abs(value) < 1e-9 for value in steady["wire_flow_hints"].values() if value is not None)

    charging = successful(project, project["default_analysis"])
    current_curve = next(curve for curve in charging["curves"] if curve["id"] == "I:R1")
    assert len(current_curve["values"]) == len(charging["time"])
    # Avec UIC et C initialement déchargé, I(0+) = 5 V / 1 kΩ = 5 mA.
    assert current_curve["values"][0] == pytest.approx(.005, abs=1e-5)
    index = min(range(len(charging["time"])), key=lambda i: abs(charging["time"][i] - .001))
    expected = .005 * math.exp(-charging["time"][index] / .001)
    assert current_curve["values"][index] == pytest.approx(expected, abs=1.5e-5)
    assert charging["currents"]["R1"] == pytest.approx(current_curve["values"][-1], abs=1e-12)
    assert 0 < charging["currents"]["R1"] < 2e-5
    assert charging["flow_sample"] == "last_calculated_point"
    assert project == original
