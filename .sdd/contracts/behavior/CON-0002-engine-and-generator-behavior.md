---
id: CON-0002
project: ""                # PRJ-XXXX
title: "Engine and generator behavior"
type: behavior
format: gherkin
spec: SPEC-0001
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/engine-and-generator-behavior.feature"
tests: ["TST-0002"]
---

# Contract: Engine and generator behavior

> **Spec:** SPEC-0001 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt das beobachtbare Verhalten von `generate`, `TraceRecorder`,
`GreedySampler`, `MockEngine` und `createEngine` fest: Event-Grammatik und
Payloads, KV-Cache-Sicht, Abbruch, Fehler, Determinismus und die Mindestpflichten
jeder `InferenceEngine`. Neue Engines (SPEC-0005, SPEC-0006) müssen INV-01 und
INV-02 erfüllen. Das Format der Traces regelt CON-0001.

## Garantien

Die im Artifact (`.sdd/contracts/behavior/engine-and-generator-behavior.feature`)
hinterlegten Szenarien sind **ausführbare Spezifikation**. Jedes Szenario ist
durch einen Vitest-Test abgedeckt, Testname = Szenariotitel wörtlich. Beim
Szenariogrundriss heißt jeder Test `"<Titel> (wert=<wert>)"`.

## Event-Modell

```ts
type TraceEvent =
  | { type: 'run-start'; engine: EngineInfo; prompt: string; maxTokens: number; sampling: SamplingParams }
  | { type: 'step-start'; index: number; contextTokens: Token[]; newPositions: [number, number] }
  | { type: 'station'; index: number; station: Station }
  | { type: 'step-end'; index: number; chosen: Token; text: string } // text = tokenizer.decode([...contextTokens, chosen])
  | { type: 'done'; finishReason: 'max-tokens' | 'eos' | 'aborted' }
  | { type: 'error'; message: string };

function generate(engine: InferenceEngine, sampler: Sampler, request: GenerateRequest,
                  deps: GenerateDeps, signal?: AbortSignal): AsyncIterable<TraceEvent>;
interface GenerateRequest { prompt: string; maxTokens: number; seed: number }
interface GenerateDeps { createRng(seed: number): Rng }
interface RecorderDeps { idProvider(): string; clock(): string /* ISO-8601 */ }
```

`generate` erzeugt pro Lauf mit `deps.createRng(request.seed)` einen frischen
Zufallsgenerator. Die `tokenize`-Station (Schritt 0, falls die Fähigkeit
vorhanden ist) und die `sample`-Station jedes Schritts erzeugt **der Generator**
aus `engine.tokenizer` bzw. `sampler`. `forward` liefert alle übrigen
Stationen und endet mit `logits`.

## Invarianten (über alle Szenarien hinweg)

- **INV-01 Engine-Pflichten:** `forward` liefert nur Stationen aus
  `info.capabilities \ {tokenize, sample}`, in der Reihenfolge aus CON-0001 INV-05,
  und die letzte ist immer `logits`. Verstöße meldet `generate` als
  `error`-Event. Sie werden nicht still korrigiert.
- **INV-02 Verteilung ohne verdeckten Zustand:** Der Sampler bekommt die
  Verteilung ausschließlich aus der `logits`-Station. `distribution` ist
  renormiert, `coverage` gibt die Masse vor der Renormierung an (`1`, `< 1` oder
  `null`).
- **INV-03 Event-Grammatik:**
  `run-start (step-start station+ step-end)* (step-start station*)? (done | error)`.
  Ein unvollständiger letzter Schritt ist nur vor `done(aborted)` oder `error`
  möglich und erscheint nicht im Trace. Genau ein abschließendes Event, danach
  endet der Iterator. Ausnahmen: (a) Verlässt der Konsument die Iteration
  (`break`/`return()`), endet der Generator ohne abschließendes Event und ruft
  kein weiteres `forward` auf. (b) Ungültige Anfragen siehe INV-07.
- **INV-04 Einzige Quelle für newPositions:** Nur `generate` berechnet
  `newPositions` und gibt sie in `step-start` mit. Der Recorder übernimmt sie.
- **INV-05 Determinismus:** Bei gleichem Prompt, Sampling-Seed, `maxTokens`,
  `weightSeed`, `idProvider` und `clock` und frisch erzeugten Objekten ist
  `serializeTrace` bytegleich. In `src/engine` und `src/trace` werden Zufall, Zeit
  und IDs nur über die injizierten Abhängigkeiten bezogen (durchgesetzt über
  CON-0004 R-04).
- **INV-06 Unveränderlichkeit:** Der von `build()` gelieferte Trace ist tief
  eingefroren (`Float32Array`-Inhalte ausgenommen, weil typisierte Arrays sich
  nicht einfrieren lassen; sie werden nie geteilt). Events reicht der Recorder
  als dieselben Objekte weiter, ohne sie zu verändern.
- **INV-07 Validierung vor dem ersten Event:** Ungültige Anfragen lehnen den ersten
  `next()`-Aufruf mit einem `GenerateError` ab, ohne dass ein Event ausgegeben
  wird. `kind`: `empty-prompt` (Prompt nach `trim()` leer), `invalid-max-tokens`
  (keine Ganzzahl in 1–32), `context-too-long`
  (`promptTokens + maxTokens − 1 > contextLength`, nur wenn `architecture ≠ null`).
- **INV-08 Ende:** Ist das gewählte Token gleich `tokenizer.eosTokenId`, endet der
  Lauf nach diesem Schritt mit `eos`, auch im Schritt `maxTokens − 1`. Sonst endet
  er nach `maxTokens` Schritten mit `max-tokens`.

## MockEngine

| Eigenschaft | Wert |
|---|---|
| `info.kind` / `info.model` | `"mock"` / `"mock-de-52"` |
| Architektur | `nLayers 2`, `nHeads 2`, `dModel 8`, `dMlp 32`, `vocabSize 52`, `contextLength 64` |
| Vokabular (id: text) | `0 <unk>`, `1 <eos>`, `2 die`, `3 der`, `4 das`, `5 ein`, `6 eine`, `7 katze`, `8 hund`, `9 maus`, `10 vogel`, `11 kind`, `12 sonne`, `13 mond`, `14 baum`, `15 haus`, `16 garten`, `17 tisch`, `18 sitzt`, `19 schläft`, `20 läuft`, `21 springt`, `22 frisst`, `23 sieht`, `24 hört`, `25 mag`, `26 sucht`, `27 findet`, `28 auf`, `29 unter`, `30 neben`, `31 im`, `32 am`, `33 dem`, `34 den`, `35 und`, `36 aber`, `37 dann`, `38 nicht`, `39 gern`, `40 leise`, `41 schnell`, `42 heute`, `43 morgen`, `44 klein`, `45 groß`, `46 rot`, `47 grün`, `48 alt`, `49 jung`, `50 .`, `51 ,` |
| Tokenizer | Kleinschreibung, Trennung an Leerraum, `.` und `,` als eigene Tokens, unbekannte Wörter → `<unk>`. `eosTokenId = 1` |
| `decode` | Tokentexte mit einem Leerzeichen verbunden, kein Leerzeichen vor `.` und `,`. `<eos>` wird nicht ausgegeben |
| Optionen | `weightSeed` (Default 1234): erzeugt die Pseudo-Gewichte. `capabilities` (Default: alle sieben): bei Einschränkung ohne `embed/attention/mlp/residual` ist `architecture = null`. `eosAt` (Schrittindex): `<eos>` bekommt dort die höchste Wahrscheinlichkeit. Ohne `eosAt` bekommt `<eos>` nie die höchste Wahrscheinlichkeit |
| Rechnung | echter Mini-Transformer mit Pseudo-Gewichten: LayerNorm, kausale Softmax-Attention, MLP mit GELU, Residual, finales LayerNorm, Unembedding, Softmax über alle 52 Tokens (`coverage = 1`) |

`createEngine(kind, deps, options?)` kennt in SPEC-0001 nur `"mock"`. Für
unbekannte `kind` wirft es einen `UnknownEngineError`.

## Begriffe

| Begriff        | Definition |
|----------------|------------|
| Schritt        | Ein Forward-Pass plus Sampling, erzeugt genau ein Token |
| Station        | Ein benannter Zwischenschritt innerhalb eines Schritts (`kind`) |
| Fähigkeiten    | `info.capabilities`, die Menge der Stationsarten, die ein Trace dieser Engine enthält |
| KV-Cache-Sicht | Schritt 0 rechnet alle Prompt-Positionen, jeder Folgeschritt nur die neue Position |
| Test-Engine    | Ein Test-Double, das `InferenceEngine` implementiert und gezielt Fehlverhalten zeigt |
| Sampling-Seed  | `request.seed`, landet in `trace.sampling.seed`, initialisiert den Rng des Laufs |
| `weightSeed`   | Seed der Pseudo-Gewichte der MockEngine, entspricht dem "Modell" |
