# Architektur- und Werkzeugregeln (CON-0004)

Jede Regel nennt ihren Prüfmechanismus. Ein Verstoß bricht `npm run lint`,
`npm run build` oder `npm test`.

**Geltungsbereich der ESLint-Regeln R-02 bis R-05:** Produktivcode unter `src/**`
ohne `*.test.ts(x)`. Tests (`tests/**`, `*.test.ts`) dürfen konkrete Engines und
Hilfsmittel direkt importieren. `tests/fixtures/**` ist von `npm run lint` und
Prettier ausgeschlossen (`ignores` bzw. `.prettierignore`, dort auch `.sdd/`,
`dist/`, `playwright-report/`, `test-results/`).

**Fixture-Paare:** Für jede mit (F) markierte Regel gibt es unter
`tests/fixtures/lint/` eine Verstoß-Datei und ein Gegenbeispiel. Sie tragen die
Endung `.ts.fixture` bzw. `.tsx.fixture`, damit Quelltext-Scanner (`sdd validate`,
`tsc`, Vitest) sie nicht als Code behandeln. Gelintet wird ihr Inhalt als Text. Der Test lintet
beide über die ESLint-Node-API mit der Projektkonfiguration
(`eslint.lintText(code, { filePath })`, virtueller Pfad im jeweiligen
`src/`-Bereich) und prüft:
- Verstoß: mindestens eine Meldung mit der erwarteten `ruleId` und `severity 2`,
  keine Parse-Fehler (`fatal`),
- Gegenbeispiel: 0 Meldungen, und die Datei ist nicht ignoriert
  (`eslint.isPathIgnored(filePath) === false`).

## R-01 Skripte und Versionen
*Prüfung: `package.json` lesen.*

Skripte `dev`, `build`, `test`, `test:e2e`, `lint` und `format` sind vorhanden.
`build` beginnt mit `tsc --noEmit` und führt danach `vite build` aus. `test` ruft
`vitest run` auf (kein Watch-Modus). `lint` führt `eslint .` und
`prettier --check .` aus. `react` und `react-dom` haben die Hauptversion 18.

## R-02 TypeScript (F für `any`)
*Prüfung: `tsc --showConfig` auswerten, Fixture-Paar.*

Die effektive Konfiguration hat `strict`, `noUncheckedIndexedAccess` und
`noImplicitOverride` auf `true`. In `src/engine/**` und `src/trace/**` gilt
`@typescript-eslint/no-explicit-any: error`.

## R-03 Schichtgrenzen (F)
*Mechanismus: `import/no-restricted-paths` mit `zones` (aufgelöste Pfade, erfasst
relative Importe und den Alias `@/` → `src/`).*

| Ziel (`target`) | verbotene Quelle (`from`) |
|---|---|
| `src/engine`, `src/trace` | `src/app`, `src/views`, `src/playback` |
| `src/trace` | `src/engine` |
| `src/views` | `src/engine`, `src/app` |
| `src/playback` | `src/engine`, `src/app`, `src/views` |
| `src/app` außer `src/app/engine-factory.ts`, `src/views`, `src/playback` | `src/engine/mock` (später `gpt2`, `remote`) |

Plugin: `eslint-plugin-import-x` (Regel `import-x/no-restricted-paths`) mit `eslint-import-resolver-typescript` für den Alias `@/`. Zonen, deren Quellverzeichnis noch keine Module enthält, werden erst getestet, sobald dort Module existieren.

Zusätzlich verbietet `no-restricted-imports` in `src/engine/**` und `src/trace/**`
die Pakete `react`, `react-dom` und `react/*`. `src/engine/**` darf aus
`src/trace/**` nur Typen importieren:
`@typescript-eslint/no-restricted-imports` mit `allowTypeImports: true` für das
Muster `@/trace/*` bzw. `../trace/*`, plus `consistent-type-imports`.
Re-Exporte konkreter Engines über ein `src/engine/index.ts` sind verboten
(R-03 gilt für den aufgelösten Pfad).

## R-04 Determinismus (F)
*Mechanismus: `no-restricted-syntax` und `no-restricted-properties` in
`src/engine/**` und `src/trace/**`.*

Verboten sind:
- `Math.random` (auch als Property-Zugriff ohne Aufruf)
- `Date.now`
- `Date()` und `new Date()` ohne Argument
- `performance.now` (auch `window.performance.now`, `globalThis.performance.now`)
- `crypto.randomUUID` und `crypto.getRandomValues` (auch über `globalThis` und `window`)
- Destrukturierung `const { now } = Date` bzw. `const { random } = Math`

Zufall, Zeit und IDs kommen aus `deps` (`createRng`, `clock`, `idProvider`).
In `src/app/**` sind diese APIs erlaubt.

## R-05 Textliterale (F)
*Mechanismus: `react/jsx-no-literals` in `src/app/**/*.tsx` und `src/views/**/*.tsx`.*

Optionen: `noStrings: true`, `ignoreProps: false`, `noAttributeStrings: true`,
`allowedStrings: []`. Ausgenommen sind über eine eigene Konfiguration die Props
`className`, `type`, `role`, `id`, `htmlFor`, `name`, `accept`, `inputMode`,
`autoComplete`, `data-*` und `aria-level`. Ist eine Ausnahme über die Optionen von
`jsx-no-literals` nicht abbildbar, ist eine projekteigene Regel unter
`eslint-rules/` zulässig. Ihre Fixtures gehören zu R-05.

## R-06 Schema-Kopie
*Prüfung: JSON-Deep-Equal.*

`src/trace/trace.schema.json` ist JSON-tief gleich
`.sdd/contracts/data/trace-serialization-format-v1.schema.json`.

## R-07 Formatierung
*Prüfung: Exit-Code 0 von `prettier --check .`.*

`// prettier-ignore` ist erlaubt (es unterdrückt keinen Fehler, nur die Formatierung).

## R-08 Keine Inline-Suppression (F für ESLint)
*Mechanismus: `linterOptions.noInlineConfig: true`,
`linterOptions.reportUnusedDisableDirectives: "error"`,
`@typescript-eslint/ban-ts-comment` mit `ts-ignore`, `ts-expect-error` und
`ts-nocheck` auf `true`, dazu ein Dateiscan.*

Der Dateiscan durchsucht alle Code- und Konfigurationsdateien des Repos
(`.ts .tsx .js .jsx .mjs .cjs .json .html .css`, ohne `node_modules`, `dist`,
`.git`, `tests/fixtures`, `.sdd`, `playwright-report`, `test-results`, `coverage`;
Markdown ist ausgenommen, weil Doku die Begriffe zitiert) nach `eslint-disable`, `@ts-ignore`,
`@ts-expect-error`, `@ts-nocheck` und `istanbul ignore`. Er findet keinen Treffer.
