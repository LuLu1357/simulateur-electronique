"""Balayage OP sur copies indépendantes ; chaque point provient de ngspice."""
from copy import deepcopy
import math
import threading
import time

from .domain import circuit_fingerprint, topology, validate_project
from .simulation import simulate

MAX_SWEEP_POINTS = 16
MAX_SWEEP_SECONDS = 45


def prepare_sweep(project: dict, component_id: str, values: list, probe: dict | None = None) -> tuple[list[dict], dict, dict]:
    component = next((entry for entry in project['components'] if entry['id'] == component_id), None)
    if component is None or component['kind'] not in ('resistor', 'voltage_source', 'potentiometer'):
        raise ValueError('Choisissez une résistance, une source continue ou un potentiomètre à balayer.')
    if component['kind'] == 'voltage_source' and component.get('waveform'):
        raise ValueError('Désactivez le créneau de cette source pour balayer sa tension continue.')
    if not isinstance(values, list) or not 2 <= len(values) <= MAX_SWEEP_POINTS:
        raise ValueError('Le balayage contient de 2 à 16 valeurs numériques.')
    field = 'position' if component['kind'] == 'potentiometer' else 'value'
    defaults = {'p': component['pins'].get('w', next(iter(component['pins'].values()))), 'n': '0'}
    probe = defaults if probe is None else probe
    points = topology(project)['terminal_to_net']
    if not isinstance(probe, dict) or set(probe) != {'p', 'n'} or any(not isinstance(point, str) or point not in points and point != '0' for point in probe.values()):
        raise ValueError('Les points de mesure doivent être des bornes existantes ou la masse 0.')
    trials = []
    for value in values:
        if type(value) not in (float, int):
            raise ValueError('Chaque valeur du balayage doit être un nombre fini en unités SI.')
        try:
            numeric = float(value)
        except (ValueError, OverflowError) as exc:
            raise ValueError('Valeur du balayage hors limites numériques.') from exc
        if not math.isfinite(numeric):
            raise ValueError('Chaque valeur du balayage doit être finie.')
        trial = deepcopy(project)
        next(entry for entry in trial['components'] if entry['id'] == component_id)[field] = numeric
        validate_project(trial)
        trials.append(trial)
    parameter = {'component_id': component_id, 'label': component['label'], 'field': field,
                 'unit': '%' if field == 'position' else 'Ω' if component['kind'] == 'resistor' else 'V'}
    return trials, parameter, deepcopy(probe)


def run_parameter_sweep(project: dict, component_id: str, values: list, probe: dict | None = None, cancel_event: threading.Event | None = None) -> dict:
    trials, parameter, probe = prepare_sweep(project, component_id, values, probe)
    started = time.monotonic()
    deadline = started + MAX_SWEEP_SECONDS
    networks = topology(project)['terminal_to_net']
    rows = []
    status = 'success'
    for index, trial in enumerate(trials):
        if cancel_event and cancel_event.is_set():
            status = 'cancelled'
            break
        if time.monotonic() >= deadline:
            status = 'timeout'
            break
        result = simulate(trial, {'kind': 'op'}, cancel_event, deadline=deadline)
        positive = result['voltages'].get(networks.get(probe['p'], '0'))
        negative = result['voltages'].get(networks.get(probe['n'], '0'))
        voltage = positive - negative if positive is not None and negative is not None else None
        current = result['currents'].get(component_id)
        rows.append({'index': index, 'value': float(values[index]), 'voltage': voltage, 'current': current,
                     'status': result['status'], 'diagnostics': result.get('diagnostics', [])})
        if result['status'] in ('cancelled', 'timeout'):
            status = result['status']
            break
        if result['status'] != 'success':
            status = 'partial'
    if cancel_event and cancel_event.is_set():
        status = 'cancelled'
    elif time.monotonic() >= deadline:
        status = 'timeout'
    return {'status': status, 'project_id': project['id'], 'project_revision': project['revision'],
            'circuit_fingerprint': circuit_fingerprint(project), 'parameter': parameter, 'probe': probe,
            'total': len(values), 'completed': len(rows), 'converged': sum(row['status'] == 'success' for row in rows),
            'rows': rows, 'elapsed_seconds': round(time.monotonic() - started, 4),
            'assumptions': ['Chaque point est un calcul OP réel sur une copie indépendante du circuit.',
                            'Le circuit actif et ses mesures ne sont pas modifiés par ce balayage.',
                            'En OP, les condensateurs sont ouverts et les inductances idéales sont des courts-circuits ; les autres sources à créneaux restent à leur niveau bas.',
                            'Potentiomètre : le courant observé entre par P ; la mesure de tension est différentielle aux points choisis.']}
