# Logit-Lens-Regeln (CON-0016)

Jede Regel nennt ihren Prüfmechanismus (TST-0017, Vitest, Node). Grundlage sind das Testmodell aus
CON-0014 (`tests/fixtures/gpt2/tiny-gpt2.safetensors`, `tiny-gpt2.config.json`) und
`tests/fixtures/gpt2/tiny-gpt2.lens.json` mit Referenzwerten aus Hugging Face `transformers`
5.20.2 / torch 2.14.1. Je Fall (`prompt`, `ids`, `next` = erstes Greedy-Token):
- `lens[l]`: für Schritt 0 (Kontext `ids`) je Layer `l` die Top 5 von
  `softmax(lm_head(ln_f(block_out_l)))` an der letzten Position, als `ids` und `probs`
  (Softmax über das ganze Vokabular, nicht renormiert);
- `lensNext[l]`: dasselbe für den Kontext `ids + [next]` (Folgeschritt).

Toleranz für Wahrscheinlichkeiten: 1e-5 absolut. IDs müssen exakt stimmen.

## Module und Typen

```ts
// @/trace/types
export const MAX_LENS_TOP_N = 20;
export interface ResidualStation {
  kind: 'residual'; layer: number; after: 'attention' | 'mlp'; stream: Tensor;
  /** Logit-Lens der letzten Position; absteigend nach prob, nicht renormiert (CON-0001 INV-17). */
  lens?: Candidate[];
}
// @/engine/lens
export interface LensEntry { id: number; logit: number; prob: number }
export function lensCandidates(logits: ArrayLike<number>, length: number, topN: number): LensEntry[];
// @/engine/gpt2/model
export class Gpt2Model {
  constructor(config: Gpt2Config, weights: Gpt2Weights, options?: { topN?: number; lensTopN?: number });
}
// @/engine/mock/mock-engine
export interface MockEngineOptions { weightSeed?: number; capabilities?: StationKind[]; eosAt?: number;
  lensTopN?: number }
```

## L-01 Auswahl aus den Logits
*Prüfung: `lensCandidates` mit handgeschriebenen Vektoren.*

`lensCandidates(logits, length, topN)` betrachtet `logits[0 … length − 1]`; `length` größer als
`logits.length` ist ein `RangeError`:
- `prob[i] = exp(logits[i] − max) / Σ_j exp(logits[j] − max)` in Float64 über **alle** `length`
  Werte.
- Ergebnis: die `min(topN, length)` Einträge mit den größten Logits, absteigend; bei Gleichstand
  die kleinere ID zuerst. `logit` ist der Eingabewert, `prob` wie oben (nicht auf die Auswahl
  renormiert).
- `topN = 0` ergibt `[]`.

Beispiel: `lensCandidates([0, 2, 2, 1], 4, 3)` ergibt die IDs `[1, 2, 3]` mit
`prob ≈ [0.3995, 0.3995, 0.1470]` (≤ 1e-4; die Summe 0.9459 bleibt unter 1).

## L-02 Lens im GPT-2-Modell
*Prüfung: `Gpt2Model` mit dem Testmodell gegen `tiny-gpt2.lens.json`.*

- Jede residual-Station mit `after: 'mlp'` trägt `lens` mit `min(lensTopN, vocabSize)` Einträgen
  (Default `lensTopN` 5; beide Testvokabulare haben mehr als 20 Tokens) für die letzte Position
  des Aufrufs (`b − 1`): IDs exakt wie die Referenz, `prob` ≤ 1e-5.
- residual-Stationen mit `after: 'attention'` haben **kein** Feld `lens` (`'lens' in station`
  ist `false`).
- Schritt 0: `forward(ids, [0, n])` vergleicht mit `lens`; Folgeschritt: danach
  `forward([...ids, next], [n, n + 1])` (mit KV-Cache) vergleicht mit `lensNext`.
- `Gpt2Model` setzt `token.text` der Lens wie bei logits auf `''`.

## L-03 Wertebereich von `lensTopN`
*Prüfung: Konstruktoren von `Gpt2Model` und `MockEngine`.*

- Erlaubt sind ganze Zahlen von 0 bis `MAX_LENS_TOP_N` (= 20). Andere Werte (−1, 21, 2.5,
  `NaN`) lösen im Konstruktor einen `RangeError` aus.
- `lensTopN: 0`: Keine Station hat das Feld `lens`.
- `lensTopN: 20`: Jede Lens hat 20 Einträge, und der Trace erfüllt INV-17.

## L-04 Lens des letzten Layers = logits
*Prüfung: `Gpt2Model` (beide Fälle) und `MockEngine` (Prompt „die katze sitzt“, 3 Tokens).*

Für die residual-Station `after: 'mlp'` des letzten Layers und die logits-Station desselben
Schritts gilt: `lens[0].token.id = distribution[0].token.id` und
`|lens[0].prob − distribution[0].prob · coverage| ≤ 1e-6`. Dabei ist `coverage` das Feld der
logits-Station (CON-0001): die Wahrscheinlichkeitsmasse der gelieferten Kandidaten vor der
Renormierung. Die GPT-2-Engine liefert die Top-100 (`coverage` < 1, CON-0014), die MockEngine das
ganze Vokabular (`coverage` = 1). Beide logits-Stationen sortieren wie L-01 (absteigend,
Gleichstand kleinere ID zuerst), sodass auch ein exakter Gleichstand an der Spitze dasselbe
Top-Token ergibt.

## L-05 Token-Texte
*Prüfung: `Gpt2Engine` mit dem Worker-Handler (wie CON-0014 G-07) und `MockEngine`.*

- `Gpt2Engine`: `token.text` jedes Lens-Kandidaten ist `tokenizer.decode([{ id, text: '' }])`
  (`Tokenizer.decode` nimmt Tokens, CON-0002), genau wie bei den logits-Kandidaten.
- `MockEngine`: `token.text` ist `MOCK_VOCAB[id]`.

## L-06 MockEngine
*Prüfung: `MockEngine` mit `generate` (CON-0002).*

- Mit Default-Optionen trägt jede residual-Station `after: 'mlp'` eine Lens mit 5 Einträgen, die
  Stationen `after: 'attention'` keine.
- Die Lens rechnet die MockEngine mit derselben Logit-Funktion wie ihre logits-Station (finales
  LayerNorm, Unembedding-Matrix und die `<eos>`-Regel aus CON-0002) und `lensCandidates`, an der
  letzten Position des Aufrufs. So gilt L-04 auch im Schritt `eosAt`.
- Ohne `residual` in `capabilities` gibt es keine Lens.
- Zwei Läufe mit gleichen Eingaben ergeben gleiche Lens (Determinismus, CON-0002).

## L-07 Trace-Format
*Prüfung: Schema-Dateien, `serializeTrace`/`deserializeTrace`, semantische Prüfung.*

- `src/trace/trace.schema.json` ist inhaltsgleich (gleiches JSON nach dem Parsen) mit
  `.sdd/contracts/data/trace-serialization-format-v1.schema.json`; beide beschreiben `lens` als
  optionales Array von `$defs/Candidate` mit 1 bis 20 Einträgen.
- Ein Trace mit Lens übersteht Export und Import unverändert (`lens` tief gleich).
- Die semantische Prüfung meldet `invariant: 'INV-17'` mit `path`-Präfix
  `/steps/<s>/stations/<i>/lens` für: doppelte ID, steigende `prob`, Summe > 1 + 1e-6 und, wenn `engine.architecture` gesetzt ist, ID ≥ `vocabSize` (die Traces beider
  Engines haben eine Architektur). Leere Lens, mehr als 20 Einträge und `prob` außerhalb
  von [0, 1] (Schema von `$defs/Candidate`) sind Schemafehler (`kind: 'schema'`).
- Ein gültiger Trace ohne `lens` bleibt gültig.
