"""Petit lanceur ngspice à limites de ressources, exécuté comme processus dédié.

Le serveur HTTP est multithread : ne jamais employer preexec_fn dans son Popen.
Ce processus Python neuf fixe ses propres limites puis se remplace par ngspice.
Ce module n'est exposé par aucun outil MCP et n'accepte aucune commande SPICE.
"""
from __future__ import annotations

import os
from pathlib import Path
import resource
import sys

MAX_RAW_BYTES = 24 * 1024 * 1024
MAX_MEMORY_BYTES = 512 * 1024 * 1024


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage interne : spice_worker.py /chemin/absolu/ngspice")
    executable = Path(sys.argv[1])
    if not executable.is_absolute() or executable.name != "ngspice" or not executable.is_file():
        raise SystemExit("Le lanceur n'accepte que l'exécutable ngspice résolu par le serveur.")
    resource.setrlimit(resource.RLIMIT_CPU, (8, 9))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_RAW_BYTES, MAX_RAW_BYTES))
    if hasattr(resource, "RLIMIT_AS") and os.uname().sysname != "Darwin":
        resource.setrlimit(resource.RLIMIT_AS, (MAX_MEMORY_BYTES, MAX_MEMORY_BYTES))
    # Sur macOS, RLIMIT_AS n'est pas appliqué : le parent surveille la RSS.
    os.execv(str(executable), [str(executable), "-n", "-b", "circuit.cir"])


if __name__ == "__main__":
    main()
