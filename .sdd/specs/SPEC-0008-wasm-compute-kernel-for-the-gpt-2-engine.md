---
id: SPEC-0008
title: "WASM compute kernel for the GPT-2 engine"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-22
updated: 2026-10-22
version: 0.2.1
priority: high          # low | medium | high | critical
tags: [engine, gpt2, performance, webassembly, simd]
depends_on: ["SPEC-0006", "SPEC-0007"]
contracts: ["CON-0014", "CON-0019"]
tests: ["TST-0015", "TST-0020", "TST-0021"]
fr_test_map:
  FR-01: [TST-0020]
  FR-02: [TST-0020]
  FR-03: [TST-0020]
  FR-04: [TST-0020]
  FR-05: [TST-0021]
  FR-06: [TST-0021, TST-0015]
---

# WASM compute kernel for the GPT-2 engine

> **Status:** implemented · **Owner:** Boris · **Version:** 0.2.1
> Anlass: SPEC-0007 §12 (Kosten der Logit-Lens), Entscheidung von Boris am 2026-10-22:
> „schnellere Rechnung mit WebAssembly“.

## 1. Kontext & Motivation

Die GPT-2-Engine (SPEC-0006) rechnet alles in reinem TypeScript. Mit der Logit-Lens aus SPEC-0007
braucht distilgpt2 je erzeugtem Token ≈ 2,2 s statt 0,65 s, weil jede Lens einmal über das ganze
Vokabular projiziert (50 257 × 768 Multiplikationen, ≈ 0,3 s in JavaScript). Für einen Vortrag ist
das zu langsam: 8 Tokens dauern fast 20 s.

Die Zeit steckt fast vollständig in zwei Rechenarten:
- **Affine Schichten** (`y = x · W + b`): q/k/v, Attention-Projektion, MLP-Eingang und -Ausgang.
- **Vokabular-Projektion** (`ln_f(x) · wteᵀ`): logits-Station und Logit-Lens.

Ein Prototyp (2026-10-22, Node 24, 593 Byte WebAssembly mit SIMD) rechnet beide ≈ 9× schneller
als der jetzige Code:

| Rechnung | JavaScript | WASM SIMD |
|---|---|---|
| Projektion 50 257 × 768 | 301 ms | 32 ms |
| affine 1 × 768 → 3072 | 18,5 ms | 2,2 ms |
| affine 8 × 768 → 3072 | 146 ms | 16,5 ms |

Die frühere Annahme (SPEC-0007 §6), die Projektion sei durch die Speicherbandbreite begrenzt, war
falsch: 154 MB in 0,3 s sind ≈ 0,5 GB/s, weit unter dem, was der Speicher liefert.

## 2. Zielsetzung

**Primärziel:** Ein austauschbarer Rechenkern für die GPT-2-Engine mit einer WebAssembly-SIMD-
Variante; die JavaScript-Rechnung bleibt als Referenz und Rückfallweg.

**Erfolgskriterien (messbar):**
- [ ] Mit dem WASM-Kern erfüllt das Testmodell alle Referenzvergleiche aus CON-0014 (G-04, G-05) und CON-0016 mit den bestehenden Toleranzen; die Greedy-Tokens sind dieselben.
- [ ] WASM- und JS-Kern weichen bei beliebigen Matrixgrößen (auch nicht durch 4 oder 8 teilbar) höchstens um 2⁻¹⁶ · Σ|xᵢ · wᵢ| + 1e-7 voneinander ab.
- [ ] In Node ist der WASM-Kern bei der Projektion 50 257 × 768 und bei affine 1 × 768 → 3072 mindestens 4× schneller als der JS-Kern.
- [ ] distilgpt2 mit Logit-Lens braucht in Chromium ≤ 0,5 s je erzeugtem Token (manuelle Messung, im PR dokumentiert; vorher 2,17 s).
- [ ] Bestehende Contracts bleiben erfüllt (CON-0014 mit einer Ergänzung in G-06).

**Nicht-Ziele:**
- Mehrere Threads (`SharedArrayBuffer`, COOP/COEP-Header), WebGPU.
- Attention-Scores, Softmax, LayerNorm und GELU in WASM: Sie kosten zusammen < 5 % (bei 64
  Tokens) und bleiben in TypeScript.
- Quantisierte Gewichte (int8, float16 im Speicher), Modelle über 4 GB.
- Eine Anzeige des Kerns in der Oberfläche und ein Schalter für die Logit-Lens (SPEC-0009, falls
  nötig).
- Eine Rust- oder C-Toolchain: Der Kern ist handgeschriebenes WebAssembly-Textformat.

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/engine/gpt2/kernel.wat       Quelltext des WASM-Moduls (Textformat, SIMD, Bulk-Memory)
src/engine/gpt2/kernel-wasm.ts   generiert: das Modul als Base64 (npm run build:kernel)
src/engine/gpt2/kernel.ts        MatrixKernel, JS-Kern, WASM-Kern, Auswahl
src/engine/gpt2/model.ts         rechnet affine Schichten und Projektion über den Kern
src/engine/gpt2/worker-handler.ts wählt beim init den Kern und meldet ihn in ready
scripts/build-kernel.mjs         übersetzt kernel.wat mit wabt nach kernel-wasm.ts
```

### 3.2 Der Kern als Strategie

```ts
export type KernelName = 'wasm-simd' | 'js';
/**
 * Vorbedingungen (für alle Kerne gleich, sonst Fehler):
 * - w, b und e stammen aus den weights des KernelSetup, mit dem der Kern entstand
 *   (auch Teilstücke per subarray); sonst Error.
 * - Größen passen in die Kapazität aus der Konfiguration (3.3); sonst RangeError.
 * x und h dürfen beliebige Float32Arrays sein.
 */
export interface MatrixKernel {
  readonly name: KernelName;
  /** y = x · W + b; x [rows, inputs], W [inputs, outputs], b [outputs], row-major; neues Array. */
  affine(x: Float32Array, rows: number, inputs: number,
         w: Float32Array, b: Float32Array, outputs: number): Float32Array;
  /** out[t] = Σ_c h[c] · e[t · k + c] für t < n; e [n, k] row-major; neues Array. */
  unembed(h: Float32Array, e: Float32Array, n: number, k: number): Float32Array;
  // Genauigkeit: JS-Kern bitgleich mit der bisherigen Rechnung, andere Kerne innerhalb der
  // Toleranz aus §6 gegen den JS-Kern.
}
export interface KernelSetup { kernel: MatrixKernel; weights: Gpt2Weights }
export function createJsKernel(config: Gpt2Config, weights: Gpt2Weights): KernelSetup;
export function createWasmKernel(config: Gpt2Config, weights: Gpt2Weights): KernelSetup;
```

Ein Kern gehört immer zu einem Satz Gewichte: Beide Fabriken nehmen `(config, weights)` und geben
`{ kernel, weights }` zurück, und beide prüfen dieselben Vorbedingungen. Damit sind die Kerne
gegeneinander austauschbar (Liskov): Was mit dem JS-Kern gelingt, gelingt mit dem WASM-Kern, und
was einer ablehnt, lehnt auch der andere ab.

`Gpt2Model` bekommt die Gewichte des Setups als Konstruktorargument und den Kern als Option:
`new Gpt2Model(config, setup.weights, { kernel: setup.kernel })`. Passen beide nicht zusammen,
scheitert der erste `forward` an der Herkunftsprüfung (`Error`), statt still langsam oder falsch zu
rechnen. Ohne Option nimmt das Modell `createJsKernel(config, weights).kernel`, damit bestehende
Aufrufer (CON-0014, CON-0016) unverändert bleiben.

Nachbedingung: Bitgleich mit der bisherigen Rechnung ist nur der JS-Kern; jeder andere Kern hält die
Toleranz aus §6 gegen den JS-Kern ein (CON-0019 K-03). Bei exaktem Gleichstand zweier Logits kann
die Greedy-Wahl deshalb je Kern verschieden ausfallen; die Referenzfälle haben keinen solchen
Gleichstand. Der JS-Kern ist die bisherige Rechnung (Summen in double, Ergebnis Float32), der
WASM-Kern rechnet in Float32 mit SIMD. Beide liefern neue Arrays, die nicht in Kernspeicher
zeigen; ein späterer Aufruf ändert kein früheres Ergebnis.
Muster: [Strategy](https://refactoring.guru/design-patterns/strategy), wie im Projektkatalog
(SPEC-0004, SPEC-0007).

### 3.3 Gewichte im WASM-Speicher und Kapazität

WebAssembly rechnet nur auf seinem eigenen linearen Speicher. Die Gewichte ziehen deshalb einmal
beim Laden um:

- `createWasmKernel(config, weights)` legt einen `WebAssembly.Memory` an, kopiert **jeden** Tensor
  (auf 16 Byte ausgerichtet) hinein und gibt `{ kernel, weights }` zurück. Die neuen `weights`
  haben dieselbe Struktur und dieselben Werte, ihre `Float32Array`s sind Sichten in den Speicher.
  Der übrige Code (Embedding-Zeilen, LayerNorm-Parameter) liest sie wie bisher. Alle Tensoren
  ziehen um, nicht nur die Matrizen: Bliebe auch nur `wpe` eine Sicht in den Datei-Puffer, hielte
  sie den ganzen Puffer (bei distilgpt2 ≈ 330 MB) am Leben.
- `createJsKernel(config, weights)` lässt die Gewichte, wo sie sind (`weights` ist dasselbe
  Objekt), und merkt sich ihre `ArrayBuffer` für die Herkunftsprüfung.
- **Kapazität** (für beide Kerne gleich, aus der Konfiguration): Eingaben (`rows · inputs` bzw.
  `k`) bis `contextLength · max(dModel, dMlp)` Werte, Ausgaben (`rows · outputs` bzw. `n`) bis
  `max(contextLength · max(3 · dModel, dMlp), vocabSize)` Werte. Der WASM-Kern legt dafür feste
  Arbeitsbereiche hinter den Gewichten an. Der Speicher wächst danach nie (`memory.grow` würde alle
  Sichten ungültig machen); das Modul enthält kein `memory.grow`.
- Speicherbedarf: Beim Umzug existieren die Gewichte kurz doppelt (Datei-Puffer und WASM-Speicher);
  danach hält der Worker keine Referenz auf den Datei-Puffer mehr. distilgpt2: ≈ 330 MB dauerhaft.
Muster: [Adapter](https://refactoring.guru/design-patterns/adapter): Der WASM-Kern übersetzt
Byte-Adressen und Arbeitsbereiche des Moduls auf `MatrixKernel`; alle Prüfungen stehen in
TypeScript, das WAT bleibt minimal.

### 3.4 Auswahl des Kerns (Factory Method)

`selectKernel(config, weights, prefer = 'auto', createWasm = createWasmKernel)` mit
`prefer: 'auto' | KernelName`:
- `'js'` → `createJsKernel(config, weights)`.
- `'wasm-simd'` → `createWasm(config, weights)`; Fehler werden weitergereicht.
- `'auto'` → WASM, wenn `wasmSimdSupported()` (per `WebAssembly.validate` des Moduls) und
  `createWasm` nicht wirft (z. B. zu wenig Speicher); sonst JS-Kern.

Der Worker ruft beim `init` `selectKernel(..., 'auto')` und meldet den Namen in `ready` als
`kernel`. `Gpt2Engine` macht ihn als `kernel: KernelName | null` lesbar (null vor `load()`).
Ein weiterer Kern (etwa WebGPU) bräuchte einen Namen in `KernelName` und einen Zweig hier; mehr
Erweiterbarkeit wäre bei zwei Kernen Vorratsarchitektur.
Muster: [Factory Method](https://refactoring.guru/design-patterns/factory-method), wie
`createEngine` (SPEC-0001).

### 3.5 Das WASM-Modul

Zwei Exporte, ein Import (`env.memory`), keine weiteren Funktionen:
- `unembed(h, e, out, n, k)` (Byte-Adressen): je Zeile zwei `f32x4`-Akkumulatoren über Blöcke von
  8 Werten, Rest skalar.
- `affine(x, rows, inputs, w, b, outputs, out)`: Ausgabezeile mit `b` vorbelegen
  (`memory.copy`), dann je Eingabe `i` die Zeile `W[i]` mit `x[i]` skaliert addieren, `f32x4` über
  Blöcke von 4 Ausgaben, Rest skalar. Summiert wird wie im JS-Kern in der Reihenfolge von `i`.

Das Modul wird aus `kernel.wat` mit dem npm-Paket `wabt` (devDependency) übersetzt und als
Base64-Konstante in `kernel-wasm.ts` eingecheckt. So braucht weder Vite noch der Worker eine
eigene `.wasm`-Datei, und Node-Tests laden es ohne Bundler. Ein Test übersetzt `kernel.wat`
erneut und vergleicht die Bytes (keine Drift).

### 3.6 Festlegungen für die test-first geschriebenen Tests

- **Module:** `@/engine/gpt2/kernel` (`createJsKernel`, `createWasmKernel`, `selectKernel`,
  `wasmSimdSupported`, Typen), `@/engine/gpt2/kernel-wasm` (`KERNEL_WASM_BASE64`),
  `@/engine/gpt2/model` (Option `kernel`), `@/engine/gpt2/worker-handler`,
  `@/engine/gpt2/gpt2-engine` (`kernel`).
- **Fixtures:** die aus SPEC-0006 und SPEC-0007 (`tiny-gpt2.*`).
- **Zufallsmatrizen** in den Tests aus `createRng` (`@/engine/rng`), Seed fest.

## 4. Funktionale Anforderungen

- **FR-01:** `MatrixKernel`, `KernelSetup` und JS-Kern nach 3.2/3.3; der JS-Kern rechnet bitgleich wie bisher (affine wie `math.affine`, Projektion wie bisher in `Gpt2Model`); gemeinsame Vorbedingungen (Herkunft, Kapazität).
- **FR-02:** WASM-Modul nach 3.5 als `kernel.wat`, übersetzt nach `kernel-wasm.ts` über `npm run build:kernel` (`scripts/build-kernel.mjs`, devDependency `wabt`).
- **FR-03:** `createWasmKernel` nach 3.3: Gewichte im WASM-Speicher, feste Arbeitsbereiche, Prüfung von Herkunft und Größen, Ergebnisse als neue Arrays.
- **FR-04:** `selectKernel` und `wasmSimdSupported` nach 3.4.
- **FR-05:** `Gpt2Model` rechnet alle affinen Schichten und die Vokabular-Projektion (logits und Lens) über die Option `kernel` (`MatrixKernel`, Default JS-Kern zu den übergebenen Gewichten).
- **FR-06:** Worker wählt den Kern beim `init` (`auto`) und meldet ihn in `ready`; `Gpt2Engine.kernel`.

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                                   | um ...                                              |
|-------|----------------|------------------------------------------------------------------|-----------------------------------------------------|
| US-01 | Vortragende/r  | einen Lauf mit distilgpt2 und Logit-Lens in wenigen Sekunden     | ihn live im Vortrag erzeugen zu können              |
| US-02 | Lernende/r     | dieselben Zahlen wie vorher, nur schneller                       | den Ansichten weiter vertrauen zu können            |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung |
|-----------------|-------------|
| Korrektheit     | WASM gegen JS: ≤ 2⁻¹⁶ · Σ|xᵢ · wᵢ| + 1e-7 je Ausgabewert (bei affine einschließlich |b|); gegen `transformers` die Toleranzen aus CON-0014 und CON-0016 |
| Performance     | Node: WASM ≥ 4× schneller als JS (Projektion 50 257 × 768, affine 1 × 768 → 3072; Median aus 5 Läufen nach Aufwärmen); Chromium: distilgpt2 mit Lens ≤ 0,5 s je Token (manuell; gemessen 2026-10-22, „The cat sat on the“, 8 Tokens, Mittel aus 3 Läufen: 0,38 s mit WASM, 2,42 s mit JS-Kern, gleicher Text) |
| Speicher        | Gewichte einmal im WASM-Speicher; kurzzeitig doppelt beim Laden; kein Wachstum danach |
| Kompatibilität  | WebAssembly SIMD (Chrome 91, Firefox 89, Safari 16.4); sonst JS-Kern ohne Fehlermeldung |
| Architektur     | Kern nur in `src/engine/gpt2/` (CON-0004, CON-0014 G-08); kein Wert-Import aus `src/trace` |
| Datenschutz     | keine Anfragen an fremde Origins; das Modul ist Teil des Bundles |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: WASM-Rechenkern

  Scenario: Gleiche Zahlen, schneller
    Given das GPT-2-Testmodell mit dem WASM-Kern
    When ich "Die Katze sitzt" vorwärts rechne
    Then stimmen alle Stationen mit transformers überein (Toleranzen aus CON-0014)

  Scenario: Rückfall ohne SIMD
    Given eine Umgebung, in der der WASM-Kern nicht angelegt werden kann
    When der Worker das Modell lädt
    Then meldet ready den Kern "js" und das Modell rechnet trotzdem
```

Die verbindlichen Regeln stehen im Contract (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Größen, die nicht durch 4 oder 8 teilbar sind (Testmodell: D = 8, Kopfbreite 4): Restschleifen.
- `rows = 0` oder `n = 0`: leeres Ergebnis.
- Eingabe größer als die Kapazität (mehr Zeilen als `contextLength`): `RangeError` bei beiden Kernen.
- Gewichte, die nicht aus dem `KernelSetup` des Kerns stammen: `Error` bei beiden Kernen, keine stille Kopie.
- Zu wenig Speicher für `WebAssembly.Memory` (sehr große Modelle): `auto` nimmt den JS-Kern.

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0019 | behavior (markdown) | Rechenkern: JS-Kern, Größenprüfung, WASM gegen JS, Gewichte im WASM-Speicher, Herkunft und Arbeitsbereiche, Auswahl, Modul, Modell gegen Referenz, Worker/Engine, Tempo |
| CON-0014 | behavior (markdown) | v0.2.0: `ready` meldet den Kern (G-06) |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0020 | unit | CON-0019 K-01 bis K-07 (Kerne, Speicher, Auswahl, Modul) |
| TST-0021 | unit | CON-0019 K-08 bis K-10 (Modell gegen Referenz, Worker/Engine, Tempo) |
| TST-0015 | unit | CON-0014 v0.2.0 (G-06 mit `kernel`) |

## 11. Implementierungsreihenfolge

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | Kern: Interface, JS-Kern, WASM-Modul, Build-Skript, Auswahl | FR-01–FR-04 | `tests/unit/compute-kernel.test.ts` | `src/engine/gpt2/kernel*.ts`, `src/engine/gpt2/kernel.wat`, `scripts/build-kernel.mjs`, `package.json`, `package-lock.json` |
| 2 | Modell, Worker und Engine nutzen den Kern | FR-05–FR-06 | `tests/unit/gpt2-kernel.test.ts` | `src/engine/gpt2/**` |

## 12. Offene Fragen

- [x] Rust/C oder handgeschriebenes WAT? **Antwort (2026-10-22, autonom entschieden):** WAT. Zwei kleine Funktionen (< 600 Byte) rechtfertigen keine zweite Toolchain; `wabt` als npm-Paket reicht und läuft in den Tests mit.
- [x] Summen in Float32 oder Float64? **Antwort (2026-10-22, autonom entschieden):** Float32 wie PyTorch. Gemessen weicht das höchstens um 2·10⁻⁷ · Σ|xᵢ · wᵢ| vom JS-Kern ab; Float64 halbierte den SIMD-Gewinn.
- [x] Kern in der Oberfläche anzeigen? **Antwort (2026-10-22, autonom entschieden):** nicht in dieser Spec; `ready` und `Gpt2Engine.kernel` machen ihn lesbar, eine Anzeige kann SPEC-0009 aufnehmen.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-22 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-22 | 0.2.0   | Boris  | Review (SOLID L, I): beide Kerne aus `(config, weights)` mit gleichen Vorbedingungen (Herkunft, Kapazität); `prefer` nutzt `KernelName`; `Gpt2Model` bekommt `setup.weights` und `setup.kernel` getrennt, ein falsches Paar scheitert an der Herkunft; Genauigkeit als Nachbedingung; alle Tensoren ziehen um (Begründung); Contracts CON-0019, CON-0014 v0.2.0 |
| 2026-10-22 | 0.2.1   | Boris  | Implementiert; Live-Messung in der NFR ergänzt (0,38 s statt 2,42 s je Token) |
