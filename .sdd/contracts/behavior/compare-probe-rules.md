# Vergleich, Sonden-Import und Werkzeuge (CON-0026)

Jede Regel nennt ihren Prüfmechanismus. CD-xx prüft TST-0029 (`tests/unit/compare-diff.test.ts`),
PF-xx TST-0027 (`tests/unit/probe-format.test.ts`), PT-xx TST-0028
(`tests/unit/probe-tools.test.ts`); alle Vitest unter Node, ohne Browser und ohne Python. Ein
„Mock-Trace“ entsteht wie in CON-0023 (`MockEngine({ weightSeed: 1234 })`, `GreedySampler`,
Seed 42, Helfer `tests/unit/helpers/engine-setup.ts`), hier mit 2 Tokens. Toleranz 1e-9, wo
nicht anders genannt.

## Module

```ts
// @/views/compare/diff
export interface Metric<T> { readonly name: string; compute(a: T, b: T): number }
export const cosine: Metric<ArrayLike<number>>;          // name "cosine"
export const jsDivergence: Metric<readonly number[]>;     // name "js-divergence"
export type Comparability = 'full' | 'output' | 'none';
export function comparability(a: Trace, b: Trace): Comparability;
export interface OutputRow { token: Token; pA: number; pB: number; delta: number }
export interface OutputDiff { rows: OutputRow[]; js: number }
export function outputDiff(a: GenerationStep, b: GenerationStep): OutputDiff | null;
export interface LayerRow { layer: number; cosine: number; lensA: Token | null;
  lensB: Token | null; expertOverlap: number | null }
export function layerDiff(a: GenerationStep, b: GenerationStep): LayerRow[];
export function largestDrop(rows: readonly LayerRow[]): number | null;
export const OUTPUT_TOP_N = 10;
// @/probe/types: Probe, ProbePair, ProbeReport, ReportPair, ReportTarget, ProbeIssue
// @/probe/import
export class ProbeImportError extends Error { kind: 'parse' | 'version' | 'schema' | 'semantic';
  errors: readonly ProbeIssue[] }                // ProbeIssue { path; message; rule? }
export function parseProbe(json: string): Probe;            // wirft ProbeImportError
export function parseReport(json: string): ProbeReport;     // wirft ProbeImportError
// @/probe/schema
export const probeFormatSchema: object;   // Inhalt von src/probe/probe-format.schema.json
```

## CD-01 Kosinus
*Prüfung: `cosine.compute` mit festen Vektoren.*

`[1, 0]` mit `[0, 1]` → 0; `[1, 2]` mit `[2, 4]` → 1; `[1, 0]` mit `[−1, 0]` → −1; `[0, 0]` mit
`[0, 0]` → 1; `[0, 0]` mit `[1, 0]` → 0. `cosine.name` ist `"cosine"`.

## CD-02 JS-Divergenz
*Prüfung: `jsDivergence.compute`.*

Gleiche Verteilungen → 0; `[1, 0]` mit `[0, 1]` → 1; `[0.5, 0.5]` mit `[1, 0]` →
`0.311278124459133` (Basis 2, Toleranz 1e-12); Eingaben werden je auf Summe 1 normiert, also
`[2, 2]` mit `[1, 0]` wie `[0.5, 0.5]` mit `[1, 0]`; symmetrisch; Ergebnis immer in [0, 1].
`jsDivergence.name` ist `"js-divergence"`.

## CD-03 Vergleichbarkeit
*Prüfung: `comparability` mit Mock-, Mock-MoE-, Fixture- und abgewandelten Traces.*

- Mock-Trace mit sich selbst und mit einem Mock-Trace eines anderen Prompts → `full`.
- Mock-Trace mit Mock-MoE-Trace (gleiches Vokabular, anderes `model`) → `output`.
- Mock-Trace mit Mock-Trace, dessen `capabilities` `["tokenize", "logits", "sample"]` sind →
  `output`.
- Mock-Trace mit `tests/fixtures/moe/tiny-granitemoe.trace.json` → `none`.
- Ist `architecture` in einem Trace `null`, gilt `vocabSize` der ersten logits-Station; ist auch
  die `null` und `engine.model` verschieden → `none`, sonst entscheiden Modell, Architektur und
  Interna wie oben (beide `null`, gleiches Modell, mit Interna → `full`).

## CD-04 Ausgabe
*Prüfung: `outputDiff` mit zwei Mock-Traces verschiedener Prompts und mit handgebauten Schritten.*

- Die Zeilen sind genau die Vereinigung der ersten 10 Kandidaten (nach `prob`) beider
  logits-Stationen, jedes Token einmal.
- `pA`/`pB` ist `prob` aus der ganzen `distribution`, 0 wenn das Token dort fehlt;
  `delta = pB − pA`.
- Sortiert nach `|delta|` absteigend, bei Gleichstand nach Token-ID aufsteigend.
- `js` ist `jsDivergence.compute` über die `pA`- und `pB`-Spalte der Zeilen.
- Ein Schritt mit sich selbst: alle `delta` 0, `js` 0.
- Fehlt in einem Schritt die logits-Station → `null`.

## CD-05 Layer
*Prüfung: `layerDiff` mit Mock-Traces, Mock-MoE-Traces und `buildMoeTrace`.*

- Je Layer mit residual-Station nach `mlp` oder `moe` in beiden Schritten genau eine Zeile,
  aufsteigend; residual nach der Attention zählt nicht.
- `cosine` ist `cosine.compute` der letzten Zeile von `stream` beider Stationen.
- `lensA`/`lensB` ist `lens[0].token`, ohne `lens` `null`.
- Mock-MoE mit sich selbst: `expertOverlap` 1 in jedem Layer; Mock-Traces: `expertOverlap` `null`.
- Bei verschiedenen Experten der letzten Zeile: Anteil gemeinsamer IDs an der Zeilenlänge von A
  (Beispiel `[1, 3]` und `[3, 0]` → 0,5).
- Ein Schritt mit sich selbst: alle `cosine` 1 (Toleranz 1e-6).

## CD-06 Größter Abfall
*Prüfung: `largestDrop` mit handgebauten Zeilen.*

Kosinus `[0.99, 0.80, 0.78]` → Layer 1; `[0.70, 0.69]` → Layer 0 (Abfall 0,30 von 1); alle 1 →
`null`; leere Liste → `null`; Gleichstand → der frühere Layer. Ergebnis ist `layer` der Zeile,
nicht ihr Index.

## CD-07 Unveränderte Traces und Tempo
*Prüfung: Mock-Traces vor und nach den Aufrufen; Zeitmessung.*

`outputDiff`, `layerDiff` und `comparability` verändern ihre Eingaben nicht (serialisierter Trace
vorher und nachher gleich). `layerDiff` zweier 24-Layer-Traces aus `buildMoeTrace` dauert unter
100 ms.

## PF-01 Schema-Kopie
*Prüfung: Dateien.*

`src/probe/probe-format.schema.json` ist JSON-tief gleich
`.sdd/contracts/data/probe-format-v1.schema.json`; `probeFormatSchema` ist ihr Inhalt.

## PF-02 Gültige Sonde und gültiger Bericht
*Prüfung: Beispiele aus SPEC-0012 §3.4, im Test vervollständigt.*

`parseProbe` liefert die Sonde unverändert als Objekt; `parseReport` den Bericht. Ein Bericht mit
drei Zielen und `logRatio`/`flip` `null` ist gültig; ebenso `meanAbsLogRatioShift: null`, wenn kein
Paar zwei Ziele hat.

## PF-03 Kette und Fehlerarten
*Prüfung: fehlerhafte Eingaben.*

- `"{"` → `parse`; `"[]"` → `parse`; `{}` → `version` mit `path` `/schemaVersion`;
  `schemaVersion: 2` → `version`.
- Bericht an `parseProbe` → `schema` (Befund an `/kind`); Sonde an `parseReport` → `schema`.
- Sonde ohne `pairs`, mit einem Ziel, mit `id` „Doctor“ → `schema` mit JSON-Pointer-Pfaden.
- Höchstens 50 Befunde.

## PF-04 Regeln
*Prüfung: je Regel ein Bericht oder eine Sonde mit genau diesem Fehler.*

PB-01, PB-02, RP-01 … RP-05 aus CON-0024 ergeben je `semantic` mit `rule` und dem dort genannten
`path`; ein `logRatioA`, das um 0,01 von `ln(pA₀/pA₁)` abweicht, ist ein RP-02-Befund, eines im
Rahmen der Toleranz nicht.

## PF-05 Schichtregel
*Prüfung: Quelltext unter `src/probe/`.*

Keine Datei unter `src/probe/` importiert `react`, `react-dom` oder aus `src/views`, `src/app`
oder `src/engine`; aus `src/trace` höchstens mit `import type`.

## PT-01 uv-Projekt
*Prüfung: Dateien unter `scripts/moe-export/`.*

`probe.py` und `verify_weights.py` existieren; `pyproject.toml` nennt zusätzlich `jsonschema` und
`huggingface_hub` in `dependencies`; `uv.lock` enthält Pakete `name = "jsonschema"` und
`name = "huggingface-hub"`. Weiter kein `requirements*.txt`. Tests liegen in
`scripts/moe-export/tests/test_probe.py` und `test_verify_weights.py`.

## PT-02 npm-Skripte
*Prüfung: `package.json`.*

`scripts.probe` ist genau `"uv run --project scripts/moe-export scripts/moe-export/probe.py"`,
`scripts["verify-weights"]` genau
`"uv run --project scripts/moe-export scripts/moe-export/verify_weights.py"`.

## PT-03 Kommandozeile
*Prüfung: Quelltext.*

`probe.py` definiert `--model`, `--tiny-random`, `--probe`, `--out`, `--seed`, `--top-n`,
`--traces`; `verify_weights.py` definiert `--model`, `--revision`, `--local`, `--reference`,
`--out`, `--top`. `probe.py` liest das Schema aus `src/probe/probe-format.schema.json` und enthält
die Meldung „ist kein einzelnes Token“. `verify_weights.py` enthält die Ausgaben `ok`,
`abweichend` und `nicht prüfbar` und die Exit-Codes 0, 1 und 3 (SPEC-0012 §3.7). Das Verhalten
prüfen die Python-Tests (außerhalb des GREEN-Gates): mehrteiliges Ziel → Exit-Code 2 ohne
Ausgabedatei; ein veränderter Tensor ist `top[0]` mit Exit-Code 1; gleiche Checkpoints → 0;
Hash-Abweichung → 1; Hub nicht erreichbar → 3; andere Form → `shapeMismatch`.

## PT-04 Beispielsonden
*Prüfung: `scripts/probes/*.probe.json`.*

Genau die vier Dateien aus SPEC-0012 §3.8; jede besteht `parseProbe`, hat 12 Paare, `name` gleich
dem Dateinamen ohne `.probe.json`, `language` und `attribute` jedes Paars wie in der Tabelle,
`targets` jedes Paars genau die Ziele der Tabelle, und das letzte Paar hat `id` `control` und
`a = b`. Die anderen 11 Paare haben `a ≠ b`. Die Ziele der englischen Sonden sind mit dem
GPT-2-Tokenizer der App (`public/tokenizers/gpt2`) je genau ein Token; „ sie“ ist dort mehr als
eines.

## PT-05 Bericht-Fixture
*Prüfung: `tests/fixtures/probe/tiny-occupation-gender-en.probe-report.json`.*

Erzeugt mit `npm run probe -- --tiny-random --seed 2 --probe
scripts/probes/occupation-gender-en.probe.json --out
tests/fixtures/probe/tiny-occupation-gender-en.probe-report.json`. `parseReport` wirft nicht;
`probe` ist `occupation-gender-en`, `model` `tiny-random-gpt2`, `generator` `probe.py`,
`createdAt` `2026-10-23T00:00:00Z`; die Paare stehen in der Reihenfolge der Sonde mit deren `a`,
`b` und Zielen; Ziel-IDs sind die GPT-2-IDs (339, 673); `topA`/`topB` haben je 5 Einträge; mindestens ein
Paar hat `flip = true` (Seed 2, damit die Ansicht einen Umschwung zeigt); das Paar `control` hat
`pA = pB` je Ziel, `js` 0 (Toleranz 1e-9) und `flip` `false`.
