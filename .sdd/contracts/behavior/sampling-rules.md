# Sampling-Regeln (CON-0010)

Jede Regel nennt ihren Prüfmechanismus (TST-0011, Vitest, Node). Zahlen gelten mit ±1e-6.
„Basis“ sind drei Kandidaten `A = {id 0, "a", logit 2}`, `B = {id 1, "b", logit 1}`,
`C = {id 2, "c", logit 0}` mit `prob` = softmax der Logits (0.665241, 0.244728, 0.090031).
„Remote“ sind drei Kandidaten ohne Logits: `prob` 0.5 / 0.3 / 0.2 (ids 0, 1, 2), `logit: null`.

## Modul und Typen

```ts
// @/sampling/transform – rein, verändert keine Eingabe, liefert neue Objekte
export interface SamplingSettings { temperature: number; topK: number; topP: number }
export const DEFAULT_SETTINGS: SamplingSettings;          // { temperature: 1, topK: 0, topP: 1 }
export const TEMPERATURE_MIN = 0.1, TEMPERATURE_MAX = 2, TOP_K_MAX = 100;
export function validateSettings(settings: SamplingSettings): void;            // RangeError
export function scores(distribution: readonly Candidate[]): number[];
export function applyTemperature(distribution: readonly Candidate[], temperature: number): Candidate[];
export function applyTopK(distribution: readonly Candidate[], topK: number): Candidate[];
export function applyTopP(distribution: readonly Candidate[], topP: number): Candidate[];
export function renormalize(distribution: readonly Candidate[]): Candidate[];
export function transformDistribution(distribution: readonly Candidate[], settings: SamplingSettings): Candidate[];
export function drawIndex(distribution: readonly Candidate[], random: number): number;
// @/engine/samplers/stochastic
export class StochasticSampler implements Sampler {
  constructor(settings: SamplingSettings);                // validiert
  readonly strategy: 'sample';
  readonly params: { temperature: number; topK: number; topP: number };
  sample(logits: LogitsStation, rng: Rng): SampleStation;
}
// @/engine/types – Sampler bekommt das optionale Feld
readonly params?: Readonly<Record<string, number | string | boolean>>;
```

## S-01 Scores
*Prüfung: Basis, Remote, gemischt.*

`scores(Basis) = [2, 1, 0]`. Hat mindestens ein Kandidat `logit: null`, sind alle Scores
`ln(prob)`: `scores(Remote) = [ln 0.5, ln 0.3, ln 0.2]`. `prob = 0` ergibt `-Infinity`.

## S-02 Temperatur
*Prüfung: Referenzvektoren.*

`applyTemperature` liefert `softmax(scores / T)`, absteigend nach `prob`, bei Gleichstand
aufsteigend nach `token.id`; `token` und `logit` bleiben die der Eingabe.

| Eingabe | T | Ergebnis (`prob` in Reihenfolge) |
|---|---|---|
| Basis | 1 | 0.665241, 0.244728, 0.090031 |
| Basis | 0.5 | 0.866813, 0.117310, 0.015876 |
| Basis | 2 | 0.506480, 0.307196, 0.186324 |
| Remote | 1 | 0.5, 0.3, 0.2 |
| Remote | 0.5 | 0.657895, 0.236842, 0.105263 |

Gleichstand: zwei Kandidaten mit gleichem Logit, IDs 7 und 3 in dieser Reihenfolge → Ergebnis
beginnt mit ID 3.

## S-03 Top-k und Top-p
*Prüfung: einzelne Glieder.*

- `applyTopK(d, 0)` gibt alle zurück; `applyTopK(d, k)` die ersten `min(k, n)`, ohne zu
  renormieren.
- `applyTopP(d, p)` berechnet die kumulierte Summe auf `renormalize(d)` und gibt das kürzeste
  Präfix mit Summe `≥ p − 1e-9` zurück (mindestens 1 Kandidat), ohne zu renormieren; `p = 1`
  gibt alle zurück.
- `renormalize` teilt alle `prob` durch ihre Summe.

## S-04 Umformung
*Prüfung: `transformDistribution` mit Referenzvektoren.*

`transformDistribution(d, s) = renormalize(applyTopP(applyTopK(applyTemperature(d, T), k), p))`.

| Eingabe | T | k | p | Ergebnis-IDs | Ergebnis `prob` |
|---|---|---|---|---|---|
| Basis | 1 | 0 | 1 | 0, 1, 2 | 0.665241, 0.244728, 0.090031 |
| Basis | 1 | 2 | 1 | 0, 1 | 0.731059, 0.268941 |
| Basis | 1 | 0 | 0.7 | 0, 1 | 0.731059, 0.268941 |
| Basis | 1 | 0 | 0.6 | 0 | 1 |
| Basis | 2 | 2 | 0.6 | 0 | 1 |
| Basis | 2 | 2 | 0.65 | 0, 1 | 0.622459, 0.377541 |
| Basis | 1 | 5 | 1 | 0, 1, 2 | 0.665241, 0.244728, 0.090031 |
| Remote | 0.5 | 0 | 1 | 0, 1, 2 | 0.657895, 0.236842, 0.105263 |

Jedes Ergebnis erfüllt CON-0001 INV-10 (absteigend, eindeutige IDs, Summe 1 ± 1e-6). Eine leere
Verteilung führt zu einem `Error`.

## S-05 Wurf
*Prüfung: `drawIndex`.*

`drawIndex(d, r)` ist der erste Index `i`, für den die kumulierte Summe `prob_0 + … + prob_i > r`
ist; gibt es keinen (Rundung), der letzte Index. Mit `d = [0.731059, 0.268941]`:
`r = 0 → 0`, `0.5 → 0`, `0.731 → 0`, `0.7311 → 1`, `0.99999 → 1`. Mit `d = [0.5, 0.4999999]`
und `r = 0.9999999 → 1`.

## S-06 Reinheit
*Prüfung: tiefe Kopie vor und nach jedem Aufruf vergleichen.*

Keine Funktion aus S-01 bis S-05 verändert ihre Eingabe; Ergebnisse sind neue Arrays mit neuen
Kandidaten-Objekten.

## S-07 Einstellungen
*Prüfung: `validateSettings` und Konstanten.*

`DEFAULT_SETTINGS = { temperature: 1, topK: 0, topP: 1 }` ist gültig. `RangeError` für:
`temperature` 0.05, 2.5, `NaN`, `Infinity`; `topK` −1, 1.5, 101, `NaN`; `topP` 0, −0.1, 1.01,
`NaN`. Gültig sind z. B. `{0.1, 0, 0.05}`, `{2, 100, 1}`.

## S-08 StochasticSampler
*Prüfung: Rng-Attrappe, die vorgegebene Werte liefert und Aufrufe zählt.*

- `strategy = 'sample'`; `params` ist gleich den Einstellungen; der Konstruktor wirft
  `RangeError` bei ungültigen Einstellungen.
- `sample(logits, rng)` ruft `rng.next()` genau einmal auf und liefert
  `{ kind: 'sample', distribution: transformDistribution(logits.distribution, s), random: r,
  chosen: distribution[drawIndex(distribution, r)].token }`.
- Basis, Einstellungen `{1, 0, 1}`: `r = 0.5` → ID 0; `r = 0.9` → ID 1; `r = 0.95` → ID 2.
- Leere Verteilung → `Error`. Die logits-Station bleibt unverändert.

## S-09 Generator und Determinismus
*Prüfung: MockEngine (weightSeed 1234), Prompt „die katze sitzt“, `maxTokens` 4, feste `idProvider`/`clock`.*

- Mit `StochasticSampler({1, 0, 1})` und Seed 7 ist `trace.sampling =
  { strategy: 'sample', seed: 7, params: { temperature: 1, topK: 0, topP: 1 } }`; der Trace
  besteht Schema und Invarianten; jede sample-Station hat `random ∈ [0, 1)`.
- Zwei Läufe mit gleichen Eingaben ergeben bytegleiche `serializeTrace`-Ausgaben.
- Mit `StochasticSampler({1, 1, 1})` (Top-k 1) sind die gewählten Tokens aller Schritte gleich
  denen eines Greedy-Laufs; ebenso mit `{1, 0, 0.05}` (Top-p 0.05).
- Greedy-Traces haben weiterhin `sampling.params = {}` und `random = null`.

## S-10 Schichtregel für `src/sampling/`
*Prüfung: ESLint-Node-API (`lintText` mit virtuellem Pfad, wie CON-0004).*

Unter `src/sampling/**/*.ts` sind verboten (Severity 2):
- Importe aus `src/engine`, `src/app`, `src/views`, `src/playback` (`import-x/no-restricted-paths`),
- `react`, `react-dom`, `react/*` und Wert-Importe aus `src/trace`
  (`@typescript-eslint/no-restricted-imports`; `import type` ist erlaubt),
- Zufall und Zeit wie CON-0004 R-04 (`no-restricted-syntax` oder `no-restricted-properties`),
- `any` (`@typescript-eslint/no-explicit-any`).

Gegenbeispiele ohne Meldung: `src/sampling/x.ts` mit `import type { Candidate } from '../trace/types'`;
`src/views/x.tsx` und `src/engine/x.ts` mit einem Wert-Import aus `../sampling/transform`.

## S-11 Performance
*Prüfung: Zeitmessung in Vitest (Node).*

`transformDistribution` über 50 257 Kandidaten (Logits aus einer festen, einfachen Folge, absteigend
sortiert) mit `{0.7, 0, 0.9}` dauert nach einem Aufwärmlauf < 50 ms.
