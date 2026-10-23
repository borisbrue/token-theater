/**
 * TST-0016 – Akzeptanztests für die GPT-2-Engine im Browser (CON-0015). Ein Test je Szenario aus
 * .sdd/contracts/behavior/gpt2-ui.feature, Testname = Szenariotitel. Das Testmodell liefert
 * page.route vom eigenen Origin (GU-03).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page, Route } from '@playwright/test';

import {
  expect,
  generate,
  generateButton,
  generatedText,
  maxTokensField,
  promptField,
  test,
} from './helpers';
import { group, playback, stationRegion } from './player-helpers';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/gpt2-ui.feature', import.meta.url),
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
const GREEDY_TEXT = 'Die Katze sitztinthinthinth';

const T = {
  manifest: 'GPT-2 zeigt die Modelle des Manifests',
  noManifest: 'Ohne Manifest ein Hinweis',
  run: 'Lauf mit dem Testmodell',
  candidates: 'Kandidaten des Testmodells',
  bpe: 'BPE-Schritte in der tokenize-Station',
  progress: 'Fortschritt beim Laden der Gewichte',
  abort: 'Abbrechen beim Laden',
  once: 'Gewichte werden nur einmal geladen',
  notFound: 'Gewichte nicht gefunden',
  invalid: 'Ungültige Gewichtsdatei',
  backToMock: 'Zurück zum Mock',
} as const;

// --- Modell-Server ---

type Reply = 'default' | { status: number; body?: string } | Promise<'release'>;

interface ModelServerOptions {
  manifest?: Reply;
  weights?: Reply;
}

interface ModelServer {
  weightRequests: () => number;
}

async function modelServer(page: Page, options: ModelServerOptions = {}): Promise<ModelServer> {
  let weights = 0;
  await page.route('**/models/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(url.pathname.indexOf('/models/') + '/models/'.length);
    let reply: Reply = 'default';
    if (path === 'index.json') reply = options.manifest ?? 'default';
    if (path === 'tiny/model.safetensors') {
      weights += 1;
      reply = options.weights ?? 'default';
    }
    if (reply instanceof Promise) {
      await reply;
      reply = 'default';
    }
    if (reply !== 'default') {
      await route.fulfill({ status: reply.status, body: reply.body ?? '' });
      return;
    }
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
  return { weightRequests: () => weights };
}

// --- Bedienelemente (CON-0015) ---

function engineGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Engine', exact: true });
}

function modelSelect(page: Page): Locator {
  return engineGroup(page).getByRole('combobox', { name: 'GPT-2-Modell', exact: true });
}

async function chooseGpt2(page: Page): Promise<void> {
  await engineGroup(page).getByRole('radio', { name: 'GPT-2 (Browser)', exact: true }).check();
}

function timeline(page: Page): Locator {
  return group(page, 'Zeitleiste').getByRole('button');
}

function stationButton(page: Page, name: string): Locator {
  return group(page, 'Stationen').getByRole('button', { name, exact: true });
}

async function startRun(page: Page, maxTokens = 3): Promise<void> {
  await promptField(page).fill('Die Katze sitzt');
  await maxTokensField(page).fill(String(maxTokens));
  await maxTokensField(page).blur();
  await generateButton(page).click();
}

async function runToEnd(page: Page): Promise<void> {
  await startRun(page);
  await expect(timeline(page)).toHaveCount(3, { timeout: 30_000 });
  await expect(generatedText(page)).toHaveText(GREEDY_TEXT);
}

function held(): { gate: Promise<'release'>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<'release'>((resolve) => {
    release = () => resolve('release');
  });
  return { gate, release };
}

// --- Szenarien ---

test(T.manifest, async ({ page }) => {
  await modelServer(page);
  await chooseGpt2(page);
  const options = await modelSelect(page).getByRole('option').allInnerTexts();
  expect(options.map((o) => o.trim())).toContain('Tiny GPT-2 (Test)');
});

test(T.noManifest, async ({ page }) => {
  await modelServer(page, { manifest: { status: 404 } });
  await chooseGpt2(page);
  await expect(engineGroup(page)).toContainText(
    'Keine GPT-2-Gewichte gefunden. Mit „npm run fetch-model -- distilgpt2“ herunterladen.',
  );
});

test(T.run, async ({ page }) => {
  await modelServer(page);
  await chooseGpt2(page);
  await runToEnd(page);
  await timeline(page).first().click();
  await expect(group(page, 'Stationen').getByRole('button')).toHaveCount(12);
  await stationButton(page, 'attention · Layer 0').click();
  await expect(stationRegion(page)).toContainText('weights [2, 6, 6]');
  await timeline(page).nth(1).click();
  await stationButton(page, 'attention · Layer 1').click();
  await expect(stationRegion(page)).toContainText('weights [2, 1, 7]');
});

test(T.candidates, async ({ page }) => {
  await modelServer(page);
  await chooseGpt2(page);
  await runToEnd(page);
  await timeline(page).first().click();
  await stationButton(page, 'logits').click();
  const candidates = stationRegion(page)
    .getByRole('list', { name: 'Kandidaten', exact: true })
    .getByRole('listitem');
  await expect(candidates).toHaveCount(10);
  expect((await candidates.first().innerText()).trim().startsWith('inth')).toBe(true);
  await expect(stationRegion(page)).toContainText(
    'Nur die 100 gelieferten Kandidaten, sie decken 5,8 % ab.',
  );
});

test(T.bpe, async ({ page }) => {
  await modelServer(page);
  await chooseGpt2(page);
  await runToEnd(page);
  await timeline(page).first().click();
  await stationButton(page, 'tokenize').click();
  await expect(stationRegion(page)).toContainText(
    'Wähle ein Token, um seine BPE-Schritte zu sehen.',
  );
});

test(T.progress, async ({ page }) => {
  const { gate, release } = held();
  await modelServer(page, { weights: gate });
  await chooseGpt2(page);
  await startRun(page);
  await expect(page.getByText('Lade Gewichte: 0,0 von 1,6 MB', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abbrechen', exact: true })).toBeVisible();
  release();
  await expect(timeline(page)).toHaveCount(3, { timeout: 30_000 });
});

test(T.abort, async ({ page }) => {
  const { gate, release } = held();
  await modelServer(page, { weights: gate });
  await chooseGpt2(page);
  await startRun(page);
  const cancel = page.getByRole('button', { name: 'Abbrechen', exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(playback(page)).toHaveCount(0);
  release();
});

test(T.once, async ({ page }) => {
  const server = await modelServer(page);
  await chooseGpt2(page);
  await runToEnd(page);
  await generateButton(page).click();
  await expect(generatedText(page)).toHaveText(GREEDY_TEXT);
  await page.reload();
  await chooseGpt2(page);
  await runToEnd(page);
  expect(server.weightRequests()).toBe(1);
});

test(T.notFound, async ({ page }) => {
  await modelServer(page, { weights: { status: 404 } });
  await chooseGpt2(page);
  await startRun(page);
  await expect(page.getByRole('alert')).toContainText(
    'Erzeugen fehlgeschlagen: Die Gewichte konnten nicht geladen werden (HTTP 404).',
  );
});

test(T.invalid, async ({ page }) => {
  await modelServer(page, { weights: { status: 200, body: 'kaputt' } });
  await chooseGpt2(page);
  await startRun(page);
  await expect(page.getByRole('alert')).toContainText(
    'Erzeugen fehlgeschlagen: Die Gewichtsdatei ist ungültig: ',
  );
});

test(T.backToMock, async ({ page }) => {
  await modelServer(page);
  await chooseGpt2(page);
  await runToEnd(page);
  await engineGroup(page).getByRole('radio', { name: 'Mock', exact: true }).check();
  await generate(page, 'die katze sitzt', 2);
  await expect(generatedText(page)).not.toContainText('inth');
  await timeline(page).first().click();
  await expect(group(page, 'Stationen').getByRole('button')).toHaveCount(12);
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios = feature
    .split('\n')
    .map((line) => /^\s*Szenario:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((title): title is string => title !== undefined);
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
});
