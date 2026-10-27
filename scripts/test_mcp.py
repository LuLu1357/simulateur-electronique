"""Essai réel MCP stdio contre l’API locale démarrée. Préserve le projet initial.

À exécuter à la racine avec .venv/bin/python scripts/test_mcp.py.
L’interface et le serveur HTTP doivent déjà écouter sur 127.0.0.1:8765.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import sys

from mcp import StdioServerParameters
from mcp.client import Client

ROOT = Path(__file__).resolve().parent.parent


def unpack(result):
    structured = result.structured_content
    if structured is not None:
        return structured
    for part in result.content:
        if getattr(part, 'type', None) == 'text':
            try:
                return json.loads(part.text)
            except json.JSONDecodeError:
                pass
    return {}


async def main():
    report = {'timestamp': datetime.now(timezone.utc).isoformat(), 'sdk': importlib.metadata.version('mcp'),
              'server_started': False, 'client_connected': False, 'tools_accessible': False, 'checks': {}}
    original = None
    expected_revision = None
    params = StdioServerParameters(command=str(ROOT / '.venv' / 'bin' / 'python'),
                                  args=['-m', 'backend.mcp_server'], cwd=ROOT,
                                  env={'PATH': os.environ.get('PATH', '')})
    try:
        async with Client(params, read_timeout_seconds=180) as client:
            report['server_started'] = True
            report['client_connected'] = True
            report['protocol_version'] = client.protocol_version
            listing = await client.list_tools()
            names = {tool.name for tool in listing.tools}
            report['tools'] = sorted(names)
            report['tools_accessible'] = {'circuit_read', 'transaction_apply', 'simulation_run', 'truth_table_test'}.issubset(names)
            assert report['tools_accessible']

            async def call(name, arguments=None):
                result = await client.call_tool(name, arguments or {})
                if result.is_error:
                    raise AssertionError(f'{name}: {result.content}')
                return unpack(result)

            state = await call('circuit_read')
            original = state['project']
            expected_revision = original['revision']
            try:
                state = await call('example_load', {'expected_revision': expected_revision, 'example_id': 'ohm'})
                expected_revision = state['project']['revision']
                resistor = next(c for c in state['project']['components'] if c['kind'] == 'resistor')
                ops = [{'type': 'set_value', 'id': resistor['id'], 'value': 2000},
                       {'type': 'move_component', 'id': resistor['id'], 'x': 350, 'y': 220}]
                preview = await call('transaction_preview', {'expected_revision': expected_revision, 'operations': ops})
                untouched = await call('circuit_read')
                assert untouched['project']['revision'] == expected_revision
                assert next(c for c in untouched['project']['components'] if c['id'] == resistor['id'])['value'] == 1000
                report['checks']['preview_without_mutation'] = True
                state = await call('transaction_apply', {'expected_revision': expected_revision, 'operations': ops})
                expected_revision = state['project']['revision']
                details = await call('component_inspect', {'component_id': resistor['id']})
                assert details['component']['value'] == 2000
                report['checks']['shared_state_modified'] = True

                bad = await client.call_tool('transaction_apply', {'expected_revision': expected_revision - 1, 'operations': ops})
                assert bad.is_error
                report['checks']['revision_conflict_rejected'] = True
                atomic = await client.call_tool('transaction_apply', {'expected_revision': expected_revision,
                    'operations': [{'type': 'set_value', 'id': resistor['id'], 'value': 3000}, {'type': 'remove_component', 'id': 'ABSENT'}]})
                assert atomic.is_error
                after = await call('circuit_read')
                assert after['project']['revision'] == expected_revision
                assert next(c for c in after['project']['components'] if c['id'] == resistor['id'])['value'] == 2000
                report['checks']['atomic_rollback'] = True

                state = await call('history_undo', {'expected_revision': expected_revision})
                expected_revision = state['project']['revision']
                assert next(c for c in state['project']['components'] if c['id'] == resistor['id'])['value'] == 1000
                state = await call('history_redo', {'expected_revision': expected_revision})
                expected_revision = state['project']['revision']
                assert next(c for c in state['project']['components'] if c['id'] == resistor['id'])['value'] == 2000
                report['checks']['undo_redo'] = True

                state = await call('simulation_run', {'analysis': {'kind': 'op'}})
                assert state['simulation']['status'] == 'success', state['simulation']
                current = abs(state['simulation']['currents'][resistor['id']])
                assert abs(current - .0025) < 1e-7, current
                report['checks']['ngspice_measured_2_5_mA_after_edit'] = current
                measured = await call('voltage_measure', {'positive': resistor['pins']['p'], 'negative': resistor['pins']['n']})
                assert abs(measured['voltage'] - 5) < 1e-8
                report['checks']['differential_voltage_5V'] = measured['voltage']
                continuity = await call('breadboard_continuity', {'a': 'a1', 'b': 'e1'})
                assert continuity['continuous'] is True
                cut = await call('breadboard_continuity', {'a': 'rail_top_p1', 'b': 'rail_top_p30'})
                assert cut['continuous'] is False
                report['checks']['breadboard_continuity_and_split'] = True

                state = await call('interface_highlight', {'expected_revision': expected_revision, 'targets': [resistor['id']], 'view': 'split'})
                expected_revision = state['project']['revision']
                state = await call('annotation_add', {'expected_revision': expected_revision, 'text': '2 kΩ sous 5 V : I = 5 / 2000 = 2,5 mA.', 'targets': [resistor['id']]})
                expected_revision = state['project']['revision']
                selection = await call('selection_read')
                assert resistor['id'] in selection['highlights']
                assert selection['annotations'][-1]['text'].startswith('2 kΩ')
                report['checks']['highlight_annotation_visible_shared_state'] = True
                measures = await call('measurements_read')
                assert measures['simulation']['stale'] is False
                retained = await call('voltage_measure', {'positive': resistor['pins']['p'], 'negative': resistor['pins']['n']})
                assert retained['stale'] is False
                report['checks']['visual_edits_preserve_electrical_measurements'] = True

                state = await call('example_load', {'expected_revision': expected_revision, 'example_id': 'subtractor'})
                expected_revision = state['project']['revision']
                table = await call('truth_table_test')
                report['truth_table'] = table
                rows = table.get('cases', table.get('rows', table.get('results', [])))
                assert len(rows) == 16, table.keys()
                # L’engin conserve tensions et niveaux observés; le statut global doit prouver les 16 comparaisons.
                assert table.get('passed', table.get('all_passed', table.get('success'))) in (True, 16), table
                report['checks']['subtractor_16_real_simulations'] = True
            finally:
                if original is not None and expected_revision is not None:
                    restored = await call('project_import', {'expected_revision': expected_revision, 'project': original})
                    expected_revision = restored['project']['revision']
                    assert restored['project']['components'] == original['components']
                    assert restored['project']['wires'] == original['wires']
                    report['initial_project_restored'] = True
        report['status'] = 'success'
    except BaseException as exc:
        report['status'] = 'error'
        report['error'] = f'{type(exc).__name__}: {exc}'
        raise
    finally:
        target = ROOT / 'docs' / 'results-mcp.json'
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps({k: v for k, v in report.items() if k not in {'truth_table', 'tools'}}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
