#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
command -v python3 >/dev/null || { echo 'Python 3.11 ou supérieur est nécessaire.'; exit 1; }
command -v npm >/dev/null || { echo 'Node.js 20.19+ ou 22.12+ et npm sont nécessaires.'; exit 1; }
if ! command -v ngspice >/dev/null; then
  echo 'Installez ngspice : brew install ngspice (macOS), sudo apt install ngspice (Debian/Ubuntu).'
  exit 1
fi
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
npm ci --prefix frontend
npm run build --prefix frontend
printf '\nInstallation terminée. Lancez ./scripts/run.sh --open\n'
