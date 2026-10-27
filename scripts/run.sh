#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ] || [ ! -f frontend/dist/index.html ]; then
  echo 'Première installation : ./scripts/install.sh'
  exit 1
fi
exec .venv/bin/python -m backend.launch "$@"
