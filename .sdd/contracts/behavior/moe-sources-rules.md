# MoE-Quellen-Regeln (CON-0023)

Jede Regel nennt ihren Prüfmechanismus. MS-xx prüft TST-0024 (`tests/unit/moe-trace.test.ts`,
Vitest, Node), EX-xx prüft TST-0025 (`tests/unit/moe-fixture.test.ts`, Vitest, Node, ohne Python).
Ein „Mock-MoE-Trace“ ist der Trace von `MockEngine({ weightSeed: 1234, moe: MOCK_MOE })` über
`generate` mit `GreedySampler`, Prompt „die katze sitzt“, 3 Tokens, Seed 42 (Helfer
`tests/unit/helpers/engine-setup.ts`). Toleranz für Rechenwerte: 1e-5 absolut, wo nicht anders
genannt.

## Module und Typen

```ts
// @/trace/types
export type StationKind = 'tokenize' | 'embed' | 'attention' | 'mlp' | 'moe' | 'residual'
  | 'logits' | 'sample';
export interface Architecture { nLayers: number; nHeads: number; dModel: number; dMlp: number;
  vocabSize: number; contextLength: number; nExperts?: number; topK?: number }
export interface MoeStation { kind: 'moe'; layer: number; lnIn: Tensor; routerLogits: Tensor;
  experts: number[][]; gates: number[][]; out: Tensor }
export interface ResidualStation { kind: 'residual'; layer: number;
  after: 'attention' | 'mlp' | 'moe'; stream: Tensor; lens?: Candidate[] }
// @/engine/mock/mock-engine
export interface MoeOptions { nExperts: number; topK: number }
export const MOCK_MOE: MoeOptions; // { nExperts: 4, topK: 2 }
export interface MockEngineOptions { weightSeed?: number; capabilities?: StationKind[];
  eosAt?: number; lensTopN?: number; moe?: MoeOptions }
// @/app/engine-factory
export type EngineKind = 'mock' | 'mock-moe' | 'remote' | 'gpt2';
```

## MS-01 Info der Mock-MoE-Engine
*Prüfung: `new MockEngine({ moe: MOCK_MOE }).info`.*

`model` ist `"mock-de-52-moe"`, `kind` `"mock"`, `capabilities` ist
`["tokenize", "embed", "attention", "moe", "residual", "logits", "sample"]`, `architecture` ist
`{ nLayers: 2, nHeads: 2, dModel: 8, dMlp: 16, vocabSize: 52, contextLength: 64, nExperts: 4,
topK: 2 }`. `MOCK_MOE` ist `{ nExperts: 4, topK: 2 }`.

## MS-02 Stationen
*Prüfung: Mock-MoE-Trace.*

Jeder Schritt hat die Folge `tokenize?` (nur Schritt 0), `embed`, je Layer `attention`,
`residual (after attention)`, `moe`, `residual (after moe)`, dann `logits`, `sample`; keine
Station `mlp`. `serializeTrace` → `deserializeTrace` läuft ohne `TraceImportError`, und
`checkInvariants` meldet nichts. `moe.lnIn`, `moe.out` haben `[n, 8]`, `moe.routerLogits` hat
`[n, 4]`; `experts` und `gates` haben `n` Zeilen zu je 2 Einträgen.

## MS-03 Routing
*Prüfung: jede moe-Station des Mock-MoE-Traces.*

Für jede Zeile `i`: `experts[i]` sind die 2 Experten mit den höchsten `routerLogits[i, ·]`, bei
Gleichstand die kleinere ID zuerst; `gates[i]` ist `softmax(routerLogits[i, experts[i]])` und
absteigend; die Summe ist `1 ± 1e-6`.

## MS-04 Beitrag zum Residual Stream
*Prüfung: Mock-MoE-Trace, jeder Schritt und Layer.*

`residual(l, after moe).stream = residual(l, after attention).stream + moe(l).out` elementweise.

## MS-05 Bestand bleibt bytegleich
*Prüfung: Hash gegen `tests/fixtures/moe/mock-dense-before-spec-0011.json`.*

Der serialisierte Trace von `MockEngine({ weightSeed: 1234 })` (Prompt „die katze sitzt“,
3 Tokens, Seed 42, `FIXED_ID`, `FIXED_CLOCK`) hat denselben SHA-256 wie vor SPEC-0011; ebenso mit
`capabilities: ["tokenize", "logits", "sample"]`. Die Router- und Experten-Gewichte kommen aus
einem eigenen Generator (`createRng((weightSeed ^ 0x9e3779b9) >>> 0)`) und verändern die übrigen
Gewichte nicht: Mock und Mock-MoE haben in Schritt 0 dieselbe `embed`-Station und dieselbe
`attention`-Station in Layer 0.

## MS-06 Determinismus
*Prüfung: zwei Mock-MoE-Traces.*

Gleicher `weightSeed` ergibt bytegleiche Traces; `weightSeed: 99` ergibt andere `routerLogits`.

## MS-07 Fehler
*Prüfung: Konstruktor.*

`RangeError` bei: Option `moe` und `capabilities` mit `mlp`; `capabilities` mit `moe` ohne Option;
`nExperts < 2`, `topK < 1`, `topK > nExperts` oder nicht ganzzahlige Werte.

## MS-08 Logit-Lens nach MoE
*Prüfung: Mock-MoE-Trace.*

Jede residual-Station mit `after: "moe"` hat `lens` mit 5 Einträgen (Default `lensTopN`), keine
nach der Attention; die Lens des letzten Layers hat dieselben IDs in derselben Reihenfolge wie die
ersten 5 Kandidaten der logits-Station (CON-0016 L-04).

## MS-09 Engine-Art `mock-moe`
*Prüfung: `createEngine('mock-moe', deps)`.*

liefert eine Engine mit `info.model = "mock-de-52-moe"` und `nExperts 4`, `topK 2`;
`createEngine('mock', deps)` liefert weiter `mock-de-52` ohne `moe`.

## EX-01 uv-Projekt
*Prüfung: Dateien unter `scripts/moe-export/`.*

- `pyproject.toml` hat `[project]` mit `requires-python` und den Abhängigkeiten `torch`,
  `transformers`, `safetensors`; einen `[[tool.uv.index]]` mit der URL
  `https://download.pytorch.org/whl/cpu` und `explicit = true`; `[tool.uv.sources]` bindet `torch`
  an diesen Index; `[dependency-groups]` hat `dev` mit `ruff` und `pytest`.
- `uv.lock` existiert und enthält ein Paket `name = "torch"`; `.python-version` existiert.
- Es gibt keine Datei `requirements*.txt` und kein `setup.py` im Ordner.
- `.gitignore` schließt `scripts/moe-export/.venv` aus.

## EX-02 npm-Skript
*Prüfung: `package.json`.*

`scripts["export-moe"]` ist genau
`"uv run --project scripts/moe-export scripts/moe-export/export_trace.py"`.

## EX-03 Kommandozeile und Adapter
*Prüfung: Quelltext von `scripts/moe-export/export_trace.py`.*

Die Optionen `--model`, `--prompt`, `--max-tokens`, `--strategy`, `--temperature`, `--seed`,
`--top-n`, `--lens-top-n`, `--out` und `--tiny-random` sind definiert; es gibt die Klassen
`GraniteMoeAdapter` und `MixtralAdapter` (Strategy, SPEC-0011 §3.10). Ein nicht unterstütztes
Modell beendet das Skript mit Exit-Code ≠ 0 und ohne Ausgabedatei (Python-Test unter
`scripts/moe-export/tests/`, `uv run pytest`, außerhalb des GREEN-Gates).

## EX-04 Fixture: Kopf
*Prüfung: `tests/fixtures/moe/tiny-granitemoe.trace.json`.*

Erzeugt mit `npm run export-moe -- --tiny-random --seed 1 --out
tests/fixtures/moe/tiny-granitemoe.trace.json`. `deserializeTrace` wirft nicht; nach erneutem
`serializeTrace` ist das JSON tief gleich dem Original. `engine.kind` ist `"transformers"`,
`engine.model` `"tiny-random-granitemoe"`, `capabilities` genau
`["tokenize", "attention", "moe", "residual", "logits", "sample"]`; `architecture` hat
`nLayers 2`, `nHeads 4`, `dModel 64`, `dMlp 32`, `nExperts 4`, `topK 2`, `vocabSize 49152`.
`prompt` ist „die katze sitzt“, `maxTokens` 3, `sampling.strategy` `"greedy"`; `finishReason` ist
`"max-tokens"` oder `"eos"`. Jede logits-Station hat 50 Kandidaten und `coverage < 1`.

## EX-05 Fixture: Residual-Summen
*Prüfung: Fixture, Toleranz 1e-4.*

In jedem Schritt gilt `residual(l, after moe) = residual(l, after attention) + moe(l).out`, und für
`l ≥ 1` `residual(l, after attention) = residual(l − 1, after moe) + attention(l).out`. Damit ist
`out` der tatsächlich addierte Beitrag (Faktoren wie `residual_multiplier` eingerechnet).

## EX-06 Fixture: Routing und Gates
*Prüfung: Fixture, Toleranz 1e-4.*

`experts[i]` sind die Top-2 der `routerLogits[i]`, und `gates[i] = softmax(routerLogits[i,
experts[i]])` (Granite-Gating).

## EX-07 Fixture: Grouped-Query-Attention aufgefächert
*Prüfung: Fixture.*

`attention.k` und `attention.v` haben `[n, 64]`; bei 4 Köpfen und 2 KV-Köpfen (Kopfbreite 16) sind
die Spalten von Kopf 0 und Kopf 1 sowie von Kopf 2 und Kopf 3 gleich.

## EX-08 Fixture: Logit-Lens
*Prüfung: Fixture, Toleranz 1e-4.*

Jede residual-Station mit `after: "moe"` hat `lens` mit 5 Einträgen, die nach der Attention keine.
Die Lens des letzten Layers hat die IDs der ersten 5 logits-Kandidaten in derselben Reihenfolge,
und `lens[j].prob = logits.distribution[j].prob · coverage`.
