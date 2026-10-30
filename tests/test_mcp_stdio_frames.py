"""Parcours MCP officiel en stdio, HTTP et ngspice réels, entièrement isolé.

Le package backend est copié dans tmp_path : même l'application créée à
l'import et les jetons du pont restent hors du projet ouvert de l'utilisateur.
Aucun serveur de production ni port fixe n'est utilisé.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

import httpx
from mcp import StdioServerParameters
from mcp.client import Client
import pytest


ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(
    not shutil.which('ngspice'), reason='ngspice requis ; aucun solveur de remplacement',
)

SERVER_BOOTSTRAP = r'''
from pathlib import Path
import sys
import uvicorn
import backend.server as server
from backend.domain import Store
from backend.examples import example_projects

workspace = Path.cwd()
project = example_projects()['led']
next(c for c in project['components'] if c['id'] == 'V1')['waveform'] = {
    'kind': 'pulse', 'low': 0, 'high': 5, 'delay': .0001,
    'rise': 1e-6, 'fall': 1e-6, 'width': .0004, 'period': .001,
}
app = server.create_app(Store(project), workspace / '.runtime')
original_simulate = server.simulate
counter = workspace / 'solver-calls'
counter.write_text('0')
def counted(*args, **kwargs):
    counter.write_text(str(int(counter.read_text()) + 1))
    return original_simulate(*args, **kwargs)
server.simulate = counted
uvicorn.run(app, fd=int(sys.argv[1]), log_level='warning', access_log=False)
'''

BRIDGE_BOOTSTRAP = r'''
from pathlib import Path
import os
import backend.mcp_server as bridge
bridge.ROOT = Path.cwd()
bridge.API_URL = os.environ['ATELIER_TEST_API_URL']
bridge.mcp.run()
'''


@pytest.fixture
def isolated_frame_service(tmp_path):
    workspace = tmp_path / 'atelier-mcp'
    shutil.copytree(ROOT / 'backend', workspace / 'backend',
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    # Garder le socket réservé jusqu'à son héritage par uvicorn, sans course sur
    # un port choisi puis libéré. Le backend est déjà limité aux systèmes POSIX.
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        url = f'http://127.0.0.1:{listener.getsockname()[1]}'
        environment = {**os.environ, 'PYTHONPATH': str(workspace)}
        with (workspace / 'server.log').open('w+') as output:
            process = subprocess.Popen(
                [sys.executable, '-c', SERVER_BOOTSTRAP, str(listener.fileno())],
                cwd=workspace, env=environment, pass_fds=(listener.fileno(),),
                stdout=output, stderr=subprocess.STDOUT,
            )
            try:
                deadline = time.monotonic() + 10
                with httpx.Client(base_url=url, trust_env=False, timeout=.2) as client:
                    while time.monotonic() < deadline:
                        if process.poll() is not None:
                            break
                        try:
                            if client.get('/api/health').status_code == 200:
                                yield workspace, url
                                return
                        except httpx.HTTPError:
                            pass
                        time.sleep(.02)
                output.seek(0)
                pytest.fail(f'Le serveur isolé ne démarre pas : {output.read()}')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def unpack(result):
    if result.structured_content is not None:
        return result.structured_content
    for part in result.content:
        if getattr(part, 'type', None) == 'text':
            try:
                return json.loads(part.text)
            except json.JSONDecodeError:
                pass
    raise AssertionError(f'Réponse MCP sans objet JSON : {result.content}')


def test_real_stdio_pulse_frames_are_read_only_and_reject_stale_sources(isolated_frame_service):
    workspace, url = isolated_frame_service
    counter = workspace / 'solver-calls'

    async def scenario():
        params = StdioServerParameters(
            command=sys.executable, args=['-c', BRIDGE_BOOTSTRAP], cwd=workspace,
            env={'PATH': os.environ.get('PATH', ''), 'PYTHONPATH': str(workspace),
                 'ATELIER_TEST_API_URL': url},
        )
        async with Client(params, read_timeout_seconds=30) as client:
            listing = await client.list_tools()
            tools = {tool.name: tool for tool in listing.tools}
            assert len(tools) == 28
            tool = tools['simulation_frame_read']
            assert tool.annotations.model_dump(by_alias=True, exclude_none=True) == {
                'readOnlyHint': True, 'destructiveHint': False,
                'idempotentHint': True, 'openWorldHint': False,
            }
            assert tool.input_schema['properties']['index']['type'] == 'integer'
            assert tool.input_schema['properties']['index']['minimum'] == 0

            async def call(name, arguments=None):
                result = await client.call_tool(name, arguments or {})
                assert not result.is_error, (name, result.content)
                return unpack(result)

            state = await call('simulation_run', {
                'analysis': {'kind': 'tran', 'step': 2e-6, 'stop': .002},
            })
            source = state['simulation']
            assert source['status'] == 'success', source
            assert counter.read_text() == '1'
            measures = await call('measurements_read')
            assert measures['simulation'] == source
            uid, times = source['simulation_id'], source['time']
            before = await call('circuit_read')

            async def frame(index):
                reply = await call('simulation_frame_read', {'simulation_id': uid, 'index': index})
                assert reply['simulation_id'] == uid
                assert reply['project_id'] == before['project']['id']
                assert reply['source_revision'] == source['project_revision']
                assert reply['circuit_fingerprint'] == source['circuit_fingerprint']
                assert reply['time'] == times[index]
                assert reply['index'] == index and reply['sample_count'] == len(times)
                sample = reply['simulation']
                assert sample['sample_index'] == index and sample['sample_time'] == times[index]
                assert sample['time'] == [] and sample['curves'] == []
                assert sample['flow_sample'] == 'sampled_point'
                return reply

            on_index = min(range(len(times)), key=lambda i: abs(times[i] - .0003))
            off_index = min(range(len(times)), key=lambda i: abs(times[i] - .0008))
            on, off = await frame(on_index), await frame(off_index)
            assert .008 < on['simulation']['currents']['LED1'] < .011
            assert abs(off['simulation']['currents']['LED1']) < 1e-7
            assert on['simulation']['wire_flow_hints'] != off['simulation']['wire_flow_hints']
            await frame(0)
            await frame(len(times) - 1)

            # Passer par le protocole officiel vérifie la validation sérialisée,
            # pas seulement l'appel direct de la fonction Python du pont.
            for invalid in (True, False, -1, 1.0, .5, '1', None, len(times)):
                rejected = await client.call_tool('simulation_frame_read', {
                    'simulation_id': uid, 'index': invalid,
                })
                assert rejected.is_error, invalid
            assert await call('circuit_read') == before
            assert await call('measurements_read') == measures
            assert counter.read_text() == '1'

            # Une édition graphique incrémente la révision du projet tout en
            # gardant la provenance et la validité du calcul source.
            visual = await call('transaction_apply', {
                'expected_revision': before['project']['revision'],
                'operations': [{'type': 'move_component', 'id': 'LED1', 'x': 550, 'y': 220}],
            })
            visual_frame = await frame(on_index)
            assert visual_frame['project_revision'] == visual['project']['revision']
            assert visual_frame['source_revision'] < visual_frame['project_revision']
            assert await call('circuit_read') == visual
            assert counter.read_text() == '1'

            changed = await call('transaction_apply', {
                'expected_revision': visual['project']['revision'],
                'operations': [{'type': 'set_value', 'id': 'R1', 'value': 680}],
            })
            obsolete = await client.call_tool('simulation_frame_read', {'simulation_id': uid, 'index': on_index})
            assert obsolete.is_error and '409' in str(obsolete.content)
            assert await call('circuit_read') == changed
            assert counter.read_text() == '1'

            replacement = await call('simulation_run', {
                'analysis': {'kind': 'tran', 'step': 2e-6, 'stop': .002},
            })
            new_uid = replacement['simulation']['simulation_id']
            assert new_uid != uid and counter.read_text() == '2'
            late = await client.call_tool('simulation_frame_read', {'simulation_id': uid, 'index': on_index})
            assert late.is_error and '409' in str(late.content)
            fresh = await call('simulation_frame_read', {'simulation_id': new_uid, 'index': on_index})
            assert fresh['simulation_id'] == new_uid
            assert await call('circuit_read') == replacement
            assert counter.read_text() == '2'

    asyncio.run(scenario())
