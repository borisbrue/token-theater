/**
 * TST-0003 – Akzeptanztests für den Trace-Inspector (CON-0003).
 * Ein Test je Szenario aus .sdd/contracts/behavior/trace-inspector-ui.feature,
 * Testname = Szenariotitel. Die Grundlage ("/" geöffnet) und der Request-Mitschnitt
 * (UI-04) laufen über das Auto-Fixture in ./helpers.ts.
 */
import {
  allStationLines,
  errorAlert,
  escapeRegExp,
  expect,
  exportButton,
  exportTrace,
  exportedTraceJson,
  generate,
  generateButton,
  generatedText,
  importText,
  maxTokensField,
  objectAt,
  promptField,
  stationItems,
  stationKinds,
  stepHeadings,
  tabTo,
  test,
  truncateBase64,
} from './helpers';

const STEP0_STATIONS = [
  'tokenize',
  'embed',
  'attention',
  'residual',
  'mlp',
  'residual',
  'attention',
  'residual',
  'mlp',
  'residual',
  'logits',
  'sample',
];

test('Startzustand', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Token Theater' })).toBeVisible();
  await expect(maxTokensField(page)).toHaveValue('8');
  await expect(generateButton(page)).toBeDisabled();
  await expect(exportButton(page)).toBeDisabled();
  await expect(stepHeadings(page)).toHaveCount(0);
});

test('Erzeugen wird mit Eingabe aktiv', async ({ page }) => {
  await promptField(page).fill('die');
  await expect(generateButton(page)).toBeEnabled();
});

test('Prompt nur aus Leerzeichen', async ({ page }) => {
  await promptField(page).fill('   ');
  await expect(generateButton(page)).toBeDisabled();
});

test('Mock-Trace erzeugen und ansehen', async ({ page }) => {
  await promptField(page).fill('die katze sitzt');
  await maxTokensField(page).fill('4');
  await generateButton(page).click();

  await expect(stepHeadings(page)).toHaveCount(4);
  expect(await stationKinds(page, 0)).toEqual(STEP0_STATIONS);

  const attentionLayer0 = stationItems(page, 0).filter({ hasText: /^attention · Layer 0 · / });
  await expect(attentionLayer0).toHaveCount(1);
  await expect(attentionLayer0).toContainText('weights [2, 3, 3]');

  await expect(generatedText(page)).toHaveText(/^die katze sitzt/);
  await expect(exportButton(page)).toBeEnabled();
});

test('Erzeugen per Tastatur', async ({ page }) => {
  await tabTo(page, promptField(page));
  await page.keyboard.type('die katze');
  await tabTo(page, generateButton(page));
  await page.keyboard.press('Enter');

  await expect(stepHeadings(page)).toHaveCount(8);
});

const MAX_TOKENS_EXAMPLES: ReadonlyArray<{ eingabe: string; angezeigt: string }> = [
  { eingabe: '0', angezeigt: '1' },
  { eingabe: '50', angezeigt: '32' },
  { eingabe: '12', angezeigt: '12' },
  { eingabe: '2.5', angezeigt: '2' },
  { eingabe: '', angezeigt: '8' },
];

for (const { eingabe, angezeigt } of MAX_TOKENS_EXAMPLES) {
  test(`Max. Tokens wird begrenzt (eingabe=${eingabe})`, async ({ page }) => {
    await promptField(page).fill('die katze');
    await maxTokensField(page).fill(eingabe);
    await maxTokensField(page).blur();

    await expect(maxTokensField(page)).toHaveValue(angezeigt);
  });
}

test('Export und Import', async ({ page }) => {
  await generate(page, 'die katze sitzt', 3);
  const textBefore = (await generatedText(page).innerText()).trim();
  const linesBefore = await allStationLines(page);

  const { download, content } = await exportTrace(page);
  expect(download.suggestedFilename()).toMatch(/^[0-9a-f-]{36}\.trace\.json$/);

  await page.reload();
  await expect(stepHeadings(page)).toHaveCount(0);
  await importText(page, content, download.suggestedFilename());

  await expect(stepHeadings(page)).toHaveCount(3);
  await expect(generatedText(page)).toHaveText(textBefore);
  expect(await allStationLines(page)).toEqual(linesBefore);
  await expect(exportButton(page)).toBeEnabled();
  await expect(errorAlert(page)).toHaveCount(0);
});

test('Ungültiger Import behält den vorherigen Trace', async ({ page }) => {
  await generate(page, 'die katze sitzt', 3);
  const linesBefore = await allStationLines(page);

  await importText(page, '{"id":"x"}');

  await expect(errorAlert(page)).toHaveCount(1);
  await expect(errorAlert(page)).toHaveText(
    'Die Datei enthält keine Trace-Version (schemaVersion).',
  );
  await expect(stepHeadings(page)).toHaveCount(3);
  expect(await allStationLines(page)).toEqual(linesBefore);
});

test('Zukünftige Trace-Version', async ({ page }) => {
  await importText(page, '{"schemaVersion":2}');

  await expect(errorAlert(page)).toHaveCount(1);
  await expect(errorAlert(page)).toHaveText('Trace-Version 2 wird nicht unterstützt.');
});

test('Kein JSON', async ({ page }) => {
  await importText(page, 'hallo');

  await expect(errorAlert(page)).toHaveCount(1);
  await expect(errorAlert(page)).toHaveText('Die Datei ist kein gültiges JSON.');
});

test('Schemafehler mit Pfad', async ({ page }) => {
  const trace = await exportedTraceJson(page, 'die katze sitzt', 3);
  const step0 = objectAt(trace, ['steps', 0]);
  delete step0['chosen'];

  await page.reload();
  await importText(page, JSON.stringify(trace));

  const alert = errorAlert(page);
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText(
    new RegExp(`^${escapeRegExp('Die Datei entspricht nicht dem Trace-Format.')}`),
  );
  await expect(alert).toContainText('/steps/0');
});

test('Semantischer Fehler mit Pfad', async ({ page }) => {
  const trace = await exportedTraceJson(page, 'die katze sitzt', 3);
  const station = objectAt(trace, ['steps', 0, 'stations', 2]);
  expect(station['kind']).toBe('attention');
  const weights = objectAt(station, ['weights']);
  const data = weights['data'];
  if (typeof data !== 'string') throw new Error('weights.data ist kein String');
  weights['data'] = truncateBase64(data, 4);

  await page.reload();
  await importText(page, JSON.stringify(trace));

  const alert = errorAlert(page);
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText(new RegExp(`^${escapeRegExp('Der Trace ist inkonsistent.')}`));
  await expect(alert).toContainText('/steps/0/stations/2/weights');
  await expect(alert).toContainText('INV-01');
});
