"""Modèle canonique et opérations communes à l'interface et au MCP.

Les fils explicites et les bandes métalliques de la breadboard participent au
même graphe. Un croisement graphique ne crée jamais de connexion.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import re
import threading
import uuid
from typing import Any

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,79}$")
_PIN_NAMES = {
    "resistor": ("p", "n"), "voltage_source": ("p", "n"),
    "switch": ("p", "n"), "button": ("p", "n"),
    "diode": ("a", "k"), "led": ("a", "k"), "npn": ("c", "b", "e"),
    "pnp": ("c", "b", "e"), "capacitor": ("p", "n"),
    "ground": ("g",), "voltage_probe": ("p", "n"),
    "current_probe": ("p", "n"), "potentiometer": ("p", "w", "n"),
}
_PREFIXES = {"resistor": "R", "voltage_source": "V", "switch": "S", "button": "B", "diode": "D", "npn": "Q", "pnp": "Q", "capacitor": "C", "ground": "G", "voltage_probe": "P", "current_probe": "I"}
_DEFAULTS = {"resistor": 1000.0, "voltage_source": 5.0, "switch": 0.0, "button": 0.0, "diode": 0.0, "npn": 0.0, "pnp": 0.0, "capacitor": 1e-6, "ground": 0.0, "voltage_probe": 0.0, "current_probe": 0.0}
_NAMES = {"resistor": "Résistance", "voltage_source": "Source de tension", "switch": "Interrupteur", "button": "Bouton poussoir", "diode": "Diode", "npn": "Transistor NPN", "pnp": "Transistor PNP", "capacitor": "Condensateur", "ground": "Masse", "voltage_probe": "Sonde de tension", "current_probe": "Sonde de courant"}
_UNITS = {"resistor": "Ω", "potentiometer": "Ω", "voltage_source": "V", "capacitor": "F"}
_ROLES = {"p": "Borne positive / entrée du courant conventionnel", "n": "Borne négative / sortie du courant conventionnel", "w": "Curseur du potentiomètre", "a": "Anode", "k": "Cathode", "c": "Collecteur", "b": "Base", "e": "Émetteur", "g": "Référence 0 V"}
_PREFIXES.update(led="LED", potentiometer="RV")
_DEFAULTS.update(led=0.0, potentiometer=10000.0)
_NAMES.update(led="DEL lumineuse", potentiometer="Potentiomètre")
_LED_MODELS = {
    "generic_led_red": "DEL rouge générique",
    "generic_led_green": "DEL verte générique",
    "generic_led_blue": "DEL bleue générique",
}


def catalog() -> dict[str, dict]:
    """Brochages pédagogiques explicites, jamais déduits d'un dessin."""
    entries = {}
    for kind, pins in _PIN_NAMES.items():
        model_id = f"generic_{kind}" if kind in ("diode", "npn", "pnp") else None
        entries[kind] = {
            "kind": kind, "name": _NAMES[kind], "unit": _UNITS.get(kind, ""),
            "default_value": _DEFAULTS[kind],
            "pins": [{"name": pin, "label": pin.upper(), "role": _ROLES[pin], "package_pin": i + 1} for i, pin in enumerate(pins)],
            "package": {"name": "Boîtier pédagogique explicite", "pin_map": {str(i + 1): pin for i, pin in enumerate(pins)}, "warning": "Ce brochage pédagogique ne définit aucun brochage constructeur. Lire la fiche du composant réel."},
            "models": ([{"id": model_id, "label": f"Modèle générique {kind.upper()}", "origin": "generic", "assumptions": ["Paramètres représentatifs, aucun fabricant certifié.", "La simulation ne valide pas le montage physique."]}] if model_id else []),
        }
        if kind == "led":
            entries[kind]["models"] = [{
                "id": model, "label": label, "origin": "generic",
                "assumptions": ["Jonction représentative à 27 °C, aucun fabricant certifié.", "Courant de référence maximal pédagogique : 20 mA ; ajouter une résistance série.", "La lumière visualisée n'est pas une mesure de flux lumineux."],
            } for model, label in _LED_MODELS.items()]
        elif kind == "potentiometer":
            entries[kind]["default_position"] = 0.5
            entries[kind]["assumptions"] = ["Piste linéaire : R(p,w) = position × R totale ; R(w,n) = (1 − position) × R totale.", "Chaque segment est limité à 1 mΩ minimum pour éviter un court-circuit numérique idéal.", "La position 0 place le curseur du côté p ; la position 1 du côté n."]
    return entries


def _identifier(value: Any, label: str = "Identifiant") -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(f"{label} invalide : lettres, chiffres, points, tirets et soulignés uniquement (80 caractères).")
    return value


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ValueError(f"{label} doit être un nombre fini.")
    try:
        converted = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"{label} dépasse les limites numériques.") from exc
    if not math.isfinite(converted):
        raise ValueError(f"{label} doit être un nombre fini.")
    return converted


def _value(kind: str, value: Any) -> float:
    value = _number(value, "Valeur")
    if kind == "resistor" and not 1e-6 <= value <= 1e15:
        raise ValueError("La résistance doit être comprise entre 1 µΩ et 10^15 Ω.")
    if kind == "potentiometer" and not 1 <= value <= 1e9:
        raise ValueError("La résistance totale du potentiomètre doit être comprise entre 1 Ω et 1 GΩ.")
    if kind == "capacitor" and not 1e-15 <= value <= 100:
        raise ValueError("La capacité doit être comprise entre 10^-15 F et 100 F.")
    if kind == "voltage_source" and abs(value) > 1e6:
        raise ValueError("La source est limitée à ±1 MV dans ce simulateur.")
    if kind in ("switch", "button") and value not in (0, 1):
        raise ValueError("Un interrupteur utilise 0 (ouvert) ou 1 (fermé).")
    return value


def _position(value: Any) -> float:
    position = _number(value, "Position du curseur")
    if not 0 <= position <= 1:
        raise ValueError("La position du curseur doit être comprise entre 0 et 1.")
    return position


def validate_source_waveform(value: Any) -> dict | None:
    """Normalise un stimulus typé ; aucune chaîne SPICE n'est acceptée."""
    if value is None:
        return None
    numeric_fields = ("low", "high", "delay", "rise", "fall", "width", "period")
    if not isinstance(value, dict) or set(value) != {"kind", *numeric_fields} or value.get("kind") != "pulse":
        raise ValueError("Stimulus attendu : pulse avec low, high, delay, rise, fall, width et period uniquement.")
    normalized = {key: _number(value[key], f"Stimulus {key}") for key in numeric_fields}
    if any(abs(normalized[key]) > 1e6 for key in ("low", "high")):
        raise ValueError("Les niveaux du stimulus sont limités à ±1 MV.")
    if normalized["delay"] < 0 or any(normalized[key] <= 0 for key in ("rise", "fall", "width", "period")):
        raise ValueError("Le retard doit être positif ou nul ; montée, descente, largeur et période doivent être strictement positives.")
    occupied = normalized["rise"] + normalized["width"] + normalized["fall"]
    if occupied > normalized["period"] and not math.isclose(occupied, normalized["period"], rel_tol=1e-12, abs_tol=0):
        raise ValueError("La montée, la largeur haute et la descente doivent tenir dans la période.")
    return {"kind": "pulse", **normalized}


def _wire_style(value: dict) -> dict:
    style = {}
    if "color" in value:
        color = value["color"]
        if color is not None and (not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color)):
            raise ValueError("La couleur du fil doit être au format #RRGGBB ou null.")
        style["color"] = color
    if "waypoints" in value:
        points = value["waypoints"]
        if not isinstance(points, list) or len(points) > 32:
            raise ValueError("Un fil admet au plus 32 points de passage.")
        normalized = []
        for point in points:
            if not isinstance(point, dict) or set(point) != {"x", "y"}:
                raise ValueError("Chaque point de passage doit définir x et y uniquement.")
            coordinate = {axis: _number(point[axis], f"Point de passage {axis}") for axis in ("x", "y")}
            if any(abs(position) > 1e6 for position in coordinate.values()):
                raise ValueError("Les points de passage sont limités à ±1 000 000 unités.")
            normalized.append(coordinate)
        style["waypoints"] = normalized
    return style


def _make_component(kind: str, cid: str, value: Any = None, label: str | None = None, model: str | None = None, waveform: Any = None) -> dict:
    if not isinstance(kind, str) or kind not in _PIN_NAMES:
        raise ValueError(f"Type de composant inconnu : {kind}.")
    _identifier(cid)
    if label is not None and (not isinstance(label, str) or len(label) > 160):
        raise ValueError("Le libellé doit être un texte de 160 caractères maximum.")
    if model is not None and not isinstance(model, str):
        raise ValueError("Le modèle doit être un identifiant textuel ou null.")
    model = model or ("generic_led_red" if kind == "led" else f"generic_{kind}" if kind in ("diode", "npn", "pnp") else None)
    allowed = [m["id"] for m in catalog()[kind]["models"]]
    if model is not None and model not in allowed:
        raise ValueError(f"Modèle {model} indisponible pour {kind}.")
    component = {"id": cid, "kind": kind, "label": str(label or cid)[:160], "value": _value(kind, _DEFAULTS[kind] if value is None else value), "model": model, "pins": {pin: f"{cid}.{pin}" for pin in _PIN_NAMES[kind]}}
    if kind == "potentiometer":
        component["position"] = 0.5
    if waveform is not None:
        if kind != "voltage_source":
            raise ValueError("Un stimulus temporel concerne uniquement une source de tension.")
        component["waveform"] = validate_source_waveform(waveform)
    return component


def new_project(empty: bool = False) -> dict:
    project = {"schema_version": 1, "id": f"project_{uuid.uuid4().hex[:12]}", "title": "Loi d’Ohm · 5 V / 1 kΩ", "revision": 0, "components": [], "wires": [], "junctions": [], "schematic": {}, "net_labels": {}, "breadboard": {"placements": {}, "rail_splits": True}, "ui": {"selected": [], "view": "split", "highlights": [], "annotations": []}}
    if empty:
        project["title"] = "Nouveau circuit"
        return project
    project["components"] = [_make_component("voltage_source", "V1"), _make_component("resistor", "R1"), _make_component("ground", "G1")]
    project["schematic"] = {"V1": {"x": 180, "y": 180, "rotation": 90}, "R1": {"x": 400, "y": 130, "rotation": 0}, "G1": {"x": 300, "y": 300, "rotation": 0}}
    project["wires"] = [{"id": "W1", "a": "V1.p", "b": "R1.p"}, {"id": "W2", "a": "R1.n", "b": "G1.g"}, {"id": "W3", "a": "V1.n", "b": "G1.g"}]
    # Les deux bornes d'une résistance occupent deux bandes distinctes.
    project["breadboard"]["placements"] = {"V1.p": "a4", "R1.p": "e4", "R1.n": "e12", "V1.n": "a12", "G1.g": "b12"}
    return project


class _UnionFind:
    def __init__(self):
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def join(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def breadboard_groups(rail_splits: bool = True) -> list[list[str]]:
    groups = [[f"{row}{col}" for row in side] for col in range(1, 31) for side in ("abcde", "fghij")]
    for position in ("top", "bottom"):
        for polarity in ("p", "n"):
            ranges = ((1, 16), (16, 31)) if rail_splits else ((1, 31),)
            groups.extend([[f"rail_{position}_{polarity}{col}" for col in range(start, stop)] for start, stop in ranges])
    return groups


def _holes() -> set[str]:
    return {hole for group in breadboard_groups() for hole in group}


def topology(project: dict) -> dict:
    uf = _UnionFind()
    components = project.get("components", [])
    terminals = {pid for comp in components for pid in comp.get("pins", {}).values()}
    junctions = {j["id"] for j in project.get("junctions", [])}
    points = terminals | junctions
    for point in points:
        uf.find(point)
    groups = breadboard_groups(project.get("breadboard", {}).get("rail_splits", True))
    for group in groups:
        for hole in group:
            uf.join(group[0], hole)
    for terminal, hole in project.get("breadboard", {}).get("placements", {}).items():
        if terminal in points and hole in _holes():
            uf.join(terminal, hole)
    for wire in project.get("wires", []):
        if wire["a"] in points and wire["b"] in points:
            uf.join(wire["a"], wire["b"])
    # Toutes les masses représentent explicitement la même référence électrique.
    grounds = [comp["pins"]["g"] for comp in components if comp["kind"] == "ground"]
    for ground in grounds[1:]:
        uf.join(grounds[0], ground)
    ground_root = uf.find(grounds[0]) if grounds else None
    members: dict[str, list[str]] = {}
    for point in sorted(uf.parent):
        members.setdefault(uf.find(point), []).append(point)
    root_to_net = {}
    nets = []
    for root, all_points in sorted(members.items()):
        logical = sorted(set(all_points) & points)
        # Identité fondée sur les bornes/jonctions plutôt que sur une coordonnée.
        anchor = logical[0] if logical else all_points[0]
        nid = "0" if root == ground_root else f"net_{hashlib.sha1(anchor.encode()).hexdigest()[:10]}"
        root_to_net[root] = nid
        if logical:
            labels = project.get("net_labels", {})
            explicit = [labels[point] for point in logical if point in labels]
            name = explicit[0] if explicit else ("Masse · 0 V" if nid == "0" else anchor)
            nets.append({"id": nid, "name": name, "points": logical, "terminals": sorted(set(logical) & terminals), "holes": sorted(set(all_points) - points)})
    terminal_to_net = {point: root_to_net[uf.find(point)] for point in sorted(points)}
    hole_to_net = {hole: root_to_net[uf.find(hole)] for hole in sorted(_holes())}
    return {"nets": nets, "terminal_to_net": terminal_to_net, "hole_to_net": hole_to_net}


def _diag(code: str, category: str, severity: str, message: str, targets: list[str], explanation: str) -> dict:
    return {"code": code, "category": category, "severity": severity, "message": message, "targets": targets, "explanation": explanation}


def validate_topology(project: dict) -> list[dict]:
    diagnostics = []
    components = project.get("components", [])
    topo = topology(project)
    mapping = topo["terminal_to_net"]
    if components and not any(comp["kind"] == "ground" for comp in components):
        diagnostics.append(_diag("missing_ground", "connection", "error", "Aucune référence de masse n'est définie.", [], "Le solveur doit disposer d'une référence 0 V. Ajouter une masse et la relier au retour prévu par le circuit."))
    for comp in components:
        nets = [mapping[p] for p in comp["pins"].values()]
        source_levels = [comp["waveform"].get("low"), comp["waveform"].get("high")] if isinstance(comp.get("waveform"), dict) else [comp["value"]]
        if comp["kind"] == "voltage_source" and len(set(nets)) == 1 and any(level != 0 for level in source_levels):
            diagnostics.append(_diag("shorted_source", "connection", "error", f"Les deux bornes de {comp['id']} sont en court-circuit.", [comp["id"]], "Une même connexion impose 0 V entre ces bornes alors que la source impose une tension non nulle. Vérifier fils et bandes de breadboard."))
        if comp["kind"] not in ("ground", "voltage_probe") and len(nets) > 1 and len(set(nets)) == 1:
            diagnostics.append(_diag("bypassed_component", "connection", "warning", f"Toutes les bornes de {comp['id']} sont sur le même réseau.", [comp["id"]], "Le câblage contourne ce composant ; aucune tension différente ne peut exister entre ses bornes."))
    net_components: dict[str, list[dict]] = {}
    for comp in components:
        for nid in set(mapping[pid] for pid in comp["pins"].values()):
            net_components.setdefault(nid, []).append(comp)
    for net in topo["nets"]:
        attached = net_components.get(net["id"], [])
        if net["id"] == "0" and attached and all(comp["kind"] == "ground" for comp in attached) and any(comp["kind"] != "ground" for comp in components):
            diagnostics.append(_diag("isolated_ground", "connection", "error", "La masse ne rejoint aucun autre composant.", net["points"], "La référence 0 V est isolée. Aucun fil ni bande de breadboard ne relie cette masse au circuit ; vérifier le retour prévu."))
        if net["id"] != "0" and len(attached) == 1:
            diagnostics.append(_diag("dangling_terminal", "connection", "warning", f"Le réseau {net['name']} n'atteint qu'un composant.", net["points"], "Cette borne est électriquement isolée du reste du montage, sauf chemin interne au composant. Vérifier si cette absence de connexion est intentionnelle."))
        if net["id"] != "0" and attached and all(comp["kind"] in ("capacitor", "voltage_probe", "diode", "npn", "pnp") for comp in attached):
            diagnostics.append(_diag("weak_dc_reference", "hypothesis", "info", f"Le réseau {net['name']} pourrait manquer de référence continue forte.", [comp["id"] for comp in attached], "Condensateurs ouverts en continu et jonctions bloquées peuvent laisser ce point très peu chargé. Une résistance de rappel peut aider à définir son potentiel ; sa valeur et son effet doivent être testés, cet ajout n'est pas une correction démontrée."))
    # Connectivité des îlots en tenant compte des composants (capacités exclues en DC).
    adjacency: dict[str, set[str]] = {net["id"]: set() for net in topo["nets"]}
    for comp in components:
        if comp["kind"] in ("capacitor", "voltage_probe"):
            continue
        nets = [mapping[pid] for pid in comp["pins"].values()]
        for a in nets:
            adjacency[a].update(nets)
    visited, stack = set(), ["0"] if "0" in adjacency else []
    while stack:
        here = stack.pop()
        if here in visited:
            continue
        visited.add(here)
        stack.extend(adjacency[here] - visited)
    floating = sorted(set(adjacency) - visited)
    if floating and "0" in adjacency:
        diagnostics.append(_diag("floating_island", "hypothesis", "warning", "Un îlot n'a pas de chemin continu vers la masse.", floating, "Son potentiel absolu peut être indéterminé. Les chemins par jonctions dépendent de leur polarisation ; examiner la topologie et les diagnostics ngspice avant de proposer une résistance de rappel."))
    return diagnostics


def _net_label(value: Any, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > 80 or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError("Un nom de réseau doit être un texte de 80 caractères maximum, sans caractère de contrôle.")
    value = value.strip()
    if not value and not allow_empty:
        raise ValueError("Un nom de réseau ne peut pas être vide.")
    return value


def _string_list(value: Any, label: str, maximum: int = 2000) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum or not all(isinstance(item, str) and 1 <= len(item) <= 100 for item in value):
        raise ValueError(f"{label} doit être une liste de {maximum} identifiants textuels maximum.")
    return value


def _validate_ui(ui: Any) -> None:
    if not isinstance(ui, dict) or ui.get("view") not in ("split", "schematic", "breadboard"):
        raise ValueError("Vue inconnue.")
    for field in ("selected", "highlights"):
        _string_list(ui.get(field), f"ui.{field}")
    annotations = ui.get("annotations")
    if not isinstance(annotations, list) or len(annotations) > 500:
        raise ValueError("ui.annotations doit contenir au plus 500 annotations.")
    ids = set()
    for note in annotations:
        if not isinstance(note, dict):
            raise ValueError("Chaque annotation doit être un objet.")
        note_id = _identifier(note.get("id"), "Identifiant d'annotation")
        if note_id in ids:
            raise ValueError("Identifiant d'annotation dupliqué.")
        ids.add(note_id)
        text = note.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 5000:
            raise ValueError("L'annotation doit contenir de 1 à 5000 caractères.")
        _string_list(note.get("targets", []), "Cibles d'annotation")


def _validate_optional_fields(project: dict) -> None:
    for key in ("description", "breadboard_note"):
        if key in project and (not isinstance(project[key], str) or len(project[key]) > 10_000):
            raise ValueError(f"{key} doit être un texte de 10000 caractères maximum.")
    if "metadata" in project and not isinstance(project["metadata"], dict):
        raise ValueError("metadata doit être un objet JSON.")
    if "pedagogy" in project and not isinstance(project["pedagogy"], dict):
        raise ValueError("pedagogy doit être un objet JSON.")
    if "default_analysis" in project:
        analysis = project["default_analysis"]
        if not isinstance(analysis, dict) or analysis.get("kind") not in ("op", "tran"):
            raise ValueError("default_analysis doit définir kind = op ou tran.")
        for key in ("step", "stop"):
            if key in analysis and _number(analysis[key], key) <= 0:
                raise ValueError(f"{key} doit être strictement positif.")
        if "startup" in analysis and not isinstance(analysis["startup"], bool):
            raise ValueError("startup doit être un booléen.")
    if "truth_table" in project:
        spec = project["truth_table"]
        if not isinstance(spec, dict):
            raise ValueError("truth_table doit être un objet JSON.")
        for key in ("inputs", "outputs"):
            mapping = spec.get(key)
            if not isinstance(mapping, dict) or not 1 <= len(mapping) <= 32 or not all(isinstance(label, str) and 1 <= len(label) <= 100 and isinstance(target, str) and 1 <= len(target) <= 100 for label, target in mapping.items()):
                raise ValueError(f"truth_table.{key} doit associer des noms à des identifiants textuels.")
        cases = spec.get("cases")
        if not isinstance(cases, list) or not 1 <= len(cases) <= 32:
            raise ValueError("truth_table.cases doit contenir de 1 à 32 cas.")
        for case in cases:
            if not isinstance(case, dict):
                raise ValueError("Chaque cas de table de vérité doit être un objet.")
            for key, labels in (("inputs", spec["inputs"]), ("expected", spec["outputs"])):
                values = case.get(key)
                if not isinstance(values, dict) or set(values) != set(labels) or any(type(bit) is not int or bit not in (0, 1) for bit in values.values()):
                    raise ValueError(f"Chaque cas doit définir {key} avec un bit 0 ou 1 pour chaque nom.")
        if "thresholds" in spec:
            limits = spec["thresholds"]
            if not isinstance(limits, dict):
                raise ValueError("Les seuils doivent être un objet.")
            low, high = _number(limits.get("low"), "Seuil bas"), _number(limits.get("high"), "Seuil haut")
            if not 0 <= low < high <= 5:
                raise ValueError("Seuils : 0 ≤ bas < haut ≤ 5 V requis.")


def validate_project(project: dict) -> dict:
    """Rejette les documents malformés avant d'atteindre calcul ou interface."""
    if not isinstance(project, dict) or type(project.get("schema_version")) is not int or project.get("schema_version") != 1:
        raise ValueError("Format de projet non pris en charge : schema_version doit valoir 1.")
    _identifier(project.get("id"), "Identifiant de projet")
    if type(project.get("revision")) is not int or project["revision"] < 0:
        raise ValueError("La révision doit être un entier positif ou nul.")
    if not isinstance(project.get("title"), str) or not project["title"].strip() or len(project["title"]) > 200:
        raise ValueError("Le titre doit contenir de 1 à 200 caractères.")
    for field in ("components", "wires", "junctions"):
        if not isinstance(project.get(field), list):
            raise ValueError(f"Le champ {field} doit être une liste.")
        if not all(isinstance(item, dict) for item in project[field]):
            raise ValueError(f"Chaque entrée de {field} doit être un objet.")
    if len(project["components"]) > 300 or len(project["wires"]) > 1200 or len(project["junctions"]) > 1000:
        raise ValueError("Limite de taille : 300 composants, 1200 fils et 1000 jonctions.")
    ids, terminals = set(), set()
    for comp in project["components"]:
        cid, kind = _identifier(comp.get("id")), comp.get("kind")
        if cid in ids:
            raise ValueError(f"Identifiant dupliqué : {cid}.")
        ids.add(cid)
        if not isinstance(kind, str) or kind not in _PIN_NAMES:
            raise ValueError(f"Type inconnu : {kind}.")
        expected = {name: f"{cid}.{name}" for name in _PIN_NAMES[kind]}
        if not isinstance(comp.get("pins"), dict) or comp["pins"] != expected:
            raise ValueError(f"Brochage explicite incohérent pour {cid} : attendu {expected}.")
        if terminals & set(expected.values()):
            raise ValueError("Identifiants de bornes dupliqués.")
        terminals.update(expected.values())
        _value(kind, comp.get("value"))
        if not isinstance(comp.get("label"), str) or len(comp["label"]) > 160:
            raise ValueError("Chaque composant doit définir un libellé textuel de 160 caractères maximum.")
        if "initial_voltage" in comp:
            _number(comp["initial_voltage"], "Tension initiale")
        if kind == "potentiometer":
            _position(comp.get("position", 0.5))
        elif "position" in comp:
            raise ValueError("Seul un potentiomètre possède une position de curseur.")
        if "waveform" in comp:
            if kind != "voltage_source":
                raise ValueError("Un stimulus temporel concerne uniquement une source de tension.")
            validate_source_waveform(comp["waveform"])
        _make_component(kind, cid, comp["value"], comp["label"], comp.get("model"), comp.get("waveform"))
    if ids & terminals:
        raise ValueError("Un identifiant de composant entre en collision avec une borne.")
    junction_ids = set()
    for junction in project["junctions"]:
        jid = _identifier(junction.get("id"))
        if jid in _holes():
            raise ValueError("Un identifiant de jonction ne peut pas être celui d’un trou de breadboard.")
        if jid in ids or jid in terminals:
            raise ValueError(f"Identifiant dupliqué : {jid}.")
        ids.add(jid)
        junction_ids.add(jid)
        _number(junction.get("x"), "Position x")
        _number(junction.get("y"), "Position y")
    for wire in project["wires"]:
        wid = _identifier(wire.get("id"))
        if wid in ids or wid in terminals:
            raise ValueError(f"Identifiant dupliqué : {wid}.")
        ids.add(wid)
        a, b = _identifier(wire.get("a"), "Extrémité a"), _identifier(wire.get("b"), "Extrémité b")
        if a not in terminals | junction_ids or b not in terminals | junction_ids:
            raise ValueError(f"Le fil {wid} référence une borne ou une jonction absente.")
        if a == b:
            raise ValueError(f"Le fil {wid} revient sur la même borne.")
        _wire_style(wire)
    schematic = project.get("schematic")
    if not isinstance(schematic, dict):
        raise ValueError("Positions schématiques manquantes.")
    comp_ids = {comp["id"] for comp in project["components"]}
    for cid in comp_ids:
        position = schematic.get(cid)
        if not isinstance(position, dict):
            raise ValueError(f"Position schématique absente pour {cid}.")
        _number(position.get("x"), "Position x")
        _number(position.get("y"), "Position y")
        rotation = _number(position.get("rotation", 0), "Rotation")
        if rotation % 90:
            raise ValueError("La rotation doit être un multiple de 90°.")
    board = project.get("breadboard")
    if not isinstance(board, dict) or not isinstance(board.get("placements"), dict) or not isinstance(board.get("rail_splits"), bool):
        raise ValueError("Configuration de breadboard invalide.")
    holes = _holes()
    for terminal, hole in board["placements"].items():
        if not isinstance(terminal, str) or not isinstance(hole, str) or terminal not in terminals | junction_ids or hole not in holes:
            raise ValueError(f"Placement breadboard invalide : {terminal} → {hole}.")
    if len(set(board["placements"].values())) != len(board["placements"]):
        raise ValueError("Deux bornes ne peuvent pas occuper le même trou ; employer deux trous de la même bande.")
    footprints = board.get("footprints", {})
    if not isinstance(footprints, dict):
        raise ValueError("Les empreintes de breadboard doivent être un objet.")
    components_by_id = {comp["id"]: comp for comp in project["components"]}
    for cid, footprint in footprints.items():
        if cid not in components_by_id or not isinstance(footprint, dict):
            raise ValueError("Une empreinte référence un composant absent ou un format invalide.")
        if footprint.get("kind") not in ("axial", "radial", "transistor", "external") or footprint.get("package") != "pedagogical":
            raise ValueError("Empreinte pédagogique inconnue ; aucun brochage constructeur ne peut être déduit.")
        if footprint.get("orientation") not in ("horizontal", "vertical") or not isinstance(footprint.get("pins"), dict):
            raise ValueError("Orientation ou brochage d'empreinte invalide.")
        expected_holes = {name: board["placements"][terminal] for name, terminal in components_by_id[cid]["pins"].items() if terminal in board["placements"]}
        if footprint["pins"] != expected_holes:
            raise ValueError("Les bornes de l'empreinte doivent correspondre aux trous réellement occupés.")
    labels = project.get("net_labels", {})
    if not isinstance(labels, dict):
        raise ValueError("net_labels doit associer des bornes ou jonctions à des noms textuels.")
    for terminal, name in labels.items():
        if not isinstance(terminal, str) or terminal not in terminals | junction_ids:
            raise ValueError("Un nom de réseau référence une borne ou jonction absente.")
        _net_label(name)
    for net in topology(project)["nets"]:
        names = {labels[point] for point in net["points"] if point in labels}
        if len(names) > 1:
            raise ValueError("Plusieurs noms différents désignent le même réseau ; choisissez un seul nom explicite.")
    _validate_ui(project.get("ui"))
    _validate_optional_fields(project)
    try:
        encoded = json.dumps(project, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise ValueError("Le projet doit être un document JSON valide.") from exc
    if len(encoded.encode()) > 2_000_000:
        raise ValueError("Le projet dépasse la limite de 2 Mo.")
    return project


def circuit_fingerprint(project: dict) -> str:
    """Empreinte de l'état électrique ; ignore présentation, notes et révision.

    Les identifiants sont conservés car les résultats de mesures les utilisent.
    L'ordre des listes de composants/fils n'a en revanche aucun effet.
    """
    electrical_fields = ("id", "kind", "value", "model", "pins", "initial_voltage", "position")
    def electrical_component(comp: dict) -> dict:
        result = {key: comp[key] for key in electrical_fields if key in comp}
        if comp["kind"] == "potentiometer":
            result["position"] = comp.get("position", 0.5)
        if comp.get("waveform") is not None:
            result["waveform"] = validate_source_waveform(comp["waveform"])
        for key in ("value", "initial_voltage", "position"):
            if key in result:
                result[key] = float(result[key])
        return result
    canonical = {
        "components": sorted((electrical_component(comp) for comp in project["components"]), key=lambda comp: comp["id"]),
        "wires": sorted(({"id": wire["id"], "a": wire["a"], "b": wire["b"]} for wire in project["wires"]), key=lambda wire: wire["id"]),
        "junctions": sorted(junction["id"] for junction in project["junctions"]),
        "placements": project["breadboard"]["placements"],
        "rail_splits": project["breadboard"]["rail_splits"],
    }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class Store:
    """État local unique, verrouillé et révisions monotones, avec sauvegarde atomique."""
    def __init__(self, project: dict | None = None, path: str | Path | None = None):
        self.lock = threading.RLock()
        self.path = Path(path) if path else None
        if project is None and self.path and self.path.exists():
            project = json.loads(self.path.read_text(encoding="utf-8"))
        self.project = deepcopy(project if project is not None else new_project())
        validate_project(self.project)
        self.simulation: dict = {"status": "idle", "voltages": {}, "currents": {}, "curves": [], "time": [], "diagnostics": [], "project_revision": None}
        self._undo: list[dict] = []
        self._redo: list[dict] = []
        self._transient_ui_fields: set[str] = set()

    def get_state(self) -> dict:
        with self.lock:
            return self._state(self.project)

    def _state(self, project: dict) -> dict:
        simulation = deepcopy(self.simulation)
        fingerprint = simulation.get("circuit_fingerprint")
        simulation["stale"] = fingerprint != circuit_fingerprint(project) if isinstance(fingerprint, str) else simulation.get("project_revision") is not None and simulation.get("project_revision") != project["revision"]
        return {"project": deepcopy(project), "topology": topology(project), "catalog": catalog(), "simulation": simulation, "diagnostics": validate_topology(project), "history": {"can_undo": bool(self._undo), "can_redo": bool(self._redo)}}

    def _check_revision(self, expected_revision: Any) -> None:
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision != self.project["revision"]:
            raise ValueError(f"Conflit de révision : attendue {expected_revision}, actuelle {self.project['revision']}. Relire le circuit avant de modifier.")

    def _persist(self, project: dict) -> None:
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix(self.path.suffix + ".tmp")
            temp.write_text(json.dumps(project, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
            temp.replace(self.path)

    def save(self) -> dict:
        with self.lock:
            self._persist(self.project)
            return self.get_state()

    def replace_project(self, project: dict, expected_revision: int) -> dict:
        with self.lock:
            self._check_revision(expected_revision)
            if not isinstance(project, dict):
                raise ValueError("Le projet doit être un objet JSON versionné.")
            candidate = deepcopy(project)
            candidate["revision"] = self.project["revision"] + 1
            validate_project(candidate)
            self._persist(candidate)
            self._undo.append(deepcopy(self.project))
            self._undo = self._undo[-100:]
            self._redo.clear()
            self._transient_ui_fields.clear()
            self.project = candidate
            return self.get_state()

    def replace(self, project: dict, expected_revision: int) -> dict:
        return self.replace_project(project, expected_revision)

    def transact(self, expected_revision: int, operations: list[dict], preview: bool = False) -> dict:
        with self.lock:
            self._check_revision(expected_revision)
            if not isinstance(preview, bool):
                raise ValueError("preview doit être un booléen.")
            if not isinstance(operations, list) or not 1 <= len(operations) <= 500:
                raise ValueError("Une transaction doit contenir de 1 à 500 opérations.")
            candidate = deepcopy(self.project)
            for operation in operations:
                if not isinstance(operation, dict):
                    raise ValueError("Chaque opération doit être un objet.")
                self._apply(candidate, operation)
            candidate["revision"] = self.project["revision"] if preview else self.project["revision"] + 1
            validate_project(candidate)
            if preview:
                result = self._state(candidate)
                result["preview"] = True
                result["base_revision"] = self.project["revision"]
                return result
            self._persist(candidate)
            presentation_only = all(operation['type'] == 'set_ui' for operation in operations)
            if presentation_only:
                self._transient_ui_fields.update(
                    field for operation in operations
                    for field in ('selected', 'view', 'highlights') if field in operation
                )
            else:
                self._undo.append(deepcopy(self.project))
                self._undo = self._undo[-100:]
                self._redo.clear()
                self._transient_ui_fields.clear()
            self.project = candidate
            return self.get_state()

    def undo(self, expected_revision: int) -> dict:
        return self._restore(expected_revision, self._undo, self._redo, "annuler")

    def redo(self, expected_revision: int) -> dict:
        return self._restore(expected_revision, self._redo, self._undo, "rétablir")

    def _restore(self, expected_revision: int, source: list, target: list, action: str) -> dict:
        with self.lock:
            self._check_revision(expected_revision)
            if not source:
                raise ValueError(f"Aucune modification à {action}.")
            candidate = deepcopy(source[-1])
            if candidate['id'] == self.project['id']:
                for field in self._transient_ui_fields:
                    value = deepcopy(self.project['ui'][field])
                    if field in ('selected', 'highlights'):
                        known = (
                            {component['id'] for component in candidate['components']}
                            | {pin for component in candidate['components'] for pin in component['pins'].values()}
                            | {wire['id'] for wire in candidate['wires']}
                            | {junction['id'] for junction in candidate['junctions']}
                            | {net['id'] for net in topology(candidate)['nets']}
                            | _holes()
                        )
                        value = [identifier for identifier in value if identifier in known]
                    candidate['ui'][field] = value
            candidate["revision"] = self.project["revision"] + 1
            validate_project(candidate)
            self._persist(candidate)
            source.pop()
            target.append(deepcopy(self.project))
            self._transient_ui_fields.clear()
            self.project = candidate
            return self.get_state()

    def _apply(self, project: dict, op: dict) -> None:
        kind = op.get("type")
        if not isinstance(kind, str):
            raise ValueError("Le type d’opération doit être un texte.")
        if "id" in op and op["id"] is not None:
            _identifier(op["id"])
        comps = {c["id"]: c for c in project["components"]}
        all_ids = set(comps) | {w["id"] for w in project["wires"]} | {j["id"] for j in project["junctions"]}
        terminals = {pin for c in comps.values() for pin in c["pins"].values()}
        def fresh(prefix: str) -> str:
            n = 1
            while f"{prefix}{n}" in all_ids:
                n += 1
            return f"{prefix}{n}"
        def component() -> dict:
            _identifier(op.get("id"), "Identifiant du composant")
            if op.get("id") not in comps:
                raise ValueError(f"Composant absent : {op.get('id')}.")
            return comps[op["id"]]
        if kind == "add_component":
            ckind = op.get("kind")
            if not isinstance(ckind, str) or ckind not in _PIN_NAMES:
                raise ValueError(f"Type de composant inconnu : {ckind}.")
            cid = op.get("id") or fresh(_PREFIXES[ckind])
            if cid in all_ids:
                raise ValueError(f"Identifiant déjà utilisé : {cid}.")
            comp = _make_component(ckind, cid, op.get("value"), op.get("label"), op.get("model"), op.get("waveform"))
            if ckind == "potentiometer":
                comp["position"] = _position(op.get("position", 0.5))
            if "initial_voltage" in op:
                if ckind != "capacitor":
                    raise ValueError("La tension initiale concerne uniquement un condensateur.")
                comp["initial_voltage"] = _number(op["initial_voltage"], "Tension initiale")
            project["components"].append(comp)
            project["schematic"][cid] = {"x": _number(op.get("x", 300), "Position x"), "y": _number(op.get("y", 200), "Position y"), "rotation": 0}
        elif kind == "move_component":
            comp = component()
            position = project["schematic"][comp["id"]]
            position["x"], position["y"] = _number(op.get("x"), "Position x"), _number(op.get("y"), "Position y")
            if "rotation" in op:
                position["rotation"] = _number(op["rotation"], "Rotation")
        elif kind == "set_value":
            comp = component()
            comp["value"] = _value(comp["kind"], op.get("value"))
        elif kind == "set_position":
            comp = component()
            if comp["kind"] != "potentiometer":
                raise ValueError("La position du curseur concerne uniquement un potentiomètre.")
            comp["position"] = _position(op.get("position"))
        elif kind == "set_waveform":
            comp = component()
            if comp["kind"] != "voltage_source":
                raise ValueError("Un stimulus temporel concerne uniquement une source de tension.")
            if "waveform" not in op:
                raise ValueError("Définir waveform avec un stimulus ou null pour revenir à une source continue.")
            waveform = validate_source_waveform(op["waveform"])
            if waveform is None:
                comp.pop("waveform", None)
            else:
                comp["waveform"] = waveform
        elif kind == "set_model":
            comp = component()
            model = op.get("model")
            if model not in [m["id"] for m in catalog()[comp["kind"]]["models"]]:
                raise ValueError("Modèle non disponible pour ce composant.")
            comp["model"] = model
        elif kind == "connect":
            _identifier(op.get("a"), "Extrémité a")
            _identifier(op.get("b"), "Extrémité b")
            points = terminals | {j["id"] for j in project["junctions"]}
            if op.get("a") not in points or op.get("b") not in points:
                raise ValueError("Les deux extrémités du fil doivent exister.")
            if op["a"] == op["b"]:
                raise ValueError("Un fil doit relier deux points distincts.")
            if any({w["a"], w["b"]} == {op["a"], op["b"]} for w in project["wires"]):
                raise ValueError("Ce fil existe déjà.")
            wid = _identifier(op.get("id") or fresh("W"))
            if wid in all_ids:
                raise ValueError("Identifiant de fil déjà utilisé.")
            project["wires"].append({"id": wid, "a": op["a"], "b": op["b"], **_wire_style(op)})
        elif kind == "set_wire_style":
            wire = next((item for item in project["wires"] if item["id"] == op.get("id")), None)
            if wire is None:
                raise ValueError("Fil absent.")
            style = _wire_style(op)
            if not style:
                raise ValueError("Définir une couleur ou des points de passage pour ce fil.")
            wire.update(style)
        elif kind == "remove_component":
            comp = component()
            pins = set(comp["pins"].values())
            project["components"] = [c for c in project["components"] if c["id"] != comp["id"]]
            project["schematic"].pop(comp["id"], None)
            project["breadboard"].get("footprints", {}).pop(comp["id"], None)
            project["wires"] = [w for w in project["wires"] if w["a"] not in pins and w["b"] not in pins]
            for pin in pins:
                project["breadboard"]["placements"].pop(pin, None)
                project.get("net_labels", {}).pop(pin, None)
            project["ui"]["selected"] = [s for s in project["ui"]["selected"] if s != comp["id"] and s not in pins]
        elif kind == "remove_wire":
            if not any(w["id"] == op.get("id") for w in project["wires"]):
                raise ValueError("Fil absent.")
            project["wires"] = [w for w in project["wires"] if w["id"] != op["id"]]
        elif kind == "add_junction":
            jid = _identifier(op.get("id") or fresh("J"))
            if jid in _holes():
                raise ValueError("Un identifiant de jonction ne peut pas être celui d’un trou de breadboard.")
            if jid in all_ids or jid in terminals:
                raise ValueError("Identifiant de jonction déjà utilisé.")
            project["junctions"].append({"id": jid, "x": _number(op.get("x"), "Position x"), "y": _number(op.get("y"), "Position y")})
        elif kind == "move_junction":
            junction = next((item for item in project["junctions"] if item["id"] == op.get("id")), None)
            if junction is None:
                raise ValueError("Jonction absente.")
            junction["x"], junction["y"] = _number(op.get("x"), "Position x"), _number(op.get("y"), "Position y")
        elif kind == "remove_junction":
            if not any(j["id"] == op.get("id") for j in project["junctions"]):
                raise ValueError("Jonction absente.")
            project["junctions"] = [j for j in project["junctions"] if j["id"] != op["id"]]
            project["breadboard"]["placements"].pop(op["id"], None)
            project.get("net_labels", {}).pop(op["id"], None)
            project["wires"] = [w for w in project["wires"] if op["id"] not in (w["a"], w["b"])]
        elif kind == "place_pin":
            terminal, hole = op.get("terminal"), op.get("hole")
            _identifier(terminal, "Borne ou jonction")
            if hole is not None and not isinstance(hole, str):
                raise ValueError("Le trou doit être un identifiant textuel ou null.")
            if terminal not in terminals | {j["id"] for j in project["junctions"]}:
                raise ValueError("Borne ou jonction absente.")
            if hole is None:
                project["breadboard"]["placements"].pop(terminal, None)
            elif hole not in _holes():
                raise ValueError("Trou de breadboard inconnu.")
            else:
                occupied = {h: t for t, h in project["breadboard"]["placements"].items() if t != terminal}
                if hole in occupied:
                    raise ValueError(f"Le trou {hole} est déjà occupé par {occupied[hole]}.")
                project["breadboard"]["placements"][terminal] = hole
            for comp in project["components"]:
                for name, pin in comp["pins"].items():
                    if pin == terminal:
                        footprint = project["breadboard"].get("footprints", {}).get(comp["id"])
                        if footprint:
                            if hole is None:
                                footprint["pins"].pop(name, None)
                            else:
                                footprint["pins"][name] = hole
        elif kind == "layout_breadboard":
            from .breadboard_layout import plan_breadboard_layout
            planned = plan_breadboard_layout(project)
            project.clear()
            project.update(planned)
        elif kind == "set_net_label":
            terminal = _identifier(op.get("terminal"), "Borne ou jonction")
            if terminal not in terminals | {j["id"] for j in project["junctions"]}:
                raise ValueError("Borne ou jonction absente pour le nom de réseau.")
            name = _net_label(op.get("name"), allow_empty=True)
            net_id = topology(project)["terminal_to_net"][terminal]
            labels = project.setdefault("net_labels", {})
            members = next(net["points"] for net in topology(project)["nets"] if net["id"] == net_id)
            for point in members:
                labels.pop(point, None)
            if name:
                labels[terminal] = name
        elif kind == "set_ui":
            for field in ("selected", "highlights"):
                if field in op:
                    _string_list(op[field], field)
            if "view" in op and op["view"] not in ("split", "schematic", "breadboard"):
                raise ValueError("Vue inconnue.")
            for field in ("selected", "view", "highlights"):
                if field in op:
                    project["ui"][field] = deepcopy(op[field])
        elif kind == "annotate":
            text = op.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 5000:
                raise ValueError("L'annotation doit contenir entre 1 et 5000 caractères.")
            targets = op.get("targets", [])
            if not isinstance(targets, list) or not all(isinstance(t, str) and len(t) <= 100 for t in targets):
                raise ValueError("Les cibles d'annotation doivent être une liste d'identifiants.")
            project["ui"]["annotations"].append({"id": f"note_{uuid.uuid4().hex[:12]}", "text": text, "targets": targets})
            if len(project["ui"]["annotations"]) > 500:
                raise ValueError("Limite de 500 annotations atteinte.")
        elif kind == "set_title":
            if not isinstance(op.get("title"), str) or not 1 <= len(op["title"].strip()) <= 200:
                raise ValueError("Titre de 1 à 200 caractères requis.")
            project["title"] = op["title"].strip()
        elif kind == "set_rail_splits":
            if not isinstance(op.get("enabled"), bool):
                raise ValueError("enabled doit être un booléen.")
            project["breadboard"]["rail_splits"] = op["enabled"]
        else:
            raise ValueError(f"Opération inconnue : {kind}.")
