import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(new URL("../src/svgExport.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const { svgMeasurementProvenance } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);
const simulation = () => ({
  status: "success",
  project_revision: 3,
  simulation_id: "a".repeat(32),
  circuit_fingerprint: "b".repeat(64),
  analysis: { kind: "tran" },
  time: [0, 0.001, 0.004, 0.01],
  sample_index: 1,
  sample_time: 0.001,
  sample_count: 4,
});

test("le SVG identifie le calcul et le point affiché, sans utiliser un temps demandé ultérieur", () => {
  const sim = { ...simulation(), requested_time: 0.01, requested_index: 3 };
  const before = structuredClone(sim);
  const description = svgMeasurementProvenance(sim);
  assert.match(description, /révision 3/);
  assert.match(description, new RegExp(`calcul ${sim.simulation_id}`));
  assert.match(description, new RegExp(`empreinte ${sim.circuit_fingerprint}`));
  assert.match(description, /échantillon 2\/4 à t=0\.001 s/);
  assert.doesNotMatch(description, /t=0\.01 s/);
  assert.deepEqual(sim, before);
});

test("le dernier point TRAN et le temps zéro sont explicitement identifiés", () => {
  const last = simulation();
  delete last.sample_index;
  delete last.sample_time;
  delete last.sample_count;
  assert.match(svgMeasurementProvenance(last), /échantillon 4\/4 à t=0\.01 s/);
  assert.match(
    svgMeasurementProvenance({
      ...simulation(),
      sample_index: 0,
      sample_time: 0,
    }),
    /échantillon 1\/4 à t=0 s/,
  );
});

test("une provenance temporelle invalide ne reçoit ni faux temps ni faux indice", () => {
  for (const changes of [
    { sample_time: undefined },
    { sample_index: 0.5 },
    { sample_index: -1 },
    { sample_index: 4 },
    { sample_count: 3 },
    { sample_count: 6001 },
    { sample_time: Infinity },
    { sample_time: 0.004 },
  ]) {
    const description = svgMeasurementProvenance({
      ...simulation(),
      ...changes,
    });
    assert.match(description, /provenance temporelle indisponible/);
    assert.doesNotMatch(description, /échantillon \d|t=/);
  }
});

test("les résultats absents, échoués et obsolètes restent explicitement distincts", () => {
  assert.equal(svgMeasurementProvenance(null), "Aucune mesure calculée.");
  assert.match(
    svgMeasurementProvenance({ ...simulation(), status: "error" }),
    /Aucune mesure courante/,
  );
  assert.match(
    svgMeasurementProvenance(simulation(), true),
    /révision 3, obsolètes/,
  );
  assert.match(
    svgMeasurementProvenance({ ...simulation(), stale: true }),
    /obsolètes/,
  );
  const dc = { ...simulation(), analysis: { kind: "op" }, time: [] };
  assert.doesNotMatch(svgMeasurementProvenance(dc), /échantillon|t=/);
});
