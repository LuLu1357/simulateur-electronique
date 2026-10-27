import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Le module est pur et sans dépendance ; ce chargement teste le TypeScript réel
// sans imposer de second framework de tests ni recopier son implémentation.
const source = await readFile(new URL('../src/visuals.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true },
});
const { voltageKnown, magnitudeIntensity, voltageColor, particleDuration, flowDirection, fitCircuitView } =
  await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'));

const rgb = color => color.slice(1).match(/../g).map(channel => parseInt(channel, 16));

test('la couleur distingue les potentiels positifs, négatifs et nuls', () => {
  assert.equal(voltageColor(0), '#64748b');
  assert.equal(voltageColor(5), '#47e19a');
  assert.equal(voltageColor(-5), '#55a1ff');
  assert.notEqual(voltageColor(2.5), voltageColor(-2.5));
  const positive = rgb(voltageColor(2.5));
  const negative = rgb(voltageColor(-2.5));
  assert.ok(positive[1] > positive[2], 'potentiel positif à dominante verte');
  assert.ok(negative[2] > negative[1], 'potentiel négatif à dominante bleue');
});

test('les tensions inconnues restent neutres et identifiables comme inconnues', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, '5']) {
    assert.equal(voltageKnown(value), false);
    assert.equal(voltageColor(value), '#64748b');
    assert.equal(magnitudeIntensity(value), 0);
  }
  for (const value of [0, -0, 1, -2, Number.MAX_VALUE]) assert.equal(voltageKnown(value), true);
});

test('le dégradé sature symétriquement sans inverser les couleurs', () => {
  assert.equal(voltageColor(50), voltageColor(5));
  assert.equal(voltageColor(-50), voltageColor(-5));
  assert.equal(voltageColor(2.5, 2.5), voltageColor(5));
  assert.equal(voltageColor(-2.5, 2.5), voltageColor(-5));
  for (const range of [0, -5, Infinity, NaN]) assert.equal(voltageColor(2, range), voltageColor(2, 5));
});

test('l’intensité est finie, croissante et bornée entre 0 et 1', () => {
  let previous = 0;
  for (const value of [0, 0.01, 0.1, 1, 2.5, 4.9, 5, 6, Number.MAX_VALUE]) {
    const intensity = magnitudeIntensity(value);
    assert.ok(Number.isFinite(intensity) && intensity >= 0 && intensity <= 1);
    assert.ok(intensity >= previous);
    assert.equal(intensity, magnitudeIntensity(-value));
    previous = intensity;
  }
  assert.equal(magnitudeIntensity(2.5), 0.5);
});

test('les durées restent bornées même pour des valeurs extrêmes', () => {
  const currents = [0, -0, 1e-300, 1e-6, 0.005, -0.005, 1e300, Number.MAX_VALUE, NaN, Infinity, -Infinity];
  const speeds = [1, 0.1, 2, 1e-300, 1e300, 0, -1, NaN, Infinity];
  for (const current of currents) for (const speed of speeds) {
    const duration = particleDuration(current, speed);
    assert.ok(Number.isFinite(duration) && duration >= 0.4 && duration <= 8, `${current}, ${speed} => ${duration}`);
  }
});

test('le signe détermine le sens ailleurs, pas la durée de l’animation', () => {
  for (const current of [0, 1e-6, 0.005, 1]) assert.equal(particleDuration(current, 1), particleDuration(-current, 1));
  assert.ok(particleDuration(0.005, 2) < particleDuration(0.005, 1));
  assert.ok(particleDuration(0.01, 1) < particleDuration(1e-6, 1));
  assert.equal(particleDuration(NaN, 1), 8);
});


test('le sens des électrons s’inverse par rapport au courant conventionnel', () => {
  assert.equal(flowDirection(0.005, 'conventional'), 'forward');
  assert.equal(flowDirection(0.005, 'electrons'), 'reverse');
  assert.equal(flowDirection(-0.005, 'conventional'), 'reverse');
  assert.equal(flowDirection(-0.005, 'electrons'), 'forward');
});

test('courant nul ou inconnu : sens de repli stable, sans prétendre un déplacement', () => {
  for (const current of [0, -0, NaN, Infinity, -Infinity]) {
    assert.equal(flowDirection(current, 'conventional'), 'forward');
    assert.equal(flowDirection(current, 'electrons'), 'forward');
  }
  assert.equal(particleDuration(0, 1), 6);
});

test('une vitesse visuelle nulle ou négative utilise le réglage par défaut', () => {
  for (const speed of [0, -0, -1, -100, NaN, Infinity, -Infinity]) {
    assert.equal(particleDuration(0.005, speed), particleDuration(0.005, 1));
  }
});


function assertFits(positions, view, width = 900, height = 360) {
  for (const point of positions) {
    const left = (point.x - 100) * view.zoom + view.pan.x;
    const right = (point.x + 100) * view.zoom + view.pan.x;
    const top = (point.y - 80) * view.zoom + view.pan.y;
    const bottom = (point.y + 80) * view.zoom + view.pan.y;
    assert.ok(left >= -1e-7 && right <= width + 1e-7, `bornes horizontales ${left}, ${right}`);
    assert.ok(top >= -1e-7 && bottom <= height + 1e-7, `bornes verticales ${top}, ${bottom}`);
  }
}

test('le cadrage inclut les composants bas des exemples et les marges de libellés', () => {
  const positions = [{ x: 100, y: 220 }, { x: 300, y: 130 }, { x: 500, y: 300 }, { x: 300, y: 420 }];
  const view = fitCircuitView(positions);
  assertFits(positions, view);
  assert.ok(view.zoom > 0 && view.zoom <= 1.5);
  const centerX = ((100 + 500) / 2) * view.zoom + view.pan.x;
  const centerY = ((130 + 420) / 2) * view.zoom + view.pan.y;
  assert.equal(centerX, 450);
  assert.equal(centerY, 180);
});

test('un grand circuit reste entièrement visible sans plancher de zoom arbitraire', () => {
  const positions = [{ x: -1e9, y: -1e9 }, { x: 1e9, y: 1e9 }, { x: 0, y: 0 }];
  const view = fitCircuitView(positions);
  assert.ok(view.zoom > 0 && view.zoom < 0.01);
  assertFits(positions, view);
});

test('le cadrage respecte les dimensions fournies et plafonne le grossissement', () => {
  const positions = [{ x: 150, y: 150 }];
  const view = fitCircuitView(positions, 1200, 800);
  assert.equal(view.zoom, 1.5);
  assertFits(positions, view, 1200, 800);
  const narrow = fitCircuitView(positions, 100, 100);
  assertFits(positions, narrow, 100, 100);
});

test('un contenu vide, malformé ou des dimensions invalides utilisent le cadrage par défaut', () => {
  const fallback = { zoom: 1, pan: { x: 0, y: 0 } };
  for (const positions of [[], null, undefined, {}, [null], [{ x: NaN, y: 1 }], [{ x: 1, y: Infinity }], [{ x: 1, y: 1 }, { x: -Infinity, y: 2 }], [{ x: '5', y: 1 }]]) {
    assert.deepEqual(fitCircuitView(positions), fallback);
  }
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(fitCircuitView([{ x: 1, y: 1 }], invalid, 360), fallback);
    assert.deepEqual(fitCircuitView([{ x: 1, y: 1 }], 900, invalid), fallback);
  }
});

test('le cadrage produit toujours des nombres finis pour des coordonnées finies extrêmes', () => {
  const cases = [
    [{ x: Number.MAX_VALUE, y: Number.MAX_VALUE }],
    [{ x: -Number.MAX_VALUE, y: -Number.MAX_VALUE }, { x: Number.MAX_VALUE, y: Number.MAX_VALUE }],
    [{ x: 1e300, y: -1e300 }, { x: -1e300, y: 1e300 }],
  ];
  for (const positions of cases) {
    for (const size of [[900, 360], [Number.MAX_VALUE, Number.MAX_VALUE], [Number.MIN_VALUE, Number.MIN_VALUE]]) {
      const { zoom, pan } = fitCircuitView(positions, ...size);
      assert.ok(Number.isFinite(zoom) && zoom > 0 && zoom <= 1.5);
      assert.ok(Number.isFinite(pan.x) && Number.isFinite(pan.y));
    }
  }
});

test('le cadrage est purement visuel et ne modifie pas les positions', () => {
  const positions = Object.freeze([Object.freeze({ x: 150, y: 420 })]);
  assert.doesNotThrow(() => fitCircuitView(positions));
  assert.deepEqual(positions, [{ x: 150, y: 420 }]);
});
