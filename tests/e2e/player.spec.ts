/**
 * TST-0006 – Akzeptanztests für den Player (CON-0006).
 * Ein Test je Szenario aus .sdd/contracts/behavior/player-ui.feature, Testname = Szenariotitel;
 * Grundriss "Tastatur" als "<Titel> (taste=<taste>)". Uhr, Request-Mitschnitt (UI-03) und das
 * Öffnen von "/" (Grundlage) laufen über das Auto-Fixture in ./player-helpers.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generate, importText, promptField, tabTo } from './helpers';
import {
  advance,
  colorRgb,
  expect,
  firstFontFamily,
  focusPage,
  generateTraceT,
  group,
  groupButton,
  nextTokenPlaceholder,
  playback,
  seekTo,
  setSpeed,
  stationHeading,
  stationRegion,
  statusMessage,
  test,
  tokenEntries,
  tokenItems,
  tokenStream,
  transportButton,
} from './player-helpers';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/player-ui.feature', import.meta.url),
);

const T = {
  noTrace: 'Ohne Trace keine Wiedergabe',
  afterGenerate: 'Nach dem Erzeugen steht der Cursor am Anfang',
  stationByStation: 'Station für Station',
  stepAndEnd: 'Schritt vor und Zum Ende',
  seek: 'Springen über Zeitleiste und Stationsleiste',
  residual: 'Residual-Stationen sind unterscheidbar',
  playPause: 'Abspielen und Pause',
  speed: 'Tempo',
  playToEnd: 'Bis zum Ende abspielen',
  tokenStream: 'Tokenstrom folgt dem Cursor',
  noPlaceholderAtEnd: 'Am Ende kein Platzhalter',
  stationView: 'Stationsansicht zeigt Tensorformen und Kandidaten',
  homeAndBack: 'Tastatur Pos1 und Rückwärts',
  space: 'Leertaste spielt ab',
  spaceOnButton: 'Leertaste auf einem fokussierten Knopf',
  promptField: 'Kürzel greifen nicht im Prompt-Feld',
  liveRegion: 'Live-Region meldet die Position',
  statusWhilePlaying: 'Statusmeldung während der Wiedergabe nur bei Schrittwechsel',
  oneStep: 'Trace mit einem Schritt',
  newTrace: 'Neuer Trace setzt zurück',
  failedImport: 'Fehlgeschlagener Import lässt den Cursor stehen',
  theme: 'Aurora-Theme ist aktiv',
  focus: 'Fokusring und Mindestgröße',
  reducedMotion: 'Reduzierte Bewegung',
} as const;

const OUTLINE_KEYBOARD = 'Tastatur';
const KEYBOARD_EXAMPLES: ReadonlyArray<{ taste: string; text: string }> = [
  { taste: 'ArrowRight', text: 'Schritt 0 · Station 2 / 12' },
  { taste: 'Shift+ArrowRight', text: 'Schritt 1 · Station 1 / 11' },
  { taste: 'End', text: 'Schritt 1 · Station 11 / 11' },
];

const TRANSPORT = [
  'Zum Anfang',
  'Schritt zurück',
  'Station zurück',
  'Abspielen',
  'Station vor',
  'Schritt vor',
  'Zum Ende',
];

test(T.noTrace, async ({ page }) => {
  await expect(playback(page)).toHaveCount(0);
  await expect(tokenStream(page)).toHaveCount(0);
  await expect(stationRegion(page)).toHaveCount(0);
});

test(T.afterGenerate, async ({ page }) => {
  await generateTraceT(page);

  for (const name of TRANSPORT) {
    await expect(transportButton(page, name)).toBeVisible();
  }
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 1 / 12');
  await expect(stationHeading(page)).toHaveText('tokenize');
  for (const name of ['Zum Anfang', 'Schritt zurück', 'Station zurück']) {
    await expect(transportButton(page, name)).toBeDisabled();
  }
  await expect(groupButton(page, 'Zeitleiste', 'Schritt 0')).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(group(page, 'Stationen').getByRole('button')).toHaveCount(12);
});

test(T.stationByStation, async ({ page }) => {
  await generateTraceT(page);
  await transportButton(page, 'Station vor').click();
  await transportButton(page, 'Station vor').click();

  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 3 / 12');
  await expect(stationHeading(page)).toHaveText('attention · Layer 0');
  await expect(groupButton(page, 'Stationen', 'attention · Layer 0')).toHaveAttribute(
    'aria-current',
    'step',
  );
});

test(T.stepAndEnd, async ({ page }) => {
  await generateTraceT(page);
  await transportButton(page, 'Schritt vor').click();

  await expect(stationRegion(page)).toContainText('Schritt 1 · Station 1 / 11');
  await expect(stationHeading(page)).toHaveText('embed');
  await expect(group(page, 'Stationen').getByRole('button')).toHaveCount(11);

  await transportButton(page, 'Zum Ende').click();
  await expect(stationRegion(page)).toContainText('Schritt 1 · Station 11 / 11');
  await expect(stationHeading(page)).toHaveText('sample');
  for (const name of ['Station vor', 'Schritt vor', 'Zum Ende']) {
    await expect(transportButton(page, name)).toBeDisabled();
  }
});

test(T.seek, async ({ page }) => {
  await generateTraceT(page);
  await groupButton(page, 'Zeitleiste', 'Schritt 1').click();
  await groupButton(page, 'Stationen', 'mlp · Layer 1').click();

  await expect(stationRegion(page)).toContainText('Schritt 1 · Station 8 / 11');
  await expect(stationHeading(page)).toHaveText('mlp · Layer 1');
});

test(T.residual, async ({ page }) => {
  await generateTraceT(page);

  await expect(groupButton(page, 'Stationen', 'residual · Layer 0 · nach Attention')).toHaveCount(
    1,
  );
  await expect(groupButton(page, 'Stationen', 'residual · Layer 0 · nach MLP')).toHaveCount(1);
});

test(T.playPause, async ({ page }) => {
  await generateTraceT(page);
  await transportButton(page, 'Abspielen').click();
  await expect(transportButton(page, 'Pause')).toBeVisible();

  await advance(page, 1500);
  await expect(stationHeading(page)).toHaveText('embed');

  await transportButton(page, 'Pause').click();
  await advance(page, 5000);
  await expect(stationHeading(page)).toHaveText('embed');
  await expect(transportButton(page, 'Abspielen')).toBeVisible();
});

test(T.speed, async ({ page }) => {
  await generateTraceT(page);
  await groupButton(page, 'Tempo', '2×').click();

  await expect(groupButton(page, 'Tempo', '2×')).toHaveAttribute('aria-pressed', 'true');
  await expect(groupButton(page, 'Tempo', '1×')).toHaveAttribute('aria-pressed', 'false');

  await transportButton(page, 'Abspielen').click();
  await advance(page, 750);
  await expect(stationHeading(page)).toHaveText('embed');
});

test(T.playToEnd, async ({ page }) => {
  await generateTraceT(page);
  await setSpeed(page, '2×');
  await transportButton(page, 'Abspielen').click();
  await advance(page, 15000);

  await expect(stationRegion(page)).toContainText('Schritt 1 · Station 11 / 11');
  await expect(transportButton(page, 'Abspielen')).toBeVisible();
});

test(T.tokenStream, async ({ page }) => {
  await generateTraceT(page);
  await expect(tokenItems(page)).toHaveText(['die', 'katze', 'sitzt', '?']);

  await groupButton(page, 'Stationen', 'sample').click();
  await expect(tokenEntries(page)).toHaveCount(4);
  await expect(tokenItems(page)).toHaveCount(5);
  await expect(tokenItems(page).last()).toHaveText('?');
  await expect(nextTokenPlaceholder(page)).toHaveCount(1);
  await expect(tokenEntries(page).nth(3)).toHaveAttribute('aria-current', 'true');
});

test(T.noPlaceholderAtEnd, async ({ page }) => {
  await generateTraceT(page);
  await transportButton(page, 'Zum Ende').click();

  await expect(tokenEntries(page)).toHaveCount(5);
  await expect(tokenItems(page)).toHaveCount(5);
  await expect(nextTokenPlaceholder(page)).toHaveCount(0);
});

test(T.stationView, async ({ page }) => {
  await generateTraceT(page);
  await groupButton(page, 'Stationen', 'attention · Layer 0').click();
  await expect(stationRegion(page)).toContainText('weights [2, 3, 3]');

  await groupButton(page, 'Stationen', 'logits').click();
  const candidates = stationRegion(page).getByRole('list', { name: 'Kandidaten', exact: true });
  await expect(candidates.getByRole('listitem')).toHaveCount(10);
});

for (const { taste, text } of KEYBOARD_EXAMPLES) {
  test(`${OUTLINE_KEYBOARD} (taste=${taste})`, async ({ page }) => {
    await generateTraceT(page);
    await focusPage(page);
    await page.keyboard.press(taste);

    await expect(stationRegion(page)).toContainText(text);
  });
}

test(T.homeAndBack, async ({ page }) => {
  await generateTraceT(page);
  await seekTo(page, 1, 2);
  await expect(stationRegion(page)).toContainText('Schritt 1 · Station 3 / 11');

  await focusPage(page);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(stationRegion(page)).toContainText('Schritt 1 · Station 1 / 11');

  await page.keyboard.press('Home');
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 1 / 12');
});

test(T.space, async ({ page }) => {
  await generateTraceT(page);
  await focusPage(page);
  await page.keyboard.press('Space');

  await expect(transportButton(page, 'Pause')).toBeVisible();
});

test(T.spaceOnButton, async ({ page }) => {
  await generateTraceT(page);
  await tabTo(page, transportButton(page, 'Station vor'));
  await page.keyboard.press('Space');

  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 2 / 12');
  await expect(transportButton(page, 'Abspielen')).toBeVisible();
});

test(T.promptField, async ({ page }) => {
  await generateTraceT(page);
  await promptField(page).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');

  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 1 / 12');
  await expect(transportButton(page, 'Abspielen')).toBeVisible();
});

test(T.liveRegion, async ({ page }) => {
  await generateTraceT(page);
  await transportButton(page, 'Station vor').click();

  await expect(statusMessage(page)).toContainText('Schritt 0 · Station 2 von 12 · embed');
});

test(T.statusWhilePlaying, async ({ page }) => {
  await generateTraceT(page);
  await setSpeed(page, '2×');
  await transportButton(page, 'Abspielen').click();

  await advance(page, 750);
  await expect(stationHeading(page)).toHaveText('embed');
  await expect(statusMessage(page)).toContainText('Schritt 0 · Station 1 von 12 · tokenize');

  await advance(page, 6850);
  await expect(statusMessage(page)).toContainText('Schritt 1 · Station 1 von 11 · embed');
});

test(T.oneStep, async ({ page }) => {
  await generate(page, 'der hund', 1);
  await expect(playback(page)).toBeVisible();

  await expect(group(page, 'Zeitleiste').getByRole('button')).toHaveCount(1);
  await expect(transportButton(page, 'Schritt zurück')).toBeDisabled();
  await expect(transportButton(page, 'Schritt vor')).toBeDisabled();
});

test(T.newTrace, async ({ page }) => {
  await generateTraceT(page);
  await seekTo(page, 1, 2);
  await expect(stationRegion(page)).toContainText('Schritt 1 · Station 3 / 11');

  await generate(page, 'der hund', 1);
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 1 / 12');
  await expect(group(page, 'Zeitleiste').getByRole('button')).toHaveCount(1);
});

test(T.failedImport, async ({ page }) => {
  await generateTraceT(page);
  await seekTo(page, 0, 2);
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 3 / 12');

  await importText(page, 'hallo');
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(stationRegion(page)).toContainText('Schritt 0 · Station 3 / 12');
});

test(T.theme, async ({ page }) => {
  const body = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { background: style.backgroundColor, fontFamily: style.fontFamily };
  });
  expect(body.background).toBe(colorRgb('bg'));
  expect(firstFontFamily(body.fontFamily)).toBe('Inter Variable');

  const headingFont = await page
    .getByRole('heading', { level: 1, name: 'Token Theater' })
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(firstFontFamily(headingFont)).toBe('Space Grotesk');
});

test(T.focus, async ({ page }) => {
  await generateTraceT(page);
  const stationForward = transportButton(page, 'Station vor');
  await tabTo(page, stationForward);

  const outline = await stationForward.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, color: style.outlineColor, width: style.outlineWidth };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.color).toBe(colorRgb('cyan'));
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);

  const buttons = playback(page).getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    expect(box, `Knopf ${i} ohne Größe`).not.toBeNull();
    expect(box?.width ?? 0, `Breite von Knopf ${i}`).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0, `Höhe von Knopf ${i}`).toBeGreaterThanOrEqual(44);
  }
});

test.describe('prefers-reduced-motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test(T.reducedMotion, async ({ page }) => {
    await generateTraceT(page);
    const current = group(page, 'Stationen').getByRole('button', { name: 'tokenize', exact: true });
    await expect(current).toHaveAttribute('aria-current', 'step');

    const duration = await current.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    );
    expect(duration).toBe('0s');
  });
});

test('Feature-Szenarien und Testnamen stimmen überein', () => {
  const feature = readFileSync(FEATURE_PATH, 'utf8');
  const scenarios: string[] = [];
  const outlines: string[] = [];
  for (const line of feature.split('\n')) {
    const scenario = /^\s*Szenario:\s*(.+?)\s*$/.exec(line);
    if (scenario?.[1]) scenarios.push(scenario[1]);
    const outline = /^\s*Szenariogrundriss:\s*(.+?)\s*$/.exec(line);
    if (outline?.[1]) outlines.push(outline[1]);
  }
  expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
  expect(outlines).toEqual([OUTLINE_KEYBOARD]);

  const examples = feature
    .slice(feature.indexOf(`Szenariogrundriss: ${OUTLINE_KEYBOARD}`))
    .split('\n')
    .map((line) => /^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .slice(1)
    .map((match) => ({ taste: match[1] ?? '', text: match[2] ?? '' }));
  expect(examples).toEqual([...KEYBOARD_EXAMPLES]);
});
