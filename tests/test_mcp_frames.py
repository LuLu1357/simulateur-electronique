"""Le pont de relecture reste une lecture et refuse la coercition des indices."""
import asyncio

import pytest
from mcp.server.mcpserver.exceptions import ToolError

import backend.mcp_server as bridge


def test_frame_tool_forwards_only_the_fixed_read_route_and_expected_parameters(monkeypatch):
    calls = []
    expected = {'simulation_id': 'a' * 32, 'index': 3, 'time': 0.0012}

    async def read(method, route, payload=None, params=None):
        calls.append((method, route, payload, params))
        return expected

    monkeypatch.setattr(bridge, 'api', read)
    assert asyncio.run(bridge.simulation_frame_read('a' * 32, 3)) is expected
    assert calls == [('GET', '/api/results/frame', None, {'simulation_id': 'a' * 32, 'index': 3})]


@pytest.mark.parametrize('index', [True, False, -1, 0.5, '1', None, float('inf')])
def test_frame_tool_rejects_bad_indices_before_any_api_call(monkeypatch, index):
    async def forbidden(*args, **kwargs):
        pytest.fail('Un indice invalide ne doit provoquer aucune requête API.')

    monkeypatch.setattr(bridge, 'api', forbidden)
    with pytest.raises(ToolError, match='entier positif ou nul'):
        asyncio.run(bridge.simulation_frame_read('a' * 32, index))


def test_registered_mcp_tool_is_read_only_and_does_not_coerce_boolean_or_float_indices(monkeypatch):
    calls = []

    async def read(method, route, payload=None, params=None):
        calls.append((method, route, payload, params))
        return {'index': params['index']}

    monkeypatch.setattr(bridge, 'api', read)
    tool = bridge.mcp._tool_manager.get_tool('simulation_frame_read')
    assert tool.annotations.read_only_hint is True
    assert tool.annotations.destructive_hint is False
    assert tool.annotations.idempotent_hint is True
    assert tool.annotations.open_world_hint is False
    assert tool.annotations.model_dump(by_alias=True, exclude_none=True) == {
        'readOnlyHint': True, 'destructiveHint': False,
        'idempotentHint': True, 'openWorldHint': False,
    }
    assert tool.parameters['properties']['index']['type'] == 'integer'
    assert tool.parameters['properties']['index']['minimum'] == 0
    for index in (True, False, -1, 1.0, '1'):
        with pytest.raises(ToolError):
            asyncio.run(tool.run({'simulation_id': 'a' * 32, 'index': index}, None))
    assert calls == []
    assert asyncio.run(tool.run({'simulation_id': 'a' * 32, 'index': 0}, None)) == {'index': 0}
    assert calls == [('GET', '/api/results/frame', None, {'simulation_id': 'a' * 32, 'index': 0})]
