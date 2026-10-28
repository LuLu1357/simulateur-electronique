import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compiled = ts.transpileModule(
  await readFile(
    new URL("../src/scopeMeasurements.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const { measureScopeCurve } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);
const close = (actual, expected, tolerance = 1e-13) => {
  assert.equal(typeof actual, "number");
  assert.ok(Number.isFinite(actual));
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} ≈ ${expected}`,
  );
};

test("une constante donne ses extrema, moyenne et valeur efficace sans muter les données", () => {
  const time = Object.freeze([0, 0.001, 0.1, 0.7, 1]);
  const values = Object.freeze([3, 3, 3, 3, 3]);
  assert.deepEqual(measureScopeCurve(time, values, { start: 0, end: 1 }), {
    sampleCount: 5,
    missingCount: 0,
    start: 0,
    end: 1,
    min: 3,
    max: 3,
    peakToPeak: 0,
    mean: 3,
    rms: 3,
  });
  const zero = measureScopeCurve([0, 1], [0, 0], { start: 0, end: 1 });
  assert.equal(zero.mean, 0);
  assert.equal(zero.rms, 0);
});

test("la rampe y=t sur pas adaptatifs a moyenne ½ et efficace 1/√3", () => {
  const time = [0, 0.01, 0.07, 0.38, 0.9, 1];
  const measured = measureScopeCurve(time, time, { start: 0, end: 1 });
  close(measured.mean, 0.5);
  close(measured.rms, 1 / Math.sqrt(3));
  assert.equal(measured.min, 0);
  assert.equal(measured.max, 1);
  assert.equal(measured.peakToPeak, 1);
  // Une moyenne arithmétique de ces points serait différente de ½.
  assert.ok(
    Math.abs(time.reduce((a, b) => a + b) / time.length - measured.mean) > 0.05,
  );
});

test("un sinus échantillonné finement sur un cycle approche moyenne 0 et efficace 1/√2", () => {
  const time = Array.from(
    { length: 4097 },
    (_, i) => 2 * Math.PI * (i / 4096) ** 1.7,
  );
  const values = time.map(Math.sin);
  const measured = measureScopeCurve(time, values, {
    start: 0,
    end: 2 * Math.PI,
  });
  close(measured.mean, 0, 1e-6);
  close(measured.rms, Math.SQRT1_2, 1e-6);
  close(measured.peakToPeak, 2, 1e-6);
});

test("le signe affecte la moyenne, mais la valeur efficace reste positive", () => {
  const constant = measureScopeCurve([0, 0.2, 1], [-2, -2, -2], {
    start: 0,
    end: 1,
  });
  assert.equal(constant.mean, -2);
  assert.equal(constant.rms, 2);
  assert.equal(constant.min, -2);
  assert.equal(constant.max, -2);
  const ramp = measureScopeCurve([0, 0.1, 1], [-2, -1.8, 0], {
    start: 0,
    end: 1,
  });
  close(ramp.mean, -1);
  close(ramp.rms, 2 / Math.sqrt(3));
});

test("le zoom ne mesure que les points inclus, avec leur intervalle exact et sans prolonger les bords", () => {
  const measured = measureScopeCurve(
    [0, 0.1, 0.4, 0.8, 1],
    [100, 1, 4, 8, 100],
    { start: 0.11, end: 0.9 },
  );
  assert.equal(measured.sampleCount, 2);
  assert.equal(measured.missingCount, 0);
  assert.equal(measured.start, 0.4);
  assert.equal(measured.end, 0.8);
  assert.equal(measured.min, 4);
  assert.equal(measured.max, 8);
  close(measured.mean, 6);
  close(measured.rms, Math.sqrt(112 / 3));
  const inclusive = measureScopeCurve([0, 0.4, 0.8, 1], [100, 4, 8, 100], {
    start: 0.4,
    end: 0.8,
  });
  assert.deepEqual(inclusive, measured);
});

test("une valeur absente garde les extrema connus mais empêche toute intégration à travers le trou", () => {
  for (const values of [
    [1, NaN, 3],
    [1, Infinity, 3],
    [1, 2],
    [1, undefined, 3],
  ]) {
    const measured = measureScopeCurve([0, 1, 2], values, { start: 0, end: 2 });
    assert.equal(measured.sampleCount, 3);
    assert.equal(measured.missingCount, 1);
    assert.equal(measured.start, 0);
    assert.equal(measured.end, 2);
    assert.equal(measured.mean, null);
    assert.equal(measured.rms, null);
    assert.equal(measured.min, 1);
    assert.equal(measured.max, values.length === 2 ? 2 : 3);
  }
  const missingEdges = measureScopeCurve([0, 1, 2], [NaN, 2, NaN], {
    start: 0,
    end: 2,
  });
  assert.equal(missingEdges.start, 0);
  assert.equal(missingEdges.end, 2);
  assert.equal(missingEdges.missingCount, 2);
  assert.equal(missingEdges.min, 2);
});

test("un horodatage inconnu entre points ou des temps hors ordre ne créent pas de continuité fictive", () => {
  for (const time of [
    [0, NaN, 2],
    [0, Infinity, 2],
    [0, 0, 2],
    [0, 2, 1],
    [0, 3, 1, 2],
  ]) {
    const measured = measureScopeCurve(
      time,
      time.map(() => 2),
      { start: 0, end: 2 },
    );
    assert.equal(measured.mean, null);
    assert.equal(measured.rms, null);
    assert.equal(measured.min, 2);
    assert.equal(measured.max, 2);
  }
  // Les données invalides hors de l'intervalle mesuré n'annulent pas ce dernier.
  const measured = measureScopeCurve(
    [NaN, -1, 0, 1, 2, NaN],
    [NaN, NaN, 2, 2, NaN, NaN],
    { start: 0, end: 1 },
  );
  assert.equal(measured.mean, 2);
  assert.equal(measured.rms, 2);
});

test("un point isolé conserve ses extrema mais n’invente ni moyenne ni efficace", () => {
  const measured = measureScopeCurve([0, 1, 2], [2, -3, 5], {
    start: 0.5,
    end: 1.5,
  });
  assert.deepEqual(measured, {
    sampleCount: 1,
    missingCount: 0,
    start: 1,
    end: 1,
    min: -3,
    max: -3,
    peakToPeak: 0,
    mean: null,
    rms: null,
  });
  const unknown = measureScopeCurve([1], [NaN], { start: 1, end: 1 });
  assert.equal(unknown.sampleCount, 1);
  assert.equal(unknown.missingCount, 1);
  for (const key of ["min", "max", "peakToPeak", "mean", "rms"])
    assert.equal(unknown[key], null);
});

test("une fenêtre vide ou invalide expose des mesures indisponibles", () => {
  for (const range of [
    { start: 0.1, end: 0.9 },
    { start: 3, end: 4 },
    { start: 2, end: 1 },
    { start: NaN, end: 1 },
    { start: 0, end: Infinity },
  ]) {
    const measured = measureScopeCurve([0, 1, 2], [1, 2, 3], range);
    assert.equal(measured.sampleCount, 0);
    assert.equal(measured.missingCount, 0);
    for (const key of [
      "start",
      "end",
      "min",
      "max",
      "peakToPeak",
      "mean",
      "rms",
    ])
      assert.equal(measured[key], null);
  }
});

test("les amplitudes extrêmes finies sont normalisées avant carrés, sommes et intégration", () => {
  const extreme = Number.MAX_VALUE;
  const constant = measureScopeCurve([0, 1], [extreme, extreme], {
    start: 0,
    end: 1,
  });
  assert.equal(constant.mean, extreme);
  assert.equal(constant.rms, extreme);
  assert.equal(constant.peakToPeak, 0);
  const bipolar = measureScopeCurve([0, 1], [-extreme, extreme], {
    start: 0,
    end: 1,
  });
  assert.equal(bipolar.mean, 0);
  close(bipolar.rms / extreme, 1 / Math.sqrt(3), 1e-15);
  assert.equal(bipolar.peakToPeak, null);
});

test("des durées extrêmes ou subnormales conservent leurs rapports sans déborder", () => {
  const extreme = Number.MAX_VALUE;
  const long = measureScopeCurve([-extreme, 0, extreme], [0, 1, 0], {
    start: -extreme,
    end: extreme,
  });
  close(long.mean, 0.5);
  close(long.rms, 1 / Math.sqrt(3));
  const tiny = Number.MIN_VALUE;
  const short = measureScopeCurve([tiny, 2 * tiny, 4 * tiny], [0, 1, 3], {
    start: tiny,
    end: 4 * tiny,
  });
  close(short.mean, 1.5);
  close(short.rms, Math.sqrt(3));
  const offset = 1e308,
    step = 2e292;
  const shifted = measureScopeCurve(
    [offset, offset + step, offset + 2 * step],
    [0, 1, 2],
    { start: offset, end: offset + 2 * step },
  );
  close(shifted.mean, 1);
  close(shifted.rms, 2 / Math.sqrt(3));
});
