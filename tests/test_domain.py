"""Preuves indépendantes de l'interface pour la topologie et les transactions."""
from copy import deepcopy
import json
import tempfile
from pathlib import Path
import unittest

from backend.domain import Store, new_project, topology, validate_project, validate_topology, catalog, circuit_fingerprint


class DomainTests(unittest.TestCase):
    def test_default_ohm_connections_match_schematic_and_board(self):
        project = new_project()
        topo = topology(project)
        self.assertEqual(topo["terminal_to_net"]["R1.p"], topo["terminal_to_net"]["V1.p"])
        self.assertEqual(topo["terminal_to_net"]["R1.n"], "0")
        self.assertEqual(topo["hole_to_net"]["a4"], topo["terminal_to_net"]["R1.p"])
        schematic_only = deepcopy(project)
        schematic_only["breadboard"]["placements"] = {}
        board_only = deepcopy(project)
        board_only["wires"] = []
        self.assertEqual(topology(schematic_only)["terminal_to_net"], topo["terminal_to_net"])
        self.assertEqual(topology(board_only)["terminal_to_net"], topo["terminal_to_net"])

    def test_correct_breadboard_strips_and_gap(self):
        topo = topology(new_project(empty=True))
        holes = topo["hole_to_net"]
        self.assertEqual(holes["a1"], holes["e1"])
        self.assertEqual(holes["f1"], holes["j1"])
        self.assertNotEqual(holes["a1"], holes["f1"])
        self.assertNotEqual(holes["a1"], holes["a2"])

    def test_split_rails_and_optional_continuity(self):
        p = new_project(empty=True)
        h = topology(p)["hole_to_net"]
        self.assertEqual(h["rail_top_p1"], h["rail_top_p15"])
        self.assertNotEqual(h["rail_top_p15"], h["rail_top_p16"])
        self.assertNotEqual(h["rail_top_p1"], h["rail_top_n1"])
        p["breadboard"]["rail_splits"] = False
        h = topology(p)["hole_to_net"]
        self.assertEqual(h["rail_top_p15"], h["rail_top_p16"])
        self.assertNotEqual(h["rail_top_p1"], h["rail_bottom_p1"])

    def test_crossing_does_not_connect_without_explicit_junction(self):
        store = Store(new_project(empty=True))
        store.transact(0, [
            {"type": "add_component", "kind": "resistor", "id": "R1", "x": 100, "y": 100},
            {"type": "add_component", "kind": "resistor", "id": "R2", "x": 200, "y": 100},
            {"type": "connect", "a": "R1.p", "b": "R1.n"},
            {"type": "connect", "a": "R2.p", "b": "R2.n"},
        ])
        nets = store.get_state()["topology"]["terminal_to_net"]
        self.assertNotEqual(nets["R1.p"], nets["R2.p"])
        store.transact(1, [{"type": "add_junction", "id": "J1", "x": 150, "y": 100}, {"type": "connect", "a": "R1.p", "b": "J1"}, {"type": "connect", "a": "R2.p", "b": "J1"}])
        nets = store.get_state()["topology"]["terminal_to_net"]
        self.assertEqual(nets["R1.p"], nets["R2.p"])

    def test_junction_can_be_placed_in_breadboard_and_removed(self):
        store = Store(new_project(empty=True))
        state = store.transact(0, [
            {"type": "add_junction", "id": "J1", "x": 10, "y": 10},
            {"type": "place_pin", "terminal": "J1", "hole": "a1"},
            {"type": "add_component", "kind": "resistor", "id": "R1"},
            {"type": "place_pin", "terminal": "R1.p", "hole": "e1"},
        ])
        nets = state["topology"]["terminal_to_net"]
        self.assertEqual(nets["J1"], nets["R1.p"])
        state = store.transact(1, [{"type": "remove_junction", "id": "J1"}])
        self.assertNotIn("J1", state["project"]["breadboard"]["placements"])

    def test_transactions_rollback_every_operation_on_error(self):
        store = Store()
        before = store.get_state()
        with self.assertRaises(ValueError):
            store.transact(0, [{"type": "set_value", "id": "R1", "value": 2000}, {"type": "connect", "a": "absent", "b": "R1.p"}])
        self.assertEqual(store.get_state(), before)

    def test_preview_does_not_write_revision_or_history(self):
        store = Store()
        preview = store.transact(0, [{"type": "set_value", "id": "R1", "value": 2200}], preview=True)
        self.assertTrue(preview["preview"])
        self.assertEqual(preview["project"]["revision"], 0)
        self.assertEqual(preview["project"]["components"][1]["value"], 2200)
        self.assertEqual(store.project["components"][1]["value"], 1000)
        self.assertFalse(store.get_state()["history"]["can_undo"])

    def test_revision_conflicts_prevent_overwrite(self):
        store = Store()
        store.transact(0, [{"type": "set_value", "id": "R1", "value": 2000}])
        with self.assertRaisesRegex(ValueError, "Conflit de révision"):
            store.transact(0, [{"type": "set_value", "id": "R1", "value": 3000}])
        self.assertEqual(store.project["components"][1]["value"], 2000)

    def test_undo_redo_revision_is_monotonic(self):
        store = Store()
        store.transact(0, [{"type": "set_value", "id": "R1", "value": 2000}, {"type": "move_component", "id": "R1", "x": 500, "y": 350}])
        undone = store.undo(1)
        self.assertEqual(undone["project"]["revision"], 2)
        self.assertEqual(undone["project"]["components"][1]["value"], 1000)
        self.assertEqual(undone["project"]["schematic"]["R1"]["x"], 400)
        redone = store.redo(2)
        self.assertEqual(redone["project"]["revision"], 3)
        self.assertEqual(redone["project"]["components"][1]["value"], 2000)
        self.assertEqual(redone["project"]["schematic"]["R1"]["x"], 500)

    def test_new_edit_after_undo_discards_redo(self):
        store = Store()
        store.transact(0, [{"type": "set_value", "id": "R1", "value": 2000}])
        store.undo(1)
        store.transact(2, [{"type": "set_title", "title": "Nouvel essai"}])
        self.assertFalse(store.get_state()["history"]["can_redo"])

    def test_persistence_and_reload_preserve_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "project.json"
            store = Store(path=path)
            state = store.transact(0, [{"type": "set_value", "id": "R1", "value": 4700}])
            loaded = Store(path=path)
            self.assertEqual(state["project"], loaded.project)
            self.assertEqual(json.loads(path.read_text())["revision"], 1)
            self.assertFalse(path.with_suffix(".json.tmp").exists())

    def test_replace_project_is_undoable(self):
        store = Store()
        old = deepcopy(store.project)
        store.replace(new_project(empty=True), 0)
        self.assertEqual(store.project["revision"], 1)
        self.assertEqual(store.project["components"], [])
        store.undo(1)
        self.assertEqual(store.project["components"], old["components"])
        self.assertEqual(store.project["revision"], 2)

    def test_pin_map_must_be_explicit_and_consistent(self):
        store = Store(new_project(empty=True))
        p = store.transact(0, [{"type": "add_component", "kind": "npn", "id": "Q1"}])["project"]
        self.assertEqual(p["components"][0]["pins"], {"c": "Q1.c", "b": "Q1.b", "e": "Q1.e"})
        self.assertEqual(catalog()["npn"]["package"]["pin_map"], {"1": "c", "2": "b", "3": "e"})
        p["components"][0]["pins"]["c"] = "Q1.e"
        with self.assertRaises(ValueError):
            validate_project(p)

    def test_dangling_source_short_and_missing_reference_diagnostics(self):
        store = Store(new_project(empty=True))
        p = store.transact(0, [{"type": "add_component", "kind": "voltage_source", "id": "V1"}, {"type": "connect", "a": "V1.p", "b": "V1.n"}])["project"]
        codes = {d["code"] for d in validate_topology(p)}
        self.assertIn("missing_ground", codes)
        self.assertIn("shorted_source", codes)
        self.assertTrue(all(d["category"] == "connection" for d in validate_topology(p) if d["code"] in ("missing_ground", "shorted_source")))

    def test_weak_node_is_hypothesis(self):
        store = Store(new_project(empty=True))
        p = store.transact(0, [{"type": "add_component", "kind": "capacitor", "id": "C1"}, {"type": "add_component", "kind": "ground", "id": "G1"}, {"type": "connect", "a": "C1.n", "b": "G1.g"}])["project"]
        hypotheses = [d for d in validate_topology(p) if d["code"] == "weak_dc_reference"]
        self.assertTrue(hypotheses)
        self.assertTrue(all(d["category"] == "hypothesis" for d in hypotheses))

    def test_nonfinite_negative_and_unknown_models_rejected(self):
        store = Store()
        for value in (-1, 0, float("nan"), float("inf"), True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                store.transact(0, [{"type": "set_value", "id": "R1", "value": value}])
        with self.assertRaises(ValueError):
            store.transact(0, [{"type": "add_component", "kind": "npn", "model": "arbitrary spice code"}])

    def test_cannot_place_two_pins_in_one_hole(self):
        store = Store()
        with self.assertRaisesRegex(ValueError, "déjà occupé"):
            store.transact(0, [{"type": "place_pin", "terminal": "R1.n", "hole": "e4"}])

    def test_last_result_marked_stale_after_modification(self):
        store = Store()
        store.simulation = {"status": "success", "project_revision": 0, "voltages": {"0": 0}}
        self.assertFalse(store.get_state()["simulation"]["stale"])
        store.transact(0, [{"type": "set_value", "id": "R1", "value": 2000}])
        self.assertTrue(store.get_state()["simulation"]["stale"])
        self.assertEqual(store.get_state()["simulation"]["voltages"], {"0": 0})


class InputValidationTests(unittest.TestCase):
    def test_malformed_import_never_replaces_valid_project(self):
        store = Store()
        before = store.get_state()
        variants = [None, [], 42, "projet"]
        for field in ("components", "wires", "junctions", "schematic", "breadboard", "ui"):
            for value in ((None, 1, "invalide") if field in ("components", "wires", "junctions") else (None, 1, "invalide", [])):
                candidate = deepcopy(store.project)
                candidate[field] = value
                variants.append(candidate)
        for field in ("components", "wires", "junctions"):
            for value in (None, [], 42, "entrée"):
                candidate = deepcopy(store.project)
                candidate[field] = [value]
                variants.append(candidate)
        for variant in variants:
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                store.replace(variant, 0)
            self.assertEqual(store.get_state(), before)

    def test_malformed_nested_fields_rejected_with_value_error(self):
        setters = [
            lambda p: p["components"][0].update(kind=[]),
            lambda p: p["components"][0].update(label={}),
            lambda p: p["components"][0].update(model=[]),
            lambda p: p["components"][0].update(pins=[]),
            lambda p: p["components"][0].update(value=10**1000),
            lambda p: p["wires"][0].update(a=[]),
            lambda p: p["wires"][0].update(b={}),
            lambda p: p["schematic"].update(V1=None),
            lambda p: p["breadboard"]["placements"].update({"V1.p": []}),
            lambda p: p["ui"].update(selected=[{}]),
            lambda p: p["ui"].update(selected=[None]),
            lambda p: p["ui"].update(highlights=[["R1"]]),
            lambda p: p["ui"].update(annotations=[None]),
            lambda p: p["ui"].update(annotations=[{"id": "N1", "text": {}, "targets": []}]),
            lambda p: p["ui"].update(annotations=[{"id": "N1", "text": "Note", "targets": [None]}]),
            lambda p: p.update(description=[]),
            lambda p: p.update(default_analysis=None),
            lambda p: p.update(truth_table=None),
            lambda p: p.update(schema_version=True),
        ]
        for index, setter in enumerate(setters):
            candidate = new_project()
            setter(candidate)
            with self.subTest(index=index), self.assertRaises(ValueError):
                validate_project(candidate)

    def test_malformed_operations_leave_no_partial_effects(self):
        store = Store()
        before = store.get_state()
        operations = [
            {"type": []},
            {"type": "set_value", "id": [], "value": 1000},
            {"type": "add_component", "kind": {}},
            {"type": "add_component", "kind": "resistor", "label": []},
            {"type": "connect", "a": [], "b": "R1.p"},
            {"type": "place_pin", "terminal": {}, "hole": "a1"},
            {"type": "place_pin", "terminal": "R1.p", "hole": []},
            {"type": "set_ui", "selected": None},
            {"type": "set_ui", "selected": [None]},
            {"type": "set_ui", "highlights": [{}]},
            {"type": "add_junction", "id": "a1", "x": 5, "y": 5},
            {"type": "annotate", "text": ["Note"]},
            {"type": "annotate", "text": "Note", "targets": [None]},
        ]
        for operation in operations:
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                store.transact(0, [{"type": "set_value", "id": "R1", "value": 2200}, operation])
            self.assertEqual(store.get_state(), before)
        with self.assertRaises(ValueError):
            store.transact(0, [{"type": "set_ui", "selected": None}, {"type": "remove_component", "id": "R1"}])

    def test_examples_remain_importable(self):
        from backend.examples import example_projects
        for name, project in example_projects().items():
            with self.subTest(example=name):
                validate_project(project)


class ElectricalFingerprintTests(unittest.TestCase):
    def test_presentation_and_revision_do_not_invalidate_measurements(self):
        store = Store()
        fingerprint = circuit_fingerprint(store.project)
        store.simulation = {"status": "success", "project_revision": 0, "circuit_fingerprint": fingerprint, "voltages": {"0": 0}}
        mutations = [
            {"type": "set_ui", "selected": ["R1"], "view": "breadboard", "highlights": ["V1.p"]},
            {"type": "move_component", "id": "R1", "x": 750, "y": 300, "rotation": 90},
            {"type": "annotate", "text": "5 V / 1 kΩ = 5 mA", "targets": ["R1"]},
            {"type": "set_title", "title": "Mon essai"},
        ]
        for operation in mutations:
            state = store.transact(store.project["revision"], [operation])
            self.assertFalse(state["simulation"]["stale"])
            self.assertEqual(circuit_fingerprint(store.project), fingerprint)

    def test_electrical_change_stales_measurements_and_undo_restores_freshness(self):
        store = Store()
        store.simulation = {"status": "success", "project_revision": 0, "circuit_fingerprint": circuit_fingerprint(store.project)}
        state = store.transact(0, [{"type": "set_value", "id": "R1", "value": 2200}])
        self.assertTrue(state["simulation"]["stale"])
        self.assertFalse(store.undo(1)["simulation"]["stale"])
        self.assertTrue(store.redo(2)["simulation"]["stale"])

    def test_all_electrical_fields_affect_fingerprint(self):
        base = new_project()
        old = circuit_fingerprint(base)
        variants = []
        p = deepcopy(base); p["components"][1]["value"] = 2000; variants.append(p)
        p = deepcopy(base); p["components"][1]["model"] = "future_model"; variants.append(p)
        p = deepcopy(base); p["components"][1]["initial_voltage"] = 1; variants.append(p)
        p = deepcopy(base); p["components"][1]["pins"]["p"] = "future_pin"; variants.append(p)
        p = deepcopy(base); p["wires"][0]["b"] = "R1.n"; variants.append(p)
        p = deepcopy(base); p["breadboard"]["rail_splits"] = False; variants.append(p)
        p = deepcopy(base); p["breadboard"]["placements"]["R1.p"] = "e5"; variants.append(p)
        for variant in variants:
            self.assertNotEqual(circuit_fingerprint(variant), old)

    def test_order_and_equivalent_numeric_encoding_do_not_affect_fingerprint(self):
        project = new_project()
        original = circuit_fingerprint(project)
        project["components"].reverse()
        project["wires"].reverse()
        for component in project["components"]:
            component["value"] = int(component["value"])
        self.assertEqual(circuit_fingerprint(project), original)


class NetworkLabelTests(unittest.TestCase):
    def test_name_shared_network_can_be_renamed_or_cleared_from_any_member(self):
        store = Store()
        state = store.transact(0, [{"type": "set_net_label", "terminal": "V1.p", "name": " Alimentation +5 V "}])
        nid = state["topology"]["terminal_to_net"]["R1.p"]
        self.assertEqual(next(net["name"] for net in state["topology"]["nets"] if net["id"] == nid), "Alimentation +5 V")
        state = store.transact(1, [{"type": "set_net_label", "terminal": "R1.p", "name": "Entrée"}])
        self.assertEqual(state["project"]["net_labels"], {"R1.p": "Entrée"})
        state = store.transact(2, [{"type": "set_net_label", "terminal": "V1.p", "name": ""}])
        self.assertEqual(state["project"]["net_labels"], {})

    def test_labels_are_visual_and_undoable(self):
        store = Store()
        original = circuit_fingerprint(store.project)
        store.simulation = {"status": "success", "project_revision": 0, "circuit_fingerprint": original}
        state = store.transact(0, [{"type": "set_net_label", "terminal": "V1.p", "name": "Entrée"}])
        self.assertFalse(state["simulation"]["stale"])
        self.assertEqual(circuit_fingerprint(store.project), original)
        self.assertEqual(store.undo(1)["project"]["net_labels"], {})
        self.assertEqual(store.redo(2)["project"]["net_labels"], {"V1.p": "Entrée"})

    def test_invalid_or_ambiguous_imported_labels_rejected(self):
        values = [None, [], {"absent": "Signal"}, {"V1.p": None}, {"V1.p": ["Signal"]}, {"V1.p": ""}, {"V1.p": "Signal\nErreur"}, {"V1.p": "X" * 81}, {"V1.p": "Alimentation", "R1.p": "Autre nom"}]
        for labels in values:
            p = new_project()
            p["net_labels"] = labels
            with self.subTest(labels=labels), self.assertRaises(ValueError):
                validate_project(p)

    def test_names_do_not_connect_separate_networks_and_removed_pin_cleans_label(self):
        store = Store()
        state = store.transact(0, [{"type": "set_net_label", "terminal": "V1.p", "name": "Signal"}, {"type": "set_net_label", "terminal": "V1.n", "name": "Signal"}])
        self.assertNotEqual(state["topology"]["terminal_to_net"]["V1.p"], state["topology"]["terminal_to_net"]["V1.n"])
        state = store.transact(1, [{"type": "remove_component", "id": "V1"}])
        self.assertEqual(state["project"]["net_labels"], {})


class BreadboardLayoutTests(unittest.TestCase):
    def assert_same_connections(self, before, after):
        # Comparaison de TOUTES les paires de bornes et jonctions, sans utiliser
        # l'égalité des IDs de réseau comme raccourci de preuve.
        first, second = topology(before)["terminal_to_net"], topology(after)["terminal_to_net"]
        self.assertEqual(set(first), set(second))
        for a in first:
            for b in first:
                self.assertEqual(first[a] == first[b], second[a] == second[b], (a, b))

    def test_small_examples_have_spaced_footprints_and_preserve_topology(self):
        from backend.examples import example_projects
        from backend.breadboard_layout import _hole_position
        for name, project in example_projects().items():
            if name == "subtractor":
                continue
            with self.subTest(example=name):
                store = Store(project)
                before = deepcopy(store.project)
                after = store.transact(0, [{"type": "layout_breadboard"}])["project"]
                self.assert_same_connections(before, after)
                self.assertEqual(before["schematic"], after["schematic"])
                self.assertEqual(before["components"], after["components"])
                self.assertEqual(before["net_labels"], after["net_labels"])
                placements = after["breadboard"]["placements"]
                self.assertEqual(len(placements), sum(len(comp["pins"]) for comp in after["components"]))
                self.assertEqual(len(placements), len(set(placements.values())))
                centers = []
                for comp in after["components"]:
                    footprint = after["breadboard"]["footprints"][comp["id"]]
                    self.assertEqual(footprint["package"], "pedagogical")
                    self.assertEqual(footprint["pins"], {pin: placements[terminal] for pin, terminal in comp["pins"].items()})
                    if comp["kind"] in ("voltage_source", "ground", "voltage_probe", "current_probe"):
                        self.assertEqual(footprint["kind"], "external")
                        self.assertTrue(all(hole.startswith("rail_") for hole in footprint["pins"].values()))
                    else:
                        points = [_hole_position(hole) for hole in footprint["pins"].values()]
                        centers.append((sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)))
                for index, center in enumerate(centers):
                    for other in centers[index + 1:]:
                        self.assertGreaterEqual(((center[0] - other[0]) ** 2 + (center[1] - other[1]) ** 2) ** 0.5, 48)

    def test_board_only_connections_are_kept_by_minimal_explicit_rigid_jumpers(self):
        project = new_project()
        project["wires"] = []
        store = Store(project)
        before = deepcopy(store.project)
        result = store.transact(0, [{"type": "layout_breadboard"}])["project"]
        self.assert_same_connections(before, result)
        self.assertEqual(len(result["wires"]), 2)  # Deux réseaux, chacun séparé en deux îlots.
        self.assertTrue(all(wire["kind"] == "rigid_jumper" for wire in result["wires"]))
        self.assertEqual(len(result["breadboard"]["layout"]["added_jumpers"]), 2)

    def test_preview_and_undo_redo_preserve_complete_project(self):
        store = Store()
        before = deepcopy(store.project)
        preview = store.transact(0, [{"type": "layout_breadboard"}], preview=True)
        self.assertTrue(preview["preview"])
        self.assertIn("footprints", preview["project"]["breadboard"])
        self.assertEqual(store.project, before)
        self.assertFalse(store.get_state()["history"]["can_undo"])
        applied = store.transact(0, [{"type": "layout_breadboard"}])["project"]
        undone = store.undo(1)["project"]
        self.assertEqual({**undone, "revision": 0}, before)
        redone = store.redo(2)["project"]
        self.assertEqual({**redone, "revision": 1}, applied)

    def test_full_board_fails_atomically_including_other_operations(self):
        store = Store(new_project(empty=True))
        store.transact(0, [{"type": "add_component", "kind": "resistor", "id": f"R{i}"} for i in range(13)])
        before = store.get_state()
        with self.assertRaisesRegex(ValueError, "12 emplacements"):
            store.transact(1, [{"type": "set_value", "id": "R0", "value": 4700}, {"type": "layout_breadboard"}])
        self.assertEqual(store.get_state(), before)
        with self.assertRaises(ValueError):
            store.transact(1, [{"type": "layout_breadboard"}], preview=True)
        self.assertEqual(store.get_state(), before)

    def test_large_subtractor_is_rejected_without_partial_placement(self):
        from backend.examples import example_projects
        store = Store(example_projects()["subtractor"])
        before = deepcopy(store.project)
        with self.assertRaisesRegex(ValueError, "plusieurs plaques"):
            store.transact(0, [{"type": "layout_breadboard"}])
        self.assertEqual(store.project, before)

    def test_twelve_components_fit_both_banks_without_shorts(self):
        store = Store(new_project(empty=True))
        store.transact(0, [{"type": "add_component", "kind": "resistor", "id": f"R{i}", "x": i * 100, "y": 100} for i in range(12)])
        before = deepcopy(store.project)
        after = store.transact(1, [{"type": "layout_breadboard"}])["project"]
        self.assert_same_connections(before, after)
        self.assertEqual(after["breadboard"]["layout"]["component_count"], 12)
        self.assertEqual(len(after["breadboard"]["placements"]), 24)
        self.assertTrue(any(hole.startswith("h") for hole in after["breadboard"]["placements"].values()))

    def test_pedagogical_transistor_pin_order_is_explicit_and_unmodified(self):
        store = Store(new_project(empty=True))
        store.transact(0, [{"type": "add_component", "kind": "npn", "id": "Q1"}, {"type": "add_component", "kind": "pnp", "id": "Q2"}])
        before_pins = [deepcopy(comp["pins"]) for comp in store.project["components"]]
        after = store.transact(1, [{"type": "layout_breadboard"}])["project"]
        for index, comp in enumerate(after["components"]):
            self.assertEqual(comp["pins"], before_pins[index])
            holes = after["breadboard"]["footprints"][comp["id"]]["pins"]
            self.assertEqual(list(holes), ["c", "b", "e"])
            self.assertEqual(int(holes["b"][1:]) - int(holes["c"][1:]), 1)
            self.assertEqual(int(holes["e"][1:]) - int(holes["b"][1:]), 1)

    def test_junction_and_split_rails_keep_original_partition(self):
        store = Store()
        store.transact(0, [{"type": "add_junction", "id": "J1", "x": 100, "y": 100}, {"type": "place_pin", "terminal": "J1", "hole": "b4"}])
        before = deepcopy(store.project)
        after = store.transact(1, [{"type": "layout_breadboard"}])["project"]
        self.assert_same_connections(before, after)
        self.assertIn("J1", after["breadboard"]["placements"])
        self.assertTrue(after["breadboard"]["rail_splits"])

    def test_drag_updates_footprint_metadata_and_removal_cleans_it(self):
        store = Store()
        store.transact(0, [{"type": "layout_breadboard"}])
        store.transact(1, [{"type": "place_pin", "terminal": "R1.p", "hole": "c2"}])
        self.assertEqual(store.project["breadboard"]["footprints"]["R1"]["pins"]["p"], "c2")
        store.transact(2, [{"type": "remove_component", "id": "R1"}])
        self.assertNotIn("R1", store.project["breadboard"]["footprints"])

    def test_transistor_body_drag_detaches_then_replaces_overlapping_holes_atomically(self):
        store = Store(new_project(empty=True))
        store.transact(0, [{"type": "add_component", "kind": "npn", "id": "Q1"}, {"type": "layout_breadboard"}])
        original = deepcopy(store.project)
        pins = store.project["components"][0]["pins"]
        operations = [{"type": "place_pin", "terminal": terminal, "hole": None} for terminal in pins.values()]
        new_holes = {"c": "c2", "b": "c3", "e": "c4"}
        operations += [{"type": "place_pin", "terminal": pins[name], "hole": hole} for name, hole in new_holes.items()]
        result = store.transact(1, operations)["project"]
        self.assertEqual(result["breadboard"]["footprints"]["Q1"]["pins"], new_holes)
        self.assertEqual(result["breadboard"]["placements"], {pins[name]: hole for name, hole in new_holes.items()})
        self.assert_same_connections(original, result)
        validate_project(result)

    def test_footprint_and_layout_metadata_do_not_change_electrical_fingerprint(self):
        store = Store()
        project = store.transact(0, [{"type": "layout_breadboard"}])["project"]
        fingerprint = circuit_fingerprint(project)
        project["breadboard"]["footprints"]["R1"]["orientation"] = "vertical"
        project["breadboard"]["layout"]["note"] = "Une autre présentation"
        self.assertEqual(circuit_fingerprint(project), fingerprint)

    def test_malformed_footprints_are_rejected_before_drag_operations(self):
        store = Store()
        store.transact(0, [{"type": "layout_breadboard"}])
        for value in (None, [], {"R1": None}, {"R1": {"kind": "axial", "package": "pedagogical", "orientation": "horizontal", "pins": {"p": "a1"}}}):
            project = deepcopy(store.project)
            project["breadboard"]["footprints"] = value
            with self.assertRaises(ValueError):
                validate_project(project)


if __name__ == "__main__":
    unittest.main()
