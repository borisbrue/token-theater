# Regeln des Rechenkerns (CON-0019)

Jede Regel nennt ihren Prüfmechanismus. K-01 bis K-07 prüft TST-0020
(`tests/unit/compute-kernel.test.ts`), K-08 bis K-10 TST-0021 (`tests/unit/gpt2-kernel.test.ts`),
beide Vitest in Node (WebAssembly SIMD vorhanden). Zufallsmatrizen kommen aus `createRng`
(`@/engine/rng`, fester Seed), Werte gleichverteilt in [−1, 1).

## Module und Typen

```ts
// @/engine/gpt2/kernel
export type KernelName = 'wasm-simd' | 'js';
export interface MatrixKernel {
  readonly name: KernelName;
  affine(x: Float32Array, rows: number, inputs: number,
         w: Float32Array, b: Float32Array, outputs: number): Float32Array;   // [rows, outputs]
  unembed(h: Float32Array, e: Float32Array, n: number, k: number): Float32Array; // [n]
}
export interface KernelSetup { kernel: MatrixKernel; weights: Gpt2Weights }
export function createJsKernel(config: Gpt2Config, weights: Gpt2Weights): KernelSetup;
export function createWasmKernel(config: Gpt2Config, weights: Gpt2Weights): KernelSetup;
export function wasmSimdSupported(): boolean;
export function selectKernel(config: Gpt2Config, weights: Gpt2Weights,
  prefer?: 'auto' | KernelName,                                            // Default 'auto'
  createWasm?: (config: Gpt2Config, weights: Gpt2Weights) => KernelSetup, // Default createWasmKernel
): KernelSetup;
// @/engine/gpt2/kernel-wasm (generiert von scripts/build-kernel.mjs)
export const KERNEL_WASM_BASE64: string;
// @/engine/gpt2/model
new Gpt2Model(config, weights, { topN?, lensTopN?, kernel?: MatrixKernel });
//   ohne kernel: createJsKernel(config, weights).kernel
// @/engine/gpt2/protocol (Ergänzung)
{ type: 'ready'; architecture: Architecture; kernel: KernelName }
// @/engine/gpt2/gpt2-engine (Ergänzung)
Gpt2Engine.kernel: KernelName | null   // null vor load()
```

Schreibweisen: `Σ|xw|` einer affine-Ausgabe `(r, o)` ist `|b[o]| + Σᵢ |x[r, i] · w[i, o]|`, einer
unembed-Ausgabe `t` ist `Σ_c |h[c] · e[t · k + c]|`.

**Synthetisches Modell** (K-01 bis K-03, K-05): Konfiguration `{ nLayers: 1, nHeads: 12, dModel:
768, dMlp: 3072, vocabSize: 100, contextLength: 4, layerNormEpsilon: 1e-5 }`, Gewichte mit der
Struktur aus CON-0014 (`wte` [100, 768], `wpe` [4, 768], `lnF`, ein Layer mit `ln1`, `attn`
[768, 2304], `attnProj` [768, 768], `ln2`, `fc` [768, 3072], `mlpProj` [3072, 768]) und
Zufallswerten. **Testmatrizen** sind Anfangsstücke (`subarray(0, …)`) der `weights` des jeweiligen
`KernelSetup`: `w` aus `layers[0].fc.w`, `b` aus `layers[0].fc.b`, `e` aus `wte`; `x` und `h` sind
eigene Zufallsarrays. **Größen:** `(rows, inputs, outputs)` ∈ {(1, 1, 1), (3, 5, 7), (2, 13, 9),
(4, 8, 24), (1, 768, 2304), (2, 3072, 768)}, `(n, k)` ∈ {(1, 1), (5, 3), (7, 8), (9, 13),
(100, 768)}.

## K-01 JS-Kern
*Prüfung: `createJsKernel` mit dem synthetischen Modell, alle Größen.*

- `name` ist `'js'`; `weights` ist genau das übergebene Objekt.
- `affine` = für jede Zeile `r` und Ausgabe `o`: `b[o] + Σᵢ x[r, i] · w[i, o]`, summiert in
  double in der Reihenfolge `i = 0, 1, …`, Ergebnis als Float32. Das ist bitgleich mit
  `affine` aus `@/engine/gpt2/math`.
- `unembed` = `Math.fround(Σ_c h[c] · e[t · k + c])`, summiert in double in der Reihenfolge
  `c = 0, 1, …`.
- Ergebnislänge `rows · outputs` bzw. `n`; `rows = 0` bzw. `n = 0` → leeres `Float32Array`.

## K-02 Gemeinsame Vorbedingungen (beide Kerne)
*Prüfung: JS- und WASM-Kern des synthetischen Modells mit denselben Aufrufen; beide verhalten sich
gleich.*

- **Herkunft:** `w`, `b` (affine) bzw. `e` (unembed), die nicht aus den `weights` des eigenen
  `KernelSetup` stammen (Test: ein neues `Float32Array` gleicher Länge; beim WASM-Kern zusätzlich
  ein Tensor aus den `weights` des JS-Setups) → `Error` mit der Meldung „Die Gewichte gehören
  nicht zu diesem Rechenkern.“ Teilstücke per `subarray` sind erlaubt; `x` und `h` dürfen
  beliebige `Float32Array`s sein.
- **Größen:** `RangeError`, wenn eine Größe keine nicht negative ganze Zahl ist oder ein Array zu
  kurz ist (`x.length < rows · inputs`, `w.length < inputs · outputs`, `b.length < outputs`,
  `h.length < k`, `e.length < n · k`). Längere Arrays sind erlaubt (gelesen wird der Anfang).
- **Kapazität:** Eingaben (`rows · inputs` bzw. `k`) bis `contextLength · max(dModel, dMlp)`
  Werte, Ausgaben (`rows · outputs` bzw. `n`) bis `max(contextLength · max(3 · dModel, dMlp),
  vocabSize)` Werte; darüber `RangeError`. Beim synthetischen Modell sind das 12 288 Eingabe- und
  12 288 Ausgabewerte. Test: affine mit `rows = 5`, `inputs = 3072`, `outputs = 1` (15 360
  Eingaben) und unembed mit `n = 12 289`, `k = 1` (12 289 Ausgaben); jeweils mit ausreichend
  langen Arrays, damit nur die Kapazität greift.
- **Frische Ergebnisse:** Das Ergebnis teilt keinen Puffer mit den `weights`; ein zweiter Aufruf
  mit anderen Eingaben ändert das erste Ergebnis nicht.

## K-03 WASM-Kern gegen JS-Kern
*Prüfung: `createWasmKernel` und `createJsKernel` mit dem synthetischen Modell, alle Größen.*

- `name` ist `'wasm-simd'`.
- Für alle Größen: `|wasm − js| ≤ 2⁻¹⁶ · Σ|xw| + 1e-7` je Ausgabewert.
- `rows = 0` bzw. `n = 0` → leeres `Float32Array`.

## K-04 Gewichte im WASM-Speicher
*Prüfung: Testmodell (`tiny-gpt2.*`) über `parseSafetensors`/`mapGpt2Weights`.*

- `createWasmKernel(config, weights).weights` hat dieselbe Struktur (`wte`, `wpe`, `lnF`,
  `layers[l].ln1|attn|attnProj|ln2|fc|mlpProj`) und je Tensor dieselbe Länge und exakt dieselben
  Werte wie `weights`.
- Alle diese `Float32Array`s teilen sich **einen** `ArrayBuffer`, der keiner der Puffer der
  Eingabe ist, und haben einen `byteOffset`, der durch 16 teilbar ist.
- Die Eingabe-`weights` bleiben unverändert.

## K-05 Kein Wachstum
*Prüfung: WASM-Kern des synthetischen Modells.*

Der gemeinsame `ArrayBuffer` der `weights` ist nach allen Aufrufen aus K-02 und K-03 derselbe
(`===`) und hat dieselbe `byteLength`; die Sichten sind weiter lesbar (Länge unverändert).

## K-06 Auswahl
*Prüfung: `selectKernel` und `wasmSimdSupported` mit dem Testmodell.*

- `wasmSimdSupported()` ist in Node `true`.
- `prefer: 'js'` → JS-Kern, `weights` ist genau das übergebene Objekt.
- `prefer: 'wasm-simd'` → WASM-Kern wie K-04; wirft `createWasm`, wirft `selectKernel` denselben
  Fehler.
- `prefer: 'auto'` (und ohne Angabe) → WASM-Kern; wirft `createWasm`, dann JS-Kern mit den
  übergebenen `weights` (kein Fehler).

## K-07 Das Modul
*Prüfung: `KERNEL_WASM_BASE64`, `kernel.wat`, `wabt`.*

- `WebAssembly.validate` der dekodierten Bytes ist `true`.
- `WebAssembly.Module.imports` ist genau `[{ module: 'env', name: 'memory', kind: 'memory' }]`;
  `exports` sind genau `affine` und `unembed` (beide `function`).
- `src/engine/gpt2/kernel.wat` enthält kein `memory.grow`.
- `kernel.wat` mit `wabt` übersetzt (Features `simd` und `bulk_memory`, `toBinary({})`) ergibt
  genau die Bytes aus `KERNEL_WASM_BASE64`.
- `package.json` hat das Skript `build:kernel` = `node scripts/build-kernel.mjs` und `wabt` unter
  `devDependencies`.

## K-08 Modell mit WASM-Kern gegen die Referenz
*Prüfung: `setup = createWasmKernel(config, weights)`, dann
`new Gpt2Model(config, setup.weights, { kernel: setup.kernel })`;
Referenzen und Toleranzen aus CON-0014 (`tiny-gpt2.golden.json`) und CON-0016
(`tiny-gpt2.lens.json`, `lensTopN` 5).*

- G-04 für beide Referenzfälle (alle Stationen, Werte mit den Toleranzen aus CON-0014).
- G-05: Folgeschritt `next_ids`/`next_logits`, Wechsel des Kontexts.
- Logit-Lens je Layer wie CON-0016 (IDs exakt, `prob` ≤ 1e-5) in Schritt 0 und im Folgeschritt.
- Ohne Option `kernel` rechnet das Modell mit dem JS-Kern: Die Stationen sind bitgleich mit
  `{ kernel: createJsKernel(config, weights).kernel }`.
- Falsches Paar: `new Gpt2Model(config, weights, { kernel: setup.kernel })` (Datei-Gewichte mit dem
  WASM-Kern) → `forward` wirft `Error` „Die Gewichte gehören nicht zu diesem Rechenkern.“
- Die Greedy-Folge über 5 Tokens (Generator, `Gpt2Engine` mit In-Process-Worker) ist `greedy`.

## K-09 Worker und Engine
*Prüfung: `createGpt2WorkerHandler`, `Gpt2Engine` mit In-Process-Worker (wie CON-0014 G-07).*

- `init` mit dem Testmodell → `ready` mit `architecture` wie CON-0014 G-06 und
  `kernel: 'wasm-simd'`.
- `Gpt2Engine.kernel` ist vor `load()` `null`, danach `'wasm-simd'`.
- Meldet der Worker `kernel: 'js'`, ist `Gpt2Engine.kernel` nach `load()` `'js'`.

## K-10 Tempo
*Prüfung: Zeitmessung (Node), je Rechnung Median aus 5 Läufen nach einem Aufwärmlauf, beide Kerne
auf denselben Daten.*

- `unembed` mit `n = 50257`, `k = 768`: WASM mindestens 4× schneller als JS.
- `affine` mit `rows = 1`, `inputs = 768`, `outputs = 3072`: WASM mindestens 4× schneller als JS.
- CON-0014 G-09 (Testmodell, 6 Tokens, < 50 ms) gilt auch mit dem WASM-Kern.
