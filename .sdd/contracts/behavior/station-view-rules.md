# Rechenregeln der Stationsansichten (CON-0017)

Jede Regel nennt ihren Prüfmechanismus (TST-0018, Vitest, Node). Die Module sind reine Funktionen
ohne DOM. Vektoren sind `ArrayLike<number>`; gerechnet wird in Float64.

## Module und Typen

```ts
// @/views/tensor/tensor-math
export function tensorRow(tensor: Tensor, row: number): Float32Array;
export function l2Norm(values: ArrayLike<number>): number;
export function extent(values: ArrayLike<number>): { min: number; max: number };
export function maxAbs(values: ArrayLike<number>): number;
export function countPositive(values: ArrayLike<number>): number;
export function topActivations(values: ArrayLike<number>, n: number): { index: number; value: number }[];
// @/views/tensor/color-scale
export interface ScaleStop { at: number; color: string }       // color: '#rrggbb'
export function sampleScale(stops: readonly ScaleStop[], t: number): string;
export function divergingPosition(value: number, limit: number): number;
// @/views/tensor/attention-matrix
export interface AttentionMatrix {
  rows: number[];            // absolute Positionen, aufsteigend
  cols: number;              // Spalten 0 … cols − 1
  values: Float32Array;      // rows.length × cols, row-major
  current: [number, number]; // [from, to): Zeilen des aktuellen Schritts als Indizes in rows
}
export function attentionMatrix(step: GenerationStep, earlierSteps: readonly GenerationStep[],
  layer: number, head: number | 'mean', history: boolean): AttentionMatrix | null;
export function topAttended(matrix: AttentionMatrix, rowIndex: number, n: number):
  { position: number; weight: number }[];
// @/views/tensor/residual-trajectory
export interface TrajectoryEntry {
  stationIndex: number;                 // Index in stations
  kind: 'embed' | 'residual';
  layer: number | null;                 // null bei embed
  after: 'attention' | 'mlp' | null;    // null bei embed
  norm: number;
  delta: number | null;                 // null beim ersten Eintrag
}
export function residualTrajectory(stations: readonly Station[], row: number): TrajectoryEntry[];
// @/app/theme/tokens
export const DIVERGING_SCALE: readonly ScaleStop[];
```

## V-01 Zeilen eines Tensors
*Prüfung: `tensorRow` mit Tensoren der Form `[r, c]`.*

`tensorRow(t, i)` liefert die `c` Werte der Zeile `i` (row-major) als **Kopie**
(`Float32Array` der Länge `c`); Änderungen am Ergebnis ändern den Trace nicht. Für `i < 0`, `i ≥ r`, nicht ganzzahliges `i` oder einen Tensor, der nicht zweidimensional
ist: `RangeError`.

## V-02 Statistik eines Vektors
*Prüfung: handgeschriebene Vektoren.*

- `l2Norm` = √(Σ vᵢ²); leerer Vektor: 0.
- `extent` = kleinster und größter Wert; leer: `{ min: 0, max: 0 }`.
- `maxAbs` = größter Betrag; leer: 0.
- `countPositive` = Anzahl der Werte > 0 (0 zählt nicht).
- `topActivations(v, n)` = die `min(n, länge)` größten Werte mit Index, absteigend, bei
  Gleichstand der kleinere Index zuerst. Beispiel: `[1, 3, 3, -2]`, n = 3 →
  `[{1, 3}, {2, 3}, {0, 1}]`; n = 0 → `[]`; n < 0 oder nicht ganzzahlig → `RangeError`.

## V-03 Farbskala
*Prüfung: `sampleScale` mit eigenen Stopps und mit `DATA_SCALE` (CON-0007 T-01) und
`DIVERGING_SCALE` (V-05).*

- Vorausgesetzt (nicht geprüft): Stopps nach `at` aufsteigend, Farben als `#rrggbb` in
  Kleinbuchstaben. Leere Stopps: `RangeError`. `t` wird auf [0, 1] begrenzt, `NaN` gilt als 0.
- Haben mehrere Stopps dasselbe `at`, gilt für `t` genau an dieser Stelle der letzte von ihnen
  (eine harte Kante, keine Division durch 0).
- `t ≤ stops[0].at` → Farbe des ersten Stopps; `t ≥ letzter at` → Farbe des letzten.
- Dazwischen: lineare Interpolation je Kanal (R, G, B) zwischen den beiden Nachbarstopps,
  gerundet mit `Math.round`. Ergebnis immer `#rrggbb` in Kleinbuchstaben.
- Beispiel: Stopps `#000000` (0) und `#ff8000` (1), `t = 0.5` → `#804000`.

## V-04 Divergierende Position
*Prüfung: Zahlenbeispiele.*

`divergingPosition(value, limit)` = `0.5 + value / (2 · limit)`, begrenzt auf [0, 1]; bei
`limit ≤ 0` genau 0,5. Beispiele: (1, 2) → 0,75; (−2, 2) → 0; (5, 2) → 1; (3, 0) → 0,5.

## V-05 Divergierende Skala im Theme
*Prüfung: `DIVERGING_SCALE` aus `@/app/theme/tokens`.*

`DIVERGING_SCALE` ist `[{ at: 0, color: COLORS.violet }, { at: 0.5, color: COLORS['surface-2'] },
{ at: 1, color: COLORS.mint }]`. Damit ist `sampleScale(DIVERGING_SCALE, 0.5)` gleich
`COLORS['surface-2']`.

## V-06 Attention-Matrix
*Prüfung: handgebaute Schritte (Mock-Form) und ein Lauf der MockEngine.*

Sei `S` die attention-Station von `step` mit `layer`, `weights` der Form `[H, e, b]` und
`[a, b) = step.newPositions`. Für jede beteiligte Station gilt `e = b − a` (bei früheren
Schritten mit ihren eigenen `newPositions`); sonst `RangeError`. Zeile `r` einer Station gehört
zur Position `a + r`.
- Gibt es `S` nicht: `null`. Ist `head` weder `'mean'` noch eine ganze Zahl in `0 … H − 1`:
  `RangeError`.
- `cols = b`. Wert eines Feldes aus einer Station mit Gewichten `w` (Form `[H, e', b']`) für die
  Zeile `r` dieser Station und Spalte `j`: `w[head, r, j]` bzw. das arithmetische Mittel über alle
  Köpfe; für `j ≥ b'` gilt 0.
- `history = false`: `rows = [a, …, b − 1]`, `current = [0, e]`.
- `history = true`: zuerst die Zeilen der früheren Schritte (in `earlierSteps`-Reihenfolge, je
  Schritt seine attention-Station desselben Layers, seine Positionen `newPositions`), nur
  Positionen `< a` und jede Position höchstens einmal (das erste Vorkommen in
  `earlierSteps`-Reihenfolge gilt); dann die Zeilen von `S`. `rows` ist
  aufsteigend, `current = [rows.length − e, rows.length]`. Schritte ohne passende Station tragen
  nichts bei.
- Kausal: Für `j > rows[r]` ist der Wert 0 (maskiertes Feld).

## V-07 Am stärksten beachtete Positionen
*Prüfung: Matrix aus V-06.*

`topAttended(m, r, n)` betrachtet die Spalten `0 … rows[r]` der Zeile `r` und liefert die
`min(n, rows[r] + 1)` größten Werte als `{ position: j, weight }`, absteigend, bei Gleichstand die
kleinere Position zuerst. `r` außerhalb von `0 … rows.length − 1`, `n` < 0 oder nicht ganzzahlig:
`RangeError`; `n = 0` → `[]`.

## V-08 Verlauf des Residual Stream
*Prüfung: handgebaute Stationen und ein Lauf der MockEngine.*

`residualTrajectory(stations, row)` liefert in Stationsreihenfolge einen Eintrag für die
embed-Station (Vektor: Zeile `row` von `sum`) und für jede residual-Station (Zeile `row` von
`stream`); andere Stationen fehlen. `norm` ist die L2-Norm des Vektors, `delta` die L2-Norm der
Differenz zum Vektor des vorigen Eintrags (beim ersten Eintrag `null`). Hat eine beteiligte Station
die Zeile nicht: `RangeError`. Ohne embed- und residual-Stationen: `[]`. Den aktuellen Eintrag
bestimmt die Ansicht über `stationIndex` (Index der gezeigten Station im Schritt).
