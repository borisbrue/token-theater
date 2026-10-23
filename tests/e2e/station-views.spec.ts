/**
 * TST-0019 – Akzeptanztests für die Ansichten der Glaskasten-Stationen (CON-0018). Ein Test je
 * Szenario aus .sdd/contracts/behavior/station-views-ui.feature, Testname = Szenariotitel. Das
 * GPT-2-Testmodell liefert page.route vom eigenen Origin (SU-03).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page, Route } from '@playwright/test';

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
import { group, stationRegion } from './player-helpers';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/station-views-ui.feature', import.meta.url),
);
const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../fixtures/gpt2/${name}`, import.meta.url)));

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
  embed: 'Embedding mit drei Vektoren',
  embedPosition: 'Position im Embedding wählen',
  stripHover: 'Wert unter der Maus im Vektorstreifen',
  heatmap: 'Attention-Heatmap von Kopf 0',
  heads: 'Kopf wechseln und Mittel',
  heatmapRow: 'Zeile der Heatmap wählen',
  heatmapHover: 'Feld unter der Maus in der Heatmap',
  kvCache: 'KV-Cache-Zeilen im Folgeschritt',
  mlp: 'MLP-Aktivierungen',
  trajectory: 'Verlauf des Residual Stream',
  lens: 'Logit-Lens nach dem MLP',
  lensAfterAttention: 'Hinweis nach der Attention',
  lensPosition: 'Logit-Lens gilt für die letzte Position',
  keyboard: 'Kopf per Tastatur wählen',
  keepSelection: 'Auswahl bleibt beim Stationswechsel',
  resetSelection: 'Neuer Lauf setzt die Auswahl zurück',
  mock: 'Mock-Lauf zeigt alle Ansichten',
  importWithoutLens: 'Importierter Trace ohne Logit-Lens',
} as const;

// --- Modell-Server (wie TST-0016) ---

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

// --- Abläufe ---

function timeline(page: Page): Locator {
  return group(page, 'Zeitleiste').getByRole('button');
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

async function mockRun(page: Page): Promise<void> {
  await generate(page, 'die katze sitzt', 2);
  await expect(timeline(page)).toHaveCount(2);
}

/** Schritt s (Knopf s + 1 der Zeitleiste) und Station `name` öffnen. */
async function open(page: Page, step: number, name: string): Promise<void> {
  await timeline(page).nth(step).click();
  await openStation(page, name);
}

async function openStation(page: Page, name: string): Promise<void> {
  await group(page, 'Stationen').getByRole('button', { name, exact: true }).click();
  await expect(stationRegion(page).getByRole('heading', { level: 2 })).toHaveText(name);
}

// --- Bedienelemente (CON-0018) ---

function radioGroup(page: Page, name: 'Position' | 'Kopf'): Locator {
  return stationRegion(page).getByRole('radiogroup', { name, exact: true });
}

function radio(page: Page, groupName: 'Position' | 'Kopf', name: string): Locator {
  return radioGroup(page, groupName).getByRole('radio', { name, exact: true });
}

function image(page: Page, name: string): Locator {
  return stationRegion(page).getByRole('img', { name, exact: true });
}

function list(page: Page, name: string): Locator {
  return stationRegion(page).getByRole('list', { name, exact: true });
}

function items(page: Page, name: string): Locator {
  return list(page, name).getByRole('listitem');
}

function historyBox(page: Page): Locator {
  return stationRegion(page).getByRole('checkbox', {
    name: 'Frühere Schritte zeigen',
    exact: true,
  });
}

async function itemTexts(page: Page, name: string): Promise<string[]> {
  return (await items(page, name).allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim());
}

async function expectItems(page: Page, name: string, expected: string[]): Promise<void> {
  await expect(items(page, name)).toHaveCount(expected.length);
  expect(await itemTexts(page, name)).toEqual(expected);
}

async function expectContains(page: Page, name: string, expected: string[]): Promise<void> {
  await expect(list(page, name)).toBeVisible();
  const texts = await itemTexts(page, name);
  for (const entry of expected) expect(texts).toContain(entry);
}

/** Maus in die Mitte der Zelle (row, col) einer Canvas mit rows × cols gleich großen Zellen. */
async function hoverCell(
  page: Page,
  canvas: Locator,
  rows: number,
  cols: number,
  row: number,
  col: number,
): Promise<void> {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Canvas ohne Bounding Box');
  await page.mouse.move(
    box.x + ((col + 0.5) * box.width) / cols,
    box.y + ((row + 0.5) * box.height) / rows,
  );
}

// --- Szenarien ---

test(T.embed, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'embed');
  await expect(radioGroup(page, 'Position').getByRole('radio')).toHaveCount(6);
  await expect(radio(page, 'Position', '5 · t')).toBeChecked();
  for (const name of [
    'Token-Embedding · 8 Werte',
    'Positions-Embedding · 8 Werte',
    'Summe · 8 Werte',
  ]) {
    await expect(image(page, name)).toBeVisible();
  }
  await expectContains(page, 'Vektoren', [
    'Token-Embedding ‖v‖ = 1,90',
    'Positions-Embedding ‖v‖ = 1,02',
    'Summe ‖v‖ = 1,76',
  ]);
  await expect(stationRegion(page)).toContainText('Skala: ±1,04');
  await expect(stationRegion(page).getByRole('list', { name: 'Tensoren' })).toContainText(
    'sum [6, 8]',
  );
});

test(T.embedPosition, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'embed');
  await radio(page, 'Position', '1 · ␣Kat').check();
  await expectContains(page, 'Vektoren', ['Summe ‖v‖ = 2,11']);
});

test(T.stripHover, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'embed');
  await hoverCell(page, image(page, 'Summe · 8 Werte'), 1, 8, 0, 0);
  await expect(stationRegion(page)).toContainText('Dimension 0: -0,59');
});

test(T.heatmap, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'attention · Layer 0');
  await expect(radio(page, 'Kopf', 'Kopf 0')).toBeChecked();
  await expect(radioGroup(page, 'Kopf').getByRole('radio')).toHaveCount(3);
  for (const name of ['Kopf 0', 'Kopf 1', 'Mittel']) {
    await expect(radio(page, 'Kopf', name)).toBeAttached();
  }
  await expect(image(page, 'Attention · Layer 0 · Kopf 0 · 6 × 6')).toBeVisible();
  await expectItems(page, 'Beachtete Tokens', [
    '0 · Die 35,5 %',
    '4 · z 22,5 %',
    '3 · ␣sit 20,7 %',
  ]);
  await expect(historyBox(page)).toHaveCount(0);
});

test(T.heads, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'attention · Layer 1');
  await radio(page, 'Kopf', 'Kopf 1').check();
  await expect(image(page, 'Attention · Layer 1 · Kopf 1 · 6 × 6')).toBeVisible();
  await expectItems(page, 'Beachtete Tokens', ['0 · Die 63,2 %', '1 · ␣Kat 24,9 %', '4 · z 4,5 %']);
  await radio(page, 'Kopf', 'Mittel').check();
  await expect(image(page, 'Attention · Layer 1 · Mittel · 6 × 6')).toBeVisible();
  await expectItems(page, 'Beachtete Tokens', [
    '0 · Die 33,2 %',
    '3 · ␣sit 23,9 %',
    '5 · t 14,7 %',
  ]);
});

test(T.heatmapRow, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'attention · Layer 0');
  await radio(page, 'Position', '0 · Die').check();
  await expectItems(page, 'Beachtete Tokens', ['0 · Die 100,0 %']);
});

test(T.heatmapHover, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'attention · Layer 0');
  const heatmap = image(page, 'Attention · Layer 0 · Kopf 0 · 6 × 6');
  await hoverCell(page, heatmap, 6, 6, 5, 0);
  await expect(stationRegion(page)).toContainText('„t“ → „Die“: 35,5 %');
  await hoverCell(page, heatmap, 6, 6, 5, 1);
  await expect(stationRegion(page)).toContainText('„t“ → „␣Kat“: 0,5 %');
  await hoverCell(page, heatmap, 6, 6, 0, 5);
  await expect(stationRegion(page)).toContainText('„Die“ → „t“: maskiert');
});

test(T.kvCache, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 1, 'attention · Layer 1');
  await expect(historyBox(page)).toBeChecked();
  await expect(image(page, 'Attention · Layer 1 · Kopf 0 · 7 × 7')).toBeVisible();
  await expect(stationRegion(page)).toContainText(
    'Nur die neue Zeile wurde berechnet. Die Zeilen darüber stammen aus früheren Schritten (KV-Cache).',
  );
  await expect(radioGroup(page, 'Position').getByRole('radio')).toHaveCount(1);
  await expect(radio(page, 'Position', '6 · inth')).toBeChecked();
  await expectItems(page, 'Beachtete Tokens', ['5 · t 36,7 %', '3 · ␣sit 28,3 %', '2 · ze 14,2 %']);
  await historyBox(page).uncheck();
  await expect(image(page, 'Attention · Layer 1 · Kopf 0 · 1 × 7')).toBeVisible();
});

test(T.mlp, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'mlp · Layer 0');
  await expect(image(page, 'Hidden · 32 Werte')).toBeVisible();
  await expect(stationRegion(page)).toContainText('Aktiv (> 0): 17 von 32');
  await expectItems(page, 'Stärkste Neuronen', [
    '#18 3,45',
    '#29 3,29',
    '#9 2,44',
    '#7 2,11',
    '#16 2,01',
  ]);
  await expectContains(page, 'Vektoren', ['Eingang ‖v‖ = 3,13', 'Ausgang ‖v‖ = 11,33']);
});

test(T.trajectory, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'residual · Layer 1 · nach MLP');
  await expect(image(page, 'Residual Stream · 8 Werte')).toBeVisible();
  await expectItems(page, 'Verlauf', [
    'embed ‖x‖ = 1,76',
    'Layer 0 · nach Attention ‖x‖ = 4,13 (Δ 3,81)',
    'Layer 0 · nach MLP ‖x‖ = 8,95 (Δ 11,33)',
    'Layer 1 · nach Attention ‖x‖ = 11,70 (Δ 8,02)',
    'Layer 1 · nach MLP ‖x‖ = 12,24 (Δ 5,20)',
  ]);
  const current = await items(page, 'Verlauf').evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-current')),
  );
  expect(current.map((value) => value === 'true')).toEqual([false, false, false, false, true]);
});

test(T.lens, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'residual · Layer 0 · nach MLP');
  await expect(items(page, 'Logit-Lens')).toHaveCount(5);
  expect((await itemTexts(page, 'Logit-Lens'))[0]?.startsWith('␣annoying')).toBe(true);
  await openStation(page, 'residual · Layer 1 · nach MLP');
  await expect(items(page, 'Logit-Lens')).toHaveCount(5);
  const first = (await itemTexts(page, 'Logit-Lens'))[0] ?? '';
  expect(first.startsWith('inth')).toBe(true);
  expect(first.endsWith('0,7 %')).toBe(true);
});

test(T.lensAfterAttention, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'residual · Layer 0 · nach Attention');
  await expect(list(page, 'Logit-Lens')).toHaveCount(0);
  await expect(stationRegion(page)).toContainText('Die Logit-Lens gibt es nach jedem MLP.');
});

test(T.lensPosition, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'residual · Layer 1 · nach MLP');
  await radio(page, 'Position', '0 · Die').check();
  await expect(stationRegion(page)).toContainText('Die Logit-Lens gilt für die letzte Position.');
  await expect(items(page, 'Verlauf').first()).toHaveText(/^\s*embed ‖x‖ = 1,51\s*$/);
  await expect(items(page, 'Logit-Lens')).toHaveCount(5);
  expect((await itemTexts(page, 'Logit-Lens'))[0]?.startsWith('inth')).toBe(true);
});

test(T.keyboard, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'attention · Layer 0');
  await radio(page, 'Kopf', 'Kopf 0').focus();
  await page.keyboard.press('ArrowRight');
  await expect(radio(page, 'Kopf', 'Kopf 1')).toBeChecked();
  await expect(image(page, 'Attention · Layer 0 · Kopf 1 · 6 × 6')).toBeVisible();
});

test(T.keepSelection, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'embed');
  await radio(page, 'Position', '2 · ze').check();
  await openStation(page, 'attention · Layer 0');
  await expect(radio(page, 'Position', '2 · ze')).toBeChecked();
  await radio(page, 'Kopf', 'Kopf 1').check();
  await openStation(page, 'attention · Layer 1');
  await expect(radio(page, 'Kopf', 'Kopf 1')).toBeChecked();
  await open(page, 1, 'attention · Layer 1');
  await expect(radio(page, 'Position', '6 · inth')).toBeChecked();
  await expect(radio(page, 'Kopf', 'Kopf 1')).toBeChecked();
});

test(T.resetSelection, async ({ page }) => {
  await gpt2Run(page);
  await open(page, 0, 'attention · Layer 0');
  await radio(page, 'Kopf', 'Kopf 1').check();
  await radio(page, 'Position', '2 · ze').check();
  await generateButton(page).click();
  await expect(timeline(page)).toHaveCount(3, { timeout: 30_000 });
  await expect(stationRegion(page).getByRole('heading', { level: 2 })).toHaveText('tokenize');
  await open(page, 0, 'attention · Layer 0');
  await expect(radio(page, 'Kopf', 'Kopf 0')).toBeChecked();
  await expect(radio(page, 'Position', '5 · t')).toBeChecked();
});

test(T.mock, async ({ page }) => {
  await mockRun(page);
  await open(page, 0, 'embed');
  await expect(image(page, 'Summe · 8 Werte')).toBeVisible();
  await openStation(page, 'attention · Layer 0');
  await expect(image(page, 'Attention · Layer 0 · Kopf 0 · 3 × 3')).toBeVisible();
  await openStation(page, 'mlp · Layer 1');
  await expect(image(page, 'Hidden · 32 Werte')).toBeVisible();
  await openStation(page, 'residual · Layer 1 · nach MLP');
  await expect(items(page, 'Logit-Lens')).toHaveCount(5);
});

/** Entfernt alle Felder "lens" aus einem serialisierten Trace. */
function withoutLens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLens);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'lens')
      .map(([key, inner]) => [key, withoutLens(inner)]),
  );
}

test(T.importWithoutLens, async ({ page }) => {
  await mockRun(page);
  const { content } = await exportTrace(page);
  expect(content).toContain('"lens"');
  const stripped = JSON.stringify(withoutLens(JSON.parse(content)));
  expect(stripped).not.toContain('"lens"');
  await importText(page, stripped);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await open(page, 0, 'residual · Layer 0 · nach MLP');
  await expect(list(page, 'Logit-Lens')).toHaveCount(0);
  await expect(stationRegion(page)).toContainText('Dieser Trace enthält keine Logit-Lens.');
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios = feature
    .split('\n')
    .map((line) => /^\s*Szenario:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((title): title is string => title !== undefined);
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
});
