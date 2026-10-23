/**
 * TST-0032 – Akzeptanztests für Smartphones (CON-0027). Ein Test je Szenario aus
 * .sdd/contracts/behavior/mobile-ui.feature (Szenariogrundriss: ein Test je Beispiel),
 * Testname = Szenariotitel. Geräte als Chromium mit Touch und mobilem Viewport; ein Wisch sind
 * PointerEvents vom Typ touch, ein Tipp geht über page.touchscreen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import { expect, exportTrace, generateButton, maxTokensField, promptField, test } from './helpers';
import { group, playback, region, stationRegion, statusMessage } from './player-helpers';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const FEATURE_PATH = here('../../.sdd/contracts/behavior/mobile-ui.feature');
const REPORT = readFileSync(
  here('../fixtures/probe/tiny-occupation-gender-en.probe-report.json'),
  'utf8',
);

const T = {
  width: 'Keine waagerechte Seite',
  controls: 'Einspaltige Steuerung',
  views: 'Ansicht-Knöpfe vollständig',
  targets: 'Touch-Ziele',
  transport: 'Transportleiste bleibt erreichbar',
  swipe: 'Wischen über die Station',
  vertical: 'Senkrechter Zug schaltet nicht',
  input: 'Wisch in einer Eingabe zählt nicht',
  tap: 'Tippen zeigt den Wert der Heatmap',
  sheet: 'Begriff als Blatt',
  stage: 'Bühne auf dem Smartphone',
  desktop: 'Desktop unverändert',
} as const;

const PHONE = { width: 390, height: 844 };
const NARROW = { width: 360, height: 740 };
const LANDSCAPE = { width: 844, height: 390 };

const DEVICES = [
  ['Smartphone', PHONE],
  ['schmales Smartphone', NARROW],
] as const;

const FORMATS = [
  ['Hochformat 390 × 844', PHONE],
  ['Querformat 844 × 390', LANDSCAPE],
] as const;

const touch = (viewport: { width: number; height: number }) =>
  ({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }) as const;

// --- Bedienung ---

async function openView(
  page: Page,
  name: 'Durchlauf' | 'Tokenizer' | 'Glossar' | 'Vergleich' | 'Sonde',
): Promise<void> {
  await page
    .getByRole('group', { name: 'Ansicht', exact: true })
    .getByRole('button', { name, exact: true })
    .click();
}

/** Mock-Lauf über die UI; Erzeugen per Tipp (CON-0027). */
async function mockRun(page: Page): Promise<void> {
  await promptField(page).fill('die katze sitzt');
  await maxTokensField(page).fill('2');
  await maxTokensField(page).blur();
  await generateButton(page).click();
  await expect(group(page, 'Zeitleiste').getByRole('button')).toHaveCount(2);
}

async function chooseStation(page: Page, name: string): Promise<void> {
  await group(page, 'Stationen').getByRole('button', { name, exact: true }).click();
  await expect(stationHeading(page)).toHaveText(name);
}

function stationHeading(page: Page): Locator {
  return stationRegion(page).getByRole('heading', { level: 2 });
}

async function pageWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth);
}

async function expectNotWider(page: Page, label: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  expect(await pageWidth(page), label).toBeLessThanOrEqual(width);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(locator: Locator): Promise<Box> {
  const result = await locator.boundingBox();
  if (result === null) throw new Error('kein Rechteck');
  return result;
}

async function expectInViewport(page: Page, locator: Locator, label: string, margin = 0) {
  const b = await box(locator);
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  expect(b.x, `${label}: links`).toBeGreaterThanOrEqual(margin - 0.5);
  expect(b.y, `${label}: oben`).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, `${label}: rechts`).toBeLessThanOrEqual(viewport.width - margin + 0.5);
  expect(b.y + b.height, `${label}: unten`).toBeLessThanOrEqual(viewport.height + 0.5);
}

/** Wisch als PointerEvents vom Typ touch über `target`, Start in dessen Mitte. */
async function swipe(target: Locator, dx: number, dy = 0): Promise<void> {
  await target.evaluate(
    async (element, { dx, dy }) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const fire = (type: string, cx: number, cy: number) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            clientX: cx,
            clientY: cy,
          }),
        );
      fire('pointerdown', x, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
      fire('pointermove', x + dx / 2, y + dy / 2);
      await new Promise((resolve) => setTimeout(resolve, 100));
      fire('pointermove', x + dx, y + dy);
      fire('pointerup', x + dx, y + dy);
    },
    { dx, dy },
  );
}

// --- Szenarien ---

for (const [name, viewport] of DEVICES) {
  test.describe(`${T.width} – ${name}`, () => {
    test.use(touch(viewport));

    test(`${T.width} – ${name}`, async ({ page }) => {
      await expectNotWider(page, 'Durchlauf vor dem Lauf');
      await mockRun(page);
      await expectNotWider(page, 'Durchlauf nach dem Lauf');
      for (const station of ['attention · Layer 0', 'mlp · Layer 0', 'logits']) {
        await chooseStation(page, station);
        await expectNotWider(page, station);
      }
      const { content } = await exportTrace(page);
      for (const view of ['Tokenizer', 'Glossar'] as const) {
        await openView(page, view);
        await expectNotWider(page, view);
      }
      await openView(page, 'Vergleich');
      await page.getByLabel('Vergleichstrace importieren', { exact: true }).setInputFiles({
        name: 'b.trace.json',
        mimeType: 'application/json',
        buffer: Buffer.from(content, 'utf8'),
      });
      await expect(region(page, 'Vergleich').getByRole('table', { name: 'Layer' })).toBeVisible();
      await expectNotWider(page, 'Vergleich');
      await openView(page, 'Sonde');
      await page.getByLabel('Sonden-Bericht importieren', { exact: true }).setInputFiles({
        name: 'bericht.probe-report.json',
        mimeType: 'application/json',
        buffer: Buffer.from(REPORT, 'utf8'),
      });
      await expect(region(page, 'Sonde').getByRole('table', { name: 'Paare' })).toBeVisible();
      await expectNotWider(page, 'Sonde');
    });
  });
}

test.describe('Smartphone', () => {
  test.use(touch(PHONE));

  test(T.controls, async ({ page }) => {
    for (const [label, field] of [
      ['Prompt', promptField(page)],
      ['Max. Tokens', maxTokensField(page)],
    ] as const) {
      const labelBox = await box(page.locator('.controls label', { hasText: label }).first());
      const fieldBox = await box(field);
      expect(labelBox.y + labelBox.height, `${label} über dem Feld`).toBeLessThanOrEqual(
        fieldBox.y + 1,
      );
    }
    expect((await box(promptField(page))).width).toBeGreaterThanOrEqual(280);
    const radios = page.getByRole('group', { name: 'Engine', exact: true }).locator('label');
    for (let i = 0; i < (await radios.count()); i += 1) {
      await expectInViewport(page, radios.nth(i), `Engine-Radio ${i}`);
    }
    await promptField(page).fill('die katze sitzt');
    const button = generateButton(page);
    await button.scrollIntoViewIfNeeded();
    const hit = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return top !== null && (top === element || element.contains(top));
    });
    expect(hit, 'nichts liegt über „Erzeugen“').toBe(true);
    await button.tap();
    await expect(group(page, 'Zeitleiste').getByRole('button').first()).toBeVisible();
  });

  test(T.targets, async ({ page }) => {
    await mockRun(page);
    const small = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll('[aria-label="Ansicht"] button'),
        ...document.querySelectorAll('[aria-label="Wiedergabe"] button'),
        ...document.querySelectorAll('.radio-choice .chip'),
      ];
      return candidates
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .filter(({ rect }) => rect.width < 43.5 || rect.height < 43.5)
        .map(
          ({ element, rect }) =>
            `${element.textContent?.trim() || element.getAttribute('aria-label')} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
        );
    });
    expect(small).toEqual([]);
    await expect(page.locator('.shortcuts')).toBeHidden();
  });

  test(T.transport, async ({ page }) => {
    await mockRun(page);
    await stationHeading(page).scrollIntoViewIfNeeded();
    const viewport = page.viewportSize() ?? PHONE;
    for (const name of ['Station vor', 'Abspielen']) {
      const button = playback(page).getByRole('button', { name, exact: true });
      await expectInViewport(page, button, name);
      expect((await box(button)).y, `${name} am unteren Rand`).toBeGreaterThan(
        viewport.height - 140,
      );
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = await box(page.locator('.transport-buttons'));
    const last = await page.evaluate(() => {
      const items = document.querySelectorAll('.details li');
      const element = items[items.length - 1];
      return element === undefined ? null : element.getBoundingClientRect().bottom;
    });
    expect(last).not.toBeNull();
    expect(last ?? Infinity, 'letzter Eintrag über der Leiste').toBeLessThanOrEqual(bar.y + 0.5);
  });

  test(T.swipe, async ({ page }) => {
    await mockRun(page);
    await chooseStation(page, 'tokenize');
    await swipe(stationHeading(page), -120);
    await expect(statusMessage(page)).toContainText('Schritt 0 · Station 2 von 12 · embed');
    await swipe(stationHeading(page), 120);
    await expect(statusMessage(page)).toContainText('Schritt 0 · Station 1 von 12 · tokenize');
  });

  test(T.vertical, async ({ page }) => {
    await mockRun(page);
    await chooseStation(page, 'tokenize');
    await swipe(stationHeading(page), -40, 120);
    await page.waitForTimeout(150);
    await expect(stationHeading(page)).toHaveText('tokenize');
  });

  test(T.input, async ({ page }) => {
    await mockRun(page);
    await chooseStation(page, 'logits');
    await swipe(stationRegion(page).getByLabel('Labor-Temperatur'), -120);
    await page.waitForTimeout(150);
    await expect(stationHeading(page)).toHaveText('logits');
  });

  test(T.tap, async ({ page }) => {
    await mockRun(page);
    await chooseStation(page, 'attention · Layer 0');
    const heatmap = stationRegion(page).locator('figure.heatmap').first();
    const canvas = heatmap.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const b = await box(canvas);
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    const readout = heatmap.locator('.readout');
    await expect(readout).not.toHaveText('');
    const text = await readout.textContent();
    await page.waitForTimeout(300);
    await expect(readout).toHaveText(text ?? '');
    await expect(stationHeading(page)).toHaveText('attention · Layer 0');
  });

  test(T.sheet, async ({ page }) => {
    await mockRun(page);
    await chooseStation(page, 'attention · Layer 0');
    const terms = stationRegion(page)
      .getByRole('list', { name: 'Begriffe', exact: true })
      .getByRole('button');
    await terms.last().tap();
    await expectInViewport(page, page.getByRole('tooltip'), 'Erklärung', 8);
  });
});

for (const [format, viewport] of FORMATS) {
  test.describe(`${T.stage} – ${format}`, () => {
    test.use(touch(viewport));

    test(`${T.stage} – ${format}`, async ({ page }) => {
      await mockRun(page);
      await page.getByRole('button', { name: 'Präsentation', exact: true }).click();
      await expect(page.locator('main[data-mode="presentation"]')).toBeVisible();
      const size = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
      }));
      expect(size.height, 'nicht höher').toBeLessThanOrEqual(viewport.height);
      expect(size.width, 'nicht breiter').toBeLessThanOrEqual(viewport.width);
      await expectInViewport(page, stationHeading(page), 'Stationsüberschrift');
      await expectInViewport(
        page,
        playback(page).getByRole('button', { name: 'Station vor', exact: true }),
        'Station vor',
      );
      await swipe(stationHeading(page), -120);
      await expect(statusMessage(page)).toContainText('Station 2 von 12');
    });
  });
}

test.describe('Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test(T.desktop, async ({ page }) => {
    await mockRun(page);
    await expect(page.locator('.shortcuts')).toBeVisible();
    const position = await page
      .locator('.transport-buttons')
      .evaluate((element) => getComputedStyle(element).position);
    expect(position).not.toBe('fixed');
  });
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
    .map((line) => /^\s*\|(.+)\|\s*$/.exec(line)?.[1]?.trim())
    .filter((cell): cell is string => cell !== undefined && cell !== 'gerät' && cell !== 'format');
  expect(examples).toEqual([...DEVICES.map(([n]) => n), ...FORMATS.map(([f]) => f)]);
});
