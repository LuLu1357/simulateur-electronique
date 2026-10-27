"""Exemples électriques réels. La logique du soustracteur est faite de BJT.

Les calculs Python des résultats attendus servent uniquement aux assertions de
la table ; les sorties observées viennent des tensions calculées par ngspice.
"""
from __future__ import annotations

from collections import defaultdict
import copy
from .domain import catalog, new_project


class Builder:
    def __init__(self, identifier: str, title: str, description: str):
        self.project = new_project(empty=True)
        self.project.update(id=f"demo_{identifier}", title=title, description=description)
        self.project["default_analysis"] = {"kind": "op"}
        self.net_pins: dict[str, list[str]] = defaultdict(list)
        self.count = 0

    def add(self, kind: str, cid: str, nets: dict[str, str], value: float | None = None, x: float | None = None, y: float | None = None, **extra) -> dict:
        entry = catalog()[kind]
        component = {"id": cid, "kind": kind, "label": cid, "value": entry["default_value"] if value is None else value, "model": f"generic_{kind}" if kind in ("npn", "pnp", "diode") else None, "pins": {pin["name"]: f"{cid}.{pin['name']}" for pin in entry["pins"]}, **extra}
        self.project["components"].append(component)
        self.project["schematic"][cid] = {"x": x if x is not None else 100 + (self.count % 6) * 150, "y": y if y is not None else 110 + (self.count // 6) * 130, "rotation": 0}
        self.count += 1
        for name, net in nets.items():
            self.net_pins[net].append(component["pins"][name])
        return component

    def finish(self) -> dict:
        for members in self.net_pins.values():
            for pin in members[1:]:
                self.project["wires"].append({"id": f"W{len(self.project['wires']) + 1}", "a": members[0], "b": pin})
        # Affectation sûre : chaque groupe métallique est dédié à un seul réseau.
        # Si une seule plaque ne suffit pas, laisser les dernières bornes hors
        # plaque ; leur câblage canonique reste explicite, jamais d'auto-court-circuit.
        groups = [[f"{row}{col}" for row in side] for col in range(1, 31) for side in ("abcde", "fghij")]
        placements = {}
        spare = iter(groups)
        for name, pins in self.net_pins.items():
            if name in ("gnd", "vcc"):
                # Les deux segments sont réellement réunis par les fils explicites
                # du schéma, et non supposés continus par leur couleur.
                row = "n" if name == "gnd" else "p"
                holes = [f"rail_{position}_{row}{i}" for position in ("top", "bottom") for i in range(1, 31)]
                for pin, hole in zip(pins, holes):
                    placements[pin] = hole
                continue
            for offset in range(0, len(pins), 5):
                holes = next(spare, None)
                if holes is None:
                    break
                for pin, hole in zip(pins[offset:offset + 5], holes):
                    placements[pin] = hole
        self.project["breadboard"]["placements"] = placements
        missing = sum(len(c["pins"]) for c in self.project["components"]) - len(placements)
        if missing:
            self.project["breadboard_note"] = f"{missing} bornes hors plaque : ce montage nécessite plusieurs breadboards. Les fils du modèle conservent le circuit complet ; les bornes hors plaque doivent encore être placées physiquement."
        return self.project


def ohm() -> dict:
    b = Builder("ohm", "Loi d’Ohm · 5 V / 1 kΩ", "Suivre le courant de la borne positive de la source, dans la résistance, puis jusqu’au retour : I = 5 V / 1 000 Ω = 5 mA.")
    b.add("voltage_source", "V1", {"p": "vcc", "n": "gnd"}, 5, 180, 180)
    b.add("resistor", "R1", {"p": "vcc", "n": "gnd"}, 1000, 400, 130)
    b.add("ground", "G1", {"g": "gnd"}, x=300, y=300)
    b.project["schematic"]["V1"]["rotation"] = 90
    return b.finish()


def divider() -> dict:
    b = Builder("divider", "Pont diviseur · deux résistances", "Deux résistances égales se partagent 5 V. Le point central atteint 2,5 V en l’absence de charge supplémentaire.")
    b.add("voltage_source", "V1", {"p": "vcc", "n": "gnd"}, 5, 100, 220)
    b.add("resistor", "R1", {"p": "vcc", "n": "out"}, 1000, 300, 130)
    b.add("resistor", "R2", {"p": "out", "n": "gnd"}, 1000, 500, 300)
    b.add("ground", "G1", {"g": "gnd"}, x=300, y=420)
    b.add("voltage_probe", "P1", {"p": "out", "n": "gnd"}, x=550, y=140)
    return b.finish()


def diode() -> dict:
    b = Builder("diode", "Diode · sens de conduction", "La résistance limite le courant ; la diode générique conduit de A vers K lorsque sa jonction est polarisée en direct. Inverser la source pour tester le blocage.")
    b.add("voltage_source", "V1", {"p": "vcc", "n": "gnd"}, 5, 100, 220)
    b.add("resistor", "R1", {"p": "vcc", "n": "junction"}, 1000, 300, 140)
    b.add("diode", "D1", {"a": "junction", "k": "gnd"}, x=500, y=250)
    b.add("ground", "G1", {"g": "gnd"}, x=300, y=400)
    return b.finish()


def transistor(pnp: bool = False) -> dict:
    kind = "pnp" if pnp else "npn"
    b = Builder(kind, f"Commande d’un {kind.upper()}", "Le courant de base commande le courant collecteur. Modèle générique et brochage pédagogique explicite C/B/E ; consulter la fiche du boîtier réel avant toute construction.")
    b.add("voltage_source", "V1", {"p": "vcc", "n": "gnd"}, 5, 80, 260)
    b.add("voltage_source", "Vin", {"p": "control", "n": "gnd"}, 0 if pnp else 5, 100, 100)
    b.add("resistor", "RB", {"p": "control", "n": "base"}, 10000, 300, 100)
    b.add("resistor", "RC", {"p": "collector" if pnp else "vcc", "n": "gnd" if pnp else "collector"}, 1000, 500, 100 if not pnp else 320)
    b.add(kind, "Q1", {"c": "collector", "b": "base", "e": "vcc" if pnp else "gnd"}, x=500, y=220)
    b.add("ground", "G1", {"g": "gnd"}, x=300, y=420)
    return b.finish()


def rc() -> dict:
    b = Builder("rc", "Charge RC · τ = 1 ms", "5 V, R = 1 kΩ et C = 1 µF, initialement déchargé. À t = RC = 1 ms, la tension du condensateur vaut environ 63,2 % de 5 V.")
    b.add("voltage_source", "V1", {"p": "vcc", "n": "gnd"}, 5, 100, 220)
    b.add("resistor", "R1", {"p": "vcc", "n": "out"}, 1000, 300, 130)
    b.add("capacitor", "C1", {"p": "out", "n": "gnd"}, 1e-6, 500, 250, initial_voltage=0)
    b.add("ground", "G1", {"g": "gnd"}, x=300, y=400)
    b.project["default_analysis"] = {"kind": "tran", "step": 0.00001, "stop": 0.006, "startup": True}
    return b.finish()


def subtractor() -> dict:
    b = Builder("subtractor", "Soustracteur à 2 bits · logique discrète", "A = A1 A0, B = B1 B0. Sortie D1 D0 modulo 4 et emprunt final séparé. Vingt portes NAND à transistors NPN, aucun calcul Python des sorties observées.")
    b.add("voltage_source", "VCC", {"p": "vcc", "n": "gnd"}, 5, 70, 90)
    for i, label in enumerate(("A0", "A1", "B0", "B1")):
        b.add("voltage_source", f"V{label}", {"p": label, "n": "gnd"}, 0, 70, 220 + 130 * i)
    b.add("ground", "G1", {"g": "gnd"}, x=70, y=780)
    gate_count = 0
    def nand(a: str, c: str, label: str | None = None) -> str:
        nonlocal gate_count
        gate_count += 1
        gate = f"N{gate_count}"
        out = label or f"{gate}_out"
        x = 270 + ((gate_count - 1) % 5) * 250
        y = 100 + ((gate_count - 1) // 5) * 330
        b.add("resistor", f"{gate}_RP", {"p": "vcc", "n": out}, 1000, x + 110, y)
        b.add("resistor", f"{gate}_RA", {"p": a, "n": f"{gate}_ba"}, 47000, x, y + 85)
        b.add("resistor", f"{gate}_RB", {"p": c, "n": f"{gate}_bb"}, 47000, x, y + 200)
        b.add("npn", f"{gate}_QA", {"c": out, "b": f"{gate}_ba", "e": f"{gate}_mid"}, x=x + 110, y=y + 85)
        b.add("npn", f"{gate}_QB", {"c": f"{gate}_mid", "b": f"{gate}_bb", "e": "gnd"}, x=x + 110, y=y + 200)
        return out
    def inv(a: str) -> str:
        return nand(a, a)
    def xor(a: str, c: str, label: str | None = None) -> str:
        ac = nand(a, c)
        return nand(nand(a, ac), nand(c, ac), label)
    xor("A0", "B0", "D0")
    borrow0 = inv(nand(inv("A0"), "B0"))
    diff1 = xor("A1", "B1")
    xor(diff1, borrow0, "D1")
    term_a = nand(inv("A1"), "B1")
    term_b = nand(inv(diff1), borrow0)
    nand(term_a, term_b, "Borrow")
    project = b.finish()
    output_terminals = {}
    for label in ("D0", "D1", "Borrow"):
        output_terminals[label] = b.net_pins[label][0]
    cases = []
    for a in range(4):
        for value_b in range(4):
            modulo = (a - value_b) % 4
            borrow = int(a < value_b)
            cases.append({"inputs": {"A0": a & 1, "A1": (a >> 1) & 1, "B0": value_b & 1, "B1": (value_b >> 1) & 1}, "expected": {"D0": modulo & 1, "D1": (modulo >> 1) & 1, "Borrow": borrow}, "expected_modulo_4": modulo, "expected_borrow": borrow})
    project["truth_table"] = {"inputs": {label: f"V{label}" for label in ("A0", "A1", "B0", "B1")}, "outputs": output_terminals, "cases": cases, "thresholds": {"low": 1.5, "high": 3.5}}
    project["pedagogy"] = {"gates": gate_count, "pull_up_ohms": 1000, "base_resistor_ohms": 47000, "explanation": "Chaque NAND comporte deux NPN en série vers la masse et une résistance de rappel au +5 V. Les deux entrées hautes permettent le courant dans les deux transistors et abaissent la sortie. Une entrée basse interrompt ce trajet : la résistance remonte la sortie. Les étages restent soumis à la charge des portes suivantes."}
    return project


def example_projects() -> dict[str, dict]:
    return {"ohm": ohm(), "divider": divider(), "diode": diode(), "npn": transistor(), "pnp": transistor(True), "rc": rc(), "subtractor": subtractor()}
