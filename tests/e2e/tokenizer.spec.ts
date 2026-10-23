/**
 * TST-0010 – Akzeptanztests für Tokenizer-Werkbank und tokenize-Station (CON-0009).
 * Ein Test je Szenario aus .sdd/contracts/behavior/tokenizer-ui.feature, Testname =
 * Szenariotitel. Request-Mitschnitt (TU-03) und das Öffnen von "/" (Grundlage) laufen über das
 * Auto-Fixture in ./helpers.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import { expect, importText, promptField, tabTo, test } from './helpers';
import { generateTraceT, stationRegion, transportButton } from './player-helpers';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/tokenizer-ui.feature', import.meta.url),
);
const BPE_TRACE_PATH = fileURLToPath(
  new URL('../fixtures/traces/gpt2-bpe.trace.json', import.meta.url),
);

const VOCAB = '/tokenizers/gpt2/vocab.json';
const MERGES = '/tokenizers/gpt2/merges.txt';
const DEFAULT_IDS = '32423 8595 2736 5513 75 11033 701 257 3046 1357 1406 13331 13';
const HINT = 'Wähle ein Token, um seine BPE-Schritte zu sehen.';
const LOADING = 'GPT-2-Vokabular wird geladen …';
const LOAD_ERROR = 'Das GPT-2-Vokabular konnte nicht geladen werden.';
const NO_BPE = 'Dieser Trace enthält keine BPE-Schritte.';
const KATZE_HEADING = 'BPE-Schritte für „␣Katze“';

const T = {
  toggle: 'Umschalter zeigt den Durchlauf',
  open: 'Werkbank öffnen',
  live: 'Live-Zerlegung bei Eingabe',
  emoji: 'Emoji und Umlaute zerfallen in Bytes',
  whitespace: 'Leerzeichen, Tabulatoren und Zeilenumbrüche sind sichtbar',
  empty: 'Leerer Text',
  colors: 'Benachbarte Tokens haben verschiedene Farben',
  merges: 'BPE-Schritte eines Wortes',
  noMerge: 'Wort ohne Merge',
  reset: 'Neuer Text setzt die Auswahl zurück',
  keyboard: 'Tastaturbedienung der Tokenliste',
  lazy: 'Vokabular wird erst beim Öffnen geladen',
  loading: 'Ladeanzeige',
  retry: 'Laden schlägt fehl und wird wiederholt',
  untouched: 'Werkbank lässt Trace und Cursor unberührt',
  mockStation: 'tokenize-Station eines Mock-Traces',
  bpeStation: 'tokenize-Station eines Traces mit BPE-Details',
  size: 'Token-Knöpfe sind groß genug',
} as const;

// --- Bedienelemente (CON-0009) ---

function viewGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Ansicht', exact: true });
}

function viewButton(page: Page, name: 'Durchlauf' | 'Tokenizer'): Locator {
  return viewGroup(page).getByRole('button', { name, exact: true });
}

function workbench(page: Page): Locator {
  return page.getByRole('region', { name: 'Tokenizer', exact: true });
}

function textField(page: Page): Locator {
  return workbench(page).getByRole('textbox', { name: 'Text', exact: true });
}

function stats(page: Page): Locator {
  return workbench(page).getByRole('list', { name: 'Kennzahlen', exact: true });
}

function tokenList(scope: Locator): Locator {
  return scope.getByRole('list', { name: 'Tokens', exact: true });
}

function tokenEntries(scope: Locator): Locator {
  return tokenList(scope).getByRole('listitem');
}

function bpeRegion(page: Page): Locator {
  return page.getByRole('region', { name: 'BPE-Schritte', exact: true });
}

function mergeEntries(page: Page): Locator {
  return bpeRegion(page).getByRole('list', { name: 'Merges', exact: true }).getByRole('listitem');
}

/** innerText eines Eintrags mit normalisiertem Leerraum: "<Anzeigetext> <ID>". */
async function entryTexts(scope: Locator): Promise<string[]> {
  const texts = await tokenEntries(scope).allInnerTexts();
  return texts.map((text) => text.replace(/\s+/g, ' ').trim());
}

/** Prüft die Token-Einträge der Reihe nach als "<Anzeigetext> <ID>". */
async function expectEntries(scope: Locator, expected: readonly string[]): Promise<void> {
  await expect(tokenEntries(scope)).toHaveCount(expected.length);
  expect(await entryTexts(scope)).toEqual(expected);
}

/** Knopf des Eintrags, dessen Anzeigetext genau `display` ist. */
async function tokenButton(scope: Locator, display: string): Promise<Locator> {
  const texts = await entryTexts(scope);
  const index = texts.findIndex((text) => text.split(' ')[0] === display);
  if (index < 0) throw new Error(`Kein Token-Eintrag "${display}" in ${JSON.stringify(texts)}`);
  return tokenEntries(scope).nth(index).getByRole('button');
}

async function openWorkbench(page: Page): Promise<void> {
  await viewButton(page, 'Tokenizer').click();
  await expect(tokenList(workbench(page))).toBeVisible();
}

async function enterText(page: Page, text: string): Promise<void> {
  await textField(page).fill(text);
}

async function selectToken(scope: Locator, display: string): Promise<void> {
  await (await tokenButton(scope, display)).click();
}

async function expectStats(page: Page, expected: readonly string[]): Promise<void> {
  for (const entry of expected) {
    await expect(stats(page).getByRole('listitem').filter({ hasText: entry })).toHaveText(entry);
  }
}

function pathCount(requests: readonly string[], path: string): number {
  return requests.filter((url) => new URL(url).pathname === path).length;
}

// --- Szenarien ---

test(T.toggle, async ({ page }) => {
  await expect(viewButton(page, 'Durchlauf')).toHaveAttribute('aria-pressed', 'true');
  await expect(viewButton(page, 'Tokenizer')).toHaveAttribute('aria-pressed', 'false');
  await expect(workbench(page)).toHaveCount(0);
  await expect(promptField(page)).toBeVisible();
});

test(T.open, async ({ page }) => {
  await openWorkbench(page);
  await expect(viewButton(page, 'Tokenizer')).toHaveAttribute('aria-pressed', 'true');
  await expect(viewButton(page, 'Durchlauf')).toHaveAttribute('aria-pressed', 'false');
  await expect(promptField(page)).toHaveCount(0);
  await expect(textField(page)).toHaveValue('Die Katze schläft auf dem Sofa.');
  await expectStats(page, ['31 Zeichen', '32 Bytes', '13 Tokens']);
  await expect(tokenEntries(workbench(page))).toHaveCount(13);
  expect((await entryTexts(workbench(page)))[1]).toBe('␣Kat 8595');
  await expect(workbench(page).getByText(DEFAULT_IDS, { exact: true })).toBeVisible();
  await expect(workbench(page).getByText(HINT, { exact: true })).toBeVisible();
});

test(T.live, async ({ page }) => {
  await openWorkbench(page);
  await enterText(page, 'Hello world');
  await expectStats(page, ['11 Zeichen', '11 Bytes', '2 Tokens']);
  await expectEntries(workbench(page), ['Hello 15496', '␣world 995']);
});

test(T.emoji, async ({ page }) => {
  await openWorkbench(page);
  await enterText(page, '🦊 Füchse');
  await expectStats(page, ['8 Zeichen', '12 Bytes', '7 Tokens']);
  await expectEntries(workbench(page), [
    '<F0 9F> 8582',
    '<A6> 99',
    '<8A> 232',
    '␣F 376',
    'ü 9116',
    'ch 354',
    'se 325',
  ]);
});

test(T.whitespace, async ({ page }) => {
  await openWorkbench(page);
  await enterText(page, 'Zeile eins\n\tzwei  drei');
  await expect(tokenEntries(workbench(page))).toHaveCount(12);
  const displays = (await entryTexts(workbench(page))).map((text) => text.split(' ')[0]);
  expect(displays).toEqual(['Ze', 'ile', '␣e', 'ins', '↵', '⇥', 'z', 'wei', '␣', '␣d', 're', 'i']);
});

test(T.empty, async ({ page }) => {
  await openWorkbench(page);
  await enterText(page, '');
  await expectStats(page, ['0 Tokens']);
  await expect(tokenEntries(workbench(page))).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test(T.colors, async ({ page }) => {
  await openWorkbench(page);
  const colors = await tokenList(workbench(page))
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).borderTopColor));
  expect(colors).toHaveLength(13);
  for (let i = 1; i < colors.length; i += 1) {
    expect(colors[i], `Token ${i} gegenüber ${i - 1}`).not.toBe(colors[i - 1]);
  }
  expect(colors[4]).toBe(colors[0]);
});

test(T.merges, async ({ page }) => {
  await openWorkbench(page);
  await selectToken(workbench(page), '␣Kat');
  await expect(bpeRegion(page).getByRole('heading', { level: 3 })).toHaveText(KATZE_HEADING);
  await expect(mergeEntries(page)).toHaveCount(5);
  const first = mergeEntries(page).nth(0);
  expect((await first.innerText()).trim().startsWith('Start')).toBe(true);
  for (const symbol of ['␣', 'K', 'a', 't', 'z', 'e']) {
    await expect(first).toContainText(symbol);
  }
  await expect(mergeEntries(page).nth(1)).toContainText('Merge 1 · Rang 9');
  const last = mergeEntries(page).nth(4);
  await expect(last).toContainText('Merge 4 · Rang 8339');
  await expect(last).toContainText('␣Kat');
  await expect(last).toContainText('ze');
  const scope = workbench(page);
  await expect(await tokenButton(scope, '␣Kat')).toHaveAttribute('aria-pressed', 'true');
  await expect(await tokenButton(scope, 'ze')).toHaveAttribute('aria-pressed', 'true');
  await expect(await tokenButton(scope, 'Die')).toHaveAttribute('aria-pressed', 'false');
});

test(T.noMerge, async ({ page }) => {
  await openWorkbench(page);
  await selectToken(workbench(page), '.');
  await expect(mergeEntries(page)).toHaveCount(1);
  expect((await mergeEntries(page).nth(0).innerText()).trim().startsWith('Start')).toBe(true);
});

test(T.reset, async ({ page }) => {
  await openWorkbench(page);
  await selectToken(workbench(page), '␣Kat');
  await expect(bpeRegion(page)).toBeVisible();
  await enterText(page, 'Hello world');
  await expect(bpeRegion(page)).toHaveCount(0);
  await expect(workbench(page).getByText(HINT, { exact: true })).toBeVisible();
});

test(T.keyboard, async ({ page }) => {
  await openWorkbench(page);
  await tabTo(page, await tokenButton(workbench(page), '␣Kat'));
  await page.keyboard.press('Enter');
  await expect(bpeRegion(page).getByRole('heading', { level: 3 })).toHaveText(KATZE_HEADING);
});

test(T.lazy, async ({ page, requests, baseURL }) => {
  expect(pathCount(requests, VOCAB)).toBe(0);
  expect(pathCount(requests, MERGES)).toBe(0);
  await openWorkbench(page);
  await viewButton(page, 'Durchlauf').click();
  await expect(promptField(page)).toBeVisible();
  await openWorkbench(page);
  expect(pathCount(requests, VOCAB)).toBe(1);
  expect(pathCount(requests, MERGES)).toBe(1);
  const origin = new URL(baseURL ?? page.url()).origin;
  for (const url of requests.filter((u) => u.includes('/tokenizers/gpt2/'))) {
    expect(new URL(url).origin).toBe(origin);
  }
});

test(T.loading, async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${VOCAB}`, async (route) => {
    await gate;
    await route.continue();
  });
  await viewButton(page, 'Tokenizer').click();
  await expect(workbench(page).getByText(LOADING, { exact: true })).toBeVisible();
  release();
  await expect(tokenEntries(workbench(page))).toHaveCount(13);
  await expect(workbench(page).getByText(LOADING, { exact: true })).toHaveCount(0);
});

test(T.retry, async ({ page }) => {
  await page.route(`**${VOCAB}`, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await viewButton(page, 'Tokenizer').click();
  await expect(page.getByRole('alert')).toHaveText(LOAD_ERROR);
  const retry = page.getByRole('button', { name: 'Erneut versuchen', exact: true });
  await expect(retry).toBeVisible();
  await page.unroute(`**${VOCAB}`);
  await retry.click();
  await expect(tokenEntries(workbench(page))).toHaveCount(13);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test(T.untouched, async ({ page }) => {
  await generateTraceT(page);
  await transportButton(page, 'Station vor').click();
  await transportButton(page, 'Station vor').click();
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 3 / 12');
  await openWorkbench(page);
  await page.getByRole('heading', { level: 1, name: 'Token Theater' }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await viewButton(page, 'Durchlauf').click();
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 3 / 12');
  await expect(transportButton(page, 'Abspielen')).toBeVisible();
});

test(T.mockStation, async ({ page }) => {
  await generateTraceT(page);
  const station = stationRegion(page);
  await expect(station.getByRole('heading', { level: 2 })).toHaveText('tokenize');
  await expectEntries(station, ['die 2', 'katze 7', 'sitzt 18']);
  await expect(tokenList(station).getByRole('button')).toHaveCount(0);
  await expect(station.getByText(NO_BPE, { exact: true })).toBeVisible();
});

test(T.bpeStation, async ({ page }) => {
  await importText(page, readFileSync(BPE_TRACE_PATH, 'utf8'), 'gpt2-bpe.trace.json');
  const station = stationRegion(page);
  await expect(station).toContainText('Schritt 0 · Station 1 / 3');
  await expectEntries(station, ['Die 32423', '␣Kat 8595', 'ze 2736']);
  await selectToken(station, '␣Kat');
  await expect(bpeRegion(page).getByRole('heading', { level: 3 })).toHaveText(KATZE_HEADING);
  await expect(mergeEntries(page)).toHaveCount(5);
  await expect(station.getByRole('heading', { level: 2 })).toHaveCount(1);
});

test(T.size, async ({ page }) => {
  await openWorkbench(page);
  const buttons = tokenList(workbench(page)).getByRole('button');
  const count = await buttons.count();
  expect(count).toBe(13);
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    expect(box?.height ?? 0, `Token-Knopf ${i}`).toBeGreaterThanOrEqual(44);
  }
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios = feature
    .split('\n')
    .map((line) => /^\s*Szenario:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((title): title is string => title !== undefined);
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
});
