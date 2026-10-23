/**
 * TST-0023 – Akzeptanztests für Layer-Karte und Glossar (CON-0021). Ein Test je Szenario aus
 * .sdd/contracts/behavior/glossary-ui.feature (Szenariogrundriss: ein Test je Beispiel),
 * Testname = Szenariotitel. Das GPT-2-Testmodell liefert page.route vom eigenen Origin.
 * „Glossar vollständig“ läuft ohne Browser gegen texts und parseTerms (SPEC-0010 §3.10).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page, Route } from '@playwright/test';

import { texts } from '../../src/app/texts';
import type { Station, StationKind } from '../../src/trace/types';
import { parseTerms } from '../../src/views/glossary/term-markup';
import {
  expect,
  exportTrace,
  generate,
  generateButton,
  importText,
  isRecord,
  maxTokensField,
  promptField,
  test,
} from './helpers';
import { group, playback, stationRegion, tokenStream } from './player-helpers';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const FEATURE_PATH = here('../../.sdd/contracts/behavior/glossary-ui.feature');
const SPEC_PATH = here('../../.sdd/specs/SPEC-0010-layer-map-and-glossary.md');
const REFERENCE_PATH = here('../fixtures/glossary/texts-before-spec-0010.json');
const fixture = (name: string): Buffer => readFileSync(here(`../fixtures/gpt2/${name}`));

const WEIGHTS = fixture('tiny-gpt2.safetensors');
const CONFIG = fixture('tiny-gpt2.config.json');
const MANIFEST = {
  models: [
    {
      id: 'tiny',
      name: 'Tiny GPT-2 (Test)',
      config: 'tiny/config.json',
      weights: 'tiny/model.safetensors',
      bytes: WEIGHTS.length,
    },
  ],
};

const T = {
  groups: 'Layer-Karte gruppiert die Stationen',
  part: 'Teil im Layer',
  gpt2Map: 'Layer-Karte im GPT-2-Lauf',
  noMap: 'Keine Layer-Karte ohne Interna',
  termsPerStation: 'Begriffe je Station',
  openClose: 'Erklärung öffnen und schließen',
  keyboard: 'Erklärung per Tastatur',
  single: 'Nur eine Erklärung zugleich',
  clickInside: 'Klick in die Erklärung lässt sie offen',
  stageEsc: 'Esc auf der Bühne schließt erst die Erklärung',
  sentence: 'Markierte Begriffe im Satz',
  more: 'Markierte Begriffe in Mehr dazu',
  layerTerm: 'Layer in der Zeile zum Teil',
  view: 'Glossar-Ansicht',
  complete: 'Glossar vollständig',
  fits: 'Bühne passt weiter in 1280 × 720',
} as const;

const PARTS: readonly (readonly [string, string])[] = [
  ['embed', 'Vor den Layern: Der Text wird zu Vektoren.'],
  [
    'attention · Layer 1',
    'Layer 1 · Teil 1 von 4: Die Attention holt Information von früheren Tokens.',
  ],
  [
    'residual · Layer 0 · nach Attention',
    'Layer 0 · Teil 2 von 4: Ihr Ergebnis wird zum Residual Stream addiert.',
  ],
  ['mlp · Layer 0', 'Layer 0 · Teil 3 von 4: Das MLP verarbeitet jedes Token für sich.'],
  [
    'residual · Layer 1 · nach MLP',
    'Layer 1 · Teil 4 von 4: Sein Ergebnis wird addiert; der Layer ist fertig.',
  ],
  ['sample', 'Nach den Layern: Aus dem letzten Vektor wird das nächste Token.'],
];

const TERMS_PER_STATION: readonly (readonly [string, readonly string[]])[] = [
  ['tokenize', ['Token', 'BPE', 'Vokabular', 'Trace', 'Schritt', 'Station']],
  ['embed', ['Embedding', 'Vektor', 'Dimension', 'Tensor']],
  [
    'attention · Layer 0',
    ['Attention', 'Kopf', 'Query, Key, Value', 'Kausale Maske', 'KV-Cache', 'LayerNorm'],
  ],
  ['residual · Layer 0 · nach MLP', ['Residual Stream', 'Layer', 'Norm', 'Logit-Lens']],
  ['mlp · Layer 1', ['MLP', 'Hidden', 'Neuron', 'GELU', 'LayerNorm']],
  ['logits', ['Logit', 'Softmax', 'Kandidat', 'Vokabular']],
  ['sample', ['Sampling', 'Greedy', 'Temperatur', 'Top-k', 'Top-p', 'Seed']],
];

const MORE_TERMS: readonly (readonly [string, readonly string[], string])[] = [
  ['tokenize', ['Byte-Pair-Encoding'], 'Das Vokabular hat 50.257 Tokens.'],
  [
    'attention · Layer 0',
    ['Query', 'kausale Maske', 'KV-Cache'],
    'Dieses Modell hat 2 Köpfe in jedem seiner 2 Layer.',
  ],
  [
    'residual · Layer 0 · nach Attention',
    ['Residual Stream', 'Layer'],
    'Der Residual Stream ist wie ein Notizblock, der durch alle Layer gereicht wird.',
  ],
  [
    'residual · Layer 1 · nach MLP',
    ['MLP', 'Logit-Lens'],
    'Die Logit-Lens zeigt, welches Token das Modell vorhersagen würde, wenn es hier aufhörte.',
  ],
  ['mlp · Layer 1', ['GELU'], 'Hier: 8 → 32 → 8 Zahlen.'],
  ['logits', ['Logit', 'Softmax'], 'Bewertet werden alle 50.257 Tokens des Vokabulars.'],
  [
    'sample',
    ['Greedy', 'Temperatur', 'Top-k', 'Top-p'],
    'Greedy nimmt immer das wahrscheinlichste Token.',
  ],
];

const HEAD_EXPLANATION =
  'Kopf Eine von mehreren parallelen Attention-Rechnungen in einem Layer. Jeder Kopf hat eigene Gewichte und achtet auf etwas anderes, etwa auf das vorige Wort. In der App: Wähle einen Kopf oder „Mittel“, den Durchschnitt aller Köpfe.';

// --- Modell-Server (wie TST-0022) ---

async function modelServer(page: Page): Promise<void> {
  await page.route('**/models/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(url.pathname.indexOf('/models/') + '/models/'.length);
    if (path === 'index.json') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MANIFEST),
      });
    } else if (path === 'tiny/config.json') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: CONFIG });
    } else if (path === 'tiny/model.safetensors') {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { 'Content-Length': String(WEIGHTS.length) },
        body: WEIGHTS,
      });
    } else {
      await route.fulfill({ status: 404, body: '' });
    }
  });
}

// --- Bausteine ---

function timeline(page: Page): Locator {
  return group(page, 'Zeitleiste').getByRole('button');
}

function presentButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Präsentation', exact: true });
}

async function expectMode(page: Page, mode: 'explore' | 'presentation'): Promise<void> {
  await expect(page.locator('main')).toHaveAttribute('data-mode', mode);
}

function position(page: Page): Locator {
  return stationRegion(page).locator('.station-position');
}

function layerMap(page: Page): Locator {
  return stationRegion(page).getByRole('list', { name: 'Layer-Karte', exact: true });
}

/** Gruppen der Karte: die direkten Listeneinträge. */
function mapGroups(page: Page): Locator {
  return layerMap(page).locator(':scope > li');
}

function mapGroup(page: Page, name: string): Locator {
  return layerMap(page).locator(`:scope > li[aria-label="${name}"]`);
}

function cells(groupLocator: Locator): Locator {
  return groupLocator.locator(':scope > ol > li');
}

function currentCells(page: Page): Locator {
  return layerMap(page).locator('[aria-current="step"]');
}

function layerPart(page: Page): Locator {
  return stationRegion(page).locator('.layer-part');
}

function termList(page: Page): Locator {
  return stationRegion(page).getByRole('list', { name: 'Begriffe', exact: true });
}

function listTerm(page: Page, name: string): Locator {
  return termList(page).getByRole('button', { name, exact: true });
}

function explanationSentence(page: Page): Locator {
  return stationRegion(page).locator('h2 + p');
}

function more(page: Page): Locator {
  return stationRegion(page).locator('details');
}

function tooltips(page: Page): Locator {
  return page.getByRole('tooltip');
}

async function ariaLabels(locator: Locator): Promise<(string | null)[]> {
  return locator.evaluateAll((elements) => elements.map((e) => e.getAttribute('aria-label')));
}

async function mockRun(page: Page): Promise<void> {
  await generate(page, 'die katze sitzt', 2);
  await expect(timeline(page)).toHaveCount(2);
}

async function gpt2Run(page: Page): Promise<void> {
  await modelServer(page);
  await page
    .getByRole('group', { name: 'Engine', exact: true })
    .getByRole('radio', { name: 'GPT-2 (Browser)', exact: true })
    .check();
  await promptField(page).fill('Die Katze sitzt');
  await maxTokensField(page).fill('3');
  await maxTokensField(page).blur();
  await generateButton(page).click();
  await expect(timeline(page)).toHaveCount(3, { timeout: 30_000 });
}

/** Mock-Lauf, Export, Interna entfernen, Import (wie CON-0020 „Lauf ohne Interna“). */
async function runWithoutInternals(page: Page): Promise<void> {
  await mockRun(page);
  const { content } = await exportTrace(page);
  const trace: unknown = JSON.parse(content);
  if (!isRecord(trace) || !isRecord(trace['engine']) || !Array.isArray(trace['steps'])) {
    throw new Error('Export hat nicht die erwartete Form');
  }
  const kept = new Set(['tokenize', 'logits', 'sample']);
  trace['engine']['capabilities'] = ['tokenize', 'logits', 'sample'];
  trace['engine']['architecture'] = null;
  for (const step of trace['steps'] as unknown[]) {
    if (!isRecord(step) || !Array.isArray(step['stations'])) continue;
    step['stations'] = (step['stations'] as unknown[]).filter(
      (s) => isRecord(s) && typeof s['kind'] === 'string' && kept.has(s['kind']),
    );
  }
  await importText(page, JSON.stringify(trace));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(group(page, 'Stationen').getByRole('button')).toHaveCount(3);
}

async function chooseStation(page: Page, name: string): Promise<void> {
  await group(page, 'Stationen').getByRole('button', { name, exact: true }).click();
  await expect(stationRegion(page).getByRole('heading', { level: 2 })).toHaveText(name);
}

async function openMore(page: Page): Promise<void> {
  await more(page).locator('summary', { hasText: 'Mehr dazu' }).click();
  await expect(more(page)).toHaveAttribute('open', '');
}

async function expectInViewport(page: Page, locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label}: sichtbar`).not.toBeNull();
  if (box === null || viewport === null) return;
  expect(box.y, `${label}: oben`).toBeGreaterThanOrEqual(0);
  expect(box.x, `${label}: links`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${label}: unten`).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(box.x + box.width, `${label}: rechts`).toBeLessThanOrEqual(viewport.width + 0.5);
}

// --- Spec-Tabellen (SPEC-0010 §3.4, §3.5) ---

/** Zeilen der Markdown-Tabelle unter der Überschrift `heading`, ohne Kopf und Trennzeile. */
function specTable(heading: string): string[][] {
  const lines = readFileSync(SPEC_PATH, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  expect(start, `Abschnitt ${heading}`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('### ')) break;
    if (!line.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    rows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
  }
  return rows.slice(2);
}

const stripCode = (cell: string): string => cell.replace(/^`|`$/g, '');

const FACTS = { vocabSize: 50257, dModel: 8, dMlp: 32, nHeads: 2, nLayers: 2 };

const STATIONS: readonly (readonly [string, Station])[] = (
  [
    ['tokenize', { kind: 'tokenize' }],
    ['embed', { kind: 'embed' }],
    ['attention', { kind: 'attention', layer: 0 }],
    ['residual-attention', { kind: 'residual', layer: 0, after: 'attention' }],
    ['mlp', { kind: 'mlp', layer: 0 }],
    ['residual-mlp', { kind: 'residual', layer: 0, after: 'mlp' }],
    ['logits', { kind: 'logits' }],
    ['sample', { kind: 'sample' }],
  ] as const
).map(([key, station]) => [key, station as unknown as Station] as const);

const plain = (text: string): string =>
  parseTerms(text)
    .map((segment) => segment.text)
    .join('');

const termIds = (text: string): string[] =>
  parseTerms(text).flatMap((segment) => (segment.kind === 'term' ? [segment.id] : []));

// --- Szenarien ---

test(T.groups, async ({ page }) => {
  await mockRun(page);
  expect(await ariaLabels(mapGroups(page))).toEqual(['Eingabe', 'Layer 0', 'Layer 1', 'Ausgabe']);
  expect(await ariaLabels(cells(mapGroup(page, 'Eingabe')))).toEqual(['tokenize', 'embed']);
  const layer0 = cells(mapGroup(page, 'Layer 0'));
  expect(await ariaLabels(layer0)).toEqual([
    'attention · Layer 0',
    'residual · Layer 0 · nach Attention',
    'mlp · Layer 0',
    'residual · Layer 0 · nach MLP',
  ]);
  await expect(layer0).toHaveText(['A', '+', 'M', '+']);
  expect(await ariaLabels(cells(mapGroup(page, 'Ausgabe')))).toEqual(['logits', 'sample']);
  await expect(currentCells(page)).toHaveCount(1);
  await expect(currentCells(page)).toHaveAttribute('aria-label', 'tokenize');
});

for (const [stationName, line] of PARTS) {
  test(`${T.part}: ${stationName}`, async ({ page }) => {
    await mockRun(page);
    await chooseStation(page, stationName);
    await expect(currentCells(page)).toHaveCount(1);
    await expect(currentCells(page)).toHaveAttribute('aria-label', stationName);
    await expect(layerPart(page)).toHaveText(line);
  });
}

test(T.gpt2Map, async ({ page }) => {
  await gpt2Run(page);
  await chooseStation(page, 'mlp · Layer 1');
  expect(await ariaLabels(mapGroups(page))).toEqual(['Eingabe', 'Layer 0', 'Layer 1', 'Ausgabe']);
  await expect(currentCells(page)).toHaveCount(1);
  await expect(currentCells(page)).toHaveAttribute('aria-label', 'mlp · Layer 1');
});

test(T.noMap, async ({ page }) => {
  await runWithoutInternals(page);
  await expect(layerMap(page)).toHaveCount(0);
  await expect(layerPart(page)).toHaveCount(0);
  await expect(termList(page).getByRole('button')).toHaveText([
    'Token',
    'BPE',
    'Vokabular',
    'Trace',
    'Schritt',
    'Station',
  ]);
});

for (const [stationName, names] of TERMS_PER_STATION) {
  test(`${T.termsPerStation}: ${stationName}`, async ({ page }) => {
    await mockRun(page);
    if (stationName !== 'tokenize') await chooseStation(page, stationName);
    await expect(termList(page).getByRole('button')).toHaveText([...names]);
  });
}

test(T.openClose, async ({ page }) => {
  await mockRun(page);
  await chooseStation(page, 'attention · Layer 0');
  const head = explanationSentence(page).getByRole('button', { name: 'Kopf', exact: true });
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(tooltips(page)).toHaveCount(0);
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(tooltips(page)).toHaveCount(1);
  const id = await tooltips(page).getAttribute('id');
  expect(id).toBeTruthy();
  await expect(head).toHaveAttribute('aria-describedby', id ?? '');
  await expect(tooltips(page)).toHaveText(HEAD_EXPLANATION);
  await head.click();
  await expect(tooltips(page)).toHaveCount(0);
});

test(T.keyboard, async ({ page }) => {
  await mockRun(page);
  const token = listTerm(page, 'Token');
  await token.focus();
  await page.keyboard.press('Enter');
  await expect(tooltips(page)).toHaveCount(1);
  await expect(tooltips(page)).toHaveText(/^Token Ein Stück Text mit fester Nummer/);
  await page.keyboard.press('Escape');
  await expect(tooltips(page)).toHaveCount(0);
  await expect(token).toBeFocused();
  await page.keyboard.press(' ');
  await expect(tooltips(page)).toHaveCount(1);
  await expect(position(page)).toHaveText('Schritt 0 · Station 1 / 12');
  await page.keyboard.press('Tab');
  await expect(tooltips(page)).toHaveCount(0);
});

test(T.single, async ({ page }) => {
  await mockRun(page);
  await listTerm(page, 'Token').click();
  await listTerm(page, 'BPE').click();
  await expect(tooltips(page)).toHaveCount(1);
  await expect(tooltips(page)).toHaveText(/^BPE Byte-Pair-Encoding/);
});

test(T.clickInside, async ({ page }) => {
  await mockRun(page);
  await listTerm(page, 'Vokabular').click();
  await expect(tooltips(page)).toHaveCount(1);
  await tooltips(page).click();
  await expect(tooltips(page)).toHaveCount(1);
});

test(T.stageEsc, async ({ page }) => {
  await mockRun(page);
  await presentButton(page).click();
  await expectMode(page, 'presentation');
  await listTerm(page, 'Token').click();
  await expect(tooltips(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(tooltips(page)).toHaveCount(0);
  await expectMode(page, 'presentation');
  await page.keyboard.press('Escape');
  await expectMode(page, 'explore');
});

test(T.sentence, async ({ page }) => {
  await mockRun(page);
  const sentence = explanationSentence(page);
  await expect(sentence.getByRole('button')).toHaveCount(1);
  await expect(sentence.getByRole('button')).toHaveText('Tokens');
  await expect(sentence).toHaveText(
    'Der Text wird in Tokens zerlegt: Wörter oder Satzzeichen mit einer festen Nummer.',
  );
  await sentence.getByRole('button', { name: 'Tokens', exact: true }).click();
  await expect(tooltips(page)).toHaveText(/^Token Ein Stück Text mit fester Nummer/);
});

for (const [stationName, names, sentence] of MORE_TERMS) {
  test(`${T.more}: ${stationName}`, async ({ page }) => {
    await gpt2Run(page);
    if (stationName !== 'tokenize') await chooseStation(page, stationName);
    await openMore(page);
    await expect(more(page).getByRole('button')).toHaveText([...names]);
    await expect(more(page)).toContainText(sentence);
  });
}

test(T.layerTerm, async ({ page }) => {
  await mockRun(page);
  await chooseStation(page, 'mlp · Layer 0');
  await layerPart(page).getByRole('button', { name: 'Layer', exact: true }).click();
  await expect(tooltips(page)).toHaveText(/^Layer Ein Block aus Attention und MLP/);
  await expect(tooltips(page)).toContainText(
    'In der App: Jeder Layer hat vier Stationen: attention, residual, mlp, residual. Die Layer-Karte zeigt, wo du bist.',
  );
});

test(T.view, async ({ page }) => {
  const views = page.getByRole('group', { name: 'Ansicht', exact: true });
  const glossaryButton = views.getByRole('button', { name: 'Glossar', exact: true });
  await glossaryButton.click();
  await expect(glossaryButton).toHaveAttribute('aria-pressed', 'true');
  const region = page.getByRole('region', { name: 'Glossar', exact: true });
  const terms = region.locator('dt');
  await expect(terms).toHaveCount(33);
  const names = await terms.allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
  expect(names[0]).toBe('Attention');
  expect(names.at(-1)).toBe('Vokabular');
  await expect(region.locator('#begriff-logitLens')).toHaveText('Logit-Lens');
  const description = region.locator('#begriff-logitLens + dd');
  await expect(description.locator('p').first()).toHaveText(
    'Wendet die Ausgabe des Modells schon auf einen Zwischenstand des Residual Stream an. So sieht man, welches Token das Modell nach diesem Layer vorhersagen würde.',
  );
  await expect(description.locator('p').last()).toHaveText(
    'In der App: Die residual-Stationen nach dem MLP, für die letzte Position.',
  );
  await views.getByRole('button', { name: 'Durchlauf', exact: true }).click();
  await expect(region).toHaveCount(0);
});

test(T.complete, () => {
  const entries = texts.glossary.entries as Readonly<
    Record<string, { term: string; meaning: string; inApp: string }>
  >;
  const table = specTable('### 3.4 Glossar');
  expect(table).toHaveLength(33);
  expect(Object.keys(entries).sort()).toEqual(table.map((row) => row[0]).sort());
  for (const [id, term, meaning, inApp] of table) {
    expect(entries[id ?? ''], `Eintrag ${id}`).toEqual({ term, meaning, inApp });
  }

  const ids = new Set(Object.keys(entries));
  const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')) as {
    explanations: Record<string, string>;
    more: Record<string, { none: string; facts: string }>;
  };
  const marked: string[] = [];
  for (const [kind, sentence] of Object.entries(texts.station.explanations)) {
    marked.push(sentence);
    expect(plain(sentence), `Satz ${kind}`).toBe(reference.explanations[kind]);
  }
  for (const [key, station] of STATIONS) {
    const none = texts.station.more(station, null);
    const facts = texts.station.more(station, FACTS);
    marked.push(none, facts);
    expect(plain(none), `Mehr dazu ${key} ohne Zahlen`).toBe(reference.more[key]?.none);
    expect(plain(facts), `Mehr dazu ${key} mit Zahlen`).toBe(reference.more[key]?.facts);
    marked.push(texts.station.layerPart(station, null));
    if ('layer' in station) {
      marked.push(texts.station.layerPart(station, { layer: 1, part: 2, parts: 4 }));
    }
  }
  for (const text of marked) {
    for (const id of termIds(text)) expect(ids.has(id), `Markierung ${id} in „${text}“`).toBe(true);
  }

  const byStation = texts.glossary.byStation as Readonly<Record<StationKind, readonly string[]>>;
  const listed = new Set(Object.values(byStation).flat());
  for (const id of ids) expect(listed.has(id), `Begriff ${id} in einer Liste`).toBe(true);
  for (const [kind, list] of specTable('### 3.5 Begriffe je Station')) {
    expect(byStation[kind as StationKind], `Begriffe ${kind}`).toEqual(
      (list ?? '').split(',').map((id) => stripCode(id.trim())),
    );
  }
});

test(T.fits, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await gpt2Run(page);
  await presentButton(page).click();
  await chooseStation(page, 'attention · Layer 0');
  const heights = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    inner: window.innerHeight,
  }));
  expect(heights.scroll).toBeLessThanOrEqual(heights.inner);
  await expectInViewport(page, tokenStream(page), 'Tokenstrom');
  await expectInViewport(page, layerMap(page), 'Layer-Karte');
  await expectInViewport(
    page,
    stationRegion(page).getByRole('heading', { level: 2 }),
    'Stationsüberschrift',
  );
  await expectInViewport(page, playback(page), 'Transportleiste');
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios = feature
    .split('\n')
    .map((line) => /^\s*Szenario(?:grundriss)?:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((title): title is string => title !== undefined);
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
  const rows = feature
    .split('\n')
    .map((line) => /^\s*\|(.+)\|\s*$/.exec(line)?.[1])
    .filter((row): row is string => row !== undefined)
    .map((row) => row.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells[0] !== 'station');
  const quoted = (cell: string): string[] =>
    [...cell.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');
  const parts = rows.filter((r) => r.length === 2 && !r[1]?.startsWith('"'));
  expect(parts.map(([s, z]) => [s, z])).toEqual(PARTS.map(([s, z]) => [s, z]));
  const termRows = rows.filter((r) => r.length === 2 && r[1]?.startsWith('"'));
  expect(termRows.map(([s, b]) => [s, quoted(b ?? '')])).toEqual(
    TERMS_PER_STATION.map(([s, b]) => [s, [...b]]),
  );
  const moreRows = rows.filter((r) => r.length === 3);
  expect(moreRows.map(([s, b, z]) => [s, quoted(b ?? ''), z])).toEqual(
    MORE_TERMS.map(([s, b, z]) => [s, [...b], z]),
  );
});
