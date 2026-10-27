import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/preferences.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true },
});
const { defaultPreferences, preferencesStorageKey, readPreferences, writePreferences } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64')
);

function storageWith(raw = null) {
  const values = new Map(raw === null ? [] : [[preferencesStorageKey, raw]]);
  const writes = [];
  return {
    writes, values,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push([key, value]); values.set(key, value); },
  };
}
const saved = overrides => JSON.stringify({ version: 1, ...defaultPreferences, ...overrides });

test('sans stockage ou réglages sauvegardés, les valeurs par défaut restent indépendantes', () => {
  for (const storage of [null, undefined, storageWith()]) assert.deepEqual(readPreferences(storage, false), defaultPreferences);
  const first = readPreferences(null, false);
  first.showVolts = false;
  assert.equal(readPreferences(null, false).showVolts, true);
  assert.equal(Object.isFrozen(defaultPreferences), true);
});

test('les six préférences valides survivent à une écriture puis une lecture', () => {
  const storage = storageWith();
  const preferences = { showVolts: false, showCurrent: true, voltageColors: false, voltageRange: 12, flowMode: 'conventional', flowSpeed: 1.75 };
  assert.equal(writePreferences(storage, preferences), true);
  assert.deepEqual(readPreferences(storage, false), preferences);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0][0], preferencesStorageKey);
});

test('le JSON malformé, null, tableaux et versions inconnues reviennent aux valeurs par défaut', () => {
  for (const raw of ['{', 'null', '[]', '[{"version":1}]', 'true', '42', '"preferences"', saved({ version: 2 }), saved({ version: '1' }), JSON.stringify({ showVolts: false })]) {
    assert.deepEqual(readPreferences(storageWith(raw), false), defaultPreferences, raw);
  }
});

test('chaque booléen est strict et une valeur invalide préserve les autres champs valides', () => {
  const valid = { showVolts: false, showCurrent: true, voltageColors: false, voltageRange: 12, flowMode: 'off', flowSpeed: 2 };
  for (const field of ['showVolts', 'showCurrent', 'voltageColors']) {
    for (const invalid of [0, 1, 'true', 'false', null, [], {}]) {
      const actual = readPreferences(storageWith(saved({ ...valid, [field]: invalid })), false);
      assert.deepEqual(actual, { ...valid, [field]: defaultPreferences[field] });
    }
  }
});

test('l’échelle de tension et la vitesse acceptent uniquement des nombres finis dans leurs limites', () => {
  for (const [field, minimum, maximum] of [['voltageRange', 0.1, 1e6], ['flowSpeed', 0.25, 3]]) {
    for (const value of [minimum, (minimum + maximum) / 2, maximum]) {
      assert.equal(readPreferences(storageWith(saved({ [field]: value })), false)[field], value);
    }
    for (const value of [0, -1, minimum / 2, maximum + 1, `${minimum}`, true, null, [], {}]) {
      assert.equal(readPreferences(storageWith(saved({ [field]: value })), false)[field], defaultPreferences[field]);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      const storage = storageWith();
      writePreferences(storage, { ...defaultPreferences, [field]: value });
      assert.equal(JSON.parse(storage.writes[0][1])[field], defaultPreferences[field]);
    }
  }
});

test('le mode de déplacement est une énumération stricte', () => {
  for (const flowMode of ['electrons', 'conventional', 'off']) assert.equal(readPreferences(storageWith(saved({ flowMode })), false).flowMode, flowMode);
  for (const flowMode of ['', 'Electrons', 'unknown', 1, true, null, [], {}]) assert.equal(readPreferences(storageWith(saved({ flowMode })), false).flowMode, 'electrons');
});

test('le mouvement réduit arrête au chargement même un mode actif sauvegardé', () => {
  const preferences = { showVolts: false, showCurrent: true, voltageColors: false, voltageRange: 24, flowMode: 'conventional', flowSpeed: 2 };
  const storage = storageWith(saved(preferences));
  const loaded = readPreferences(storage, true);
  assert.deepEqual(loaded, { ...preferences, flowMode: 'off' });
  assert.deepEqual(readPreferences(null, true), { ...defaultPreferences, flowMode: 'off' });
  // La lecture ne réécrit rien, et la session peut choisir ensuite une animation.
  assert.equal(storage.writes.length, 0);
  loaded.flowMode = 'electrons';
  assert.equal(writePreferences(storage, loaded), true);
  assert.equal(readPreferences(storage, false).flowMode, 'electrons');
  assert.equal(readPreferences(storage, true).flowMode, 'off');
});

test('un stockage refusé, indisponible ou plein ne propage aucune exception', () => {
  const denied = { getItem() { throw new Error('Access denied'); }, setItem() { throw new Error('Quota exceeded'); } };
  assert.deepEqual(readPreferences(denied, false), defaultPreferences);
  assert.equal(writePreferences(denied, defaultPreferences), false);
  assert.equal(writePreferences(null, defaultPreferences), false);
  assert.equal(writePreferences(undefined, defaultPreferences), false);
  const inaccessible = new Proxy({}, { get() { throw new Error('Storage inaccessible'); } });
  assert.deepEqual(readPreferences(inaccessible, false), defaultPreferences);
  assert.equal(writePreferences(inaccessible, defaultPreferences), false);
});

test('l’écriture exclut circuit, simulation, jeton et tout champ étranger', () => {
  const storage = storageWith();
  const secret = 'jeton-a-ne-jamais-ecrire';
  const preferences = { ...defaultPreferences, token: secret, circuit: { title: 'Projet privé' }, simulation: { voltages: { supply: 5 } }, foreign: 'exclu', version: 999 };
  assert.equal(writePreferences(storage, preferences), true);
  const raw = storage.writes[0][1];
  assert.deepEqual(JSON.parse(raw), { version: 1, ...defaultPreferences });
  for (const absent of [secret, 'token', 'circuit', 'simulation', 'foreign', 'Projet privé']) assert.equal(raw.includes(absent), false);
});

test('les données étrangères chargées et les accesseurs ne sont jamais recopiés ou exécutés', () => {
  const storage = storageWith(saved({ token: 'secret', foreign: { showVolts: false } }));
  assert.deepEqual(readPreferences(storage, false), defaultPreferences);
  let invoked = false;
  const unsafe = { ...defaultPreferences, toJSON() { invoked = true; throw new Error('Ne doit pas être appelé'); } };
  Object.defineProperty(unsafe, 'showVolts', { get() { invoked = true; throw new Error('Ne doit pas être lu'); } });
  assert.equal(writePreferences(storage, unsafe), true);
  assert.equal(invoked, false);
  assert.deepEqual(JSON.parse(storage.writes[0][1]), { version: 1, ...defaultPreferences });
});

test('une entrée d’écriture nulle ou malformée n’empêche pas la sauvegarde de réglages sûrs', () => {
  for (const value of [null, undefined, [], ['active'], true, 'mode']) {
    const storage = storageWith();
    assert.equal(writePreferences(storage, value), true);
    assert.deepEqual(JSON.parse(storage.writes[0][1]), { version: 1, ...defaultPreferences });
  }
});
