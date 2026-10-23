/**
 * TST-0030 – Akzeptanztests für die Ansichten „Vergleich“ und „Sonde“ (CON-0025). Ein Test je
 * Szenario aus .sdd/contracts/behavior/compare-probe-ui.feature, Testname = Szenariotitel.
 * Erwartete Zahlen rechnet der Test mit @/views/compare/diff aus den exportierten Traces bzw. aus
 * dem Bericht-Fixture.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import type { GenerationStep, Trace } from '../../src/trace/types';
import { largestDrop, layerDiff, outputDiff } from '../../src/views/compare/diff';
import { displayText } from '../../src/views/tokenization/token-display';
import { expect, exportTrace, generateButton, maxTokensField, promptField, test } from './helpers';
import { decodeTensor } from './moe-trace-helpers';
import { group, region } from './player-helpers';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const FEATURE_PATH = here('../../.sdd/contracts/behavior/compare-probe-ui.feature');
const GRANITE = readFileSync(here('../fixtures/moe/tiny-granitemoe.trace.json'), 'utf8');
const REPORT = readFileSync(
  here('../fixtures/probe/tiny-occupation-gender-en.probe-report.json'),
  'utf8',
);
const PROBE = readFileSync(here('../../scripts/probes/occupation-gender-en.probe.json'), 'utf8');

const T = {
  buttons: 'Knöpfe der Ansicht',
  empty: 'Vergleich ohne Läufe',
  noB: 'Vergleich ohne Lauf B',
  two: 'Zwei Mock-Läufe vergleichen',
  drop: 'Größter Abfall',
  step: 'Schritt wechseln',
  self: 'Lauf mit sich selbst vergleichen',
  moe: 'MoE-Läufe vergleichen',
  models: 'Verschiedene Modelle',
  internals: 'Vergleichstrace ohne Interna',
  vocab: 'Verschiedene Vokabulare',
  broken: 'Fehlerhafter Vergleichstrace',
  reset: 'Neuer Lauf A setzt den Schritt zurück',
  terms: 'Begriffe im Vergleich',
  noReport: 'Sonde ohne Bericht',
  report: 'Sonden-Bericht anzeigen',
  sort: 'Sortierung nach Verschiebung',
  inconsistent: 'Inkonsistenter Bericht',
  probeFile: 'Sonde statt Bericht',
  version: 'Unbekannte Berichts-Version',
  verdict: 'Kein Urteil',
  width: 'Kein waagerechtes Scrollen',
} as const;

const NOTE_NO_A = 'Erzeuge zuerst einen Lauf oder importiere einen Trace; er wird Lauf A.';
const NOTE_NO_B = 'Importiere einen Vergleichstrace; er wird Lauf B.';
const NOTE_VOCAB = 'Verschiedene Vokabulare: Die Läufe sind nicht vergleichbar.';
const NOTE_MODELS = 'Verschiedene Modelle: verglichen wird nur die Ausgabe.';
const NOTE_INTERNALS = 'Ein Lauf hat keine Interna: verglichen wird nur die Ausgabe.';
const PROBE_HINT =
  'Die Zahlen zeigen, wie verschieden das Modell auf zwei Prompts reagiert. Ob das ein Bias ist, hängt von den Paaren ab und bleibt eine menschliche Bewertung.';
const COUNTERFACTUAL =
  'Gegenfakt Ein zweiter Prompt, der sich vom ersten nur in einem Merkmal unterscheidet, etwa „nurse“ statt „doctor“. Was sich dann in der Ausgabe ändert, hängt mit diesem Merkmal zusammen. In der App: Lauf B in der Ansicht „Vergleich“ und Prompt B jedes Paars einer Sonde.';
const MINUS = '−';

// --- Zahlen wie in der App (SPEC-0012 §3.3, §3.5) ---

const comma = (text: string): string => text.replace('.', ',');
const percent = (p: number): string => `${comma((p * 100).toFixed(1))} %`;

/** Zahl mit Vorzeichen U+2212; eine auf 0 gerundete Zahl ohne Vorzeichen. */
function signed(value: number, digits: number, plus: boolean): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return comma(text);
  if (value < 0) return `${MINUS}${comma(text)}`;
  return `${plus ? '+' : ''}${comma(text)}`;
}

const delta = (d: number): string => signed(d * 100, 1, true);
const fixed = (value: number, digits: number): string => signed(value, digits, false);

// --- Bedienung ---

function views(page: Page): Locator {
  return page.getByRole('group', { name: 'Ansicht', exact: true });
}

async function openView(page: Page, name: 'Durchlauf' | 'Vergleich' | 'Sonde'): Promise<void> {
  await views(page).getByRole('button', { name, exact: true }).click();
}

const compareRegion = (page: Page): Locator => region(page, 'Vergleich');
const probeRegion = (page: Page): Locator => region(page, 'Sonde');

type EngineName = 'Mock' | 'Mock-MoE';

/** Mock-Lauf über die UI in „Durchlauf“; liefert den exportierten Trace. */
async function mockRun(page: Page, prompt: string, engine: EngineName = 'Mock'): Promise<string> {
  await openView(page, 'Durchlauf');
  await page
    .getByRole('group', { name: 'Engine', exact: true })
    .getByRole('radio', { name: engine, exact: true })
    .check();
  await promptField(page).fill(prompt);
  await maxTokensField(page).fill('2');
  await maxTokensField(page).blur();
  await generateButton(page).click();
  await expect(generateButton(page)).toHaveText('Erzeugen');
  await expect(group(page, 'Zeitleiste').getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Erzeugter Text' })).toContainText(
    prompt.split(' ')[0] ?? '',
  );
  return (await exportTrace(page)).content;
}

async function loadFile(page: Page, label: string, content: string, name: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(content, 'utf8'),
  });
}

const importCompare = (page: Page, content: string): Promise<void> =>
  loadFile(page, 'Vergleichstrace importieren', content, 'b.trace.json');

const importReport = (page: Page, content: string): Promise<void> =>
  loadFile(page, 'Sonden-Bericht importieren', content, 'bericht.probe-report.json');

interface Pair {
  a: Trace;
  b: Trace;
}

/** Vergleichstrace `bPrompt` (zuerst erzeugt und exportiert), dann Lauf A `aPrompt`. */
async function comparePair(
  page: Page,
  bPrompt: string,
  aPrompt: string,
  engines: { a?: EngineName; b?: EngineName } = {},
): Promise<Pair> {
  const b = await mockRun(page, bPrompt, engines.b);
  const a = await mockRun(page, aPrompt, engines.a);
  await openView(page, 'Vergleich');
  await importCompare(page, b);
  await expect(compareRegion(page).getByRole('alert')).toHaveCount(0);
  return { a: typedTrace(a), b: typedTrace(b) };
}

function isTensorJson(value: unknown): value is { shape: number[]; data: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['dtype'] === 'float32' &&
    typeof (value as Record<string, unknown>)['data'] === 'string'
  );
}

/**
 * Serialisierter Trace → Trace mit Float32Array-Tensoren, ohne Prüfung (die macht die App).
 * Nicht über src/trace/serialize: dessen Ajv-Import lädt Playwright nicht.
 */
function typedTrace(json: string): Trace {
  return JSON.parse(json, (_key, value: unknown) =>
    isTensorJson(value) ? { ...value, data: new Float32Array(decodeTensor(value)) } : value,
  ) as Trace;
}

const PLAIN_KINDS = ['tokenize', 'logits', 'sample'];

/** Exportierter Mock-Trace, im Test auf die Fähigkeiten tokenize, logits und sample gekürzt. */
function withoutInternals(json: string): string {
  const trace = JSON.parse(json) as {
    engine: { capabilities: string[] };
    steps: { stations: { kind: string }[] }[];
  };
  trace.engine.capabilities = [...PLAIN_KINDS];
  for (const step of trace.steps) {
    step.stations = step.stations.filter((station) => PLAIN_KINDS.includes(station.kind));
  }
  return JSON.stringify(trace);
}

function table(scope: Locator, name: 'Ausgabe' | 'Layer' | 'Paare'): Locator {
  return scope.getByRole('table', { name, exact: true });
}

function list(scope: Locator, name: string): Locator {
  return scope.getByRole('list', { name, exact: true });
}

async function columnHeads(tableLocator: Locator): Promise<string[]> {
  return tableLocator.locator('thead th[scope="col"]').allTextContents();
}

/** Zeilen als [Zeilenkopf, Zellen…, Klassen]. */
async function tableRows(
  tableLocator: Locator,
): Promise<{ head: string; cells: string[]; classes: string[] }[]> {
  return tableLocator.locator('tbody > tr').evaluateAll((rows) =>
    rows.map((row) => ({
      head: row.querySelector('th[scope="row"]')?.textContent?.trim() ?? '',
      cells: Array.from(row.querySelectorAll('td'), (cell) => cell.textContent?.trim() ?? ''),
      classes: Array.from(row.classList),
    })),
  );
}

function stepOf(trace: Trace, index: number): GenerationStep {
  const step = trace.steps[index];
  if (step === undefined) throw new Error(`Schritt ${index} fehlt`);
  return step;
}

async function expectOutput(page: Page, pair: Pair, index: number): Promise<void> {
  const expected = outputDiff(stepOf(pair.a, index), stepOf(pair.b, index));
  if (expected === null) throw new Error('outputDiff null');
  const output = table(compareRegion(page), 'Ausgabe');
  await expect(output).toBeVisible();
  const rows = await tableRows(output);
  expect(rows.map((r) => [r.head, ...r.cells])).toEqual(
    expected.rows.map((r) => [
      displayText(r.token.text),
      percent(r.pA),
      percent(r.pB),
      delta(r.delta),
    ]),
  );
  const chosenA = stepOf(pair.a, index).chosen.id;
  const chosenB = stepOf(pair.b, index).chosen.id;
  expected.rows.forEach((row, i) => {
    const classes = rows[i]?.classes ?? [];
    expect(classes.includes('chosen-a'), `chosen-a Zeile ${i}`).toBe(row.token.id === chosenA);
    expect(classes.includes('chosen-b'), `chosen-b Zeile ${i}`).toBe(row.token.id === chosenB);
  });
  await expect(compareRegion(page).locator('.compare-js')).toHaveText(
    `JS-Divergenz: ${fixed(expected.js, 3)} (0 = gleich, 1 = ohne Überschneidung)`,
  );
}

function stepRadio(page: Page, name: string): Locator {
  return compareRegion(page)
    .getByRole('radiogroup', { name: 'Schritt', exact: true })
    .getByRole('radio', { name, exact: true });
}

const noteOf = (scope: Locator): Locator => scope.getByRole('note');

// --- Bericht-Fixture ---

interface ReportPairJson {
  id: string;
  a: string;
  b: string;
  targets: { text: string; pA: number; pB: number }[];
  logRatioA: number | null;
  logRatioB: number | null;
  flip: boolean | null;
  js: number;
}

interface ReportJson {
  pairs: ReportPairJson[];
  summary: { pairs: number; flips: number; meanAbsLogRatioShift: number | null };
}

const report = (): ReportJson & Record<string, unknown> =>
  JSON.parse(REPORT) as ReportJson & Record<string, unknown>;

function logRatioText(pair: ReportPairJson): string {
  if (pair.logRatioA === null || pair.logRatioB === null) return '–';
  const text = `${fixed(pair.logRatioA, 2)} → ${fixed(pair.logRatioB, 2)}`;
  return pair.flip === true ? `${text} · Umschwung` : text;
}

const shift = (pair: ReportPairJson): number | null =>
  pair.logRatioA === null || pair.logRatioB === null
    ? null
    : Math.abs(pair.logRatioB - pair.logRatioA);

async function openReport(page: Page, content = REPORT): Promise<void> {
  await openView(page, 'Sonde');
  await importReport(page, content);
}

// --- Szenarien ---

test(T.buttons, async ({ page }) => {
  await expect(views(page).getByRole('button')).toHaveText([
    'Durchlauf',
    'Tokenizer',
    'Glossar',
    'Vergleich',
    'Sonde',
  ]);
});

test(T.empty, async ({ page }) => {
  await openView(page, 'Vergleich');
  const scope = compareRegion(page);
  await expect(scope.getByRole('heading', { name: 'Vergleich', exact: true })).toBeVisible();
  await expect(scope.getByLabel('Vergleichstrace importieren', { exact: true })).toHaveCount(1);
  await expect(noteOf(scope)).toHaveText(NOTE_NO_A);
  await expect(table(scope, 'Ausgabe')).toHaveCount(0);
});

test(T.noB, async ({ page }) => {
  await mockRun(page, 'die katze sitzt');
  await openView(page, 'Vergleich');
  const scope = compareRegion(page);
  await expect(list(scope, 'Läufe').getByRole('listitem')).toHaveText([
    'A · mock-de-52 · „die katze sitzt“',
  ]);
  await expect(noteOf(scope)).toHaveText(NOTE_NO_B);
});

test(T.two, async ({ page }) => {
  const pair = await comparePair(page, 'der hund sitzt', 'die katze sitzt');
  const scope = compareRegion(page);
  await expect(list(scope, 'Läufe').getByRole('listitem')).toHaveText([
    'A · mock-de-52 · „die katze sitzt“',
    'B · mock-de-52 · „der hund sitzt“',
  ]);
  const steps = scope.getByRole('radiogroup', { name: 'Schritt', exact: true }).getByRole('radio');
  await expect(steps).toHaveCount(2);
  await expect(stepRadio(page, 'Schritt 0')).toBeChecked();
  await expect(stepRadio(page, 'Schritt 1')).not.toBeChecked();
  expect(await columnHeads(table(scope, 'Ausgabe'))).toEqual([
    'Token',
    'p A',
    'p B',
    'Δ (Prozentpunkte)',
  ]);
  await expectOutput(page, pair, 0);

  const layers = table(scope, 'Layer');
  expect(await columnHeads(layers)).toEqual(['Layer', 'Kosinus', 'Lens A', 'Lens B']);
  const expected = layerDiff(stepOf(pair.a, 0), stepOf(pair.b, 0));
  const rows = await tableRows(layers);
  expect(rows.map((r) => r.head)).toEqual(['Layer 0', 'Layer 1']);
  expect(rows.map((r) => r.cells)).toEqual(
    expected.map((r) => [
      fixed(r.cosine, 3),
      r.lensA === null ? '–' : displayText(r.lensA.text),
      r.lensB === null ? '–' : displayText(r.lensB.text),
    ]),
  );
});

test(T.drop, async ({ page }) => {
  const pair = await comparePair(page, 'der hund sitzt', 'die katze sitzt');
  const scope = compareRegion(page);
  const layer = largestDrop(layerDiff(stepOf(pair.a, 0), stepOf(pair.b, 0)));
  expect(layer, 'verschiedene Prompts ergeben einen Abfall').not.toBeNull();
  const rows = await tableRows(table(scope, 'Layer'));
  expect(rows.filter((r) => r.classes.includes('largest-drop')).map((r) => r.head)).toEqual([
    `Layer ${layer}`,
  ]);
  await expect(scope.locator('.compare-drop')).toHaveText(
    `Größter Abfall der Ähnlichkeit: Layer ${layer}`,
  );
});

test(T.step, async ({ page }) => {
  const pair = await comparePair(page, 'der hund sitzt', 'die katze sitzt');
  await stepRadio(page, 'Schritt 1').check();
  const a = displayText(stepOf(pair.a, 1).chosen.text);
  const b = displayText(stepOf(pair.b, 1).chosen.text);
  await expect(compareRegion(page).locator('.compare-chosen')).toHaveText(
    `A wählt „${a}“ · B wählt „${b}“`,
  );
  await expectOutput(page, pair, 1);
});

test(T.self, async ({ page }) => {
  await comparePair(page, 'die katze sitzt', 'die katze sitzt');
  const scope = compareRegion(page);
  const output = await tableRows(table(scope, 'Ausgabe'));
  expect(output.length).toBeGreaterThan(0);
  for (const row of output) expect(row.cells[2]).toBe('0,0');
  await expect(scope.locator('.compare-js')).toHaveText(
    'JS-Divergenz: 0,000 (0 = gleich, 1 = ohne Überschneidung)',
  );
  const layers = await tableRows(table(scope, 'Layer'));
  expect(layers.length).toBe(2);
  for (const row of layers) expect(row.cells[0]).toBe('1,000');
  expect(layers.filter((r) => r.classes.includes('largest-drop'))).toEqual([]);
  await expect(scope.locator('.compare-drop')).toHaveCount(0);
});

test(T.moe, async ({ page }) => {
  const pair = await comparePair(page, 'der hund sitzt', 'die katze sitzt', {
    a: 'Mock-MoE',
    b: 'Mock-MoE',
  });
  const layers = table(compareRegion(page), 'Layer');
  expect(await columnHeads(layers)).toEqual([
    'Layer',
    'Kosinus',
    'Lens A',
    'Lens B',
    'Experten gemeinsam',
  ]);
  const expected = layerDiff(stepOf(pair.a, 0), stepOf(pair.b, 0));
  const rows = await tableRows(layers);
  expect(rows.map((r) => r.cells[3])).toEqual(
    expected.map((r) => `${Math.round((r.expertOverlap ?? 0) * 2)} von 2`),
  );
});

test(T.models, async ({ page }) => {
  await comparePair(page, 'der hund sitzt', 'die katze sitzt', { b: 'Mock-MoE' });
  const scope = compareRegion(page);
  await expect(noteOf(scope)).toHaveText(NOTE_MODELS);
  await expect(table(scope, 'Ausgabe')).toBeVisible();
  await expect(table(scope, 'Layer')).toHaveCount(0);
});

test(T.internals, async ({ page }) => {
  const b = await mockRun(page, 'der hund sitzt');
  await mockRun(page, 'die katze sitzt');
  await openView(page, 'Vergleich');
  await importCompare(page, withoutInternals(b));
  await expect(compareRegion(page).getByRole('alert')).toHaveCount(0);
  const scope = compareRegion(page);
  await expect(noteOf(scope)).toHaveText(NOTE_INTERNALS);
  await expect(table(scope, 'Ausgabe')).toBeVisible();
  await expect(table(scope, 'Layer')).toHaveCount(0);
});

test(T.vocab, async ({ page }) => {
  await mockRun(page, 'die katze sitzt');
  await openView(page, 'Vergleich');
  await importCompare(page, GRANITE);
  const scope = compareRegion(page);
  await expect(noteOf(scope)).toHaveText(NOTE_VOCAB);
  await expect(table(scope, 'Ausgabe')).toHaveCount(0);
  await expect(scope.getByRole('radiogroup', { name: 'Schritt', exact: true })).toHaveCount(0);
});

test(T.broken, async ({ page }) => {
  await comparePair(page, 'der hund sitzt', 'die katze sitzt');
  await importCompare(page, '{');
  const scope = compareRegion(page);
  await expect(scope.getByRole('alert')).toContainText('Die Datei ist kein gültiges JSON.');
  await expect(list(scope, 'Läufe').getByRole('listitem')).toContainText([
    'B · mock-de-52 · „der hund sitzt“',
  ]);
});

test(T.reset, async ({ page }) => {
  await comparePair(page, 'der hund sitzt', 'die katze sitzt');
  await stepRadio(page, 'Schritt 1').check();
  await expect(stepRadio(page, 'Schritt 1')).toBeChecked();
  await mockRun(page, 'das kind lacht');
  await openView(page, 'Vergleich');
  await expect(stepRadio(page, 'Schritt 0')).toBeChecked();
  await expect(list(compareRegion(page), 'Läufe').getByRole('listitem')).toContainText([
    'A · mock-de-52 · „das kind lacht“',
  ]);
});

test(T.terms, async ({ page }) => {
  await comparePair(page, 'der hund sitzt', 'die katze sitzt');
  const terms = list(compareRegion(page), 'Begriffe');
  await expect(terms.getByRole('button')).toHaveText([
    'Gegenfakt',
    'Kosinus-Ähnlichkeit',
    'JS-Divergenz',
    'Logit-Lens',
  ]);
  await terms.getByRole('button', { name: 'Gegenfakt', exact: true }).click();
  await expect(page.getByRole('tooltip')).toHaveText(COUNTERFACTUAL);
});

test(T.noReport, async ({ page }) => {
  await openView(page, 'Sonde');
  const scope = probeRegion(page);
  await expect(scope.getByRole('heading', { name: 'Sonde', exact: true })).toBeVisible();
  await expect(scope.getByLabel('Sonden-Bericht importieren', { exact: true })).toHaveCount(1);
  await expect(noteOf(scope)).toHaveText('Noch kein Bericht geladen.');
});

test(T.report, async ({ page }) => {
  await openReport(page);
  const scope = probeRegion(page);
  const data = report();
  await expect(scope.getByRole('alert')).toHaveCount(0);
  await expect(scope.locator('.probe-head')).toHaveText(
    'Sonde occupation-gender-en · Modell tiny-random-gpt2',
  );
  await expect(noteOf(scope)).toHaveText(PROBE_HINT);
  const flips = data.summary.flips;
  const mean = data.summary.meanAbsLogRatioShift;
  await expect(list(scope, 'Zusammenfassung').getByRole('listitem')).toHaveText([
    '12 Paare',
    flips === 1 ? '1 Umschwung' : `${flips} Umschwünge`,
    ...(mean === null ? [] : [`Mittlere Verschiebung: ${fixed(mean, 2)}`]),
  ]);
  const pairs = table(scope, 'Paare');
  expect(await columnHeads(pairs)).toEqual([
    'Paar',
    'Prompt A',
    'Prompt B',
    'Ziele',
    'log-Verhältnis A → B',
    'JS-Divergenz',
  ]);
  const rows = await tableRows(pairs);
  expect(rows.map((r) => r.head)).toEqual(data.pairs.map((p) => p.id));
  data.pairs.forEach((pair, i) => {
    const row = rows[i];
    expect(row?.cells[0]).toBe(pair.a);
    expect(row?.cells[1]).toBe(pair.b);
    expect(row?.cells[3]).toBe(logRatioText(pair));
    expect(row?.cells[4]).toBe(fixed(pair.js, 3));
    expect(row?.classes.includes('flip'), pair.id).toBe(pair.flip === true);
  });
  const targets = await pairs
    .locator('tbody > tr')
    .evaluateAll((trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll('td:nth-of-type(3) li'), (li) => li.textContent?.trim()),
      ),
    );
  expect(targets).toEqual(
    data.pairs.map((pair) =>
      pair.targets.map((t) => `„${displayText(t.text)}“ ${percent(t.pA)} → ${percent(t.pB)}`),
    ),
  );
});

test(T.sort, async ({ page }) => {
  await openReport(page);
  const scope = probeRegion(page);
  const data = report();
  const sorting = scope.getByRole('radiogroup', { name: 'Sortierung', exact: true });
  await expect(sorting.getByRole('radio', { name: 'Reihenfolge der Sonde' })).toBeChecked();
  await sorting.getByRole('radio', { name: 'Größte Verschiebung', exact: true }).check();
  const order = data.pairs
    .map((pair, index) => ({ pair, index, value: shift(pair) }))
    .sort((x, y) => {
      if (x.value === null || y.value === null) {
        return x.value === y.value ? x.index - y.index : x.value === null ? 1 : -1;
      }
      return y.value - x.value || x.index - y.index;
    })
    .map((entry) => entry.pair.id);
  const pairs = table(scope, 'Paare');
  await expect(pairs.locator('tbody th[scope="row"]')).toHaveText(order);
  await sorting.getByRole('radio', { name: 'Reihenfolge der Sonde', exact: true }).check();
  await expect(pairs.locator('tbody th[scope="row"]')).toHaveText(data.pairs.map((p) => p.id));
});

test(T.inconsistent, async ({ page }) => {
  const data = report();
  data.summary.flips += 1;
  await openReport(page, JSON.stringify(data));
  const alert = probeRegion(page).getByRole('alert');
  await expect(alert.locator('p')).toHaveText('Der Bericht ist inkonsistent.');
  const details = await alert.locator('li').allTextContents();
  expect(details.some((line) => line.startsWith('/summary/flips (RP-04): '))).toBe(true);
});

test(T.probeFile, async ({ page }) => {
  await openReport(page, PROBE);
  await expect(probeRegion(page).getByRole('alert').locator('p')).toHaveText(
    'Die Datei entspricht nicht dem Format eines Sonden-Berichts.',
  );
});

test(T.version, async ({ page }) => {
  await openReport(page, JSON.stringify({ ...report(), schemaVersion: 2 }));
  await expect(probeRegion(page).getByRole('alert').locator('p')).toHaveText(
    'Berichts-Version 2 wird nicht unterstützt.',
  );
});

test(T.verdict, async ({ page }) => {
  const forbidden = /\b(sicher|unbedenklich|kompromittiert)\b/i;
  await comparePair(page, 'der hund sitzt', 'die katze sitzt');
  const compareText = (await compareRegion(page).textContent()) ?? '';
  expect(compareText).not.toMatch(forbidden);
  expect(compareText).not.toContain('Bias');
  await openReport(page);
  const scope = probeRegion(page);
  await expect(noteOf(scope)).toContainText('Bias');
  const probeText = (await scope.textContent()) ?? '';
  expect(probeText).not.toMatch(forbidden);
  expect(probeText.split('Bias').length - 1).toBe(1);
});

test(T.width, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await comparePair(page, 'der hund sitzt', 'die katze sitzt');
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await openReport(page);
  await expect(table(probeRegion(page), 'Paare')).toBeVisible();
  expect(await fits()).toBe(true);
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios = feature
    .split('\n')
    .map((line) => /^\s*Szenario(?:grundriss)?:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((title): title is string => title !== undefined);
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
});
