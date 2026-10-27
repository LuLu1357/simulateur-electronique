"""Copies durables : aucune opération ne perd le circuit actif ou un fichier existant."""
from copy import deepcopy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.domain import Store, new_project
from backend.project_library import ProjectLibrary
from backend.server import create_app


def test_snapshots_survive_reopening_and_are_independent(tmp_path):
    library = ProjectLibrary(tmp_path)
    project = new_project()
    first = library.save(project)["saved"]
    project["components"][0]["value"] = 9
    second = library.save(project)["saved"]
    reopened = ProjectLibrary(tmp_path)
    assert [entry["id"] for entry in reopened.list()["projects"]] == [second["id"], first["id"]]
    assert reopened.get(first["id"])["components"][0]["value"] == 5
    loaded = reopened.get(first["id"])
    loaded["components"].clear()
    assert reopened.get(first["id"])["components"]
    assert "project" not in reopened.list()["projects"][0]


def test_capacity_rejects_thirteenth_copy_without_eviction(tmp_path):
    library = ProjectLibrary(tmp_path)
    for _ in range(12):
        library.save(new_project())
    previous = library.path.read_bytes()
    with pytest.raises(ValueError, match="12"):
        library.save(new_project())
    assert library.path.read_bytes() == previous
    removed = library.list()["projects"][0]["id"]
    assert len(library.delete(removed)["projects"]) == 11
    assert len(library.save(new_project())["projects"]) == 12


def test_corrupt_library_never_gets_replaced_by_empty_data(tmp_path):
    library = ProjectLibrary(tmp_path)
    identifier = library.save(new_project())["saved"]["id"]
    library.path.write_text('{"version":1,"projects":["incomplete"]}')
    previous = library.path.read_bytes()
    for action in [library.list, lambda: library.get(identifier), lambda: library.save(new_project()), lambda: library.delete(identifier)]:
        with pytest.raises(ValueError, match="corrompue"):
            action()
        assert library.path.read_bytes() == previous


def test_failed_atomic_write_preserves_previous_file(tmp_path, monkeypatch):
    library = ProjectLibrary(tmp_path)
    library.save(new_project())
    previous = library.path.read_bytes()
    def rejected_replace(self, target):
        raise OSError("disque indisponible")
    monkeypatch.setattr(Path, "replace", rejected_replace)
    with pytest.raises(ValueError, match="précédentes"):
        library.save(new_project())
    assert library.path.read_bytes() == previous
    assert not list(tmp_path.glob(".projects-*.tmp"))


def test_http_library_revision_load_undo_and_delete(tmp_path):
    app = create_app(Store(), tmp_path)
    with TestClient(app) as client:
        headers = {"X-Atelier-Token": client.get("/api/session").json()["token"]}
        original = client.get("/api/state").json()["project"]
        assert client.post("/api/projects/save", json={"expected_revision": 0}).status_code == 403
        saved = client.post("/api/projects/save", json={"expected_revision": 0}, headers=headers)
        assert saved.status_code == 200
        identifier = saved.json()["saved"]["id"]
        exported = client.get('/api/projects/export/' + identifier)
        assert exported.status_code == 200 and exported.json() == original
        assert 'attachment' in exported.headers['content-disposition']
        assert client.get("/api/state").json()["project"] == original
        modified = client.post("/api/transaction", headers=headers, json={"expected_revision": 0, "operations": [{"type": "set_value", "id": "R1", "value": 2000}]}).json()["project"]
        assert client.post("/api/projects/save", headers=headers, json={"expected_revision": 0}).status_code == 409
        assert client.post("/api/projects/load", headers=headers, json={"expected_revision": 0, "id": identifier}).status_code == 409
        loaded = client.post("/api/projects/load", headers=headers, json={"expected_revision": modified["revision"], "id": identifier})
        assert loaded.status_code == 200
        assert next(c for c in loaded.json()["project"]["components"] if c["id"] == "R1")["value"] == 1000
        undone = client.post("/api/undo", headers=headers, json={"expected_revision": loaded.json()["project"]["revision"]}).json()["project"]
        assert undone["components"] == modified["components"]
        assert client.post("/api/projects/delete", headers=headers, json={"id": identifier}).status_code == 200
        assert client.get("/api/state").json()["project"] == undone
        assert not client.get("/api/projects").json()["projects"]


@pytest.mark.parametrize("identifier", ["../../project.json", "/etc/passwd", 12, None, "saved_missing"])
def test_library_never_accepts_client_file_paths(tmp_path, identifier):
    library = ProjectLibrary(tmp_path)
    with pytest.raises(ValueError):
        library.get(identifier)
    with pytest.raises(ValueError):
        library.delete(identifier)
    assert not library.path.exists()


def test_http_library_refuses_extra_fields_and_active_load_during_calculation(tmp_path):
    app = create_app(Store(), tmp_path)
    with TestClient(app) as client:
        headers = {"X-Atelier-Token": client.get("/api/session").json()["token"]}
        assert client.post("/api/projects/save", headers=headers, json={"expected_revision": 0, "path": "elsewhere"}).status_code == 422
        saved = client.post("/api/projects/save", headers=headers, json={"expected_revision": 0}).json()["saved"]
        app.state.running = True
        assert client.post("/api/projects/load", headers=headers, json={"expected_revision": 0, "id": saved["id"]}).status_code == 409
        app.state.running = False
