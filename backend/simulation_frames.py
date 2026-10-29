"""Instantanés d'un calcul transitoire existant, sans nouveau calcul ngspice."""
from __future__ import annotations

from copy import deepcopy
import math
import re
from typing import Any

from .domain import circuit_fingerprint, topology
from .flow import calculate_wire_flows
from .simulation import MAX_POINTS


class FrameUnavailableError(Exception):
    """Le résultat demandé n'est plus le calcul courant exploitable."""


def _finite(value: Any) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except (OverflowError, ValueError):
        return False


def simulation_frame(project: dict, simulation: dict, simulation_id: str, index: int,
                     *, running: bool = False) -> dict:
    """Retourne les seules grandeurs du point choisi, plus ses flux de fils.

    Les vecteurs source sont lus directement : ni interpolation ni réutilisation
    des valeurs du dernier point. Les tableaux source et le projet restent intacts.
    L'appelant doit garder son verrou de lecture du projet pendant cet appel.
    """
    if not isinstance(simulation_id, str) or not re.fullmatch(r"[0-9a-f]{32}", simulation_id):
        raise ValueError("L'identifiant du calcul doit contenir 32 caractères hexadécimaux.")
    if type(index) is not int or index < 0:
        raise ValueError("L'indice d'échantillon doit être un entier positif ou nul.")
    if running:
        raise FrameUnavailableError("Un calcul est en cours. Attendez son résultat avant la relecture.")
    if not isinstance(simulation, dict) or simulation.get("status") != "success":
        raise FrameUnavailableError("Aucun calcul réussi courant n'est disponible pour la relecture.")
    if simulation.get("simulation_id") != simulation_id:
        raise FrameUnavailableError("Le calcul demandé a changé. Relisez le résultat courant.")
    fingerprint = circuit_fingerprint(project)
    if simulation.get("stale") or simulation.get("circuit_fingerprint") != fingerprint:
        raise FrameUnavailableError("Le circuit a changé depuis ce calcul. Relancez la simulation.")
    analysis = simulation.get("analysis")
    if not isinstance(analysis, dict) or analysis.get("kind") != "tran":
        raise FrameUnavailableError("La relecture nécessite un calcul transitoire réussi.")
    times = simulation.get("time")
    if not isinstance(times, list) or not 2 <= len(times) <= MAX_POINTS:
        raise ValueError("La série temporelle du calcul est absente ou hors limites.")
    previous = None
    for value in times:
        if not _finite(value) or value < 0 or previous is not None and value <= previous:
            raise ValueError("Les temps du calcul doivent être finis et strictement croissants.")
        previous = value
    if index >= len(times):
        raise ValueError("Cet indice dépasse le nombre d'échantillons du calcul.")
    source_revision = simulation.get("project_revision")
    if type(source_revision) is not int or source_revision < 0:
        raise ValueError("La provenance du calcul ne contient pas de révision valide.")

    curves = simulation.get("curves")
    if not isinstance(curves, list):
        raise ValueError("Les courbes du calcul sont absentes.")
    by_id = {}
    for curve in curves:
        if not isinstance(curve, dict) or not isinstance(curve.get("id"), str) or curve["id"] in by_id:
            raise ValueError("Les identifiants de courbe du calcul sont invalides ou dupliqués.")
        by_id[curve["id"]] = curve

    def sample(identifier: str, unit: str) -> float:
        curve = by_id.get(identifier)
        values = curve.get("values") if curve else None
        if not curve or curve.get("unit") != unit or not isinstance(values, list) or len(values) != len(times):
            raise ValueError(f"Courbe complète {identifier} [{unit}] absente du calcul.")
        value = values[index]
        if not _finite(value):
            raise ValueError(f"Valeur non finie dans la courbe {identifier}, échantillon {index}.")
        return float(value)

    topo = topology(project)
    voltages = {"0": 0.0}
    for net in topo["nets"]:
        if net["id"] != "0":
            voltages[net["id"]] = sample(net["id"], "V")
    currents, terminal_currents, probes = {}, {}, {}
    for component in project["components"]:
        cid, kind, pins = component["id"], component["kind"], component["pins"]
        if kind in ("ground", "voltage_probe"):
            # Symboles de référence et sondes idéales ne consomment aucun courant.
            terminal_currents[cid] = {pin: 0.0 for pin in pins}
            if kind == "voltage_probe":
                differential = voltages[topo["terminal_to_net"][pins["p"]]] - voltages[topo["terminal_to_net"][pins["n"]]]
                if not _finite(differential):
                    raise ValueError(f"Tension différentielle non finie pour {cid}.")
                probes[cid] = differential
            continue
        current = sample(f"I:{cid}", "A")
        currents[cid] = current
        if kind in ("npn", "pnp"):
            terminal_currents[cid] = {"c": current, "b": sample(f"I:{cid}.b", "A"), "e": sample(f"I:{cid}.e", "A")}
        elif kind == "potentiometer":
            terminal_currents[cid] = {"p": current, "w": sample(f"I:{cid}.w", "A"), "n": sample(f"I:{cid}.n", "A")}
        else:
            positive, negative = ("a", "k") if kind in ("diode", "led") else ("p", "n")
            terminal_currents[cid] = {positive: current, negative: -current}
    snapshot = {
        "status": "success", "project_revision": source_revision,
        "simulation_id": simulation_id, "circuit_fingerprint": fingerprint,
        "analysis": deepcopy(analysis), "voltages": voltages, "currents": currents,
        "terminal_currents": terminal_currents, "probe_voltages": probes,
        "time": [], "curves": [], "diagnostics": [], "log": "", "netlist": "",
        "assumptions": deepcopy(simulation.get("assumptions", [])),
        "sample_index": index, "sample_time": float(times[index]), "sample_count": len(times),
        "stale": False,
    }
    snapshot.update(calculate_wire_flows(project, snapshot))
    snapshot["flow_sample"] = "sampled_point"
    snapshot["flow_sample_index"] = index
    snapshot["flow_sample_time"] = float(times[index])
    snapshot["diagnostics"].extend(deepcopy(snapshot["flow_diagnostics"]))
    return {
        "project_id": project["id"], "project_revision": project["revision"],
        "source_revision": source_revision, "simulation_id": simulation_id,
        "circuit_fingerprint": fingerprint, "index": index,
        "time": float(times[index]), "sample_count": len(times), "simulation": snapshot,
    }
