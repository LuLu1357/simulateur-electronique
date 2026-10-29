"""Adaptateur ngspice : aucune valeur électrique n'est fabriquée par l'interface.

Les noms SPICE sont générés ; modèles et paramètres sont une liste fermée.
Aucune netlist libre, commande SPICE utilisateur ou directive .include n'est admise.
"""
from __future__ import annotations

import copy
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any

from .domain import circuit_fingerprint, topology, validate_topology, validate_source_waveform
from .spice_worker import MAX_RAW_BYTES
from .flow import calculate_wire_flows

MAX_SECONDS = 12.0
MAX_TABLE_SECONDS = 60.0
MAX_POINTS = 6000
MAX_COMPONENTS = 300
MODEL_LINES = {
    "generic_diode": ".model gd D(Is=1e-14 N=1 Rs=0.1)",
    "generic_npn": ".model gn NPN(Is=1e-15 Bf=100 Vaf=100)",
    "generic_pnp": ".model gp PNP(Is=1e-15 Bf=100 Vaf=100)",
    "generic_led_red": ".model glr D(Is=1e-20 N=1.8 Rs=2)",
    "generic_led_green": ".model glg D(Is=1e-23 N=1.8 Rs=2)",
    "generic_led_blue": ".model glb D(Is=1e-30 N=1.8 Rs=2)",
}
ASSUMPTIONS = [
    "Modèles génériques : diode Is=10 fA, N=1 ; BJT β nominal=100, VAF=100 V ; température 27 °C. Ce ne sont pas des modèles constructeur.",
    "Fils et breadboard idéaux : aucune résistance de contact, inductance parasite ni tolérance des composants.",
    "Courant conventionnel : positif de p vers n, de l'anode vers la cathode ; pour un BJT, courant entrant par le collecteur. Une source qui débite présente un courant négatif.",
    "Une simulation ne valide pas automatiquement un montage physique ni le brochage d'un composant réel.",
]


def _finite(value: Any, name: str, positive: bool = False, maximum: float = 1e12) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ValueError(f"{name} doit être un nombre fini en unités SI.")
    try:
        result = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"{name} dépasse les limites numériques.") from exc
    if not math.isfinite(result) or abs(result) > maximum or (positive and result <= 0):
        raise ValueError(f"{name} hors limites : valeur finie {'strictement positive ' if positive else ''}requise.")
    return result


def build_netlist(project: dict, analysis: dict | None = None) -> tuple[str, dict]:
    """Compile uniquement des composants typés, avec correspondances stables."""
    analysis = analysis or {"kind": "op"}
    kind = analysis.get("kind", "op")
    if kind not in ("op", "tran"):
        raise ValueError("Analyse inconnue : choisir op ou tran.")
    if len(project.get("components", [])) > MAX_COMPONENTS:
        raise ValueError(f"Limite de {MAX_COMPONENTS} composants dépassée.")
    topo = topology(project)
    ids = sorted(n["id"] for n in topo["nets"] if n["id"] != "0")
    net_to_spice = {net: f"n{i + 1}" for i, net in enumerate(ids)}
    net_to_spice["0"] = "0"
    ttn = topo["terminal_to_net"]
    lines = ["* Atelier Electronique - projet compile, valeurs SI", ".temp 27", ".options reltol=1e-5 abstol=1e-12 itl1=200 itl4=100"]
    current_vectors: dict[str, str] = {}
    probe_nodes: dict[str, tuple[str, str]] = {}
    save_vectors = ["all"]
    terminal_current_vectors = {}
    potentiometer_vectors = {}
    used_models: set[str] = set()
    for i, c in enumerate(project.get("components", [])):
        ck = c["kind"]
        pins = c["pins"]
        def node(pin: str) -> str:
            return net_to_spice[ttn[pins[pin]]]
        dev = ""
        vector = None
        if ck in ("resistor", "switch", "button"):
            value = _finite(c.get("value", 1000), c["id"], positive=(ck == "resistor"), maximum=1e15 if ck == "resistor" else 1e12)
            # Interrupteur ouvert : fuite explicite de 1 pS, pas un fil.
            resistance = value if ck == "resistor" else (0.01 if value >= 0.5 else 1e12)
            dev = f"r{i} {node('p')} {node('n')} {resistance:.15g}"
            vector = f"@r{i}[i]"
        elif ck in ("voltage_source", "current_probe"):
            value = 0 if ck == "current_probe" else _finite(c.get("value", 5), c["id"])
            waveform = validate_source_waveform(c.get("waveform")) if ck == "voltage_source" else None
            if waveform:
                value = waveform["low"]
            dev = f"v{i} {node('p')} {node('n')} DC {value:.15g}"
            if waveform and kind == "tran":
                pulse = " ".join(f"{waveform[key]:.15g}" for key in ("low", "high", "delay", "rise", "fall", "width", "period"))
                dev += f" PULSE({pulse})"
            vector = f"v{i}#branch"
        elif ck == "capacitor":
            value = _finite(c.get("value", 1e-6), c["id"], positive=True)
            initial = _finite(c.get("initial_voltage", 0), f"IC {c['id']}")
            dev = f"c{i} {node('p')} {node('n')} {value:.15g} IC={initial:.15g}"
            vector = f"@c{i}[i]"
        elif ck == "inductor":
            value = _finite(c.get("value", 0.01), c["id"], positive=True, maximum=1e6)
            if value < 1e-12:
                raise ValueError("L'inductance doit être comprise entre 1 pH et 1 MH.")
            dev = f"l{i} {node('p')} {node('n')} {value:.15g} IC=0"
            vector = f"l{i}#branch"
        elif ck == "potentiometer":
            value = _finite(c.get("value", 10000), c["id"], positive=True)
            if not 1 <= value <= 1e9:
                raise ValueError("Résistance totale du potentiomètre hors limites : 1 Ω à 1 GΩ.")
            position = _finite(c.get("position", 0.5), f"Curseur {c['id']}")
            if not 0 <= position <= 1:
                raise ValueError("La position du curseur doit être comprise entre 0 et 1.")
            upper = max(0.001, value * position)
            lower = max(0.001, value * (1 - position))
            dev = f"r{i}p {node('p')} {node('w')} {upper:.15g}\nr{i}n {node('w')} {node('n')} {lower:.15g}"
            vector = f"@r{i}p[i]"
            potentiometer_vectors[c["id"]] = (vector, f"@r{i}n[i]")
            save_vectors.append(f"@r{i}n[i]")
        elif ck in ("diode", "led"):
            model = c.get("model") or ("generic_led_red" if ck == "led" else "generic_diode")
            names = {"generic_diode": "gd"} if ck == "diode" else {"generic_led_red": "glr", "generic_led_green": "glg", "generic_led_blue": "glb"}
            if model not in names:
                raise ValueError(f"Modèle {ck} non autorisé ; choisir un modèle du catalogue.")
            used_models.add(model)
            dev = f"d{i} {node('a')} {node('k')} {names[model]}"
            vector = f"@d{i}[id]"
        elif ck in ("npn", "pnp"):
            model = c.get("model", f"generic_{ck}")
            if model != f"generic_{ck}":
                raise ValueError(f"Modèle {ck} non autorisé ; choisir generic_{ck}.")
            used_models.add(model)
            dev = f"q{i} {node('c')} {node('b')} {node('e')} {'gn' if ck == 'npn' else 'gp'}"
            vector = f"@q{i}[ic]"
            terminal_current_vectors[c["id"]] = {"c": vector, "b": f"@q{i}[ib]", "e": f"@q{i}[ie]"}
            save_vectors.extend((f"@q{i}[ib]", f"@q{i}[ie]"))
        elif ck == "voltage_probe":
            probe_nodes[c["id"]] = (ttn[pins["p"]], ttn[pins["n"]])
        elif ck != "ground":
            raise ValueError(f"Composant non pris en charge : {ck}.")
        if dev:
            lines.append(dev)
        if vector:
            current_vectors[c["id"]] = vector
            save_vectors.append(vector)
    lines.extend(MODEL_LINES[key] for key in sorted(used_models))
    lines.append(".save " + " ".join(save_vectors))
    lines.extend([".control", "set filetype=ascii", "set noaskquit"])
    if kind == "op":
        lines.append("op")
    else:
        step = _finite(analysis.get("step", 1e-5), "Pas temporel", positive=True)
        stop = _finite(analysis.get("stop", 0.01), "Durée", positive=True)
        if stop > 10 or step < 1e-10 or stop / step > MAX_POINTS - 100:
            raise ValueError("Analyse temporelle limitée à 10 s et 5 900 intervalles ; augmenter le pas si nécessaire.")
        # UIC permet une charge RC sous alimentation DC. L'hypothèse apparaît au résultat.
        startup = analysis.get("startup", True)
        lines.append(f"tran {step:.15g} {stop:.15g} 0 {step:.15g}{' uic' if startup else ''}")
    lines.extend(["write result.raw all", "quit", ".endc", ".end", ""])
    return "\n".join(lines), {"topology": topo, "net_to_spice": net_to_spice, "current_vectors": current_vectors, "terminal_current_vectors": terminal_current_vectors, "potentiometer_vectors": potentiometer_vectors, "probe_nodes": probe_nodes, "analysis": copy.deepcopy(analysis)}


def parse_ascii_raw(path: Path) -> dict[str, list[float]]:
    """Lecteur borné du format RAW ASCII documenté par ngspice."""
    if path.stat().st_size > MAX_RAW_BYTES:
        raise ValueError("Résultat ngspice trop volumineux.")
    text = path.read_text(errors="replace")
    if "Flags: real" not in text or "Values:\n" not in text:
        raise ValueError("Résultat ngspice absent, complexe ou illisible.")
    nvar_match = re.search(r"No\. Variables:\s*(\d+)", text)
    npoints_match = re.search(r"No\. Points:\s*(\d+)", text)
    if not nvar_match or not npoints_match:
        raise ValueError("Entête RAW incomplet.")
    nvars = int(nvar_match[1]); npoints = int(npoints_match[1])
    if not (0 < nvars <= 2000 and 0 < npoints <= MAX_POINTS):
        raise ValueError("Résultat hors limites de variables ou d'échantillons.")
    header, values_text = text.split("Values:\n", 1)
    variable_text = header.split("Variables:\n", 1)[1]
    names = []
    for line in variable_text.splitlines():
        parts = line.split()
        if len(parts) >= 3:
            names.append(parts[1].lower())
    if len(names) != nvars:
        raise ValueError("Table des variables RAW incohérente.")
    rows = [line.split() for line in values_text.splitlines() if line.strip()]
    if len(rows) != npoints * nvars:
        raise ValueError("Simulation incomplète : les mesures ne seront pas présentées comme réussies.")
    data = {name: [] for name in names}
    for point in range(npoints):
        for variable, name in enumerate(names):
            parts = rows[point * nvars + variable]
            value = float(parts[-1])
            if not math.isfinite(value):
                raise ValueError("Le solveur a renvoyé une valeur non finie.")
            data[name].append(value)
    return data


class _SimulationAbort(Exception):
    def __init__(self, code: str, message: str, status: str = "error"):
        super().__init__(message)
        self.code = code
        self.status = status


def _requested_abort(cancel_event: threading.Event | None, deadline: float | None, now: float | None = None) -> _SimulationAbort | None:
    # Une demande de l'utilisateur garde la priorité, même au dernier cas.
    if cancel_event is not None and cancel_event.is_set():
        return _SimulationAbort("cancelled", "Calcul arrêté à la demande de l'utilisateur ; aucun nouveau résultat n'est déclaré valide.", "cancelled")
    if deadline is not None and (time.monotonic() if now is None else now) >= deadline:
        return _SimulationAbort("table_timeout", f"La limite globale de {MAX_TABLE_SECONDS:g} s de la table d'essais est atteinte ; les cas déjà terminés sont conservés.", "timeout")
    return None


def _check_abort(cancel_event: threading.Event | None, deadline: float | None) -> None:
    reason = _requested_abort(cancel_event, deadline)
    if reason is not None:
        raise reason


def _rss_kib(pid: int) -> int | None:
    """RSS en Kio, ou None si la surveillance n'a pu être établie.

    Une erreur, un processus disparu ou une réponse ps invalide ne représentent
    jamais une mesure de zéro octet. L'appelant distingue la course de terminaison.
    """
    try:
        proc_status = Path(f"/proc/{pid}/status")
        if proc_status.is_file():
            for line in proc_status.read_text().splitlines():
                if line.startswith("VmRSS:"):
                    fields = line.split()
                    if len(fields) != 3 or fields[2] != "kB" or not fields[1].isdigit():
                        return None
                    value = int(fields[1])
                    return value if value > 0 else None
            return None
        measured = subprocess.run(["/bin/ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True, timeout=0.5)
        if not isinstance(measured.stdout, str):
            return None
        output = measured.stdout.strip()
        if measured.returncode != 0 or not re.fullmatch(r"[0-9]+", output):
            return None
        value = int(output)
        return value if value > 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def simulate(project: dict, analysis: dict | None = None, cancel_event: threading.Event | None = None, *, deadline: float | None = None) -> dict:
    """Exécute une analyse ; un échec conserve netlist, log et diagnostics."""
    start = time.monotonic()
    result = {"status": "error", "project_revision": project.get("revision", 0), "circuit_fingerprint": circuit_fingerprint(project), "voltages": {}, "currents": {}, "time": [], "curves": [], "diagnostics": [], "log": "", "netlist": "", "assumptions": list(ASSUMPTIONS), "analysis": analysis or {"kind": "op"}}
    try:
        if deadline is not None and (type(deadline) not in (int, float) or not math.isfinite(deadline)):
            raise ValueError("L'échéance du calcul doit être un instant monotone fini.")
        _check_abort(cancel_event, deadline)
        netlist, info = build_netlist(project, analysis)
        result["netlist"] = netlist
        result["diagnostics"] = validate_topology(project)
        if any(d.get("severity") == "error" and d.get("category") in ("connection", "connexion", "topology") for d in result["diagnostics"]):
            # La validité structurelle est traitée par le domaine ; on garde les
            # avertissements de nœuds flottants pour observer le solveur réel.
            pass
        executable = shutil.which("ngspice")
        if not executable:
            raise ValueError("ngspice introuvable. Installer ngspice puis relancer ; aucune simulation de remplacement n'est utilisée.")
        if not any(c["kind"] == "ground" for c in project.get("components", [])):
            result["diagnostics"].append({"category": "connection", "severity": "error", "code": "missing_ground", "message": "Aucune masse : le circuit ne définit pas de potentiel de référence 0 V.", "targets": []})
            raise ValueError("Ajouter une référence de masse au circuit avant le calcul.")
        if info["analysis"].get("kind") == "tran" and info["analysis"].get("startup", True):
            result["assumptions"].append("Transitoire avec UIC : condensateurs à leur tension initiale déclarée (0 V par défaut), inductances à 0 A, puis sources appliquées ; ce départ diffère du point de fonctionnement DC.")
        if any(c["kind"] in ("button", "switch") for c in project.get("components", [])):
            result["assumptions"].append("Interrupteurs : 0,01 Ω fermés, 10¹² Ω ouverts ; pas de rebond mécanique.")
        if any(c["kind"] == "potentiometer" for c in project.get("components", [])):
            result["assumptions"].append("Potentiomètre linéaire : R(p,w)=position×R, R(w,n)=(1−position)×R ; chaque segment vaut au minimum 1 mΩ. Courant principal affiché : entrant par p ; les courants p/w/n sont disponibles séparément.")
        if any(c["kind"] == "inductor" for c in project.get("components", [])):
            result["assumptions"].append("Inductance idéale linéaire : V(p)−V(n)=L×dI/dt ; courant positif de p vers n, lu dans ngspice. Résistance série nulle, sans pertes, saturation ni couplage magnétique. En continu, la bobine est un court-circuit idéal ; avec UIC, son courant initial est 0 A.")
        if any(c["kind"] == "led" for c in project.get("components", [])):
            result["assumptions"].append("DEL : jonctions génériques rouge, verte et bleue, sans modèle constructeur, thermique ou photométrique. Le seuil pédagogique d’avertissement est 20 mA ; la simulation ne modélise pas une destruction.")
        if any(c["kind"] == "voltage_source" and c.get("waveform") for c in project.get("components", [])):
            result["assumptions"].append("Source à impulsions : niveau bas utilisé pour le point continu OP ; en TRAN, ngspice calcule la suite périodique avec les temps de montée, de plateau haut et de descente déclarés.")
        with tempfile.TemporaryDirectory(prefix="atelier-ngspice-") as directory:
            work = Path(directory)
            (work / "circuit.cir").write_text(netlist)
            log_path = work / "engine.log"
            with log_path.open("w") as log_file:
                env = {"PATH": os.environ.get("PATH", ""), "LANG": "C", "SPICE_ASCIIRAWFILE": "1", "HOME": directory, "OMP_NUM_THREADS": "1"}
                worker = Path(__file__).with_name("spice_worker.py")
                _check_abort(cancel_event, deadline)
                process = subprocess.Popen([sys.executable, str(worker), str(Path(executable).absolute())], cwd=directory, stdout=log_file, stderr=subprocess.STDOUT, env=env, start_new_session=True)
                reason = None
                last_memory_check = 0.0
                while process.poll() is None:
                    now = time.monotonic()
                    reason = _requested_abort(cancel_event, deadline, now)
                    if reason is None and now - start > MAX_SECONDS:
                        reason = _SimulationAbort("simulation_timeout", f"La limite de durée du calcul ({MAX_SECONDS:g} s) est atteinte.")
                    if reason is None and now - last_memory_check > 0.3:
                        last_memory_check = now
                        try:
                            rss = _rss_kib(process.pid)
                        except (OSError, ValueError, subprocess.SubprocessError):
                            rss = None
                        # Un calcul rapide peut finir pendant ps. Dans ce cas,
                        # son absence de RSS ne constitue pas un échec de suivi.
                        if process.poll() is None:
                            if rss is None:
                                reason = _SimulationAbort("memory_monitor_failed", "La surveillance de la mémoire de ngspice est indisponible ; le calcul a été arrêté pour conserver la limite de ressources.")
                            elif rss > 512 * 1024:
                                reason = _SimulationAbort("memory_limit_exceeded", "La limite mémoire de ngspice (512 Mio) est atteinte.")
                    if reason is not None:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait(timeout=2)
                        break
                    time.sleep(0.015)
                result["log"] = log_path.read_text(errors="replace")[-32000:]
                _check_abort(cancel_event, deadline)
                if reason is not None:
                    raise reason
                raw_path = work / "result.raw"
                if process.returncode != 0 or not raw_path.is_file():
                    raise ValueError("Le moteur ngspice n'a pas produit de calcul exploitable. Consulter son journal.")
                raw = parse_ascii_raw(raw_path)
                _check_abort(cancel_event, deadline)
                if info["analysis"].get("kind") == "tran":
                    times = raw.get("time", [])
                    requested_stop = float(info["analysis"].get("stop", 0.01))
                    if not times or times[-1] < requested_stop * (1 - 1e-8):
                        raise ValueError("Analyse temporelle interrompue avant la durée demandée : consulter le journal ; mesures non validées.")
        voltages = {"0": 0.0}
        curves = []
        for net, spice_node in info["net_to_spice"].items():
            if net == "0":
                continue
            values = raw.get(f"v({spice_node})")
            if values is None:
                raise ValueError(f"Tension absente du résultat : {net}.")
            voltages[net] = values[-1]
            curves.append({"id": net, "label": f"V({net})", "unit": "V", "values": values})
        currents = {}
        for comp, vector in info["current_vectors"].items():
            # ngspice préfixe certains vecteurs @device par i(...).
            values = raw.get(vector.lower()) or raw.get(f"i({vector.lower()})")
            if values is None and vector.endswith("#branch"):
                values = raw.get(f"i({vector[:-7].lower()})")
            if values is None:
                raise ValueError(f"Courant absent du résultat ngspice pour {comp} ({vector}).")
            currents[comp] = values[-1]
            curves.append({"id": f"I:{comp}", "label": f"I({comp})", "unit": "A", "values": values})
        terminal_currents = {}
        for comp, vectors in info["terminal_current_vectors"].items():
            terminal_currents[comp] = {}
            for pin, vector in vectors.items():
                values = raw.get(vector) or raw.get(f"i({vector})")
                if values is None:
                    raise ValueError(f"Courant de borne absent : {comp}.{pin}.")
                terminal_currents[comp][pin] = values[-1]
                if pin != "c":
                    curves.append({"id": f"I:{comp}.{pin}", "label": f"I({comp}.{pin})", "unit": "A", "values": values})
        for comp, (upper_vector, lower_vector) in info["potentiometer_vectors"].items():
            upper_values = raw.get(upper_vector) or raw.get(f"i({upper_vector})")
            lower_values = raw.get(lower_vector) or raw.get(f"i({lower_vector})")
            if upper_values is None or lower_values is None:
                raise ValueError(f"Courant de segment absent : {comp}.")
            terminal_currents[comp] = {"p": upper_values[-1], "w": lower_values[-1] - upper_values[-1], "n": -lower_values[-1]}
            curves.append({"id": f"I:{comp}.w", "label": f"I({comp}.w)", "unit": "A", "values": [lower - upper for upper, lower in zip(upper_values, lower_values)]})
            curves.append({"id": f"I:{comp}.n", "label": f"I({comp}.n)", "unit": "A", "values": [-value for value in lower_values]})
        probes = {}
        for comp, (plus, minus) in info["probe_nodes"].items():
            probes[comp] = voltages[plus] - voltages[minus]
        _check_abort(cancel_event, deadline)
        result.update(status="success", voltages=voltages, currents=currents, curves=curves, time=raw.get("time", []), probe_voltages=probes, terminal_currents=terminal_currents)
        result.update(calculate_wire_flows(project, result))
        result["diagnostics"].extend(result["flow_diagnostics"])
        for component in project.get("components", []):
            if component["kind"] != "led":
                continue
            samples = next((curve["values"] for curve in curves if curve["id"] == f"I:{component['id']}"), [])
            peak_current = max(samples, default=0.0)
            if peak_current > 0.020:
                current_ma = peak_current * 1000
                result["diagnostics"].append({"category": "observation", "severity": "warning", "code": "led_overcurrent", "message": f"{component['id']} : courant maximal calculé {current_ma:.3g} mA, au-delà du seuil pédagogique de 20 mA. Augmenter la résistance série.", "explanation": "Avertissement fondé sur les échantillons réellement calculés ; le modèle ne simule ni échauffement ni destruction, et ce seuil ne remplace pas une fiche constructeur.", "measured_peak_current": peak_current, "limit_current": 0.020, "targets": [component["id"]]})
        log_lower = result["log"].lower()
        if any(word in log_lower for word in ("singular", "gmin stepping", "source stepping")):
            result["diagnostics"].append({"category": "solver", "severity": "warning", "code": "solver_assistance", "message": "Le journal signale des difficultés numériques ou des étapes de convergence. Les valeurs ont été obtenues, mais examiner les nœuds peu chargés avant d'interpréter le circuit.", "targets": []})
        _check_abort(cancel_event, deadline)
        result["diagnostics"].append({"category": "observation", "severity": "info", "code": "converged", "message": f"ngspice a produit {len(result['time']) or 1} point(s) exploitable(s). Les tensions affichées proviennent de ce calcul.", "targets": []})
    except _SimulationAbort as error:
        result.update(status=error.status, voltages={}, currents={}, time=[], curves=[])
        for field in ("probe_voltages", "terminal_currents", "terminal_currents_flat", "wire_currents", "wire_current_status", "wire_flow_hints", "wire_flow_hint_kind", "flow_diagnostics", "flow_legend", "flow_sample"):
            result.pop(field, None)
        result["diagnostics"].append({"category": "solver", "severity": "info" if error.status == "cancelled" else "error", "code": error.code, "message": str(error), "targets": []})
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        result["status"] = "error"
        result["diagnostics"].append({"category": "solver", "severity": "error", "code": "simulation_failed", "message": str(error), "targets": []})
    result["elapsed_seconds"] = round(time.monotonic() - start, 4)
    return result


def run_truth_table(project: dict, inputs: dict, outputs: dict, cases: list, thresholds: dict | None = None, cancel_event: threading.Event | None = None) -> dict:
    """Chaque ligne est un vrai calcul analogique indépendant, puis seuillage."""
    started = time.monotonic()
    deadline = started + MAX_TABLE_SECONDS
    thresholds = thresholds or {"low": 1.5, "high": 3.5}
    low = _finite(thresholds.get("low", 1.5), "Seuil bas")
    high = _finite(thresholds.get("high", 3.5), "Seuil haut")
    if not 0 <= low < high <= 5:
        raise ValueError("Seuils invalides : 0 ≤ bas < haut ≤ 5 V requis.")
    if not isinstance(cases, list) or not 1 <= len(cases) <= 32:
        raise ValueError("Une table contient de 1 à 32 combinaisons.")
    sources = {c["id"]: c for c in project["components"]}
    for label, cid in inputs.items():
        if cid not in sources or sources[cid]["kind"] != "voltage_source":
            raise ValueError(f"Entrée {label} : la source continue {cid} est introuvable.")
    topo = topology(project)
    for label, terminal in outputs.items():
        if terminal not in topo["terminal_to_net"]:
            raise ValueError(f"Sortie {label} : borne {terminal} inconnue.")
    rows = []
    stop_reason = None
    for index, case in enumerate(cases):
        stop_reason = _requested_abort(cancel_event, deadline)
        if stop_reason is not None:
            break
        trial = copy.deepcopy(project)
        applied = case.get("inputs", {})
        if set(applied) != set(inputs) or any(v not in (0, 1) or isinstance(v, str) for v in applied.values()):
            raise ValueError("Chaque ligne doit définir toutes les entrées par 0 ou 1.")
        components = {c["id"]: c for c in trial["components"]}
        for label, cid in inputs.items():
            components[cid]["value"] = 5.0 * applied[label]
        measured = simulate(trial, {"kind": "op"}, cancel_event, deadline=deadline)
        volts = {label: measured["voltages"].get(topo["terminal_to_net"][terminal]) for label, terminal in outputs.items()}
        observed = {label: (None if value is None or low < value < high else (0 if value <= low else 1)) for label, value in volts.items()}
        expected = case.get("expected", {})
        passed = measured["status"] == "success" and observed == expected
        rows.append({"index": index, "inputs": copy.deepcopy(applied), "applied_voltages": {label: bit * 5.0 for label, bit in applied.items()}, "voltages": volts, "thresholds": {"low": low, "high": high}, "expected": expected, "observed": observed, "convergence": measured["status"], "passed": passed, "diagnostics": measured["diagnostics"], "elapsed_seconds": measured.get("elapsed_seconds"), "expected_modulo_4": case.get("expected_modulo_4"), "expected_borrow": case.get("expected_borrow"), "observed_modulo_4": observed.get("D0", 0) + 2 * observed.get("D1", 0) if observed.get("D0") is not None and observed.get("D1") is not None else None})
        stop_reason = _requested_abort(cancel_event, deadline)
        if stop_reason is None and measured["status"] == "cancelled":
            stop_reason = _SimulationAbort("cancelled", "Table d'essais arrêtée à la demande de l'utilisateur.", "cancelled")
        if stop_reason is None and measured["status"] == "timeout" and any(d.get("code") == "table_timeout" for d in measured.get("diagnostics", [])):
            stop_reason = _SimulationAbort("table_timeout", f"La limite globale de {MAX_TABLE_SECONDS:g} s de la table d'essais est atteinte ; les cas déjà terminés sont conservés.", "timeout")
        if stop_reason is not None:
            break
    # Vérifier aussi après le dernier cas : son annulation ne devient pas failed.
    stop_reason = _requested_abort(cancel_event, deadline) or stop_reason
    passed_count = sum(row["passed"] for row in rows)
    status = stop_reason.status if stop_reason is not None else ("success" if passed_count == len(rows) else "failed")
    diagnostics = []
    if stop_reason is not None:
        diagnostics.append({"category": "solver", "severity": "info" if status == "cancelled" else "error", "code": stop_reason.code, "message": str(stop_reason), "targets": []})
    return {"status": status, "project_revision": project["revision"], "circuit_fingerprint": circuit_fingerprint(project), "thresholds": {"low": low, "high": high}, "cases": rows, "passed": passed_count, "total": len(cases), "completed": len(rows), "diagnostics": diagnostics, "elapsed_seconds": round(time.monotonic() - started, 4), "time_limit_seconds": MAX_TABLE_SECONDS, "assumptions": list(ASSUMPTIONS), "note": "Résultat D1D0 modulo 4 ; emprunt final séparé. Cet affichage n'est pas un entier signé."}
