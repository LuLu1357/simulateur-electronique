"""Lance le service local et, sur demande, son interface dans le navigateur."""
from __future__ import annotations
import argparse
import json
import threading
import urllib.error
import urllib.request
import webbrowser
import time
import uvicorn

URL = 'http://127.0.0.1:8765'

def ready() -> bool:
    try:
        with urllib.request.urlopen(URL + '/api/health', timeout=1) as response:
            data = json.load(response)
            return data.get('server_started') is True and data.get('mcp', {}).get('transport') == 'stdio'
    except (OSError, ValueError, urllib.error.URLError):
        return False

def open_when_ready():
    for _ in range(40):
        if ready():
            webbrowser.open(URL)
            return
        time.sleep(.25)

def main():
    parser = argparse.ArgumentParser(description='Atelier Électronique — serveur local')
    parser.add_argument('--open', action='store_true', help='Ouvrir le navigateur après démarrage')
    args = parser.parse_args()
    if ready():
        print(f'Atelier déjà démarré : {URL}')
        if args.open:
            webbrowser.open(URL)
        return
    if args.open:
        threading.Thread(target=open_when_ready, daemon=True).start()
    uvicorn.run('backend.server:app', host='127.0.0.1', port=8765, access_log=False)

if __name__ == '__main__':
    main()
