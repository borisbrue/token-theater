/**
 * TST-0012 – Akzeptanztests für Sampling-Steuerung, Logits-Ansicht, Labor und Zufallswurf
 * (CON-0011). Ein Test je Szenario aus .sdd/contracts/behavior/sampling-ui.feature, Testname =
 * Szenariotitel. Request-Mitschnitt (SU-03) und das Öffnen von "/" laufen über das Auto-Fixture
 * in ./helpers.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  exportTrace,
  generate,
  generatedText,
  importText,
  maxTokensField,
  promptField,
  generateButton,
  test,
} from './helpers';
import { groupButton, stationRegion, tokenEntries } from './player-helpers';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/sampling-ui.feature', import.meta.url),
);
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/traces/${name}`, import.meta.url)), 'utf8');

const PROMPT = 'die katze sitzt';
const PERCENT = /(\d+,\d) %/g;

const T = {
  start: 'Startzustand der Sampling-Steuerung',
  enable: 'Zufall schaltet die Felder frei',
  seed: 'Gleicher Seed, gleicher Text',
  export: 'Export enthält die Sampling-Parameter',
  topK1: 'Top-k 1 entspricht Greedy',
  topP: 'Top-p 0,05 entspricht Greedy',
  normalize: 'Ungültige Zahlen werden normalisiert',
  bars: 'Logits als Balken',
  labTopK: 'Labor mit Top-k',
  labTemp: 'Labor mit Temperatur und Zurücksetzen',
  labTrace: 'Labor ändert den Trace nicht',
  labParams: 'Labor übernimmt die Trace-Parameter',
  labKeys: 'Pfeiltasten im Labor bewegen nur den Regler',
  greedyDraw: 'Greedy-Wurf',
  randomDraw: 'Sichtbarer Zufallswurf',
  noLogits: 'Verteilung ohne Logits',
  unknownCoverage: 'Unbekannte Abdeckung',
} as const;

// --- Bedienelemente (CON-0011) ---

function sampling(page: Page): Locator {
  return page.getByRole('group', { name: 'Sampling', exact: true });
}

function strategy(page: Page, name: 'Greedy' | 'Zufall'): Locator {
  return sampling(page).getByRole('radio', { name, exact: true });
}

type Field = 'Temperatur' | 'Top-k' | 'Top-p' | 'Seed';

function field(page: Page, name: Field): Locator {
  const role = name === 'Temperatur' || name === 'Top-p' ? 'slider' : 'spinbutton';
  return sampling(page).getByRole(role, { name, exact: true });
}

function lab(page: Page): Locator {
  return page.getByRole('region', { name: 'Sampling-Labor', exact: true });
}

type LabField = 'Labor-Temperatur' | 'Labor-Top-k' | 'Labor-Top-p';

function labField(page: Page, name: LabField): Locator {
  const role = name === 'Labor-Top-k' ? 'spinbutton' : 'slider';
  return lab(page).getByRole(role, { name, exact: true });
}

function candidates(page: Page): Locator {
  return stationRegion(page)
    .getByRole('list', { name: 'Kandidaten', exact: true })
    .getByRole('listitem');
}

function labEntries(page: Page): Locator {
  return lab(page)
    .getByRole('list', { name: 'Labor-Verteilung', exact: true })
    .getByRole('listitem');
}

function percents(text: string): number[] {
  return Array.from(text.matchAll(PERCENT), (m) =>
    Number.parseFloat((m[1] ?? '').replace(',', '.')),
  );
}

async function texts(locator: Locator): Promise<string[]> {
  return (await locator.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

async function chooseRandom(
  page: Page,
  values: Partial<Record<Field, string>> = {},
): Promise<void> {
  await strategy(page, 'Zufall').check();
  for (const [name, value] of Object.entries(values) as [Field, string][]) {
    await field(page, name).fill(value);
  }
}

/** Erzeugt mit dem aktuellen Sampling und wartet auf den Text. */
async function generateWith(page: Page, maxTokens: number): Promise<string> {
  await generate(page, PROMPT, maxTokens);
  return (await generatedText(page).innerText()).trim();
}

async function openStation(page: Page, name: 'logits' | 'sample'): Promise<void> {
  await groupButton(page, 'Stationen', name).click();
  await expect(stationRegion(page).getByRole('heading', { level: 2 })).toHaveText(name);
}

async function generateAndOpen(page: Page, maxTokens: number, station: 'logits' | 'sample') {
  await generateWith(page, maxTokens);
  await openStation(page, station);
}

// --- Szenarien ---

test(T.start, async ({ page }) => {
  await expect(strategy(page, 'Greedy')).toBeChecked();
  await expect(strategy(page, 'Zufall')).not.toBeChecked();
  const expected: [Field, string][] = [
    ['Temperatur', '1'],
    ['Top-k', '0'],
    ['Top-p', '1'],
    ['Seed', '42'],
  ];
  for (const [name, value] of expected) {
    await expect(field(page, name)).toBeDisabled();
    await expect(field(page, name)).toHaveValue(value);
  }
});

test(T.enable, async ({ page }) => {
  await strategy(page, 'Zufall').check();
  for (const name of ['Temperatur', 'Top-k', 'Top-p', 'Seed'] as const) {
    await expect(field(page, name)).toBeEnabled();
  }
  await field(page, 'Temperatur').fill('0.7');
  await expect(sampling(page)).toContainText('0,7');
});

/** Frische Seite: der zweite Lauf startet ohne Trace, das Warten auf den Text ist eindeutig. */
async function freshPage(page: Page): Promise<void> {
  await page.reload();
  await expect(generatedText(page)).toHaveCount(0);
}

test(T.seed, async ({ page }) => {
  await chooseRandom(page, { Seed: '7' });
  const first = await generateWith(page, 4);
  await freshPage(page);
  await chooseRandom(page, { Seed: '7' });
  expect(await generateWith(page, 4)).toBe(first);
});

test(T.export, async ({ page }) => {
  await chooseRandom(page, { Temperatur: '0.5', 'Top-k': '5', 'Top-p': '0.9', Seed: '7' });
  await generateWith(page, 2);
  const { content } = await exportTrace(page);
  const trace = JSON.parse(content) as { sampling: unknown };
  expect(trace.sampling).toEqual({
    strategy: 'sample',
    seed: 7,
    params: { temperature: 0.5, topK: 5, topP: 0.9 },
  });
});

test(T.topK1, async ({ page }) => {
  const greedy = await generateWith(page, 4);
  await freshPage(page);
  await chooseRandom(page, { 'Top-k': '1', Seed: '3' });
  expect(await generateWith(page, 4)).toBe(greedy);
});

test(T.topP, async ({ page }) => {
  const greedy = await generateWith(page, 4);
  await freshPage(page);
  await chooseRandom(page, { 'Top-p': '0.05', Seed: '11' });
  expect(await generateWith(page, 4)).toBe(greedy);
});

test(T.normalize, async ({ page }) => {
  await chooseRandom(page, { 'Top-k': '250', Seed: '-5' });
  await promptField(page).fill(PROMPT);
  await maxTokensField(page).fill('1');
  await generateButton(page).click();
  await expect(field(page, 'Top-k')).toHaveValue('100');
  await expect(field(page, 'Seed')).toHaveValue('0');
});

test(T.bars, async ({ page }) => {
  await generateAndOpen(page, 2, 'logits');
  await expect(candidates(page)).toHaveCount(10);
  const values = (await texts(candidates(page))).map((t) => percents(t)[0] ?? NaN);
  values.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  for (let i = 1; i < values.length; i += 1) {
    expect(values[i] ?? NaN).toBeLessThanOrEqual(values[i - 1] ?? NaN);
  }
  await expect(stationRegion(page)).toContainText(/\+ 42 weitere Tokens mit zusammen \d+,\d %/);
});

test(T.labTopK, async ({ page }) => {
  await generateAndOpen(page, 2, 'logits');
  await labField(page, 'Labor-Top-k').fill('2');
  const rows = await texts(labEntries(page));
  expect(rows).toHaveLength(10);
  rows.slice(2).forEach((row) => expect(row.endsWith('entfernt')).toBe(true));
  const sum = rows.slice(0, 2).reduce((s, row) => s + (percents(row)[1] ?? NaN), 0);
  expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.2);
});

test(T.labTemp, async ({ page }) => {
  await generateAndOpen(page, 2, 'logits');
  await labField(page, 'Labor-Temperatur').fill('0.3');
  const [original, changed] = percents((await texts(labEntries(page)))[0] ?? '');
  expect(changed ?? NaN).toBeGreaterThan(original ?? NaN);
  await lab(page).getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await expect(labField(page, 'Labor-Temperatur')).toHaveValue('1');
  await expect(labField(page, 'Labor-Top-k')).toHaveValue('0');
  await expect(labField(page, 'Labor-Top-p')).toHaveValue('1');
  for (const row of await texts(labEntries(page))) {
    const [before, after] = percents(row);
    expect(after).toBe(before);
  }
});

test(T.labTrace, async ({ page }) => {
  await generateAndOpen(page, 2, 'logits');
  const text = (await generatedText(page).innerText()).trim();
  await labField(page, 'Labor-Top-p').fill('0.05');
  await expect(labEntries(page).first()).toContainText('100,0 %');
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 11 / 12');
  await expect(generatedText(page)).toHaveText(text);
});

test(T.labParams, async ({ page }) => {
  await chooseRandom(page, { Temperatur: '0.5', 'Top-k': '5', 'Top-p': '0.9', Seed: '7' });
  await generateAndOpen(page, 2, 'logits');
  await expect(labField(page, 'Labor-Temperatur')).toHaveValue('0.5');
  await expect(labField(page, 'Labor-Top-k')).toHaveValue('5');
  await expect(labField(page, 'Labor-Top-p')).toHaveValue('0.9');
});

test(T.labKeys, async ({ page }) => {
  await generateAndOpen(page, 2, 'logits');
  await labField(page, 'Labor-Temperatur').focus();
  await page.keyboard.press('ArrowRight');
  await expect(labField(page, 'Labor-Temperatur')).toHaveValue('1.1');
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 11 / 12');
});

test(T.greedyDraw, async ({ page }) => {
  await generateAndOpen(page, 2, 'sample');
  await expect(stationRegion(page)).toContainText('Strategie: Greedy');
  const first = (await texts(candidates(page)))[0] ?? '';
  const token = first.split(' ')[0] ?? '';
  await expect(stationRegion(page)).toContainText(
    `Greedy: kein Zufall, gewählt wird das wahrscheinlichste Token „${token}“.`,
  );
  await expect(candidates(page).first()).toHaveAttribute('aria-current', 'true');
});

test(T.randomDraw, async ({ page }) => {
  await chooseRandom(page, { Seed: '7' });
  await generateAndOpen(page, 2, 'sample');
  const station = stationRegion(page);
  await expect(station).toContainText('Temperatur 1,0 · Top-k aus · Top-p 1,00 · Seed 7');
  const match = /Zufallszahl 0,\d{3} fällt auf „([^“]+)“/.exec(await station.innerText());
  expect(match).not.toBeNull();
  const token = match?.[1] ?? '';
  const marks = await candidates(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute('aria-current')),
  );
  expect(marks.filter((mark) => mark === 'true')).toHaveLength(1);
  const rows = await texts(candidates(page));
  expect(rows[marks.indexOf('true')]?.split(' ')[0]).toBe(token);
  const streamTexts = await tokenEntries(page).allInnerTexts();
  const newIndex = await tokenEntries(page).evaluateAll((items) =>
    items.findIndex((item) => item.getAttribute('aria-current') === 'true'),
  );
  expect(streamTexts[newIndex]?.trim()).toBe(token);
});

test(T.noLogits, async ({ page }) => {
  await importText(page, fixture('remote-top3.trace.json'), 'remote-top3.trace.json');
  await openStation(page, 'logits');
  await expect(candidates(page)).toHaveCount(3);
  const first = candidates(page).first();
  await expect(first).toContainText('␣Katze');
  await expect(first).toContainText('50,0 %');
  await expect(first).toContainText('–');
  await expect(stationRegion(page)).toContainText(
    'Nur die 3 gelieferten Kandidaten, sie decken 80,0 % ab.',
  );
  await labField(page, 'Labor-Temperatur').fill('0.5');
  const rows = await texts(labEntries(page));
  expect(rows.map((row) => percents(row)[1])).toEqual([65.8, 23.7, 10.5]);
});

test(T.unknownCoverage, async ({ page }) => {
  await importText(page, fixture('gpt2-bpe.trace.json'), 'gpt2-bpe.trace.json');
  await openStation(page, 'logits');
  await expect(stationRegion(page)).toContainText('Abdeckung der Verteilung unbekannt.');
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios = feature
    .split('\n')
    .map((line) => /^\s*Szenario:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((title): title is string => title !== undefined);
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
});
