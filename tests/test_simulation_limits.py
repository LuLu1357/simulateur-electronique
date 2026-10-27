"""Contrôles déterministes des limites ; aucun binaire ngspice requis."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import subprocess
import threading

import pytest

from backend.domain import new_project, topology, validate_project
import backend.simulation as engine


def test_valid_high_resistance_can_be_compiled_for_simulation():
    project = new_project()
    resistor = next(component for component in project['components'] if component['kind'] == 'resistor')
    resistor['value'] = 1e15
    validate_project(project)
    netlist, _ = engine.build_netlist(project)
    assert '1e+15' in netlist


def test_oversized_integer_analysis_has_useful_numeric_error():
    with pytest.raises(ValueError, match='limites numériques'):
        engine.build_netlist(new_project(), {'kind': 'tran', 'step': 10 ** 1000})


class Clock:
    def __init__(self):
        self.now = 1000.0
    def monotonic(self):
        return self.now


@pytest.fixture
def clock(monkeypatch):
    timer = Clock()
    monkeypatch.setattr(engine.time, "monotonic", timer.monotonic)
    monkeypatch.setattr(engine.time, "sleep", lambda _: None)
    return timer


def table_spec(count=3):
    project = new_project()
    return project, {"inputs": {"IN": "V1"}, "outputs": {"OUT": "R1.p"},
                     "cases": [{"inputs": {"IN": n % 2}, "expected": {"OUT": n % 2}} for n in range(count)]}


def measured(project, status="success", code=None):
    net = topology(project)["terminal_to_net"]["R1.p"]
    source = next(c for c in project["components"] if c["id"] == "V1")
    return {"status": status, "voltages": {net: source["value"]} if status == "success" else {},
            "diagnostics": [{"code": code}] if code else [], "elapsed_seconds": 1.0}


def test_table_global_deadline_is_shared_and_preserves_finished_cases(monkeypatch, clock):
    project, spec = table_spec(32)
    deadlines = []
    def bounded_simulate(trial, analysis, cancel_event, *, deadline):
        deadlines.append(deadline)
        clock.now += 31
        return measured(trial, "success" if len(deadlines) == 1 else "timeout", None if len(deadlines) == 1 else "table_timeout")
    monkeypatch.setattr(engine, "simulate", bounded_simulate)
    result = engine.run_truth_table(project, **spec)
    assert deadlines == [1060.0, 1060.0]
    assert result["status"] == "timeout"
    assert result["passed"] == 1
    assert result["completed"] == 2
    assert result["total"] == 32
    assert result["cases"][0]["passed"]
    assert result["cases"][1]["convergence"] == "timeout"
    assert result["diagnostics"][0]["code"] == "table_timeout"
    assert result["time_limit_seconds"] == 60 < 180


def test_table_checks_deadline_after_final_case(monkeypatch, clock):
    project, spec = table_spec(1)
    def complete_late(trial, analysis, cancel_event, *, deadline):
        clock.now = deadline
        return measured(trial)
    monkeypatch.setattr(engine, "simulate", complete_late)
    result = engine.run_truth_table(project, **spec)
    assert result["cases"][0]["passed"]  # Le calcul du cas est conservé.
    assert result["status"] == "timeout"
    assert result["diagnostics"][0]["code"] == "table_timeout"


def test_table_checks_deadline_before_first_case(monkeypatch, clock):
    project, spec = table_spec()
    real_topology = engine.topology
    def topology_after_budget(trial):
        clock.now += 61
        return real_topology(trial)
    monkeypatch.setattr(engine, "topology", topology_after_budget)
    monkeypatch.setattr(engine, "simulate", lambda *a, **k: pytest.fail("Aucun calcul après l'échéance"))
    result = engine.run_truth_table(project, **spec)
    assert result["status"] == "timeout"
    assert result["cases"] == []


@pytest.mark.parametrize("reported_status", ["success", "cancelled"])
def test_table_last_case_user_cancel_stays_cancelled(monkeypatch, clock, reported_status):
    project, spec = table_spec(1)
    event = threading.Event()
    def final_cancel(trial, analysis, cancel_event, *, deadline):
        event.set()
        return measured(trial, reported_status)
    monkeypatch.setattr(engine, "simulate", final_cancel)
    result = engine.run_truth_table(project, **spec, cancel_event=event)
    assert len(result["cases"]) == 1
    assert result["status"] == "cancelled"
    assert result["diagnostics"][0]["code"] == "cancelled"


def test_user_cancel_takes_priority_over_global_timeout(monkeypatch, clock):
    project, spec = table_spec(1)
    event = threading.Event()
    def cancel_at_deadline(trial, analysis, cancel_event, *, deadline):
        clock.now = deadline + 1
        event.set()
        return measured(trial, "timeout", "table_timeout")
    monkeypatch.setattr(engine, "simulate", cancel_at_deadline)
    result = engine.run_truth_table(project, **spec, cancel_event=event)
    assert result["status"] == "cancelled"
    assert result["diagnostics"][0]["code"] == "cancelled"


def test_single_case_timeout_does_not_claim_global_budget_exhausted(monkeypatch, clock):
    project, spec = table_spec(2)
    def case_timeout(trial, analysis, cancel_event, *, deadline):
        clock.now += 12
        return measured(trial, "error", "simulation_timeout")
    monkeypatch.setattr(engine, "simulate", case_timeout)
    result = engine.run_truth_table(project, **spec)
    assert result["status"] == "failed"
    assert len(result["cases"]) == 2
    assert result["diagnostics"] == []


def test_expired_simulation_deadline_prevents_process_start(monkeypatch, clock):
    monkeypatch.setattr(engine.subprocess, "Popen", lambda *a, **k: pytest.fail("Pas de processus après l'échéance"))
    result = engine.simulate(new_project(), deadline=clock.now)
    assert result["status"] == "timeout"
    assert result["diagnostics"][0]["code"] == "table_timeout"


class FakeProcess:
    pid = 987654321
    def __init__(self):
        self.returncode = None
        self.wait_calls = []
    def poll(self):
        return self.returncode
    def wait(self, timeout):
        self.wait_calls.append(timeout)
        self.returncode = -9
        return self.returncode


@pytest.fixture
def fake_process(monkeypatch, clock):
    process = FakeProcess()
    kills = []
    monkeypatch.setattr(engine.shutil, "which", lambda _: "/mock/ngspice")
    def launch(*args, **kwargs):
        (Path(kwargs["cwd"]) / "result.raw").write_text("mock RAW")
        return process
    monkeypatch.setattr(engine.subprocess, "Popen", launch)
    monkeypatch.setattr(engine.os, "killpg", lambda pid, signal: kills.append((pid, signal)))
    return process, kills


@pytest.mark.parametrize("failure", [None, OSError("ps indisponible"), subprocess.TimeoutExpired("ps", .5)])
def test_memory_monitor_failure_kills_waits_and_has_distinct_diagnostic(monkeypatch, fake_process, failure):
    process, kills = fake_process
    def unreadable_rss(pid):
        if isinstance(failure, Exception):
            raise failure
        return None
    monkeypatch.setattr(engine, "_rss_kib", unreadable_rss)
    result = engine.simulate(new_project())
    assert kills == [(process.pid, engine.signal.SIGKILL)]
    assert process.wait_calls == [2]
    assert result["status"] == "error"
    assert result["diagnostics"][-1]["code"] == "memory_monitor_failed"
    assert result["voltages"] == {}


def test_measured_memory_limit_is_distinct_from_monitor_failure(monkeypatch, fake_process):
    process, kills = fake_process
    monkeypatch.setattr(engine, "_rss_kib", lambda pid: 512 * 1024 + 1)
    result = engine.simulate(new_project())
    assert kills and process.wait_calls == [2]
    assert result["status"] == "error"
    assert result["diagnostics"][-1]["code"] == "memory_limit_exceeded"


def test_process_finishing_during_rss_check_does_not_fail_monitor(monkeypatch, fake_process):
    process, kills = fake_process
    def gone_after_measurement(pid):
        process.returncode = 0
        return None
    monkeypatch.setattr(engine, "_rss_kib", gone_after_measurement)
    monkeypatch.setattr(engine, "parse_ascii_raw", lambda path: {"v(n1)": [5.0], "i(v0)": [-.005], "i(@r1[i])": [.005]})
    result = engine.simulate(new_project())
    assert not kills and not process.wait_calls
    assert result["status"] == "success"
    assert not any(d["code"] == "memory_monitor_failed" for d in result["diagnostics"])


def test_in_process_global_deadline_kills_and_waits(monkeypatch, clock, fake_process):
    process, kills = fake_process
    clock.now += 1
    # L'échéance passe seulement après Popen, pendant la surveillance.
    def launch(*args, **kwargs):
        clock.now += 2
        return process
    monkeypatch.setattr(engine.subprocess, "Popen", launch)
    result = engine.simulate(new_project(), deadline=clock.now + 1)
    assert kills and process.wait_calls == [2]
    assert result["status"] == "timeout"
    assert result["diagnostics"][-1]["code"] == "table_timeout"


@pytest.mark.parametrize("returncode,stdout", [(1, "123"), (0, ""), (0, "abc"), (0, "-1"), (0, "0"), (0, "123 456"), (0, "123\n456"), (0, None)])
def test_ps_failure_or_invalid_output_is_unknown_not_zero(monkeypatch, returncode, stdout):
    monkeypatch.setattr(engine.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=returncode, stdout=stdout))
    assert engine._rss_kib(987654321) is None


def test_ps_valid_positive_rss_is_returned(monkeypatch):
    monkeypatch.setattr(engine.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout="  4567\n"))
    assert engine._rss_kib(987654321) == 4567


@pytest.mark.parametrize("failure", [OSError("refus"), subprocess.TimeoutExpired("ps", .5)])
def test_ps_read_error_and_timeout_are_unknown(monkeypatch, failure):
    def failed(*a, **k):
        raise failure
    monkeypatch.setattr(engine.subprocess, "run", failed)
    assert engine._rss_kib(987654321) is None


@pytest.mark.parametrize("text,expected", [("VmRSS: 123 kB\n", 123), ("VmRSS: x kB\n", None), ("VmRSS: 0 kB\n", None), ("VmRSS: 4 MB\n", None), ("Name: test\n", None)])
def test_proc_status_invalid_missing_and_positive_measurements(monkeypatch, text, expected):
    class ProcStatus:
        def is_file(self):
            return True
        def read_text(self):
            return text
    monkeypatch.setattr(engine, "Path", lambda _: ProcStatus())
    assert engine._rss_kib(123) == expected


def test_individual_timeout_keeps_error_status_and_diagnostic(monkeypatch, clock, fake_process):
    process, kills = fake_process
    def launch(*args, **kwargs):
        clock.now += engine.MAX_SECONDS + 1
        return process
    monkeypatch.setattr(engine.subprocess, "Popen", launch)
    result = engine.simulate(new_project())
    assert kills and process.wait_calls == [2]
    assert result["status"] == "error"
    assert result["diagnostics"][-1]["code"] == "simulation_timeout"
