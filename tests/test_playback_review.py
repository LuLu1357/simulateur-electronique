"""Le scénario de revue utilise deux plaques, jamais le projet utilisateur."""
from backend.domain import topology
from scripts.playback_review import review_project


def test_review_fixture_retains_pulse_led_and_energy_on_two_boards():
    project = review_project()
    assert project["id"] == "demo_qa_playback_pulse"
    assert project["breadboard"]["board_count"] == 2
    assert project["default_analysis"] == {"kind": "tran", "step": 2e-6, "stop": 0.002}
    components = {c["id"]: c for c in project["components"]}
    assert components["V1"]["waveform"]["kind"] == "pulse"
    assert components["C1"]["value"] == 1e-8
    placements = project["breadboard"]["placements"]
    assert all(placements[t].startswith("2:") for name in ("LED1", "C1")
               for t in components[name]["pins"].values())
    assert all(not placements[t].startswith("2:") for t in components["R1"]["pins"].values())
    nets = topology(project)["terminal_to_net"]
    assert nets["R1.n"] == nets["LED1.a"] == nets["C1.p"]
    assert nets["LED1.k"] == nets["C1.n"] == nets["V1.n"] == "0"
    assert nets["R1.p"] != nets["R1.n"]
