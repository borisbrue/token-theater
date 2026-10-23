---
id: SPEC-0001
title: "Foundation: scaffold, engine interface and trace format"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-21
updated: 2026-10-21
version: 0.3.0
priority: high          # low | medium | high | critical
tags: [foundation, engine, trace, scaffold]
depends_on: []
contracts: ["CON-0001", "CON-0002", "CON-0003", "CON-0004"]
tests: ["TST-0001", "TST-0002", "TST-0003", "TST-0004"]
fr_test_map:
  FR-01: [TST-0004, TST-0003]
  FR-02: [TST-0001, TST-0002]
  FR-03: [TST-0001, TST-0004]
  FR-04: [TST-0001]
  FR-05: [TST-0002]
  FR-06: [TST-0002]
  FR-07: [TST-0002]
  FR-08: [TST-0002, TST-0001]
  FR-09: [TST-0004]
  FR-10: [TST-0003]
  FR-11: [TST-0004, TST-0003]
  FR-12: [TST-0004, TST-0002]
---

# Foundation: scaffold, engine interface and trace format

> **Status:** draft · **Owner:** Boris · **Version:** 0.3.0
> Grundlage: `.sdd/docs/architecture/vision.md`

## 1. Kontext & Motivation

Token Theater soll zeigen, wie ein Sprachmodell Text erzeugt, Schritt für Schritt
und so langsam, dass man es erklären kann. Leitprinzip ist **"erst rechnen, dann
abspielen"**: Eine Engine rechnet in normalem Tempo und schreibt jeden
Zwischenschritt in einen **Trace**. Alle späteren Ansichten und der
Playback-Controller lesen nur noch diesen Trace.

Zwei sehr unterschiedliche Engines sollen dasselbe Format befüllen: eine eigene
GPT-2-Engine (SPEC-0006, alle Interna) und ein Remote-Adapter für Ollama/llama.cpp
(SPEC-0005, nur Logprobs). Trace-Format und Engine-Interface sind deshalb der
Vertrag, an dem alle weiteren Specs hängen. Diese Spec legt sie fest, baut das
Projektgerüst und liefert eine **Mock-Engine**, mit der sich UI-Arbeit ohne
Modellgewichte und ohne Server erledigen lässt.

## 2. Zielsetzung

**Primärziel:** Ein lauffähiges, getestetes Projektgerüst mit stabilem
Trace-Format und Engine-Interface, das die Mock-Engine vollständig befüllt.

**Erfolgskriterien (messbar):**
- [ ] `npm ci && npm run build && npm test && npm run lint` laufen fehlerfrei.
- [ ] Ein Trace der Mock-Engine validiert gegen `trace.schema.json` (ajv).
- [ ] Export → Import eines Traces ergibt einen tief gleichen Trace (Round-Trip).
- [ ] Gleicher Prompt + gleicher Seed ergibt bei der Mock-Engine einen bytegleichen Trace-Export.
- [ ] ESLint schlägt fehl, wenn `src/engine/**` oder `src/trace/**` React importiert oder `src/views/**` aus `src/engine/**` importiert.
- [ ] Ein Playwright-Test startet die App, erzeugt einen Mock-Trace und sieht die Liste der Stationen.

**Nicht-Ziele (explizit):**
- Playback-Controller, Transportleiste, Tempo (→ SPEC-0002)
- Echter BPE-Tokenizer (→ SPEC-0003); die Mock-Engine nutzt einen Wort-Tokenizer
- Temperatur, Top-k und Top-p (→ SPEC-0004); hier nur Greedy und ein seedbarer Zufallsgenerator
- Remote-Adapter und GPT-2-Engine (→ SPEC-0005, SPEC-0006)
- Visualisierungen der Stationen (→ SPEC-0003/0004/0007); hier nur eine Debug-Liste
- Quantisierung (float16) beim Export (→ SPEC-0008)

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/app/       Shell (Header, Debug-Ansicht "Trace-Inspector"), engine-factory.ts
src/views/     (leer bis auf Debug-Liste) – liest nur Trace/Playback-State
src/trace/     Trace-Typen, trace.schema.json, TraceRecorder, serialize/deserialize
src/engine/    InferenceEngine-Interface, Generator-Schleife, Sampler, mock/
```

Abhängigkeiten zeigen nur nach unten. Das wird per ESLint `no-restricted-imports`
je Verzeichnis durchgesetzt (FR-09). `engine/` hängt von den **Typen** in
`trace/` ab. `trace/` kennt die Engines nicht.

### 3.2 Trace-Modell

Ein **Trace** beschreibt einen Generierungslauf. Er besteht aus **Schritten**
(ein Schritt erzeugt ein Token), und jeder Schritt besteht aus einer geordneten
Liste von **Stationen**:

```ts
interface Trace {
  schemaVersion: 1;
  id: string;                    // UUID
  createdAt: string;             // ISO-8601
  engine: EngineInfo;            // kind, model, capabilities, Architektur-Hyperparameter
  prompt: string;
  maxTokens: number;             // 1–32
  sampling: SamplingParams;      // { strategy: string; seed: number; params: Record<string, number | string | boolean> }
  steps: GenerationStep[];
  finishReason: 'max-tokens' | 'eos' | 'aborted' | 'error';
  error?: { message: string };   // genau bei finishReason 'error'
}

interface EngineInfo {
  kind: string; model: string;
  capabilities: StationKind[];   // enthält immer 'logits' und 'sample'
  architecture: { nLayers; nHeads; dModel; dMlp; vocabSize; contextLength } | null;
  eosTokenId: number | null;
}

interface GenerationStep {
  index: number;                 // 0 = Prompt-Durchlauf
  contextTokens: Token[];        // Kontext VOR diesem Schritt
  newPositions: [start, end);    // welche Positionen dieser Schritt neu berechnet (KV-Cache-Sicht)
  stations: Station[];
  chosen: Token;
  text: string;                  // tokenizer.decode([...contextTokens, chosen])
}

type Station =
  | { kind: 'tokenize';  tokens: Token[] }
  | { kind: 'embed';     token: Tensor; position: Tensor; sum: Tensor }          // [newPos, dModel]
  | { kind: 'attention'; layer: number; lnIn: Tensor; q: Tensor; k: Tensor; v: Tensor;
                         weights: Tensor /* [heads, newPos, ctx] */; out: Tensor }
  | { kind: 'mlp';       layer: number; lnIn: Tensor; hidden: Tensor; out: Tensor }
  | { kind: 'residual';  layer: number; after: 'attention' | 'mlp'; stream: Tensor }
  | { kind: 'logits';    vocabSize: number | null; distribution: Candidate[]; coverage: number | null } // nach finalem LayerNorm
  | { kind: 'sample';    distribution: Candidate[]; random: number | null; chosen: Token };

interface Tensor { shape: number[]; dtype: 'float32'; data: Float32Array }
interface Token { id: number; text: string }
interface Candidate { token: Token; logit: number | null; prob: number }
```

**Verteilung als Teil des Forward-Ergebnisses.** Die `logits`-Station ist die
letzte Station jedes `forward` und trägt die Verteilung für den Sampler:
`distribution` ist absteigend nach `prob` sortiert und auf die gelieferten
Kandidaten **renormiert** (Summe 1 ± 1e-6). `coverage` ist die
Wahrscheinlichkeitsmasse dieser Kandidaten **vor** der Renormierung: `1` bei
voller Verteilung (Mock, GPT-2), `< 1` bei Top-N (Remote), `null`, wenn
unbekannt. So sieht der Sampler den Unterschied, statt ihn zu raten, und es gibt
keine verdeckte Kopplung an einen vorherigen Aufruf.

**Erweiterbare Sampling-Parameter.** `sampling.strategy` ist ein freier Name
(`greedy` hier, z. B. `temperature-top-p` in SPEC-0004), `sampling.params` ein
offenes Objekt. Neue Strategien erweitern Schema v1 also nicht. Generell gilt:
**zusätzliche optionale Felder bleiben in v1 erlaubt** (das Schema setzt
`additionalProperties: true` außer in `Tensor`, `Token` und `Candidate`).
`schemaVersion` steigt nur bei inkompatiblen Änderungen.

**Fähigkeiten statt Pflichtfelder.** `engine.capabilities` listet die
Stationstypen, die eine Engine liefert (`tokenize`, `embed`, `attention`, `mlp`,
`residual`, `logits`, `sample`). Der Remote-Adapter meldet z. B. nur
`tokenize`, `logits` und `sample`. Ansichten fragen die Fähigkeit ab und zeigen
"in diesem Modus nicht sichtbar", statt leer zu bleiben.

**KV-Cache-Sicht.** Schritt 0 berechnet alle Prompt-Positionen. Jeder weitere
Schritt berechnet nur die eine neue Position. Tensoren der Stationen haben
deshalb als erste Dimension `newPositions` statt des ganzen Kontexts. Ansichten
setzen vollständige Matrizen (z. B. die Attention-Heatmap) aus den Schritten
`0..n` zusammen. Das hält Traces klein und macht den KV-Cache selbst
erklärbar (entschieden, siehe Offene Fragen).

**Serialisierung.** JSON. Tensordaten werden als Base64 der little-endian
float32-Bytes gespeichert, alles andere bleibt lesbar. `serializeTrace` /
`deserializeTrace` liegen in `trace/`. Die Datei `src/trace/trace.schema.json`
(JSON Schema 2020-12) beschreibt das **serialisierte** Format und ist
maßgeblich. **Bei Abweichungen gilt CON-0001** (dort auch die semantischen
Invarianten und die Struktur von `TraceImportError`).

### 3.3 Strategy Pattern (Behavioral): `InferenceEngine` und `Sampler`

**Anwendung:** Jede Engine implementiert dasselbe Interface:

```ts
interface Tokenizer {
  tokenize(text: string): Promise<Token[]>;
  decode(tokens: Token[]): string;
  readonly eosTokenId: number | null;
}

interface Loadable {
  load(onProgress?: (p: LoadProgress) => void, signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

interface InferenceEngine extends Loadable {
  readonly info: EngineInfo;
  readonly tokenizer: Tokenizer;
  /** Ein Forward-Pass über newPositions; liefert Stationen, die letzte ist immer 'logits'. */
  forward(context: Token[], newPositions: [number, number], signal?: AbortSignal): AsyncIterable<Station>;
}

interface Sampler {
  readonly strategy: string;
  sample(logits: LogitsStation, rng: Rng): SampleStation;
}
```

Die Rollen sind getrennt (Interface Segregation): Die Shell braucht nur
`Loadable` und `info`, die Tokenizer-Ansicht nur `Tokenizer`, der Generator
`forward`. SPEC-0003 tauscht nur den `Tokenizer` aus.

Das **Sampling liegt bewusst außerhalb der Engine** (Vision: "Sampling erfolgt im
Client"). `Sampler` ist eine eigene Strategy (`GreedySampler` hier,
Temperatur/Top-k/Top-p in SPEC-0004) mit injizierbarem `Rng`.

**Begründung:** Mock, GPT-2 und Remote sind austauschbar, ohne dass Generator,
Recorder oder UI sie unterscheiden müssen. Gleiche Sampling-Regler in allen
Modi.

**Alternative:** Die Engine sampelt selbst (`generate(prompt) → text`). Abgelehnt,
weil der Zufallsschritt dann nicht sichtbar und nicht steuerbar wäre.

Quelle: https://refactoring.guru/design-patterns/strategy

### 3.4 Template Method (Behavioral): `Generator`-Schleife

**Anwendung:** `generate(engine, sampler, request, deps, signal)` legt die feste
Abfolge fest: Anfrage validieren → `run-start` → `tokenize` → Schritt 0
`forward(prompt)` → `sample` → Token anhängen → `forward(neue Position)` … bis
`maxTokens` oder EOS. Die `tokenize`- und die `sample`-Station erzeugt der
**Generator** (aus `engine.tokenizer` bzw. `sampler`), `forward` liefert den
Rest und endet mit `logits`. Pro Lauf erzeugt `deps.createRng(request.seed)` einen
frischen Zufallsgenerator. Event-Payloads und Fehlerarten legt CON-0002 fest. Die Engines
füllen nur die variablen Teile (`tokenizer`, `forward`). Die
Schleife ist als Funktion mit Strategy-Parametern umgesetzt, nicht als
Basisklasse, aber der Ablauf ist dieselbe feste Schablone.

**Nur der Generator berechnet `newPositions`** (Schritt 0: `[0, promptLen)`,
Schritt n: `[promptLen+n-1, promptLen+n)`) und gibt sie im Event `step-start`
mit. Der Recorder übernimmt den Wert, statt ihn selbst zu berechnen
(Single Responsibility).

**Begründung:** Die autoregressive Schleife ist der Kern dessen, was erklärt
werden soll. Sie existiert genau einmal und ist für alle Engines gleich.

Quelle: https://refactoring.guru/design-patterns/template-method

### 3.5 Iterator + Builder: Events und `TraceRecorder`

**Anwendung:** Der Generator ist ein pull-basierter Iterator
(`AsyncIterable<TraceEvent>`) mit fester Reihenfolge:
`run-start (step-start station+ step-end)* (step-start station*)? (done | error)`.
Ein unvollständiger letzter Schritt (Abbruch, Fehler) erscheint nicht im Trace. Der Konsument bestimmt das
Tempo (Backpressure bei großen Tensoren), das Ende des Iterators markiert
eindeutig `done` oder `error`, und `return()` bzw. `AbortSignal` räumen
deterministisch auf. Der `TraceRecorder` ist ein Builder: `record(events)`
konsumiert die Events, **reicht jedes unverändert weiter**
(`AsyncIterable<TraceEvent>` hinaus, z. B. für einen Fortschrittsbalken) und
liefert über `build()` einen mit `Object.freeze` eingefrorenen `Trace`. Ein
AsyncIterable hat genau einen Konsumenten. Weitere Konsumenten hängen sich
hinter den Recorder.

**Begründung:** Reihenfolge, Abbruch und Fehler lassen sich als Contract prüfen.
Aufzeichnen und Erzeugen bleiben getrennt.

**Alternative:** EventEmitter/Observer mit Callbacks. Abgelehnt: keine
Backpressure, Abschluss- und Fehlersemantik müssten separat definiert werden.
Ein Multi-Subscriber-Broadcast für einen späteren Live-Modus kann dünn darüber
gelegt werden.

Quellen: https://refactoring.guru/design-patterns/iterator ·
https://refactoring.guru/design-patterns/builder

### 3.6 Chain of Responsibility (Behavioral): Trace-Import

**Anwendung:** `deserializeTrace` ist eine Kette von Gliedern mit einheitlicher
Signatur `(input) → Result<next, TraceImportError>`: **JSON parsen → Version
prüfen → Schema (ajv) → Semantik** (Tensor-Länge = Produkt(shape),
`distribution` renormiert, Stationsreihenfolge) **→ Tensoren dekodieren**. Die
Versionsprüfung steht vor dem Schema, damit bei `schemaVersion: 2` die Meldung
"Trace-Version 2 wird nicht unterstützt" kommt statt eines ajv-Fehlers. Umgesetzt
als Array von Funktionen, ohne Klassen. Spätere Glieder (float16, Migration) werden
angehängt.

**Alternative:** eine monolithische `validateTrace`. Abgelehnt, weil sie Fehlerklassen
vermischt und gezielte Tests je Glied erschwert.

Quelle: https://refactoring.guru/design-patterns/chain-of-responsibility

### 3.7 Factory Method (Creational): `createEngine`

**Anwendung:** Konkrete Engines werden ausschließlich in
`src/app/engine-factory.ts` erzeugt: `createEngine(kind, deps)`. `deps` enthält
`rng`, `idProvider` und `clock`, die auch der Recorder bekommt. SPEC-0005/0006
registrieren dort nur neue Erzeuger. Views bekommen nie eine Engine-Klasse zu
sehen (Schichtregel FR-09).

**Alternative:** Singleton für die aktive Engine. Abgelehnt: globaler Zustand
widerspricht dem Determinismus-Ziel und erschwert Tests mit verschiedenen Seeds.

Quelle: https://refactoring.guru/design-patterns/factory-method

### 3.8 Adapter (Structural): Ausblick auf SPEC-0005

Der Remote-Adapter übersetzt die HTTP/Logprob-API in den
`InferenceEngine`-Vertrag. Für Engines mit eingeschränkten Fähigkeiten legt der
Behavior-Contract fest: `forward` liefert nur Stationen aus `info.capabilities`,
die letzte ist immer `logits`, `Candidate.logit` darf `null` sein, `coverage`
darf `< 1` oder `null` sein. Die Mock-Engine bekommt eine Option
`capabilities`, mit der Tests diese Einschränkung simulieren.

Quelle: https://refactoring.guru/design-patterns/adapter

### 3.9 Mock-Engine

Deterministische Engine mit Pseudo-Gewichten aus einem `weightSeed` (Default
1234). Sie ist ein echter Mini-Transformer: `nLayers=2`, `nHeads=2`, `dModel=8`,
`dMlp=32`, `contextLength=64`. Ihr festes deutsches Vokabular hat 52 Tokens
(`<unk>`, `<eos>`, 48 Wörter, `.` und `,`). Vokabular, Tokenizer und
`decode`-Regel stehen verbindlich in CON-0002. Die Daten sind dadurch
**strukturell korrekt**:
Attention-Zeilen sind kausal maskiert und summieren sich zu 1, `residual.stream`
ist `vorheriger Stream + out`, Wahrscheinlichkeiten summieren sich zu 1
(`coverage: 1`). Standardmäßig meldet die Mock-Engine alle Fähigkeiten und ist damit die Referenz für Ansichten und
Tests. Über die Option `capabilities` lässt sich eine eingeschränkte Engine
simulieren (3.8). Die Option `eosAt` (Schrittindex) gibt `<eos>` in diesem Schritt
die höchste Wahrscheinlichkeit. Ohne die Option bekommt `<eos>` nie die höchste
Wahrscheinlichkeit, Greedy-Läufe erreichen also immer `maxTokens`.

### 3.10 Modul-Layout (verbindlich, Tests importieren genau diese Pfade)

| Modul | Exporte |
|---|---|
| `src/trace/types.ts` | `Trace`, `GenerationStep`, `Station`, `StationKind`, `LogitsStation`, `SampleStation`, `Tensor`, `Token`, `Candidate`, `EngineInfo`, `SamplingParams`, `TraceEvent` |
| `src/trace/schema.ts` | `validateTrace(json: unknown): { ok: true } \| { ok: false; errors: ImportIssue[] }` (nur Schema), `traceSchema` |
| `src/trace/invariants.ts` | `checkInvariants(serialized: unknown): ImportIssue[]` (INV-01 bis INV-13, INV-15 auf dem serialisierten Objekt) |
| `src/trace/serialize.ts` | `serializeTrace(trace): string`, `deserializeTrace(json: string): Trace`, `TraceImportError`, `ImportIssue` (`{ path; message; invariant? }`) |
| `src/trace/recorder.ts` | `TraceRecorder` (`new TraceRecorder({ idProvider, clock })`, `record(events): AsyncIterable<TraceEvent>`, `build(): Trace`) |
| `src/trace/trace.schema.json` | Kopie des CON-0001-Artifacts |
| `src/engine/types.ts` | `Tokenizer`, `Loadable`, `InferenceEngine`, `Sampler`, `Rng` (`next(): number` in [0, 1)), `LoadProgress`, `GenerateRequest`, `GenerateDeps` |
| `src/engine/rng.ts` | `createRng(seed: number): Rng` (mulberry32) |
| `src/engine/generate.ts` | `generate(engine, sampler, request, deps, signal?)`, `GenerateError` (`kind`) |
| `src/engine/samplers/greedy.ts` | `GreedySampler` |
| `src/engine/mock/mock-engine.ts` | `MockEngine` (`new MockEngine({ weightSeed?, capabilities?, eosAt? })`), `MOCK_VOCAB` |
| `src/app/engine-factory.ts` | `createEngine(kind, deps, options?)`, `UnknownEngineError` |
| `src/app/texts.ts` | `texts` (alle UI-Texte und Fehlermeldungen) |

Der Alias `@/` zeigt auf `src/` (Vite, Vitest und tsconfig).

### 3.11 Festlegungen aus den test-first geschriebenen Tests

Die Tests TST-0001 bis TST-0004 setzen zusätzlich voraus:

- **Klassen und Aufrufe:** `MockEngine`, `GreedySampler` und `TraceRecorder` sind Klassen. `new GreedySampler()` braucht keine Argumente, `GreedySampler.strategy === 'greedy'`. `load()` lässt sich ohne Argumente aufrufen und liefert ein Promise (bei der Mock-Engine ein No-op). `generate` ruft `load` nicht selbst auf. `tokenizer.eosTokenId` ist ein schlichtes Feld. `createEngine` liefert die Engine synchron.
- **Event-Objekte:** `done` ist exakt `{ type, finishReason }`, `error` exakt `{ type, message }`, `trace.error` exakt `{ message }`. `TraceImportError.message === errors[0].message`.
- **Pfade:** Semantik-Fehler zeigen auf Feldebene (z. B. `/steps/0/stations/2/weights`). Schema-Fehler nutzen den Ajv-`instancePath` (bei `required` das Elternobjekt), und die Meldung nennt den Feldnamen. `oneOf`-Rauschen anderer Stationszweige wird anhand von `kind` gefiltert.
- **Tensoren:** Im deserialisierten bzw. aufgezeichneten Trace ist ein Tensor `{ shape: number[], dtype, data: Float32Array }`, row-major. Base64 läuft über `atob`/`btoa`, kein `@types/node` im Produktivcode.
- **Abbruch:** Das `AbortSignal` wird vor jeder Station und vor jedem Schritt geprüft.
- **UI-DOM:**
  - Je Schritt ein `listitem` mit genau einer `h2` "Schritt n" und einer verschachtelten Stationsliste. Der `innerText` der Stationszeile ist exakt die Zeile aus CON-0003.
  - `<section aria-label="Erzeugter Text">`. Höchstens ein `role="alert"`, und nur solange ein Fehler angezeigt wird.
  - "Max. Tokens" ist `input type=number` und wird beim `blur` begrenzt.
  - Der Export läuft als echter Download über `<a download>`. Nach `reload` ist die App leer.
- **Werkzeuge:**
  - `eslint-plugin-import-x` mit `eslint-import-resolver-typescript`, ohne typbasiertes Linting.
  - `tests/fixtures/**` ist von ESLint, Prettier, tsconfig und Vitest ausgeschlossen. JSON-Importe laufen über `resolveJsonModule`, Vite/Vitest erlauben den Zugriff auf `.sdd/contracts/`.
  - Playwright: `testDir tests/e2e`, Port 4173 via `vite preview --strictPort --host 127.0.0.1`, nur Chromium.

## 4. Funktionale Anforderungen

- **FR-01:** Das Repository enthält ein Vite-Projekt mit React 18 und TypeScript (`strict: true`) sowie die npm-Skripte `dev`, `build` (`tsc --noEmit && vite build`), `test` (Vitest, einmaliger Lauf), `test:e2e` (Playwright), `lint` (ESLint) und `format` (Prettier).
- **FR-02:** `src/trace/types.ts` definiert `Trace`, `GenerationStep`, `Station` (diskriminierte Union über `kind`), `Tensor`, `Token`, `Candidate`, `EngineInfo`, `SamplingParams` (offen erweiterbar) und `TraceEvent` gemäß 3.2 und 3.5.
- **FR-03:** `src/trace/trace.schema.json` beschreibt das serialisierte Trace-Format (JSON Schema 2020-12, `schemaVersion: 1`, zusätzliche optionale Felder erlaubt außer in `Tensor`, `Token` und `Candidate`). Die Datei ist eine inhaltsgleiche Kopie des Contract-Artifacts `.sdd/contracts/data/trace-serialization-format-v1.schema.json` (CON-0001, ein Test prüft die Gleichheit). `validateTrace(json)` liefert entweder den Erfolg oder eine Liste lesbarer Fehler mit JSON-Pfad.
- **FR-04:** `serializeTrace(trace): string` und `deserializeTrace(json): Trace` speichern Tensordaten als Base64 little-endian float32. `deserializeTrace` ist die Kette aus 3.6 und lehnt ungültige Eingaben mit einem typisierten `TraceImportError` (`kind`: `parse` | `version` | `schema` | `semantic`, Pfad, Meldung) ab. Ein Round-Trip ist verlustfrei.
- **FR-05:** `src/engine/types.ts` definiert `Tokenizer`, `Loadable`, `InferenceEngine`, `Sampler`, `Rng`, `LoadProgress`, `GenerateRequest` und `GenerateDeps` gemäß 3.3 und CON-0002. `src/engine/rng.ts` liefert `createRng(seed)` (mulberry32). `GreedySampler` wählt aus `logits.distribution` das wahrscheinlichste Token (bei Gleichstand die niedrigste ID) und setzt `random: null`.
- **FR-06:** `generate` implementiert die Schleife aus 3.4 als `AsyncIterable<TraceEvent>` (`generate(engine, sampler, request, deps, signal?)`) mit der Event-Reihenfolge aus 3.5 und berechnet als einzige Stelle `newPositions` (im `step-start`-Event). Endet ein `forward` nicht mit einer `logits`-Station oder liefert es eine Station außerhalb von `info.capabilities`, ist das ein Engine-Fehler. Die Schleife endet bei `maxTokens`, bei einem EOS-Token (`finishReason: 'eos'`), bei Abbruch über das `AbortSignal` (`'aborted'`, der bis dahin aufgezeichnete Trace bleibt gültig) oder bei einem Engine-Fehler (Event `error` mit Meldung, `finishReason: 'error'`). Ungültige Anfragen lehnen den ersten `next()` mit `GenerateError` ab (`empty-prompt`, `invalid-max-tokens`, `context-too-long`).
- **FR-07:** `TraceRecorder` (mit `idProvider` und `clock`) reicht alle Events unverändert weiter und baut daraus einen tief eingefrorenen `Trace`. `newPositions` übernimmt er aus `step-start`. `build()` vor dem abschließenden Event wirft einen Fehler.
- **FR-08:** `MockEngine` erfüllt 3.9 und die Tabelle MockEngine in CON-0002 (Optionen `weightSeed`, `capabilities`, `eosAt`). Bei gleichem Prompt, Sampling-Seed, `weightSeed` und `maxTokens` ist `serializeTrace` bytegleich (bis auf `id` und `createdAt`, die injizierbar sind). Die Option `capabilities` schränkt die gelieferten Stationen ein.
- **FR-09:** Die ESLint-Konfiguration verbietet per `no-restricted-imports` React in `src/engine/**` und `src/trace/**`, Imports aus `src/engine/**` in `src/views/**`, Imports konkreter Engines (`src/engine/mock/**` usw.) außerhalb von `src/app/engine-factory.ts` sowie `Math.random` in `src/engine/**` und `src/trace/**`. Ein Test prüft das an absichtlich verbotenen Fixture-Dateien.
- **FR-10:** Die App zeigt einen Header "Token Theater" und einen **Trace-Inspector**: Prompt-Eingabe, Feld für `maxTokens` (1–32, Default 8), Knopf "Erzeugen" (Mock-Engine, Greedy), danach den erzeugten Text sowie je Schritt die Stationen mit `kind`, `layer` und Tensor-Shapes (Darstellung und Bedienelemente gemäß CON-0003). Ein Knopf "Trace exportieren" lädt die JSON-Datei herunter. Ein Datei-Import lädt einen Trace und zeigt ihn an, ungültige Dateien führen zu einer verständlichen Fehlermeldung aus `texts.ts` (Tabelle in CON-0003).
- **FR-11:** UI-Texte liegen in einem zentralen Modul `src/app/texts.ts` (Deutsch). ESLint `react/jsx-no-literals` verbietet Textliterale in JSX unter `src/app/**` und `src/views/**`.
- **FR-12:** Engines werden nur über `createEngine(kind, deps, options?)` in `src/app/engine-factory.ts` erzeugt (3.7). `createRng`, `idProvider` und `clock` werden dort injiziert. Unbekannte `kind` führen zu `UnknownEngineError`.

## 5. User Stories

| ID    | Als ...                  | möchte ich ...                                           | um ...                                                    |
|-------|--------------------------|----------------------------------------------------------|-----------------------------------------------------------|
| US-01 | Entwickler (Agent/Boris) | eine Mock-Engine mit strukturell korrekten Daten         | Ansichten ohne Gewichte und ohne Server zu bauen          |
| US-02 | Entwickler               | ein Schema, gegen das jeder Trace validiert              | neue Engines sicher anzubinden                            |
| US-03 | Vortragende/r            | einen Trace exportieren und später wieder importieren    | eine Vorführung offline und reproduzierbar abzuspielen    |
| US-04 | Lernende/r               | sehen, welche Stationen ein Schritt durchläuft           | den Ablauf eines LLM-Durchlaufs grob nachzuvollziehen     |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung                                                                 |
|-----------------|-----------------------------------------------------------------------------|
| Performance     | Mock-Trace mit 8 Schritten wird in < 200 ms erzeugt (Vitest, Node)           |
| Wartbarkeit     | `tsc --noEmit` strict ohne Fehler; kein `any` in `src/trace` und `src/engine` |
| Determinismus   | Kein `Math.random()` in `src/engine` und `src/trace` (ESLint-Regel)          |
| Accessibility   | Inspector per Tastatur bedienbar, Formularfelder mit Labels                 |
| Datenschutz     | Keine Netzwerkzugriffe in dieser Spec                                       |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: Trace-Fundament

  Scenario: Mock-Trace erzeugen und ansehen
    Given die App ist geöffnet
    When ich "die katze sitzt" eingebe, maxTokens 4 setze und "Erzeugen" klicke
    Then sehe ich 4 Schritte
    And Schritt 0 enthält die Stationen tokenize, embed, attention, residual, mlp, residual, attention, residual, mlp, residual, logits, sample
    And der Trace validiert gegen trace.schema.json

  Scenario: Determinismus
    Given die Mock-Engine mit Seed 42
    When ich denselben Prompt zweimal mit maxTokens 8 erzeuge
    Then sind beide serialisierten Traces bytegleich (bei injizierter id und createdAt)

  Scenario: Export und Import
    Given ein erzeugter Mock-Trace
    When ich ihn exportiere und die Datei wieder importiere
    Then zeigt der Inspector denselben Text und dieselben Stationen

  Scenario: Ungültiger Import
    When ich eine JSON-Datei ohne "schemaVersion" importiere
    Then sehe ich "Die Datei enthält keine Trace-Version (schemaVersion)."
    And der vorher angezeigte Trace bleibt erhalten

  Scenario: Abbruch
    Given eine Generierung mit maxTokens 32 läuft
    When das AbortSignal ausgelöst wird
    Then endet der Trace mit finishReason "aborted"
    And alle bis dahin abgeschlossenen Schritte sind enthalten und schema-gültig
```

Die vollständigen, verbindlichen Szenarien stehen in CON-0002 und CON-0003.

## 8. Edge Cases & Fehlerfälle

- Leerer Prompt oder nur Leerzeichen: "Erzeugen" ist deaktiviert, `generate` lehnt mit `GenerateError` `empty-prompt` ab.
- Prompt nur aus unbekannten Wörtern: Tokens werden zu `<unk>`, die Generierung läuft trotzdem.
- EOS im ersten Schritt: Trace mit genau einem Schritt, `finishReason: 'eos'`.
- `maxTokens` außerhalb 1–32, nicht ganzzahlig oder leer: Die UI rundet ab, begrenzt und fällt bei leerem Feld auf 8 zurück. `generate` lehnt mit `invalid-max-tokens` ab.
- Tensor mit `data.length ≠ Produkt(shape)`: `validateTrace` meldet einen Fehler (Zusatzprüfung über das Schema hinaus).
- Import einer zukünftigen `schemaVersion` (z. B. 2): klare Meldung "Trace-Version 2 wird nicht unterstützt."
- Prompt + `maxTokens` überschreiten `contextLength`: `GenerateError` `context-too-long`.
- EOS im Schritt `maxTokens − 1`: `finishReason: 'eos'`.
- Engine wirft mitten in `forward`: Event `error`, der Trace enthält die abgeschlossenen Schritte, `finishReason: 'error'`.

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0001 | data (json-schema) | Serialisiertes Trace-Format v1, semantische Invarianten INV-01–13, Import-Fehlerklassen |
| CON-0002 | behavior (gherkin) | `generate`, `TraceRecorder`, `GreedySampler`, `MockEngine`, `createEngine`: Event-Grammatik, KV-Cache-Sicht, Abbruch, Fehler, Determinismus, Engine-Pflichten |
| CON-0003 | behavior (gherkin) | Trace-Inspector-UI: Erzeugen, Anzeige, Export/Import, Fehlermeldungen, Tastatur |
| CON-0004 | behavior (markdown) | Architektur- und Werkzeugregeln R-01–R-07 (Skripte, strict TS, Schichtgrenzen, Determinismus, Textliterale, Schema-Kopie) |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0001 | unit       | Schema, Invarianten INV-01–15, Import-Fehlerklassen, Round-Trip, Schema-Kopie (CON-0001) |
| TST-0002 | contract   | Alle Szenarien aus CON-0002: Generator, Recorder, GreedySampler, MockEngine, Factory, Laufzeit |
| TST-0003 | acceptance | Playwright: alle Szenarien aus CON-0003 (Trace-Inspector) |
| TST-0004 | unit       | Architektur- und Werkzeugregeln R-01–R-08 (CON-0004), Fixture-Paare für ESLint |

## 11. Implementierungsreihenfolge

1. Gerüst: Vite/React/TS, ESLint (inkl. Schichtregeln), Prettier, Vitest, Playwright, npm-Skripte (FR-01, FR-09)
2. Trace-Typen + JSON Schema + `validateTrace` (FR-02, FR-03)
3. Serialisierung mit Base64-Tensoren + Round-Trip-Tests (FR-04)
4. Engine-Typen, RNG, `GreedySampler` (FR-05)
5. `MockEngine` (FR-08)
6. `generate` + `TraceRecorder` inkl. Abbruch und Fehler (FR-06, FR-07)
7. Trace-Inspector-UI, Export/Import, Texte-Modul (FR-10, FR-11)
8. Playwright-Akzeptanztests

## 12. Offene Fragen

- [x] KV-Cache-Sicht: Sollen Folgeschritte im Trace nur die neue Position speichern (kleine Traces, KV-Cache wird erklärbar; Ansichten setzen volle Matrizen zusammen) oder jeden Schritt vollständig neu über den ganzen Kontext (einfachere Ansichten, Traces wachsen quadratisch)? Empfehlung: nur neue Position.
  **Antwort (2026-10-21, Boris):** Nur neue Position. Festgeschrieben in 3.2 und FR-07.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-21 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-21 | 0.2.0   | Boris  | Review: Verteilung in logits-Station (coverage), Tokenizer/Loadable getrennt, newPositions nur im Generator, offene SamplingParams; Patterns Iterator, Chain of Responsibility, Factory Method, Adapter |
| 2026-10-21 | 0.3.0   | Boris  | Contract-Review: eosTokenId, maxTokens, error und text im Trace; run-start-Event und vollständige Grammatik; tokenize/sample vom Generator; createRng pro Lauf; festes Mock-Vokabular (52); GenerateError-Arten |
