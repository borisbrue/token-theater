# GPT-2-Engine-Regeln (CON-0014)

Jede Regel nennt ihren Prüfmechanismus (TST-0015, Vitest, Node). Grundlage ist das Testmodell
unter `tests/fixtures/gpt2/` (`tiny-gpt2.safetensors`: 2 Layer, 2 Heads, D = 8, M = 32,
V = 50257, C = 64, zufällige Gewichte, Seed 20261022) und `tiny-gpt2.golden.json` mit
Referenzwerten aus Hugging Face `transformers` 5.20.2 / torch 2.14.1 (eager-Attention, per Hooks
aufgezeichnet) für die Prompts „Die Katze sitzt“ (IDs `32423, 8595, 2736, 1650, 89, 83`) und
„Hello world, this is“. Je Fall: `embed` (`[n, D]`), je Layer `lnIn_attn`, `qkv` (`[n, 3D]`),
`attn_out`, `lnIn_mlp`, `hidden` (`[n, M]`), `mlp_out`, `block_out`; `attentions[l]` (`[H, n, n]`);
`top_ids`/`top_logits`/`top_probs` (Top-100 der letzten Position, `probs` = Softmax über V),
`coverage100`; `greedy` (5 Tokens, `generate`, `do_sample=False`); `next_ids`/`next_logits`
(Top-10 nach Anhängen von `greedy[0]`).

Toleranzen: Aktivierungen 1e-4, Attention-Gewichte 1e-5, Logits 1e-3, Wahrscheinlichkeiten 1e-5
(absolut).

## Module und Typen

```ts
// @/engine/gpt2/safetensors
export interface SafeTensor { dtype: string; shape: number[]; data: Float32Array | null } // null: dtype nicht unterstützt
export function parseSafetensors(buffer: ArrayBuffer): Map<string, SafeTensor>;
// @/engine/gpt2/config
export interface Gpt2Config { nLayers: number; nHeads: number; dModel: number; dMlp: number;
  vocabSize: number; contextLength: number; layerNormEpsilon: number }
export function parseGpt2Config(json: unknown): Gpt2Config;
// @/engine/gpt2/weights
export function mapGpt2Weights(tensors: Map<string, SafeTensor>, config: Gpt2Config): Gpt2Weights;
// @/engine/gpt2/model
export class Gpt2Model {
  constructor(config: Gpt2Config, weights: Gpt2Weights, options?: { topN?: number });   // topN Default 100
  forward(context: readonly number[], positions: [number, number]): Station[];         // ohne logits-Texte
}
// @/engine/gpt2/errors
export class Gpt2LoadError extends Error { readonly kind: 'network' | 'format' | 'crash' } // name 'Gpt2LoadError'
// @/engine/gpt2/protocol
export type WorkerCommand =
  | { type: 'init'; config: unknown; weights: ArrayBuffer; topN: number }
  | { type: 'forward'; requestId: number; context: number[]; positions: [number, number] };
export type WorkerResponse =
  | { type: 'ready'; architecture: Architecture; kernel: KernelName } // KernelName aus @/engine/gpt2/kernel (CON-0019)
  | { type: 'init-error'; message: string }
  | { type: 'stations'; requestId: number; stations: Station[] }
  | { type: 'forward-error'; requestId: number; message: string };
// @/engine/gpt2/worker-handler
export function createGpt2WorkerHandler(
  post: (response: WorkerResponse, transfer?: Transferable[]) => void,
): (command: WorkerCommand) => void;
// @/engine/gpt2/gpt2-engine
export interface WorkerLike {
  postMessage(command: WorkerCommand, transfer?: Transferable[]): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}
export interface Gpt2EngineDeps {
  tokenizer: Tokenizer;                          // mit explain (GPT-2-BPE)
  createWorker(): WorkerLike;
  loadWeights(signal?: AbortSignal): Promise<{ config: unknown; weights: ArrayBuffer }>;
}
export class Gpt2Engine implements InferenceEngine {
  constructor(options: { model: string; topN?: number; maxPromptTokens?: number }, deps: Gpt2EngineDeps);
}
```

## G-01 safetensors
*Prüfung: Fixtures und konstruierte Puffer.*

- `tiny-gpt2.safetensors` ergibt 28 Tensoren, alle `F32`, z. B. `wte.weight` `[50257, 8]`,
  `wpe.weight` `[64, 8]`, `h.0.attn.c_attn.weight` `[8, 24]`, `h.1.mlp.c_fc.weight` `[8, 32]`;
  `__metadata__` ist kein Tensor.
- `f16-sample.safetensors` (`wpe.weight[:4]` und `ln_f.bias` als `F16`) ergibt `Float32Array`s,
  die von den F32-Werten des Testmodells höchstens um `|x| · 2⁻¹⁰ + 1e-7` abweichen.
- `BF16` wird umgerechnet (konstruierter Puffer: `0x3F80` → 1, `0xC000` → −2).
- Andere dtypes (z. B. `I64`) ergeben `data: null`.
- `Gpt2LoadError('format')` bei: Puffer < 8 Byte; Header-Länge über das Pufferende; Header kein
  JSON-Objekt; `data_offsets` außerhalb der Daten oder rückwärts; Byte-Länge ≠ Produkt(shape) ·
  dtype-Größe (für F32/F16/BF16).

## G-02 Konfiguration
*Prüfung: `parseGpt2Config`.*

`tiny-gpt2.config.json` → `{ nLayers: 2, nHeads: 2, dModel: 8, dMlp: 32, vocabSize: 50257,
contextLength: 64, layerNormEpsilon: 1e-5 }`. `n_inner: 16` → `dMlp: 16`; fehlendes
`layer_norm_epsilon` → 1e-5. `Gpt2LoadError('format')` bei fehlenden/nicht positiven Ganzzahlen,
`n_embd % n_head ≠ 0` und `activation_function` außer `gelu_new`/`gelu`.

## G-03 Gewichte
*Prüfung: `mapGpt2Weights`.*

Das Testmodell lässt sich abbilden; dieselben Tensoren mit Präfix `transformer.` ebenfalls (mit
gleichem Ergebnis). Zusätzliche Tensoren `h.0.attn.bias` (auch mit nicht unterstütztem dtype),
`h.0.attn.masked_bias` und `lm_head.weight` stören nicht. `Gpt2LoadError('format')` mit dem
Tensornamen in der Meldung, wenn ein benötigter Tensor fehlt (z. B. `h.1.ln_2.bias`), eine Form
nicht passt (z. B. `wpe.weight` `[63, 8]`) oder ein benötigter Tensor `data: null` hat.

## G-04 Rechnung gegen die Referenz
*Prüfung: `Gpt2Model.forward(ids, [0, n])` je Referenzfall.*

- Stationen in der Reihenfolge `embed, (attention, residual, mlp, residual) × L, logits`
  (CON-0001 INV-05 ohne tokenize/sample), Layer-Werte `0..L−1`, residual `after` abwechselnd
  `attention`/`mlp`.
- `embed.token` = Zeilen `ids` von `wte`, `embed.position` = Zeilen `0..n−1` von `wpe` (exakt),
  `embed.sum` ≈ `embed` der Referenz.
- Je Layer l: `attention.lnIn` ≈ `lnIn_attn`; `q`, `k`, `v` ≈ erstes, zweites, drittes Drittel von
  `qkv` (je `[n, D]`); `weights` ≈ `attentions[l]` (`[H, n, n]`, CON-0001 INV-09 erfüllt); `out` ≈
  `attn_out`; erstes `residual.stream` ≈ Eingangsstrom + `attn_out` (Eingang: `embed` bzw. voriges
  `block_out`); `mlp.lnIn` ≈ `lnIn_mlp`; `mlp.hidden` ≈ `hidden`; `mlp.out` ≈ `mlp_out`; zweites
  `residual.stream` ≈ `block_out`.
- `logits`: `distribution` hat 100 Einträge mit den IDs `top_ids` in dieser Reihenfolge, `logit`
  ≈ `top_logits`, `prob` ≈ `top_probs[i] / coverage100`, `coverage` ≈ `coverage100`,
  `vocabSize = 50257`; Token-Texte sind leer (die Engine füllt sie, G-07).

## G-05 KV-Cache
*Prüfung: Folge von `forward`-Aufrufen auf derselben Instanz.*

- Nach `forward(ids, [0, n])` ergibt `forward([...ids, greedy[0]], [n, n + 1])` Stationen mit den
  Formen `[1, D]` (bzw. `[1, M]`) und `weights` `[H, 1, n + 1]` (INV-09), und die ersten 10 Einträge
  der logits-Verteilung haben die IDs `next_ids` mit `logit` ≈ `next_logits`.
- Ein danach folgender `forward` mit einem anderen Kontext (`ids` des zweiten Falls, `[0, n₂]`)
  liefert die Referenzwerte des zweiten Falls (der Cache wird verworfen).
- `forward(ids, [0, n])` zweimal hintereinander liefert gleiche Stationen.

## G-06 Worker-Protokoll
*Prüfung: `createGpt2WorkerHandler` mit aufgezeichneten Antworten.*

- `init` mit Testmodell → genau eine Antwort `ready` mit `architecture = { nLayers: 2, nHeads: 2,
  dModel: 8, dMlp: 32, vocabSize: 50257, contextLength: 64 }` und `kernel: 'wasm-simd'` (Node hat
  WebAssembly SIMD; seit v0.2.0, SPEC-0008).
- `init` mit kaputtem Puffer → `init-error` mit einer Meldung, die mit `Die Gewichtsdatei ist
  ungültig: ` beginnt.
- `forward` vor `init` → `forward-error` mit derselben `requestId`.
- `forward` nach `init` → `stations` mit derselben `requestId`, Stationen wie G-04.

## G-07 Engine (Proxy)
*Prüfung: `Gpt2Engine` mit einem In-Process-Worker (Handler aus G-06, Nachrichten per
`structuredClone`, asynchron zugestellt), `loadWeights` liefert die Fixtures, `tokenizer` ist der
GPT-2-Tokenizer aus SPEC-0003.*

- Nach `load()`: `info = { kind: 'gpt2', model: <options.model>, capabilities: alle sieben in
  der Reihenfolge von STATION_KINDS, architecture: wie G-06, eosTokenId: 50256 }`;
  `tokenizer` ist der übergebene.
- Ein Greedy-Lauf (Generator, Prompt „Die Katze sitzt“, `maxTokens` 5) wählt die Tokens
  `greedy`; der Trace erfüllt Schema und alle Invarianten (einschließlich INV-16, die
  tokenize-Station hat `bpe`); die Kandidaten-Texte sind `tokenizer.decode([{ id, text: '' }])`.
- `loadWeights` wirft → `load()` wirft denselben Fehler; `init-error` → `load()` wirft
  `Gpt2LoadError('format')` mit der Meldung des Workers.
- Abbruch: Ein vor `load()` abgebrochenes Signal führt zu einem `AbortError`; ein während eines
  Schritts abgebrochenes Signal beendet den Lauf mit `aborted`.
- `onerror` des Workers → laufende und künftige Aufrufe scheitern mit
  `Gpt2LoadError('crash')` „Der GPT-2-Worker ist abgestürzt.“; über den Generator endet der Lauf
  mit dieser Meldung.
- Prompt mit mehr als `maxPromptTokens` Tokens (Test: `maxPromptTokens: 4`, Prompt mit 6 Tokens)
  → Lauf endet mit `error` „Der Prompt hat 6 Tokens; die GPT-2-Engine erlaubt höchstens 4.“
- `dispose()` ruft `terminate()` des Workers auf.

## G-08 Factory und Schichtregel
*Prüfung: `createEngine`, ESLint-Node-API.*

- `createEngine('gpt2', deps)` ohne `options.gpt2` wirft einen `Error`.
- Wert-Import aus `'../engine/gpt2/gpt2-engine'` in `src/app/x.ts` →
  `import-x/no-restricted-paths`; in `src/app/engine-factory.ts` keine Meldung dieser Regel;
  `src/engine/x.ts` mit Import aus `'./gpt2/model'` → `import-x/no-restricted-paths`.
- `src/engine/gpt2/**` erfüllt CON-0004 R-02 bis R-04 (`any`, Wert-Import aus `trace`,
  `Math.random` werden gemeldet).

## G-09 Performance
*Prüfung: Zeitmessung (Node).*

`forward` des Testmodells über 6 Tokens dauert nach einem Aufwärmlauf < 50 ms.
