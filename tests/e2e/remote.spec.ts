/**
 * TST-0014 – Akzeptanztests für den Server-Modus (CON-0013). Ein Test je Szenario aus
 * .sdd/contracts/behavior/remote-ui.feature, Testname = Szenariotitel. Der Fake-Server liegt per
 * page.route auf dem eigenen Origin (RU-03); Presets setzt playwright.config.ts beim Build.
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
  maxTokensField,
  promptField,
  test,
} from './helpers';
import { group, playback, stationRegion, tokenItems } from './player-helpers';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/remote-ui.feature', import.meta.url),
);
const fixtureText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/remote/${name}.json`, import.meta.url)), 'utf8');

const KEY = 'sk-test-123';
const PROMPT = 'Die Katze sitzt auf dem';

const T = {
  mockDefault: 'Mock ist voreingestellt',
  fields: 'Server zeigt die Einstellungen',
  profile: 'Profil füllt die Felder',
  models: 'Modelle laden',
  modelsDenied: 'Modelle laden mit falschem Key',
  legacyRun: 'Lauf im Dialekt Klassisch',
  candidates: 'Kandidaten eines echten Modells',
  contentRun: 'Lauf im Dialekt Logprobs-Liste',
  autoDialect: 'Dialekt wird automatisch erkannt',
  random: 'Zufall mit dem Server ist reproduzierbar',
  wrongKey: 'Falscher Key beim Lauf',
  midRunError: 'Fehler mitten im Lauf',
  unreachable: 'Server nicht erreichbar',
  abort: 'Fortschritt und Abbrechen',
  keyNotStored: 'Der API-Key wird nicht gespeichert',
  exportNoKey: 'Export eines Server-Traces enthält keinen Key',
  backToMock: 'Zurück zum Mock',
} as const;

// --- Fake-Server ---

interface Call {
  url: string;
  method: string;
  authorization: string | undefined;
  body: Record<string, unknown> | null;
}

type Reply = { status?: number; fixture?: string; json?: unknown } | 'abort' | Promise<'release'>;

interface FakeOptions {
  /** Antwort auf die n-te (0-basiert) POST-Anfrage an /completions; undefined → Standard. */
  completion?: (body: Record<string, unknown>, index: number) => Reply | undefined;
  modelsStatus?: number;
}

interface Fake {
  calls: Call[];
  completions(): Call[];
}

function standardFixture(body: Record<string, unknown>): string {
  if (body['echo'] === true) return 'legacy-echo';
  if (body['logprobs'] === true) return 'content-step';
  return 'legacy-step';
}

async function fakeServer(page: Page, options: FakeOptions = {}): Promise<Fake> {
  const calls: Call[] = [];
  let completionIndex = 0;
  await page.route('**/fake-llm/v1/**', async (route: Route) => {
    const request = route.request();
    const raw = request.postData();
    const body = raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
    calls.push({
      url: request.url(),
      method: request.method(),
      authorization: request.headers()['authorization'],
      body,
    });
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (request.url().endsWith('/models')) {
      const status = options.modelsStatus ?? 200;
      await route.fulfill({
        status,
        headers: cors,
        contentType: 'application/json',
        body: status === 200 ? fixtureText('models-legacy') : '{"error":"denied"}',
      });
      return;
    }
    const index = completionIndex;
    completionIndex += 1;
    let reply = options.completion?.(body ?? {}, index);
    if (reply instanceof Promise) {
      await reply;
      reply = undefined;
    }
    if (reply === 'abort') {
      await route.abort('connectionrefused');
      return;
    }
    const status = reply?.status ?? 200;
    const content =
      reply?.json !== undefined
        ? JSON.stringify(reply.json)
        : fixtureText(reply?.fixture ?? standardFixture(body ?? {}));
    await route.fulfill({ status, headers: cors, contentType: 'application/json', body: content });
  });
  return { calls, completions: () => calls.filter((c) => c.url.endsWith('/completions')) };
}

// --- Bedienelemente (CON-0013) ---

function engineGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Engine', exact: true });
}

function engineRadio(page: Page, name: 'Mock' | 'Server'): Locator {
  return engineGroup(page).getByRole('radio', { name, exact: true });
}

function baseUrlField(page: Page): Locator {
  return engineGroup(page).getByRole('textbox', { name: 'Basis-URL', exact: true });
}

function keyField(page: Page): Locator {
  return engineGroup(page).getByLabel('API-Key', { exact: true });
}

function modelField(page: Page): Locator {
  return engineGroup(page).getByLabel('Modell', { exact: true });
}

function dialectSelect(page: Page): Locator {
  return engineGroup(page).getByRole('combobox', { name: 'Dialekt', exact: true });
}

function profileSelect(page: Page): Locator {
  return engineGroup(page).getByRole('combobox', { name: 'Profil', exact: true });
}

type DialectLabel = 'Automatisch' | 'Klassisch (vLLM)' | 'Logprobs-Liste (MLX)';

function fakeUrl(baseURL: string | undefined): string {
  return `${baseURL ?? ''}/fake-llm/v1`;
}

async function configureServer(page: Page, url: string, dialect: DialectLabel): Promise<void> {
  await engineRadio(page, 'Server').check();
  await baseUrlField(page).fill(url);
  await keyField(page).fill(KEY);
  await modelField(page).fill('Qwen3.5-0.8B');
  await dialectSelect(page).selectOption({ label: dialect });
}

async function startRun(page: Page, maxTokens = 3): Promise<void> {
  await promptField(page).fill(PROMPT);
  await maxTokensField(page).fill(String(maxTokens));
  await maxTokensField(page).blur();
  await generateButton(page).click();
}

function timeline(page: Page): Locator {
  return group(page, 'Zeitleiste').getByRole('button');
}

function stationButtons(page: Page): Locator {
  return group(page, 'Stationen').getByRole('button');
}

async function runToEnd(page: Page, maxTokens = 3): Promise<void> {
  await startRun(page, maxTokens);
  await expect(timeline(page)).toHaveCount(maxTokens);
}

async function stationNames(page: Page): Promise<string[]> {
  return stationButtons(page).evaluateAll((buttons) =>
    buttons.map((b) => b.getAttribute('aria-label') ?? ''),
  );
}

function alert(page: Page): Locator {
  return page.getByRole('alert');
}

// --- Szenarien ---

test(T.mockDefault, async ({ page }) => {
  await expect(engineRadio(page, 'Mock')).toBeChecked();
  await expect(baseUrlField(page)).toHaveCount(0);
});

test(T.fields, async ({ page }) => {
  await engineRadio(page, 'Server').check();
  await expect(baseUrlField(page)).toBeVisible();
  await expect(keyField(page)).toHaveAttribute('type', 'password');
  await expect(modelField(page)).toBeVisible();
  const dialects = await dialectSelect(page).getByRole('option').allInnerTexts();
  expect(dialects.map((d) => d.trim())).toEqual([
    'Automatisch',
    'Klassisch (vLLM)',
    'Logprobs-Liste (MLX)',
  ]);
  const profiles = await profileSelect(page).getByRole('option').allInnerTexts();
  expect(profiles.map((p) => p.trim())).toEqual(['Eigene Angaben', 'Test-vLLM', 'Test-MLX']);
  await expect(engineGroup(page).getByRole('button', { name: 'Modelle laden' })).toBeVisible();
});

test(T.profile, async ({ page, baseURL }) => {
  await engineRadio(page, 'Server').check();
  await profileSelect(page).selectOption({ label: 'Test-MLX' });
  await expect(baseUrlField(page)).toHaveValue(fakeUrl(baseURL));
  await expect(modelField(page)).toHaveValue('mlx-test');
  await expect(dialectSelect(page)).toHaveValue('content');
  await expect(keyField(page)).toHaveValue('sk-optiq-test');
  await profileSelect(page).selectOption({ label: 'Test-vLLM' });
  await expect(modelField(page)).toHaveValue('Qwen3.5-0.8B');
  await expect(dialectSelect(page)).toHaveValue('legacy');
  await expect(keyField(page)).toHaveValue('');
});

test(T.models, async ({ page, baseURL }) => {
  const fake = await fakeServer(page);
  await configureServer(page, fakeUrl(baseURL), 'Automatisch');
  await engineGroup(page).getByRole('button', { name: 'Modelle laden' }).click();
  await expect(engineGroup(page)).toContainText('12 Modelle gefunden');
  const models = fake.calls.filter((c) => c.url.endsWith('/models'));
  expect(models).toHaveLength(1);
  expect(models[0]?.method).toBe('GET');
  expect(models[0]?.authorization).toBe(`Bearer ${KEY}`);
});

test(T.modelsDenied, async ({ page, baseURL }) => {
  await fakeServer(page, { modelsStatus: 401 });
  await configureServer(page, fakeUrl(baseURL), 'Automatisch');
  await engineGroup(page).getByRole('button', { name: 'Modelle laden' }).click();
  await expect(engineGroup(page)).toContainText('Der Server hat den API-Key abgelehnt (HTTP 401).');
});

test(T.legacyRun, async ({ page, baseURL }) => {
  const fake = await fakeServer(page);
  await configureServer(page, fakeUrl(baseURL), 'Klassisch (vLLM)');
  await runToEnd(page);
  await timeline(page).first().click();
  expect(await stationNames(page)).toEqual(['tokenize', 'logits', 'sample']);
  await expect(generatedText(page)).toHaveText('Die Katze sitzt auf dem Sofa Sofa Sofa');
  const completions = fake.completions();
  expect(completions).toHaveLength(4);
  expect(completions[0]?.body?.['echo']).toBe(true);
  for (const call of completions) {
    expect(call.authorization).toBe(`Bearer ${KEY}`);
    expect(call.body?.['model']).toBe('Qwen3.5-0.8B');
    expect(call.body?.['max_tokens']).toBe(1);
    expect(call.body?.['logprobs']).toBe(20);
  }
});

test(T.candidates, async ({ page, baseURL }) => {
  await fakeServer(page);
  await configureServer(page, fakeUrl(baseURL), 'Klassisch (vLLM)');
  await runToEnd(page);
  await timeline(page).first().click();
  await group(page, 'Stationen').getByRole('button', { name: 'logits', exact: true }).click();
  const candidates = stationRegion(page)
    .getByRole('list', { name: 'Kandidaten', exact: true })
    .getByRole('listitem');
  await expect(candidates).toHaveCount(5);
  await expect(candidates.first()).toContainText('␣Sofa');
  await expect(candidates.first()).toContainText('55,9 %');
  await expect(candidates.first()).toContainText('–');
  await expect(stationRegion(page)).toContainText(
    'Nur die 5 gelieferten Kandidaten, sie decken 43,7 % ab.',
  );
  await group(page, 'Stationen').getByRole('button', { name: 'tokenize', exact: true }).click();
  const tokens = await stationRegion(page)
    .getByRole('list', { name: 'Tokens', exact: true })
    .getByRole('listitem')
    .allInnerTexts();
  expect(tokens.map((t) => t.replace(/\s+/g, ' ').trim())).toEqual([
    'Die 0',
    '␣Kat 1',
    'ze 2',
    '␣sitzt 3',
    '␣auf 4',
    '␣dem 5',
  ]);
});

test(T.contentRun, async ({ page, baseURL }) => {
  const fake = await fakeServer(page);
  await configureServer(page, fakeUrl(baseURL), 'Logprobs-Liste (MLX)');
  await runToEnd(page);
  await timeline(page).first().click();
  expect(await stationNames(page)).toEqual(['logits', 'sample']);
  await expect(generatedText(page)).toHaveText('Die Katze sitzt auf dem Dach Dach Dach');
  const completions = fake.completions();
  expect(completions).toHaveLength(3);
  for (const call of completions) {
    expect(call.body?.['logprobs']).toBe(true);
    expect(call.body?.['top_logprobs']).toBe(10);
  }
  await expect(tokenItems(page).first()).toHaveText(PROMPT.replaceAll(' ', '␣'));
});

test(T.autoDialect, async ({ page, baseURL }) => {
  const fake = await fakeServer(page, { completion: () => ({ fixture: 'content-step' }) });
  await configureServer(page, fakeUrl(baseURL), 'Automatisch');
  await runToEnd(page);
  await timeline(page).first().click();
  expect(await stationNames(page)).toEqual(['logits', 'sample']);
  const probe = fake.completions()[0]?.body;
  expect(probe?.['prompt']).toBe('Hallo');
  expect(probe?.['top_logprobs']).toBe(1);
});

test(T.random, async ({ page, baseURL }) => {
  await fakeServer(page);
  const setup = async () => {
    await configureServer(page, fakeUrl(baseURL), 'Klassisch (vLLM)');
    const sampling = page.getByRole('group', { name: 'Sampling', exact: true });
    await sampling.getByRole('radio', { name: 'Zufall', exact: true }).check();
    await sampling.getByRole('spinbutton', { name: 'Seed', exact: true }).fill('7');
  };
  await setup();
  await runToEnd(page);
  const first = (await generatedText(page).innerText()).trim();
  await page.reload();
  await expect(generatedText(page)).toHaveCount(0);
  await setup();
  await runToEnd(page);
  await expect(generatedText(page)).toHaveText(first);
  await group(page, 'Stationen').getByRole('button', { name: 'sample', exact: true }).click();
  await expect(stationRegion(page)).toContainText(/Zufallszahl 0,\d{3}/);
});

test(T.wrongKey, async ({ page, baseURL }) => {
  await fakeServer(page, { completion: () => ({ status: 401, json: { error: 'denied' } }) });
  await configureServer(page, fakeUrl(baseURL), 'Klassisch (vLLM)');
  await startRun(page);
  await expect(alert(page)).toContainText(
    'Erzeugen fehlgeschlagen: Der Server hat den API-Key abgelehnt (HTTP 401).',
  );
});

test(T.midRunError, async ({ page, baseURL }) => {
  await fakeServer(page, {
    completion: (_body, index) =>
      index === 2 ? { status: 429, json: { error: 'slow' } } : undefined,
  });
  await configureServer(page, fakeUrl(baseURL), 'Klassisch (vLLM)');
  await startRun(page);
  await expect(alert(page)).toContainText(
    'Der Lauf wurde abgebrochen: Der Server begrenzt die Anfragen (HTTP 429). Bitte kurz warten.',
  );
  await expect(timeline(page)).toHaveCount(1);
});

test(T.unreachable, async ({ page, baseURL }) => {
  await fakeServer(page, { completion: () => 'abort' });
  await configureServer(page, fakeUrl(baseURL), 'Logprobs-Liste (MLX)');
  await startRun(page);
  await expect(alert(page)).toContainText(
    `Der Lauf wurde abgebrochen: Der Server ist nicht erreichbar (${fakeUrl(baseURL)}).`,
  );
  await expect(playback(page)).toHaveCount(0);
});

test(T.abort, async ({ page, baseURL }) => {
  let release: () => void = () => undefined;
  const held = new Promise<'release'>((resolve) => {
    release = () => resolve('release');
  });
  await fakeServer(page, { completion: (_body, index) => (index === 1 ? held : undefined) });
  await configureServer(page, fakeUrl(baseURL), 'Logprobs-Liste (MLX)');
  await startRun(page, 5);
  await expect(page.getByText('Schritt 2 von 5', { exact: true })).toBeVisible();
  const cancel = page.getByRole('button', { name: 'Abbrechen', exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await expect(timeline(page)).toHaveCount(1);
  await expect(alert(page)).toHaveCount(0);
  release();
});

test(T.keyNotStored, async ({ page, baseURL }) => {
  await configureServer(page, fakeUrl(baseURL), 'Klassisch (vLLM)');
  await keyField(page).blur();
  await page.reload();
  await engineRadio(page, 'Server').check();
  await expect(baseUrlField(page)).toHaveValue(fakeUrl(baseURL));
  await expect(modelField(page)).toHaveValue('Qwen3.5-0.8B');
  await expect(dialectSelect(page)).toHaveValue('legacy');
  await expect(keyField(page)).toHaveValue('');
  const stored = await page.evaluate(() => {
    const dump = (storage: Storage) =>
      Array.from({ length: storage.length }, (_, i) => {
        const key = storage.key(i) ?? '';
        return `${key}=${storage.getItem(key) ?? ''}`;
      }).join('\n');
    return `${dump(window.localStorage)}\n${dump(window.sessionStorage)}`;
  });
  expect(stored).not.toContain(KEY);
});

test(T.exportNoKey, async ({ page, baseURL }) => {
  await fakeServer(page);
  await configureServer(page, fakeUrl(baseURL), 'Klassisch (vLLM)');
  await runToEnd(page);
  const { content } = await exportTrace(page);
  expect((JSON.parse(content) as { engine: { kind: string } }).engine.kind).toBe('remote-legacy');
  expect(content).not.toContain(KEY);
});

test(T.backToMock, async ({ page, baseURL }) => {
  const fake = await fakeServer(page);
  await configureServer(page, fakeUrl(baseURL), 'Klassisch (vLLM)');
  await engineRadio(page, 'Mock').check();
  await generate(page, 'die katze sitzt', 2);
  await timeline(page).first().click();
  await expect(stationButtons(page)).toHaveCount(12);
  expect(fake.completions()).toHaveLength(0);
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios = feature
    .split('\n')
    .map((line) => /^\s*Szenario:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((title): title is string => title !== undefined);
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
});
