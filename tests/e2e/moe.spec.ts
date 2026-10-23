/**
 * TST-0026 – Akzeptanztests für das MoE-Routing (CON-0022). Ein Test je Szenario aus
 * .sdd/contracts/behavior/moe-ui.feature (Szenariogrundriss: ein Test je Beispiel),
 * Testname = Szenariotitel. Fixture aus dem Exporter (CON-0023 EX-04), 24-Layer-Trace aus
 * tests/e2e/moe-trace-helpers.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  errorAlert,
  expect,
  exportTrace,
  generateButton,
  importText,
  isRecord,
  maxTokensField,
  promptField,
  test,
} from './helpers';
import { buildMoeTrace, decodeTensor } from './moe-trace-helpers';
import { group, playback, stationRegion, tokenStream } from './player-helpers';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const FEATURE_PATH = here('../../.sdd/contracts/behavior/moe-ui.feature');
const FIXTURE = readFileSync(here('../fixtures/moe/tiny-granitemoe.trace.json'), 'utf8');

const T = {
  stations: 'Mock-MoE liefert MoE-Stationen',
  routing: 'Routing-Tabelle',
  chosen: 'Gewählte Experten des Tokens',
  allLayers: 'Token durch alle Layer verfolgen',
  map: 'Layer-Karte eines MoE-Laufs',
  part: 'Teil im MoE-Layer',
  texts: 'Texte der moe-Station',
  term: 'Erklärung eines MoE-Begriffs',
  residual: 'Residual nach MoE',
  fixture: 'Exportierter MoE-Trace',
  invalid: 'Ungültiges Routing wird abgelehnt',
  collapsed: 'Verdichtete Layer-Karte',
  fits: 'Bühne mit 24 Layern passt in 1280 × 720',
} as const;

const PARTS: readonly (readonly [string, string])[] = [
  ['moe · Layer 0', 'Layer 0 · Teil 3 von 4: Der Router schickt jedes Token an wenige Experten.'],
  [
    'residual · Layer 1 · nach MoE',
    'Layer 1 · Teil 4 von 4: Sein Ergebnis wird addiert; der Layer ist fertig.',
  ],
];

const ROUTER_EXPLANATION =
  'Router Eine kleine lineare Schicht, die für jedes Token eine Bewertung je Experte berechnet. Die Experten mit den höchsten Bewertungen bekommen das Token. In der App: Die Farbe einer Zelle in der Routing-Tabelle zeigt, wie stark der Router diesen Experten bewertet.';

// --- Läufe ---

function timeline(page: Page): Locator {
  return group(page, 'Zeitleiste').getByRole('button');
}

async function mockMoeRun(page: Page): Promise<void> {
  await page
    .getByRole('group', { name: 'Engine', exact: true })
    .getByRole('radio', { name: 'Mock-MoE', exact: true })
    .check();
  await promptField(page).fill('die katze sitzt');
  await maxTokensField(page).fill('2');
  await maxTokensField(page).blur();
  await generateButton(page).click();
  await expect(timeline(page)).toHaveCount(2);
}

async function importRun(page: Page, content: string, stationCount: number): Promise<void> {
  await importText(page, content);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(group(page, 'Stationen').getByRole('button')).toHaveCount(stationCount);
}

/** 24 Layer, 8 Experten, Top-2: tokenize, 24 × 4, logits, sample. */
const layers24 = (): string => JSON.stringify(buildMoeTrace({ layers: 24, experts: 8, topK: 2 }));

// --- Bausteine ---

function stationButton(page: Page, name: string): Locator {
  return group(page, 'Stationen').getByRole('button', { name, exact: true });
}

async function chooseStation(page: Page, name: string): Promise<void> {
  await stationButton(page, name).click();
  await expect(stationRegion(page).getByRole('heading', { level: 2 })).toHaveText(name);
}

async function choosePosition(page: Page, name: string): Promise<void> {
  await stationRegion(page)
    .getByRole('radiogroup', { name: 'Position', exact: true })
    .getByRole('radio', { name, exact: true })
    .check();
}

function table(page: Page, name: 'Routing' | 'Experten dieses Tokens in allen Layern'): Locator {
  return stationRegion(page).getByRole('table', { name, exact: true });
}

const routingTable = (page: Page): Locator => table(page, 'Routing');
const allLayersTable = (page: Page): Locator =>
  table(page, 'Experten dieses Tokens in allen Layern');

function bodyRows(tableLocator: Locator): Locator {
  return tableLocator.locator('tbody > tr');
}

function row(tableLocator: Locator, header: string): Locator {
  return bodyRows(tableLocator).filter({
    has: tableLocator.page().locator('th[scope="row"]', { hasText: new RegExp(`^${header}$`) }),
  });
}

async function columnHeads(tableLocator: Locator): Promise<string[]> {
  return tableLocator.locator('thead th[scope="col"]').allTextContents();
}

async function rowHeads(tableLocator: Locator): Promise<string[]> {
  return tableLocator.locator('tbody th[scope="row"]').allTextContents();
}

/** Gewählte Zellen einer Zeile als [Experte, Prozent]. */
async function chosenCells(rowLocator: Locator): Promise<[number, number][]> {
  const cells = rowLocator.locator('td');
  const all = await cells.evaluateAll((els) =>
    els.map((el, index) => ({
      index,
      chosen: el.classList.contains('chosen'),
      text: el.textContent?.trim() ?? '',
    })),
  );
  return all
    .filter((cell) => cell.chosen)
    .map((cell) => {
      const percent = /^(\d+) %$/.exec(cell.text);
      expect(percent, `Zelle E${cell.index}: „${cell.text}“`).not.toBeNull();
      return [cell.index, Number(percent?.[1])];
    });
}

function chosenList(page: Page): Locator {
  return stationRegion(page).getByRole('list', { name: 'Gewählte Experten', exact: true });
}

async function chosenEntries(page: Page): Promise<[number, number][]> {
  const texts = await chosenList(page).getByRole('listitem').allTextContents();
  return texts.map((text) => {
    const match = /^Experte (\d+) · (\d+) %$/.exec(text.trim());
    expect(match, `Eintrag „${text}“`).not.toBeNull();
    return [Number(match?.[1]), Number(match?.[2])];
  });
}

function layerMap(page: Page): Locator {
  return stationRegion(page).getByRole('list', { name: 'Layer-Karte', exact: true });
}

function mapGroup(page: Page, name: string): Locator {
  return layerMap(page).locator(`:scope > li[aria-label="${name}"]`);
}

function cells(groupLocator: Locator): Locator {
  return groupLocator.locator(':scope > ol > li');
}

function layerPart(page: Page): Locator {
  return stationRegion(page).locator('.layer-part');
}

function termList(page: Page): Locator {
  return stationRegion(page).getByRole('list', { name: 'Begriffe', exact: true });
}

function presentButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Präsentation', exact: true });
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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

// --- Szenarien ---

test(T.stations, async ({ page }) => {
  await mockMoeRun(page);
  await expect(stationButton(page, 'moe · Layer 0')).toHaveCount(1);
  await expect(stationButton(page, 'residual · Layer 0 · nach MoE')).toHaveCount(1);
  await expect(stationButton(page, 'mlp · Layer 0')).toHaveCount(0);
  await expect(stationButton(page, 'moe · Layer 1')).toHaveText('X1');
});

test(T.routing, async ({ page }) => {
  await mockMoeRun(page);
  await chooseStation(page, 'moe · Layer 0');
  const routing = routingTable(page);
  expect(await columnHeads(routing)).toEqual(['E0', 'E1', 'E2', 'E3']);
  expect(await rowHeads(routing)).toEqual(['0 · die', '1 · katze', '2 · sitzt']);
  for (const header of ['0 · die', '1 · katze', '2 · sitzt']) {
    const chosen = await chosenCells(row(routing, header));
    expect(chosen, header).toHaveLength(2);
    const sum = chosen.reduce((total, [, percent]) => total + percent, 0);
    expect(sum).toBeGreaterThanOrEqual(99);
    expect(sum).toBeLessThanOrEqual(101);
    const labels = await row(routing, header)
      .locator('td')
      .evaluateAll((els) =>
        els.map((el) => ({
          label: el.getAttribute('aria-label') ?? '',
          chosen: el.classList.contains('chosen'),
          text: el.textContent?.trim() ?? '',
        })),
      );
    labels.forEach((cell, e) => {
      const pattern = cell.chosen
        ? new RegExp(`^Experte ${e}: Router \\d+ %, gewählt, Gate ${cell.text}$`)
        : new RegExp(`^Experte ${e}: Router \\d+ %$`);
      expect(cell.label).toMatch(pattern);
      if (!cell.chosen) expect(cell.text).toBe('');
    });
  }
  await expect(row(routing, '2 · sitzt')).toHaveClass(/\bselected\b/);
});

test(T.chosen, async ({ page }) => {
  await mockMoeRun(page);
  await chooseStation(page, 'moe · Layer 0');
  const entries = await chosenEntries(page);
  expect(entries).toHaveLength(2);
  expect(entries[0]?.[1] ?? 0).toBeGreaterThanOrEqual(entries[1]?.[1] ?? 0);
  const fromTable = await chosenCells(row(routingTable(page), '2 · sitzt'));
  expect([...entries].sort((a, b) => a[0] - b[0])).toEqual(fromTable);
  await expect(
    stationRegion(page).getByText('Summe der Gates: 100 %', { exact: true }),
  ).toBeVisible();

  await choosePosition(page, '1 · katze');
  await expect(row(routingTable(page), '1 · katze')).toHaveClass(/\bselected\b/);
  await expect(row(routingTable(page), '2 · sitzt')).not.toHaveClass(/\bselected\b/);
  const katze = await chosenCells(row(routingTable(page), '1 · katze'));
  expect([...(await chosenEntries(page))].sort((a, b) => a[0] - b[0])).toEqual(katze);
});

test(T.allLayers, async ({ page }) => {
  await mockMoeRun(page);
  await chooseStation(page, 'moe · Layer 1');
  await choosePosition(page, '1 · katze');
  const all = allLayersTable(page);
  expect(await rowHeads(all)).toEqual(['Layer 0', 'Layer 1']);
  const current = await bodyRows(all).evaluateAll((els) =>
    els.map((el) => el.classList.contains('current')),
  );
  expect(current).toEqual([false, true]);
  expect(await chosenCells(row(all, 'Layer 1'))).toEqual(
    await chosenCells(row(routingTable(page), '1 · katze')),
  );
  expect(await chosenCells(row(all, 'Layer 0'))).toHaveLength(2);
});

test(T.map, async ({ page }) => {
  await mockMoeRun(page);
  await chooseStation(page, 'moe · Layer 0');
  expect(await cells(mapGroup(page, 'Layer 0')).allTextContents()).toEqual(['A', '+', 'X', '+']);
  const current = layerMap(page).locator('[aria-current="step"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute('aria-label', 'moe · Layer 0');
});

for (const [stationName, line] of PARTS) {
  test(`${T.part} – ${stationName}`, async ({ page }) => {
    await mockMoeRun(page);
    await chooseStation(page, stationName);
    await expect(layerPart(page)).toHaveText(line);
  });
}

test(T.texts, async ({ page }) => {
  await mockMoeRun(page);
  await chooseStation(page, 'moe · Layer 1');
  await expect(stationRegion(page).locator('h2 + p')).toHaveText(
    'Statt eines einzigen MLP hat dieser Layer viele Experten. Ein Router wählt für jedes Token wenige davon aus und mischt ihre Ergebnisse nach Gate-Gewichten.',
  );
  expect(await termList(page).getByRole('button').allTextContents()).toEqual([
    'Mixture of Experts',
    'Router',
    'Experte',
    'Gate-Gewicht',
    'LayerNorm',
  ]);
  const more = stationRegion(page).locator('details');
  await more.locator('summary', { hasText: 'Mehr dazu' }).click();
  await expect(more).toContainText(
    'Dieses Modell hat 4 Experten je MoE-Layer; je Token rechnen 2 davon.',
  );
  const tensors = stationRegion(page).getByRole('list', { name: 'Tensoren', exact: true });
  for (const entry of ['lnIn [3, 8]', 'routerLogits [3, 4]', 'out [3, 8]']) {
    await expect(tensors.getByRole('listitem').filter({ hasText: entry })).toHaveCount(1);
  }
});

test(T.term, async ({ page }) => {
  await mockMoeRun(page);
  await chooseStation(page, 'moe · Layer 0');
  await termList(page).getByRole('button', { name: 'Router', exact: true }).click();
  await expect(page.getByRole('tooltip')).toHaveText(ROUTER_EXPLANATION);
});

test(T.residual, async ({ page }) => {
  await mockMoeRun(page);
  await chooseStation(page, 'residual · Layer 1 · nach MoE');
  const history = stationRegion(page).getByRole('list', { name: 'Verlauf', exact: true });
  await expect(
    history.getByRole('listitem').filter({ hasText: /^Layer 0 · nach MoE / }),
  ).toHaveCount(1);
  await expect(
    history.getByRole('listitem').filter({ hasText: /^Layer 1 · nach MoE / }),
  ).toHaveCount(1);
  await expect(
    stationRegion(page)
      .getByRole('list', { name: 'Logit-Lens', exact: true })
      .getByRole('listitem'),
  ).toHaveCount(5);
});

test(T.fixture, async ({ page }) => {
  const trace = JSON.parse(FIXTURE) as { steps: { stations: unknown[] }[] };
  await importRun(page, FIXTURE, trace.steps[0]?.stations.length ?? 0);
  await expect(errorAlert(page)).toHaveCount(0);
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(stationButton(page, 'embed')).toHaveCount(0);
  await expect(stationButton(page, 'moe · Layer 0')).toHaveCount(1);
  await expect(stationButton(page, 'moe · Layer 1')).toHaveCount(1);
  await chooseStation(page, 'moe · Layer 1');
  const routing = routingTable(page);
  expect(await columnHeads(routing)).toEqual(['E0', 'E1', 'E2', 'E3']);
  const heads = await rowHeads(routing);
  expect(heads.length).toBeGreaterThan(0);
  for (const header of heads) expect(await chosenCells(row(routing, header))).toHaveLength(2);
});

test(T.invalid, async ({ page }) => {
  await mockMoeRun(page);
  const { content } = await exportTrace(page);
  const trace: unknown = JSON.parse(content);
  if (!isRecord(trace) || !Array.isArray(trace['steps'])) throw new Error('Export unerwartet');
  const step = trace['steps'][0] as { stations: Record<string, unknown>[] };
  const station = step.stations[4];
  if (station === undefined || station['kind'] !== 'moe')
    throw new Error('stations/4 ist nicht moe');
  const logits = decodeTensor(station['routerLogits']).slice(0, 4);
  const experts = station['experts'] as number[][];
  const chosen = new Set(experts[0]);
  const weakest = logits
    .map((value, e) => ({ value, e }))
    .filter((entry) => !chosen.has(entry.e))
    .sort((a, b) => a.value - b.value)[0];
  experts[0] = [weakest?.e ?? 0, experts[0]?.[1] ?? 0];
  await importText(page, JSON.stringify(trace));
  const alert = errorAlert(page);
  await expect(alert).toHaveText(/^Der Trace ist inkonsistent\./);
  await expect(alert).toContainText('/steps/0/stations/4/experts/0');
  await expect(alert).toContainText('INV-18');
});

test(T.collapsed, async ({ page }) => {
  await importRun(page, layers24(), 1 + 24 * 4 + 2);
  await chooseStation(page, 'moe · Layer 7');
  const groups = layerMap(page).locator(':scope > li');
  await expect(groups).toHaveCount(26);
  const names = await groups.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(names).toEqual([
    'Eingabe',
    ...Array.from({ length: 24 }, (_, l) => `Layer ${l}`),
    'Ausgabe',
  ]);
  expect(await cells(mapGroup(page, 'Layer 7')).allTextContents()).toEqual(['A', '+', 'X', '+']);
  for (let layer = 0; layer < 24; layer += 1) {
    if (layer === 7) continue;
    const groupCells = cells(mapGroup(page, `Layer ${layer}`));
    await expect(groupCells).toHaveCount(1);
    await expect(groupCells).toHaveClass(/\blayer-cell-collapsed\b/);
    await expect(groupCells).toHaveText(`L${layer}`);
  }
  await expect(layerPart(page)).toHaveText(
    'Layer 7 · Teil 3 von 4: Der Router schickt jedes Token an wenige Experten.',
  );
});

test(T.fits, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await importRun(page, layers24(), 1 + 24 * 4 + 2);
  await presentButton(page).click();
  await chooseStation(page, 'moe · Layer 7');
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
    .filter((r): r is string => r !== undefined)
    .map((r) => r.split('|').map((cell) => cell.trim()))
    .filter((r) => r[0] !== 'station');
  expect(rows).toEqual(PARTS.map(([s, z]) => [s, z]));
});
