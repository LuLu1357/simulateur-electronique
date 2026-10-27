"""Implantation pédagogique espacée, sans changement du graphe électrique.

Ce plan emploie des empreintes de démonstration explicitement mappées aux
bornes du modèle. Il ne constitue pas un brochage de composant constructeur.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import re

_EXTERNAL = {"voltage_source", "ground", "voltage_probe", "current_probe"}
_AXIAL = {"resistor", "diode"}


def _hole_position(hole: str) -> tuple[float, float]:
    rail = re.fullmatch(r"rail_(top|bottom)_([pn])(\d+)", hole)
    if rail:
        return (58 + (int(rail[3]) - 1) * 23, (32 if rail[1] == "top" else 290) + (17 if rail[2] == "n" else 0))
    point = re.fullmatch(r"([a-j])(\d+)", hole)
    if point is None:
        raise ValueError("Trou de breadboard inconnu lors de l'implantation.")
    row = "abcdefghij".index(point[1])
    return (58 + (int(point[2]) - 1) * 23, 83 + row * 16 if row < 5 else 190 + (row - 5) * 16)


def _partition(topo: dict) -> set[frozenset[str]]:
    return {frozenset(net["points"]) for net in topo["nets"]}


def plan_breadboard_layout(project: dict) -> dict:
    """Retourne une copie complète implantée ; l'entrée n'est jamais modifiée.

    Douze emplacements sont volontairement réservés pour garder des corps et
    étiquettes lisibles sur une plaque de trente colonnes. Toute impossibilité
    rejette l'ensemble du plan, sans implantation partielle.
    """
    from .domain import breadboard_groups, topology

    before = topology(project)  # Capturer aussi les unions dues à l'ancienne plaque.
    before_nets = before["terminal_to_net"]
    candidate = deepcopy(project)
    parts = [comp for comp in candidate["components"] if comp["kind"] not in _EXTERNAL]
    external = [comp for comp in candidate["components"] if comp["kind"] in _EXTERNAL]
    if len(parts) > 12:
        raise ValueError(
            f"Implantation impossible sur cette plaque : {len(parts)} composants dépassent les 12 emplacements pédagogiques espacés. "
            "Utilisez plusieurs plaques ou un circuit plus petit ; aucune implantation partielle n'a été appliquée."
        )

    split = candidate["breadboard"]["rail_splits"]
    groups = breadboard_groups(split)
    group_of = {hole: index for index, group in enumerate(groups) for hole in group}
    owners: dict[int, str] = {}
    placements: dict[str, str] = {}
    used: set[str] = set()
    footprints: dict[str, dict] = {}

    def put(terminal: str, hole: str) -> None:
        group = group_of[hole]
        net = before_nets[terminal]
        if hole in used or (group in owners and owners[group] != net):
            raise ValueError("Implantation impossible sans court-circuit : aucun changement appliqué.")
        used.add(hole)
        owners[group] = net
        placements[terminal] = hole

    # Corps espacés de 5 colonnes (= 115 px), sur deux bandes à 107 px d'écart.
    parts.sort(key=lambda comp: (
        candidate["schematic"][comp["id"]]["y"],
        candidate["schematic"][comp["id"]]["x"], comp["id"],
    ))
    for index, comp in enumerate(parts):
        base = 1 + (index % 6) * 5
        row = "c" if index < 6 else "h"
        if comp["kind"] in ("npn", "pnp", "potentiometer"):
            # Trois bornes pédagogiques sur trois bandes distinctes ; aucun
            # boîtier constructeur n'est déduit de cette affectation.
            columns = ({"c": base, "b": base + 1, "e": base + 2} if comp["kind"] != "potentiometer" else {"p": base, "w": base + 1, "n": base + 2})
            footprint_kind = "transistor" if comp["kind"] != "potentiometer" else "radial"
        else:
            names = list(comp["pins"])
            columns = {names[0]: base, names[1]: base + 3}
            footprint_kind = "axial" if comp["kind"] in _AXIAL else "radial"
        holes = {name: f"{row}{column}" for name, column in columns.items()}
        for name, hole in holes.items():
            put(comp["pins"][name], hole)
        footprints[comp["id"]] = {"kind": footprint_kind, "pins": holes, "package": "pedagogical", "orientation": "horizontal"}

    # Les sources idéales, la référence et les sondes sont des connexions
    # externes. Un segment de rail ne peut appartenir qu'à UN ancien réseau.
    external_by_net: dict[str, list[str]] = defaultdict(list)
    for comp in external:
        for terminal in comp["pins"].values():
            external_by_net[before_nets[terminal]].append(terminal)
    rail_indices = [index for index, group in enumerate(groups) if group[0].startswith("rail_")]
    available_rails = set(rail_indices)
    for net, terminals in sorted(external_by_net.items(), key=lambda item: (item[0] != "0", item[0])):
        preferred_polarity = "_n" if net == "0" else "_p"
        while terminals:
            preferred = sorted(available_rails, key=lambda index: (preferred_polarity not in groups[index][0], index))
            if not preferred:
                raise ValueError("Implantation impossible : trop de réseaux externes pour les segments de rails disponibles. Aucune implantation appliquée.")
            index = preferred[0]
            available_rails.remove(index)
            holes = groups[index]
            # Espacer d'abord les raccordements au lieu de les coller côte à côte.
            order = holes[::3] + [hole for hole in holes if hole not in holes[::3]]
            batch, terminals = terminals[:len(order)], terminals[len(order):]
            for terminal, hole in zip(batch, order):
                put(terminal, hole)
    for comp in external:
        footprints[comp["id"]] = {"kind": "external", "pins": {name: placements[terminal] for name, terminal in comp["pins"].items()}, "package": "pedagogical", "orientation": "horizontal"}

    # Les jonctions sont des points de raccordement, pas des boîtiers. Réutiliser
    # les bandes de leur réseau ; à défaut, réserver une nouvelle bande libre.
    strip_indices = [index for index, group in enumerate(groups) if not group[0].startswith("rail_")]
    for junction in candidate["junctions"]:
        terminal = junction["id"]
        net = before_nets[terminal]
        possible = [index for index, owner in owners.items() if owner == net]
        possible += [index for index in strip_indices if index not in owners]
        hole = next((hole for index in possible for hole in groups[index] if hole not in used), None)
        if hole is None:
            raise ValueError("Implantation impossible : aucun trou libre compatible pour les jonctions. Aucune implantation appliquée.")
        put(terminal, hole)

    candidate["breadboard"]["placements"] = placements
    candidate["breadboard"]["footprints"] = footprints
    after = topology(candidate)
    # Une union nouvelle entre deux anciens réseaux est toujours interdite.
    for net in after["nets"]:
        if len({before_nets[point] for point in net["points"]}) > 1:
            raise ValueError("L'implantation proposée fusionnerait deux réseaux ; plan rejeté.")

    used_ids = {comp["id"] for comp in candidate["components"]} | {wire["id"] for wire in candidate["wires"]} | {j["id"] for j in candidate["junctions"]} | set(before_nets)
    next_wire = 1
    added = []
    # k sous-groupes d'un ancien réseau demandent exactement k-1 jumpers.
    # Les rapprochements successifs sont choisis dans l'ordre physique et les
    # points les plus proches entre voisins pour réduire les traversées.
    for old_net in before["nets"]:
        separated: dict[str, list[str]] = defaultdict(list)
        for point in old_net["points"]:
            separated[after["terminal_to_net"][point]].append(point)
        islands = list(separated.values())
        islands.sort(key=lambda points: min((*_hole_position(placements[point]), point) for point in points))
        for left, right in zip(islands, islands[1:]):
            def distance(pair):
                a, b = pair
                ax, ay = _hole_position(placements[a])
                bx, by = _hole_position(placements[b])
                return (abs(ax - bx) + abs(ay - by), a, b)
            a, b = min(((a, b) for a in left for b in right), key=distance)
            while f"WB{next_wire}" in used_ids:
                next_wire += 1
            wid = f"WB{next_wire}"
            used_ids.add(wid)
            next_wire += 1
            candidate["wires"].append({"id": wid, "a": a, "b": b, "kind": "rigid_jumper", "origin": "breadboard_layout"})
            added.append(wid)
    final = topology(candidate)
    if _partition(final) != _partition(before):
        raise ValueError("La continuité avant/après n'est pas identique ; implantation rejetée.")
    candidate["breadboard"]["layout"] = {
        "version": 1, "algorithm": "spaced_pedagogical_v1", "component_count": len(parts),
        "external_count": len(external), "added_jumpers": added,
        "note": "Empreintes pédagogiques à bornes explicites ; vérifier le brochage constructeur du composant réel. Les rails coupés ne sont reliés que par les fils explicites du circuit.",
    }
    candidate["breadboard_note"] = "Implantation pédagogique sur une plaque : composants espacés, sources et sondes externes, liaisons par jumpers rigides. Le brochage réel et le montage physique restent à vérifier."
    return candidate
