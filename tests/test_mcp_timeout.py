"""Le pont MCP conserve le timeout initial et borne son arrêt de secours."""
import asyncio

import httpx
import pytest
from mcp.server.mcpserver.exceptions import ToolError

import backend.mcp_server as bridge


@pytest.mark.parametrize('method,route,stop_expected', [
    ('POST', '/api/simulate', True),
    ('POST', '/api/truth-table', True),
    ('POST', '/api/transaction', False),
    ('GET', '/api/results', False),
])
@pytest.mark.parametrize('stop_fails', [False, True])
def test_timeout_is_a_tool_error_and_stop_only_targets_calculations(tmp_path, monkeypatch, method, route, stop_expected, stop_fails):
    runtime = tmp_path / '.runtime'
    runtime.mkdir()
    (runtime / 'token').write_text('local-test-token')
    monkeypatch.setattr(bridge, 'ROOT', tmp_path)
    original = httpx.ReadTimeout('timeout initial', request=httpx.Request(method, bridge.API_URL + route))
    stops = []
    class LocalClient:
        def __init__(self, **kwargs):
            assert kwargs['timeout'] == 180
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def request(self, *args, **kwargs):
            raise original
        async def post(self, route, **kwargs):
            stops.append((route, kwargs))
            if stop_fails:
                raise httpx.ConnectError('arrêt indisponible')
            return httpx.Response(200, json={'stop_requested': True}, request=httpx.Request('POST', bridge.API_URL + route))
    monkeypatch.setattr(bridge.httpx, 'AsyncClient', LocalClient)
    with pytest.raises(ToolError, match='Délai de réponse') as caught:
        asyncio.run(bridge.api(method, route, {} if method == 'POST' else None))
    assert caught.value.__cause__ is original
    assert len(stops) == int(stop_expected)
    if stop_expected:
        assert stops[0][0] == '/api/stop'
        assert stops[0][1]['headers']['X-Atelier-Token'] == 'local-test-token'
        if stop_fails:
            assert 'n’a pas pu être confirmé' in str(caught.value)
        else:
            assert 'a été transmise' in str(caught.value)


def test_secondary_stop_has_an_absolute_deadline(tmp_path, monkeypatch):
    runtime = tmp_path / '.runtime'
    runtime.mkdir()
    (runtime / 'token').write_text('local-test-token')
    monkeypatch.setattr(bridge, 'ROOT', tmp_path)
    monkeypatch.setattr(bridge, 'STOP_TIMEOUT_SECONDS', .02)
    original = httpx.ReadTimeout('timeout initial')
    stop_cancelled = []
    class StalledClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def request(self, *args, **kwargs):
            raise original
        async def post(self, *args, **kwargs):
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                stop_cancelled.append(True)
                raise
    monkeypatch.setattr(bridge.httpx, 'AsyncClient', StalledClient)
    async def bounded_call():
        with pytest.raises(ToolError, match='n’a pas pu être confirmé') as caught:
            await asyncio.wait_for(bridge.api('POST', '/api/truth-table', {}), .5)
        assert caught.value.__cause__ is original
    asyncio.run(bounded_call())
    assert stop_cancelled == [True]
