/**
 * Helfer für TST-0006 (CON-0006, Player-UI).
 *
 * Uhr und Request-Mitschnitt: Das Auto-Fixture `requests` aus ./helpers.ts ruft `page.goto('/')`
 * selbst auf, bevor ein Test die Uhr installieren könnte. Deshalb definiert diese Datei ein
 * eigenes `test` auf Basis von `@playwright/test`, dessen Auto-Fixture `requests` dieselbe
 * UI-03-Prüfung (keine Anfragen an fremde Origins, wie CON-0003 UI-04) enthält, aber vorher
 * `page.clock.install()` und `page.clock.pauseAt(...)` aufruft (CON-0006 Kopfkommentar). Danach
 * vergeht Zeit nur über `page.clock.runFor`. Reduzierte Bewegung wird über die Option
 * `reducedMotion` ebenfalls vor dem Öffnen gesetzt.
 */
import { expect, test as base, type Locator, type Page } from '@playwright/test';

import { COLORS } from '../../src/app/theme/tokens';
import { generate } from './helpers';

const LOCAL_SCHEMES = ['blob:', 'data:', 'about:'];
const CLOCK_START = new Date('2026-10-21T12:00:00Z').getTime();

interface PlayerOptions {
  /** prefers-reduced-motion, vor page.goto emuliert. */
  reducedMotion: 'reduce' | 'no-preference';
}

interface PlayerFixtures {
  /** Alle angefragten URLs (UI-03). */
  requests: string[];
}

export const test = base.extend<PlayerFixtures & PlayerOptions>({
  reducedMotion: ['no-preference', { option: true }],
  requests: [
    async ({ page, baseURL, reducedMotion }, use) => {
      const urls: string[] = [];
      page.on('request', (request) => urls.push(request.url()));
      await page.emulateMedia({ reducedMotion });
      await page.clock.install({ time: CLOCK_START });
      await page.clock.pauseAt(CLOCK_START + 1000);
      await page.goto('/');
      await use(urls);

      const allowedOrigin = new URL(baseURL ?? page.url()).origin;
      const foreign = urls.filter((url) => {
        if (LOCAL_SCHEMES.some((scheme) => url.startsWith(scheme))) return false;
        return new URL(url).origin !== allowedOrigin;
      });
      expect(foreign, 'Anfragen an fremde Origins (UI-03)').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// --- Regionen und Gruppen (CON-0006, Bedienelemente) ---

export function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

export function playback(page: Page): Locator {
  return region(page, 'Wiedergabe');
}

export function stationRegion(page: Page): Locator {
  return region(page, 'Station');
}

export function stationHeading(page: Page): Locator {
  return stationRegion(page).getByRole('heading', { level: 2 });
}

export function tokenStream(page: Page): Locator {
  return region(page, 'Tokenstrom');
}

export function transportButton(page: Page, name: string): Locator {
  return playback(page).getByRole('button', { name, exact: true });
}

export function group(page: Page, name: 'Tempo' | 'Zeitleiste' | 'Stationen'): Locator {
  return playback(page).getByRole('group', { name, exact: true });
}

export function groupButton(
  page: Page,
  groupName: 'Tempo' | 'Zeitleiste' | 'Stationen',
  name: string,
): Locator {
  return group(page, groupName).getByRole('button', { name, exact: true });
}

export function statusMessage(page: Page): Locator {
  return page.getByRole('status');
}

/** Alle Einträge des Tokenstroms, Platzhalter eingeschlossen. */
export function tokenItems(page: Page): Locator {
  return tokenStream(page).getByRole('list').getByRole('listitem');
}

/** Nur die Token-Einträge (ohne Platzhalter "?"). */
export function tokenEntries(page: Page): Locator {
  return tokenItems(page).filter({ hasNotText: /^\s*\?\s*$/ });
}

export function nextTokenPlaceholder(page: Page): Locator {
  return tokenStream(page).getByRole('listitem', { name: 'nächstes Token', exact: true });
}

// --- Abläufe ---

/** Trace T: "die katze sitzt", Max. Tokens 2 (Schritt 0 mit 12, Schritt 1 mit 11 Stationen). */
export async function generateTraceT(page: Page): Promise<void> {
  await generate(page, 'die katze sitzt', 2);
  await expect(playback(page)).toBeVisible();
}

/** "Seitenfokus herstellen": Klick auf die (nicht fokussierbare) Hauptüberschrift. */
export async function focusPage(page: Page): Promise<void> {
  await page.getByRole('heading', { level: 1, name: 'Token Theater' }).click();
}

/** Springt über Zeitleiste und Stationsleiste auf Schritt `step`, Station `station` (0-basiert). */
export async function seekTo(page: Page, step: number, station: number): Promise<void> {
  await groupButton(page, 'Zeitleiste', `Schritt ${step}`).click();
  await group(page, 'Stationen').getByRole('button').nth(station).click();
}

export async function setSpeed(page: Page, label: '0.25×' | '0.5×' | '1×' | '2×'): Promise<void> {
  await groupButton(page, 'Tempo', label).click();
  await expect(groupButton(page, 'Tempo', label)).toHaveAttribute('aria-pressed', 'true');
}

export async function advance(page: Page, ms: number): Promise<void> {
  await page.clock.runFor(ms);
}

// --- Farben und Schriften ---

/** "#rrggbb" → "rgb(r, g, b)", wie getComputedStyle Farben serialisiert. */
export function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

export function colorRgb(token: 'bg' | 'cyan'): string {
  return hexToRgb(String(COLORS[token]));
}

/** Erster Eintrag einer berechneten font-family, ohne Anführungszeichen. */
export function firstFontFamily(fontFamily: string): string {
  return (fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}
