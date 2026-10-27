"""Courants des conducteurs idéaux déduits par la conservation de la charge.

Un courant de fil n'est déterminé de façon unique que si ce fil est un pont du
graphe conducteur complet : fils, contacts, bandes métalliques et masses.
Un cycle de fils idéaux autorise une circulation indéterminée. Les indications
pour l'animation sont donc séparées des mesures et explicitement pédagogiques.
"""
from __future__ import annotations

from collections import defaultdict
import math
from typing import Any

from .domain import breadboard_groups

FLOW_LEGEND = (
    "Courants de fil : positifs de a vers b, selon le courant conventionnel. "
    "Dans un cycle de conducteurs idéaux, la répartition entre les chemins "
    "n'est pas déterminée par la simulation. Les trajets pédagogiques choisissent "
    "un arbre privilégiant les fils explicites : ils illustrent une circulation "
    "compatible avec la loi des nœuds et ne constituent pas des mesures de fil. "
    "Dans les métaux, le déplacement des électrons est opposé au courant conventionnel."
)


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def component_terminal_currents(project: dict, result: dict) -> dict[str, float | None]:
    """Courant positif entrant dans chaque borne du composant, en ampères."""
    currents = result.get("currents", {})
    transistor_currents = result.get("terminal_currents", {})
    flat: dict[str, float | None] = {}
    for component in project.get("components", []):
        cid, kind, pins = component["id"], component["kind"], component["pins"]
        if kind in ("ground", "voltage_probe"):
            flat.update({point: 0.0 for point in pins.values()})
        elif kind in ("npn", "pnp"):
            terminal_values = transistor_currents.get(cid, {})
            for pin, point in pins.items():
                flat[point] = _finite(terminal_values.get(pin))
        else:
            value = _finite(currents.get(cid))
            positive, negative = ("a", "k") if kind == "diode" else ("p", "n")
            flat[pins[positive]] = value
            flat[pins[negative]] = -value if value is not None else None
    return flat


def _graph(project: dict):
    nodes = {point for comp in project.get("components", []) for point in comp["pins"].values()}
    nodes.update(junction["id"] for junction in project.get("junctions", []))
    # Les fils sont placés en premier pour que l'arbre pédagogique les privilégie.
    edges: list[tuple[str, str, str | None]] = []
    wire_indices = {}
    for wire in project.get("wires", []):
        wire_indices[wire["id"]] = len(edges)
        edges.append((wire["a"], wire["b"], wire["id"]))
        nodes.update((wire["a"], wire["b"]))
    placements = project.get("breadboard", {}).get("placements", {})
    for terminal, hole in placements.items():
        edges.append((terminal, hole, None))
        nodes.update((terminal, hole))
    for index, group in enumerate(breadboard_groups(project.get("breadboard", {}).get("rail_splits", True))):
        hub = f"__breadboard_group_{index}"
        nodes.add(hub)
        for hole in group:
            edges.append((hole, hub, None))
            nodes.add(hole)
    grounds = [c["pins"]["g"] for c in project.get("components", []) if c["kind"] == "ground"]
    if len(grounds) > 1:
        nodes.add("__ground")
        for point in grounds:
            edges.append((point, "__ground", None))
    return nodes, edges, wire_indices


def _forest(nodes: set[str], edges: list[tuple[str, str, str | None]], values: dict[str, float | None]):
    """DFS itérative : ponts, sommes des sous-arbres et bilan de chaque îlot."""
    adjacency = defaultdict(list)
    for index, (a, b, _) in enumerate(edges):
        adjacency[a].append((b, index))
        adjacency[b].append((a, index))
    discovery = {}
    low = {}
    parent = {}
    parent_edge = {}
    root_of = {}
    subtree = {}
    unknown = {}
    absolute = {}
    bridges = set()
    finished = []
    timer = 0
    for root in sorted(nodes):
        if root in discovery:
            continue
        discovery[root] = low[root] = timer
        timer += 1
        parent[root] = None
        parent_edge[root] = None
        root_of[root] = root
        subtree[root] = values.get(root) or 0.0
        unknown[root] = int(root in values and values[root] is None)
        absolute[root] = abs(values.get(root) or 0.0)
        stack = [(root, iter(adjacency[root]))]
        while stack:
            node, neighbors = stack[-1]
            try:
                neighbor, edge_index = next(neighbors)
            except StopIteration:
                stack.pop()
                finished.append(node)
                previous = parent[node]
                if previous is not None:
                    low[previous] = min(low[previous], low[node])
                    if low[node] > discovery[previous]:
                        bridges.add(parent_edge[node])
                    subtree[previous] += subtree[node]
                    unknown[previous] += unknown[node]
                    absolute[previous] += absolute[node]
                continue
            if edge_index == parent_edge[node]:
                continue
            if neighbor in discovery:
                low[node] = min(low[node], discovery[neighbor])
                continue
            parent[neighbor] = node
            parent_edge[neighbor] = edge_index
            root_of[neighbor] = root
            discovery[neighbor] = low[neighbor] = timer
            timer += 1
            subtree[neighbor] = values.get(neighbor) or 0.0
            unknown[neighbor] = int(neighbor in values and values[neighbor] is None)
            absolute[neighbor] = abs(values.get(neighbor) or 0.0)
            stack.append((neighbor, iter(adjacency[neighbor])))
    edge_currents = {}
    for node in finished:
        edge_index = parent_edge[node]
        if edge_index is not None:
            a, _, _ = edges[edge_index]
            # La somme est un courant entrant dans les composants ; le fil
            # doit apporter son opposé depuis le côté enfant du sous-arbre.
            edge_currents[edge_index] = -subtree[node] if a == node else subtree[node]
    return {"bridges": bridges, "edge_currents": edge_currents, "root_of": root_of,
            "residual": {root: subtree[root] for root in nodes if parent.get(root) is None},
            "unknown": {root: unknown[root] for root in nodes if parent.get(root) is None},
            "absolute": {root: absolute[root] for root in nodes if parent.get(root) is None}}


def _pedagogical_tree(nodes, edges):
    """Kruskal sans pondération : sélection stable, fils explicites prioritaires."""
    parent = {node: node for node in nodes}
    def find(node):
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node
    tree = []
    original_indices = []
    for index, edge in enumerate(edges):
        a, b, _ = edge
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
            tree.append(edge)
            original_indices.append(index)
    return tree, original_indices


def calculate_wire_flows(project: dict, result: dict) -> dict:
    """Ajoute les flux de fils sans confondre mesure unique et trajet illustratif.

    Le calcul utilise les courants au dernier point de l'analyse (DC ou temporel).
    Il ne prétend pas connaître la vitesse microscopique des électrons.
    """
    unavailable = {wire["id"]: None for wire in project.get("wires", [])}
    output = {"wire_currents": dict(unavailable),
              "wire_current_status": {key: "unavailable" for key in unavailable},
              "wire_flow_hints": dict(unavailable),
              "wire_flow_hint_kind": "pedagogical_path", "terminal_currents_flat": {},
              "flow_diagnostics": [], "flow_legend": FLOW_LEGEND,
              "flow_sample": "last_calculated_point"}
    if result.get("status") != "success":
        return output
    values = component_terminal_currents(project, result)
    output["terminal_currents_flat"] = values
    nodes, edges, wire_indices = _graph(project)
    forest = _forest(nodes, edges, values)
    bad_roots = set()
    for root, residual in forest["residual"].items():
        tolerance = max(5e-10, forest["absolute"][root] * 1e-6)
        if forest["unknown"][root] or abs(residual) > tolerance:
            bad_roots.add(root)
            output["flow_diagnostics"].append({"category": "solver", "severity": "warning", "code": "wire_flow_unavailable",
                "message": "Flux des fils indisponible sur un réseau : courant de borne manquant ou bilan numérique insuffisamment précis.",
                "targets": [wire_id for wire_id, index in wire_indices.items() if forest["root_of"][edges[index][0]] == root],
                "residual_amperes": residual, "tolerance_amperes": tolerance})
    for wire_id, index in wire_indices.items():
        if forest["root_of"][edges[index][0]] in bad_roots:
            continue
        if index in forest["bridges"]:
            output["wire_currents"][wire_id] = forest["edge_currents"][index]
            output["wire_current_status"][wire_id] = "unique"
        else:
            output["wire_current_status"][wire_id] = "underdetermined"
    tree, original_indices = _pedagogical_tree(nodes, edges)
    hint_forest = _forest(nodes, tree, values)
    hint_currents = {original: hint_forest["edge_currents"].get(tree_index, 0.0) for tree_index, original in enumerate(original_indices)}
    for wire_id, index in wire_indices.items():
        if forest["root_of"][edges[index][0]] not in bad_roots:
            output["wire_flow_hints"][wire_id] = hint_currents.get(index, 0.0)
    return output
