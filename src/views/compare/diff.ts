import type {
  Candidate,
  GenerationStep,
  LogitsStation,
  MoeStation,
  ResidualStation,
  Station,
  Token,
  Trace,
} from '../../trace/types';
import { lacksInternals } from '../station/internals';

/**
 * Kennzahlen des Vergleichs zweier Läufe (SPEC-0012 §3.2, CON-0026 CD-xx). Rein und ohne DOM:
 * alles kommt aus den Traces, nichts wird verändert.
 */

/** Strategy (SPEC-0012 §3.10): eine Kennzahl über zwei gleich lange Eingaben. */
export interface Metric<T> {
  readonly name: string;
  compute(a: T, b: T): number;
}

export const cosine: Metric<ArrayLike<number>> = {
  name: 'cosine',
  compute(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      dot += x * y;
      normA += x * x;
      normB += y * y;
    }
    if (normA === 0 && normB === 0) return 1;
    if (normA === 0 || normB === 0) return 0;
    return dot / Math.sqrt(normA * normB);
  },
};

function normalized(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map((value) => value / total) : values.map(() => 0);
}

/** Jensen-Shannon-Divergenz, Basis 2, nach Normierung je Seite; Terme mit 0 entfallen. */
export const jsDivergence: Metric<readonly number[]> = {
  name: 'js-divergence',
  compute(a, b) {
    const p = normalized(a);
    const q = normalized(b);
    let total = 0;
    p.forEach((pi, i) => {
      const qi = q[i] ?? 0;
      const mi = (pi + qi) / 2;
      if (pi > 0) total += pi * Math.log2(pi / mi);
      if (qi > 0) total += qi * Math.log2(qi / mi);
    });
    return Math.min(1, Math.max(0, total / 2));
  },
};

export type Comparability = 'full' | 'output' | 'none';

function firstLogits(trace: Trace): LogitsStation | undefined {
  for (const step of trace.steps) {
    const logits = step.stations.find((s): s is LogitsStation => s.kind === 'logits');
    if (logits !== undefined) return logits;
  }
  return undefined;
}

function vocabSizeOf(trace: Trace): number | null {
  return trace.engine.architecture?.vocabSize ?? firstLogits(trace)?.vocabSize ?? null;
}

function sameArchitecture(a: Trace, b: Trace): boolean {
  return JSON.stringify(a.engine.architecture) === JSON.stringify(b.engine.architecture);
}

/** Voller Vergleich, nur Ausgabe oder keiner (SPEC-0012 §3.2). */
export function comparability(a: Trace, b: Trace): Comparability {
  const vocabA = vocabSizeOf(a);
  const vocabB = vocabSizeOf(b);
  const sameModel = a.engine.model === b.engine.model;
  if (vocabA !== null && vocabB !== null) {
    if (vocabA !== vocabB) return 'none';
  } else if (!sameModel) {
    return 'none';
  }
  const internals =
    !lacksInternals(a.engine.capabilities) && !lacksInternals(b.engine.capabilities);
  return sameModel && sameArchitecture(a, b) && internals ? 'full' : 'output';
}

export const OUTPUT_TOP_N = 10;

export interface OutputRow {
  token: Token;
  pA: number;
  pB: number;
  /** pB − pA */
  delta: number;
}

export interface OutputDiff {
  rows: OutputRow[];
  js: number;
}

function logitsOf(step: GenerationStep): LogitsStation | undefined {
  return step.stations.find((s): s is LogitsStation => s.kind === 'logits');
}

function topCandidates(distribution: readonly Candidate[]): Candidate[] {
  return [...distribution].sort((x, y) => y.prob - x.prob).slice(0, OUTPUT_TOP_N);
}

/** Vereinigung der Top-10 beider Läufe mit pA, pB, Δ und JS-Divergenz (CD-04). */
export function outputDiff(a: GenerationStep, b: GenerationStep): OutputDiff | null {
  const logitsA = logitsOf(a);
  const logitsB = logitsOf(b);
  if (logitsA === undefined || logitsB === undefined) return null;
  const probA = new Map(logitsA.distribution.map((c) => [c.token.id, c.prob]));
  const probB = new Map(logitsB.distribution.map((c) => [c.token.id, c.prob]));
  const union = new Map<number, Token>();
  for (const candidate of [
    ...topCandidates(logitsA.distribution),
    ...topCandidates(logitsB.distribution),
  ]) {
    if (!union.has(candidate.token.id)) union.set(candidate.token.id, candidate.token);
  }
  const rows = [...union.values()]
    .map((token) => {
      const pA = probA.get(token.id) ?? 0;
      const pB = probB.get(token.id) ?? 0;
      return { token, pA, pB, delta: pB - pA };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.token.id - y.token.id);
  return {
    rows,
    js: jsDivergence.compute(
      rows.map((row) => row.pA),
      rows.map((row) => row.pB),
    ),
  };
}

export interface LayerRow {
  layer: number;
  cosine: number;
  lensA: Token | null;
  lensB: Token | null;
  /** Anteil gemeinsamer Experten der letzten Position; null ohne moe in beiden. */
  expertOverlap: number | null;
}

function feedForwardResiduals(stations: readonly Station[]): Map<number, ResidualStation> {
  const result = new Map<number, ResidualStation>();
  for (const station of stations) {
    if (station.kind === 'residual' && station.after !== 'attention') {
      result.set(station.layer, station);
    }
  }
  return result;
}

function moeStations(stations: readonly Station[]): Map<number, MoeStation> {
  const result = new Map<number, MoeStation>();
  for (const station of stations) if (station.kind === 'moe') result.set(station.layer, station);
  return result;
}

/** Letzte Zeile eines [n, d]-Stroms ohne Kopie. */
function lastRow(station: ResidualStation): Float32Array {
  const { shape, data } = station.stream;
  const n = shape[0] ?? 0;
  const d = shape[1] ?? 0;
  return data.subarray((n - 1) * d, n * d);
}

function overlap(a: MoeStation | undefined, b: MoeStation | undefined): number | null {
  if (a === undefined || b === undefined) return null;
  const rowA = a.experts.at(-1) ?? [];
  const rowB = new Set(b.experts.at(-1) ?? []);
  if (rowA.length === 0) return null;
  return rowA.filter((expert) => rowB.has(expert)).length / rowA.length;
}

/** Je Layer Kosinus der letzten Position, Lens-Top-1 und Experten-Überlappung (CD-05). */
export function layerDiff(a: GenerationStep, b: GenerationStep): LayerRow[] {
  const residualsA = feedForwardResiduals(a.stations);
  const residualsB = feedForwardResiduals(b.stations);
  const moeA = moeStations(a.stations);
  const moeB = moeStations(b.stations);
  return [...residualsA.keys()]
    .filter((layer) => residualsB.has(layer))
    .sort((x, y) => x - y)
    .flatMap((layer) => {
      const stationA = residualsA.get(layer);
      const stationB = residualsB.get(layer);
      if (stationA === undefined || stationB === undefined) return [];
      return [
        {
          layer,
          cosine: cosine.compute(lastRow(stationA), lastRow(stationB)),
          lensA: stationA.lens?.[0]?.token ?? null,
          lensB: stationB.lens?.[0]?.token ?? null,
          expertOverlap: overlap(moeA.get(layer), moeB.get(layer)),
        },
      ];
    });
}

const DROP_EPSILON = 1e-6;

/** Layer mit dem größten Abfall des Kosinus gegenüber der Zeile davor (Start 1), sonst null. */
export function largestDrop(rows: readonly LayerRow[]): number | null {
  let best: number | null = null;
  let bestDrop = DROP_EPSILON;
  let previous = 1;
  for (const row of rows) {
    const drop = previous - row.cosine;
    if (drop > bestDrop) {
      bestDrop = drop;
      best = row.layer;
    }
    previous = row.cosine;
  }
  return best;
}
