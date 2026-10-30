"""Serveur de revue temporelle isolé, sans lire le runtime de l'utilisateur.

Voir docs/VALIDATION_RELECTURE.md. Aucun résultat électrique n'est préfabriqué :
le bouton Calculer TRAN de l'application lance le vrai ngspice.
"""
from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import shutil
import sys
import tempfile

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def review_project():
    from backend.breadboard_layout import plan_breadboard_layout
    from backend.domain import Store, topology
    from backend.examples import Builder

    builder = Builder(
        "qa_playback_pulse", "Revue isolée · DEL PULSE · deux plaques",
        "DEL rouge, résistance de 330 Ω et condensateur de 10 nF en parallèle "
        "sur la DEL. PULSE 0/5 V ; observer les points vers 300 µs et 800 µs.",
    )
    builder.add("voltage_source", "V1", {"p": "pulse", "n": "gnd"}, 5, 120, 220,
                waveform={"kind": "pulse", "low": 0, "high": 5, "delay": 0.0001,
                          "rise": 1e-6, "fall": 1e-6, "width": 0.0004, "period": 0.001})
    builder.add("resistor", "R1", {"p": "pulse", "n": "led"}, 330, 320, 140)
    builder.add("led", "LED1", {"a": "led", "k": "gnd"}, x=530, y=230)
    builder.add("capacitor", "C1", {"p": "led", "n": "gnd"}, 1e-8, 530, 360,
                initial_voltage=0)
    builder.add("ground", "G1", {"g": "gnd"}, x=320, y=420)
    project = builder.finish()
    project["default_analysis"] = {"kind": "tran", "step": 2e-6, "stop": 0.002}
    project["breadboard"]["board_count"] = 2
    project = plan_breadboard_layout(project)
    before = topology(project)["terminal_to_net"]
    for component_id in ("LED1", "C1"):
        component = next(c for c in project["components"] if c["id"] == component_id)
        for terminal in component["pins"].values():
            hole = project["breadboard"]["placements"][terminal]
            project["breadboard"]["placements"][terminal] = f"2:{hole}"
        footprint = project["breadboard"]["footprints"][component_id]
        footprint["pins"] = {name: f"2:{hole}" for name, hole in footprint["pins"].items()}
    # Le transfert change seulement l'emplacement : tous les réseaux canoniques restent identiques.
    assert topology(project)["terminal_to_net"] == before
    return Store(project).get_state()["project"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8876)
    parser.add_argument("--frame-delay-ms", type=int, default=1200,
                        help="Latence artificielle de lecture, uniquement sur ce service de test.")
    parser.add_argument("--dist", type=Path, default=PROJECT_ROOT / "frontend" / "dist")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or args.port == 8765:
        parser.error("Choisir un port de test libre, distinct du service utilisateur 8765.")
    if not 0 <= args.frame_delay_ms <= 3000:
        parser.error("Le délai de lecture doit être compris entre 0 et 3000 ms.")
    dist = args.dist.resolve()
    if not (dist / "index.html").is_file():
        parser.error("Compiler le frontend puis fournir son dossier avec --dist.")

    # server.py crée une app par défaut à l'import. Copier le package avant de
    # l'importer garantit que même ce runtime implicite est temporaire.
    with tempfile.TemporaryDirectory(prefix="atelier-playback-review-") as scratch:
        sandbox = Path(scratch)
        shutil.copytree(PROJECT_ROOT / "backend", sandbox / "backend",
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        (sandbox / "frontend").mkdir()
        (sandbox / "frontend" / "dist").symlink_to(dist, target_is_directory=True)
        sys.path.insert(0, str(sandbox))
        import uvicorn
        import backend.server as server
        from backend.domain import Store

        app = server.create_app(Store(review_project()), sandbox / "review-runtime")

        @app.middleware("http")
        async def slow_frame(request, call_next):
            if request.url.path == "/api/results/frame":
                await asyncio.sleep(args.frame_delay_ms / 1000)
            return await call_next(request)

        print(f"Revue ISOLÉE : http://127.0.0.1:{args.port}/", flush=True)
        print(f"Lectures retardées de {args.frame_delay_ms} ms ; Ctrl+C termine et supprime le runtime.", flush=True)
        uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
