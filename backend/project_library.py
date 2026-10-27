"""Snapshots de circuits locaux, indépendants du projet actuellement ouvert."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import uuid

from .domain import validate_project

CAPACITY = 12
_SAVED_ID = re.compile(r'^saved_[0-9a-f]{32}$')
_MAX_FILE_SIZE = 32 * 1024 * 1024


def _snapshot_id(value) -> str:
    if not isinstance(value, str) or not _SAVED_ID.fullmatch(value):
        raise ValueError('Identifiant de sauvegarde inconnu.')
    return value


class ProjectLibrary:
    """Un fichier fixe, un verrou de processus et des remplacements atomiques.

    Une lecture corrompue n'est jamais assimilée à une bibliothèque vide :
    aucune sauvegarde ou suppression ne peut ainsi écraser les données en place.
    """

    def __init__(self, runtime: Path):
        self.path = runtime / 'projects.json'
        self.lock = threading.RLock()

    def _read(self) -> list[dict]:
        if not self.path.exists():
            return []
        try:
            if self.path.stat().st_size > _MAX_FILE_SIZE:
                raise ValueError('Bibliothèque trop volumineuse.')
            document = json.loads(self.path.read_text(encoding='utf8'))
            if not isinstance(document, dict) or type(document.get('version')) is not int or document['version'] != 1:
                raise ValueError('Version inconnue.')
            entries = document.get('projects')
            if not isinstance(entries, list) or len(entries) > CAPACITY:
                raise ValueError('Liste de sauvegardes invalide.')
            ids = set()
            for entry in entries:
                if not isinstance(entry, dict) or set(entry) != {'id', 'saved_at', 'project'}:
                    raise ValueError('Sauvegarde malformée.')
                identifier = _snapshot_id(entry['id'])
                if identifier in ids:
                    raise ValueError('Identifiants de sauvegarde dupliqués.')
                ids.add(identifier)
                timestamp = entry.get('saved_at')
                if not isinstance(timestamp, str) or len(timestamp) > 40:
                    raise ValueError('Date de sauvegarde invalide.')
                parsed = datetime.fromisoformat(timestamp)
                if parsed.tzinfo is None:
                    raise ValueError('Date de sauvegarde sans fuseau horaire.')
                validate_project(entry.get('project'))
            return entries
        except (OSError, ValueError, TypeError, OverflowError, RecursionError) as exc:
            raise ValueError('La bibliothèque de projets est illisible ou corrompue. Les sauvegardes existantes sont conservées ; aucune modification n’a été appliquée.') from exc

    @staticmethod
    def _metadata(entry: dict) -> dict:
        project = entry['project']
        return {
            'id': entry['id'], 'project_id': project['id'],
            'title': project['title'], 'revision': project['revision'],
            'saved_at': entry['saved_at'],
            'component_count': len(project['components']),
            'wire_count': len(project['wires']),
        }

    @classmethod
    def _document(cls, entries: list[dict]) -> dict:
        return {'projects': [cls._metadata(entry) for entry in reversed(entries)], 'capacity': CAPACITY}

    def list(self) -> dict:
        with self.lock:
            return self._document(self._read())

    def _write(self, entries: list[dict]) -> None:
        temporary = None
        try:
            payload = json.dumps({'version': 1, 'projects': entries}, ensure_ascii=False, allow_nan=False, indent=2) + '\n'
            if len(payload.encode('utf8')) > _MAX_FILE_SIZE:
                raise ValueError('La bibliothèque atteint sa limite de taille ; exporte et supprime une ancienne sauvegarde.')
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf8', dir=self.path.parent, prefix='.projects-', suffix='.tmp', delete=False) as output:
                temporary = Path(output.name)
                os.chmod(temporary, 0o600)
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(self.path)
        except OSError as exc:
            raise ValueError('La bibliothèque ne peut pas être enregistrée. Les sauvegardes précédentes sont conservées.') from exc
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink(missing_ok=True)

    def save(self, project: dict) -> dict:
        snapshot = deepcopy(project)
        validate_project(snapshot)
        with self.lock:
            entries = self._read()
            if len(entries) >= CAPACITY:
                raise ValueError('La bibliothèque contient déjà 12 sauvegardes. Supprime une ancienne sauvegarde avant d’en ajouter une.')
            entry = {
                'id': f'saved_{uuid.uuid4().hex}',
                'saved_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
                'project': snapshot,
            }
            entries.append(entry)
            self._write(entries)
            return {**self._document(entries), 'saved': self._metadata(entry)}

    def get(self, identifier: str) -> dict:
        identifier = _snapshot_id(identifier)
        with self.lock:
            entry = next((entry for entry in self._read() if entry['id'] == identifier), None)
            if entry is None:
                raise ValueError('Cette sauvegarde n’existe plus dans la bibliothèque.')
            return deepcopy(entry['project'])

    def delete(self, identifier: str) -> dict:
        identifier = _snapshot_id(identifier)
        with self.lock:
            entries = self._read()
            remaining = [entry for entry in entries if entry['id'] != identifier]
            if len(remaining) == len(entries):
                raise ValueError('Cette sauvegarde n’existe plus dans la bibliothèque.')
            self._write(remaining)
            return self._document(remaining)
