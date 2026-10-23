/**
 * TST-0022 – Akzeptanztests für Präsentationsmodus und Erklärtexte (CON-0020). Ein Test je
 * Szenario aus .sdd/contracts/behavior/presentation-ui.feature (Szenariogrundriss: ein Test je
 * Beispiel), Testname = Szenariotitel. Das GPT-2-Testmodell liefert page.route vom eigenen Origin.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page, Route } from '@playwright/test';

import {
  expect,
  exportTrace,
  generate,
  generateButton,
  generatedText,
  importText,
  isRecord,
  maxTokensField,
  promptField,
  test,
} from './helpers';
import { group, playback, stationRegion, tokenItems, tokenStream } from './player-helpers';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/presentation-ui.feature', import.meta.url),
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

const NO_INTERNALS_NOTE =
  'Dieser Lauf zeigt nur Tokens und Wahrscheinlichkeiten. Ein Server liefert keine Interna wie Attention oder MLP; die zeigt die Engine „GPT-2 (Browser)“.';

const MORE_WITH_FACTS: readonly (readonly [string, string])[] = [
  ['tokenize', 'Das Vokabular hat 50.257 Tokens.'],
  ['embed', 'Jeder Vektor hat 8 Zahlen.'],
  ['attention · Layer 0', 'Dieses Modell hat 2 Köpfe in jedem seiner 2 Layer.'],
  [
    'residual · Layer 0 · nach Attention',
    'Der Residual Stream ist wie ein Notizblock, der durch alle Layer gereicht wird.',
  ],
  ['mlp · Layer 1', 'Hier: 8 → 32 → 8 Zahlen.'],
  [
    'residual · Layer 1 · nach MLP',
    'Die Logit-Lens zeigt, welches Token das Modell vorhersagen würde, wenn es hier aufhörte.',
  ],
  ['logits', 'Bewertet werden alle 50.257 Tokens des Vokabulars.'],
  ['sample', 'Greedy nimmt immer das wahrscheinlichste Token.'],
];

const T = {
  needsTrace: 'Präsentation erst mit Trace',
  stage: 'Bühne ohne Formular',
  fits: 'Bühne passt in 1280 × 720',
  fontSize: 'Größere Schrift auf der Bühne',
  keys: 'Ein- und Ausschalten per Taste',
  promptKey: 'Taste p im Prompt-Feld',
  exitButton: 'Präsentation beenden per Knopf',
  cursor: 'Cursor bleibt beim Moduswechsel',
  clickerStage: 'Clicker auf der Bühne',
  clickerExplore: 'Clicker im Erkunden-Modus',
  moreClosed: 'Mehr dazu ist zugeklappt',
  moreFacts: 'Mehr dazu mit den Zahlen des Modells',
  moreNoFacts: 'Mehr dazu ohne Modellzahlen',
  note: 'Hinweis bei einem Lauf ohne Interna',
  noNote: 'Kein Hinweis mit Interna',
  spaces: 'Tokenstrom zeigt Leerzeichen',
} as const;

// --- Modell-Server (wie TST-0016/TST-0019) ---

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

function exitButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Präsentation beenden', exact: true });
}

function stage(page: Page): Locator {
  return page.getByRole('region', { name: 'Bühne', exact: true });
}

function main(page: Page): Locator {
  return page.locator('main');
}

async function expectMode(page: Page, mode: 'explore' | 'presentation'): Promise<void> {
  await expect(main(page)).toHaveAttribute('data-mode', mode);
}

function position(page: Page): Locator {
  return stationRegion(page).locator('.station-position');
}

function more(page: Page): Locator {
  return stationRegion(page).locator('details');
}

function moreSummary(page: Page): Locator {
  return more(page).locator('summary', { hasText: 'Mehr dazu' });
}

/** Klick auf die App-Überschrift: kein Eingabefeld fokussiert. */
async function blurInputs(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Token Theater', level: 1 }).click();
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

/** Mock-Lauf, Export, Interna entfernen, Import (Feature-Kopf „Lauf ohne Interna“). */
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
  await moreSummary(page).click();
  await expect(more(page)).toHaveAttribute('open', '');
}

async function fontSizeOfFirstToken(page: Page): Promise<number> {
  return tokenItems(page)
    .first()
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
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

// --- Szenarien ---

test(T.needsTrace, async ({ page }) => {
  await expect(presentButton(page)).toBeDisabled();
  await expectMode(page, 'explore');
  await blurInputs(page);
  await page.keyboard.press('p');
  await expectMode(page, 'explore');
  await mockRun(page);
  await expect(presentButton(page)).toBeEnabled();
});

test(T.stage, async ({ page }) => {
  await mockRun(page);
  await presentButton(page).click();
  await expectMode(page, 'presentation');
  await expect(promptField(page)).toHaveCount(0);
  await expect(generatedText(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Details' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Ansicht', exact: true })).toHaveCount(0);
  for (const name of ['Tokenstrom', 'Station', 'Wiedergabe']) {
    await expect(stage(page).getByRole('region', { name, exact: true })).toHaveCount(1);
  }
  await expect(stage(page).getByRole('button', { name: 'Präsentation beenden' })).toBeVisible();
  await expect(stage(page)).toBeFocused();
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
  await expectInViewport(
    page,
    stationRegion(page).getByRole('heading', { level: 2 }),
    'Stationsüberschrift',
  );
  await expectInViewport(page, playback(page), 'Transportleiste');
});

test(T.fontSize, async ({ page }) => {
  await mockRun(page);
  const before = await fontSizeOfFirstToken(page);
  await presentButton(page).click();
  await expectMode(page, 'presentation');
  const after = await fontSizeOfFirstToken(page);
  expect(after).toBeGreaterThanOrEqual(1.5 * before);
});

test(T.keys, async ({ page }) => {
  await mockRun(page);
  await blurInputs(page);
  await page.keyboard.press('p');
  await expectMode(page, 'presentation');
  await page.keyboard.press('Escape');
  await expectMode(page, 'explore');
  await expect(presentButton(page)).toBeFocused();
  await page.keyboard.press('p');
  await expectMode(page, 'presentation');
  await page.keyboard.press('p');
  await expectMode(page, 'explore');
});

test(T.promptKey, async ({ page }) => {
  await mockRun(page);
  await promptField(page).click();
  await promptField(page).press('End');
  await promptField(page).press('p');
  await expectMode(page, 'explore');
  await expect(promptField(page)).toHaveValue('die katze sitztp');
});

test(T.exitButton, async ({ page }) => {
  await mockRun(page);
  await presentButton(page).click();
  await expectMode(page, 'presentation');
  await exitButton(page).click();
  await expectMode(page, 'explore');
  await expect(promptField(page)).toHaveCount(1);
  await expect(generatedText(page)).toHaveCount(1);
  await expect(presentButton(page)).toBeFocused();
});

test(T.cursor, async ({ page }) => {
  await mockRun(page);
  const forward = playback(page).getByRole('button', { name: 'Station vor', exact: true });
  await forward.click();
  await forward.click();
  await presentButton(page).click();
  await expectMode(page, 'presentation');
  await expect(position(page)).toHaveText('Schritt 0 · Station 3 / 12');
  await page.keyboard.press('Escape');
  await expectMode(page, 'explore');
  await expect(position(page)).toHaveText('Schritt 0 · Station 3 / 12');
});

test(T.clickerStage, async ({ page }) => {
  await mockRun(page);
  await presentButton(page).click();
  await expectMode(page, 'presentation');
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  await expect(position(page)).toHaveText('Schritt 0 · Station 3 / 12');
  await page.keyboard.press('PageUp');
  await expect(position(page)).toHaveText('Schritt 0 · Station 2 / 12');
});

test(T.clickerExplore, async ({ page }) => {
  await mockRun(page);
  await blurInputs(page);
  await page.keyboard.press('PageDown');
  await expect(position(page)).toHaveText('Schritt 0 · Station 2 / 12');
  await expectMode(page, 'explore');
  await page.keyboard.press('PageUp');
  await expect(position(page)).toHaveText('Schritt 0 · Station 1 / 12');
});

test(T.moreClosed, async ({ page }) => {
  await mockRun(page);
  await expect(more(page)).toHaveCount(1);
  await expect(moreSummary(page)).toHaveText('Mehr dazu');
  await expect(more(page)).not.toHaveAttribute('open', /.*/);
  const explanation = stationRegion(page).locator('h2 + p');
  await expect(explanation).toHaveText(
    'Der Text wird in Tokens zerlegt: Wörter oder Satzzeichen mit einer festen Nummer.',
  );
  await openMore(page);
  await expect(more(page)).toContainText(
    'Ein Leerzeichen gehört zum folgenden Wort und erscheint als „␣“.',
  );
});

for (const [stationName, sentence] of MORE_WITH_FACTS) {
  test(`${T.moreFacts}: ${stationName}`, async ({ page }) => {
    await gpt2Run(page);
    await chooseStation(page, stationName);
    await openMore(page);
    await expect(more(page)).toContainText(sentence);
  });
}

test(T.moreNoFacts, async ({ page }) => {
  await runWithoutInternals(page);
  await chooseStation(page, 'logits');
  await openMore(page);
  await expect(more(page)).toContainText(
    'Ist das Modell unbekannt (etwa bei einem Server), kennt der Trace nur die gelieferten Kandidaten.',
  );
  await expect(more(page)).not.toContainText('Bewertet werden alle');
  await chooseStation(page, 'tokenize');
  if ((await more(page).getAttribute('open')) === null) await openMore(page);
  await expect(more(page)).not.toContainText('Das Vokabular hat');
});

test(T.note, async ({ page }) => {
  await runWithoutInternals(page);
  const note = playback(page).getByRole('note');
  await expect(note).toHaveText(NO_INTERNALS_NOTE);
  await expect(group(page, 'Stationen').getByRole('button')).toHaveCount(3);
  await presentButton(page).click();
  await expectMode(page, 'presentation');
  await expect(stage(page).getByRole('note')).toHaveText(NO_INTERNALS_NOTE);
});

test(T.noNote, async ({ page }) => {
  await mockRun(page);
  await expect(playback(page).getByRole('note')).toHaveCount(0);
});

test(T.spaces, async ({ page }) => {
  await gpt2Run(page);
  await expect(tokenItems(page)).toHaveText(['Die', '␣Kat', 'ze', '␣sit', 'z', 't', '?']);
  await playback(page).getByRole('button', { name: 'Zum Ende', exact: true }).click();
  const last = (await tokenItems(page).allTextContents()).at(-1) ?? '';
  expect(last).not.toMatch(/\s/);
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios = feature
    .split('\n')
    .map((line) => /^\s*Szenario(?:grundriss)?:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((title): title is string => title !== undefined);
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
  const examples = feature
    .split('\n')
    .map((line) => /^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && m[1] !== 'station')
    .map((m) => [m[1], m[2]]);
  expect(examples).toEqual(MORE_WITH_FACTS.map(([s, t]) => [s, t]));
});
