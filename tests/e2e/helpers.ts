import { readFile } from 'node:fs/promises';
import { expect, test as base, type Download, type Locator, type Page } from '@playwright/test';

/** Lokale Schemes, die keine Netzwerkanfragen sind (Downloads, eingebettete Daten). */
const LOCAL_SCHEMES = ['blob:', 'data:', 'about:'];

interface InspectorFixtures {
  /** Alle URLs, die die Seite während des Tests angefragt hat (UI-04). */
  requests: string[];
}

/**
 * Test mit Request-Mitschnitt: Jeder Test öffnet "/" (Grundlage) und prüft am Ende,
 * dass keine Anfrage an einen fremden Origin ging (CON-0003 UI-04).
 */
export const test = base.extend<InspectorFixtures>({
  requests: [
    async ({ page, baseURL }, use) => {
      const urls: string[] = [];
      page.on('request', (request) => urls.push(request.url()));
      await page.goto('/');
      await use(urls);

      const allowedOrigin = new URL(baseURL ?? page.url()).origin;
      const foreign = urls.filter((url) => {
        if (LOCAL_SCHEMES.some((scheme) => url.startsWith(scheme))) return false;
        return new URL(url).origin !== allowedOrigin;
      });
      expect(foreign, 'Anfragen an fremde Origins (UI-04)').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export function promptField(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Prompt' });
}

export function maxTokensField(page: Page): Locator {
  return page.getByRole('spinbutton', { name: 'Max. Tokens' });
}

export function generateButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Erzeugen', exact: true });
}

export function exportButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Trace exportieren' });
}

export function generatedText(page: Page): Locator {
  return page.getByRole('region', { name: 'Erzeugter Text' });
}

export function errorAlert(page: Page): Locator {
  return page.getByRole('alert');
}

function stepsList(page: Page): Locator {
  return page.getByRole('list', { name: 'Schritte' });
}

/** Überschriften "Schritt n" (Ebene 2) in der Liste "Schritte": eine je Schritt. */
export function stepHeadings(page: Page): Locator {
  return stepsList(page).getByRole('heading', { level: 2, name: /^Schritt \d+$/ });
}

/** Das listitem des Schritts `index` (enthält die Überschrift "Schritt index"). */
export function stepItem(page: Page, index: number): Locator {
  return stepsList(page)
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { level: 2, name: `Schritt ${index}`, exact: true }),
    });
}

/** Alle Stationszeilen eines Schritts in Anzeigereihenfolge. */
export function stationItems(page: Page, index: number): Locator {
  return stepItem(page, index).getByRole('list').getByRole('listitem');
}

export async function stationLines(page: Page, index: number): Promise<string[]> {
  const lines = await stationItems(page, index).allInnerTexts();
  return lines.map((line) => line.trim());
}

/** Stationsart = Text der Zeile bis zum ersten " · ". */
export async function stationKinds(page: Page, index: number): Promise<string[]> {
  const lines = await stationLines(page, index);
  return lines.map((line) => line.split(' · ')[0] ?? '');
}

/** Stationszeilen aller angezeigten Schritte, je Schritt ein Array. */
export async function allStationLines(page: Page): Promise<string[][]> {
  const count = await stepHeadings(page).count();
  const result: string[][] = [];
  for (let i = 0; i < count; i += 1) {
    result.push(await stationLines(page, i));
  }
  return result;
}

/** Erzeugt einen Mock-Trace über die UI und wartet auf die erwartete Schrittzahl. */
export async function generate(page: Page, prompt: string, maxTokens: number): Promise<void> {
  await promptField(page).fill(prompt);
  await maxTokensField(page).fill(String(maxTokens));
  await maxTokensField(page).blur();
  await generateButton(page).click();
  await expect(stepHeadings(page)).toHaveCount(maxTokens);
}

/** Klickt "Trace exportieren" und liefert Download samt Dateiinhalt. */
export async function exportTrace(page: Page): Promise<{ download: Download; content: string }> {
  const downloadPromise = page.waitForEvent('download');
  await exportButton(page).click();
  const download = await downloadPromise;
  const path = await download.path();
  const content = await readFile(path, 'utf8');
  return { download, content };
}

/** Lädt Text als Datei über die Datei-Eingabe "Trace importieren". */
export async function importText(
  page: Page,
  content: string,
  name = 'import.trace.json',
): Promise<void> {
  await page.getByLabel('Trace importieren').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(content, 'utf8'),
  });
}

/** Erzeugt einen Trace, exportiert ihn und liefert das geparste JSON. */
export async function exportedTraceJson(
  page: Page,
  prompt: string,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  await generate(page, prompt, maxTokens);
  const { content } = await exportTrace(page);
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error('Export ist kein JSON-Objekt');
  return parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Folgt `path` (Objektschlüssel und Array-Indizes) und liefert das Zielobjekt, sonst Fehler. */
export function objectAt(
  root: unknown,
  path: ReadonlyArray<string | number>,
): Record<string, unknown> {
  let current: unknown = root;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') {
      current = current[key];
    } else if (isRecord(current) && typeof key === 'string') {
      current = current[key];
    } else {
      throw new Error(`Pfad ${path.join('/')} nicht auflösbar bei ${String(key)}`);
    }
  }
  if (!isRecord(current)) throw new Error(`Kein Objekt unter ${path.join('/')}`);
  return current;
}

/** Kürzt Base64-kodierte Bytes um `bytes` Bytes und kodiert gültig neu. */
export function truncateBase64(data: string, bytes: number): string {
  const raw = Buffer.from(data, 'base64');
  return raw.subarray(0, raw.length - bytes).toString('base64');
}

/** Drückt Tab, bis `target` den Fokus hat (höchstens 20 Schritte). */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await target.evaluate((element) => element === document.activeElement);
    if (focused) return;
  }
  throw new Error('Ziel ist per Tab nicht erreichbar (UI-01)');
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
