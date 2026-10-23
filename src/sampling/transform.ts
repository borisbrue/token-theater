import type { Candidate } from '../trace/types';

/**
 * Sampling-Mathematik (SPEC-0004 §3.2, CON-0010): feste Kette reiner Glieder
 * Temperatur → Top-k → Top-p → Renormierung und der Wurf. Keine Funktion verändert ihre
 * Eingabe; Zufall kommt nur als Zahl `random` in drawIndex. Sampler (Engine) und
 * Sampling-Labor (View) nutzen dieselbe Rechnung.
 */

export interface SamplingSettings {
  temperature: number;
  /** 0 = aus. */
  topK: number;
  /** 1 = aus. */
  topP: number;
}

export const DEFAULT_SETTINGS: SamplingSettings = Object.freeze({
  temperature: 1,
  topK: 0,
  topP: 1,
});
export const TEMPERATURE_MIN = 0.1;
export const TEMPERATURE_MAX = 2;
export const TOP_K_MAX = 100;

const TOP_P_TOLERANCE = 1e-9;

export function validateSettings(settings: SamplingSettings): void {
  const { temperature, topK, topP } = settings;
  if (
    !Number.isFinite(temperature) ||
    temperature < TEMPERATURE_MIN ||
    temperature > TEMPERATURE_MAX
  ) {
    throw new RangeError(
      `temperature muss in [${TEMPERATURE_MIN}, ${TEMPERATURE_MAX}] liegen, ist ${temperature}`,
    );
  }
  if (!Number.isInteger(topK) || topK < 0 || topK > TOP_K_MAX) {
    throw new RangeError(`topK muss eine Ganzzahl in 0–${TOP_K_MAX} sein, ist ${topK}`);
  }
  if (!Number.isFinite(topP) || topP <= 0 || topP > 1) {
    throw new RangeError(`topP muss in (0, 1] liegen, ist ${topP}`);
  }
}

function copy(candidate: Candidate, prob = candidate.prob): Candidate {
  return {
    token: { id: candidate.token.id, text: candidate.token.text },
    logit: candidate.logit,
    prob,
  };
}

/** Adapter: Logits, wenn alle Kandidaten einen haben, sonst ln(prob) (Remote, Top-N). */
export function scores(distribution: readonly Candidate[]): number[] {
  const useLogits = allLogits(distribution);
  return distribution.map((c) => scoreOf(c, useLogits));
}

function allLogits(distribution: readonly Candidate[]): boolean {
  for (const candidate of distribution) if (candidate.logit === null) return false;
  return true;
}

/** Einzige Stelle der Score-Regel; `useLogits` aus allLogits (gilt für die ganze Verteilung). */
function scoreOf(candidate: Candidate, useLogits: boolean): number {
  return useLogits ? (candidate.logit as number) : Math.log(candidate.prob);
}

/** softmax(scores / T): Wahrscheinlichkeiten je Eingabeindex plus absteigende Reihenfolge. */
interface Tempered {
  /** Unnormierte Gewichte exp(score / T − max) je Eingabeindex. */
  weights: Float64Array;
  total: number;
  /** Eingabeindizes absteigend nach Gewicht (Gleichstand: token.id aufsteigend); null = Eingabefolge. */
  order: number[] | null;
}

function tempered(distribution: readonly Candidate[], temperature: number): Tempered {
  const n = distribution.length;
  const useLogits = allLogits(distribution);
  const weights = new Float64Array(n);
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const scaled = scoreOf(distribution[i] as Candidate, useLogits) / temperature;
    weights[i] = scaled;
    if (scaled > max) max = scaled;
  }
  let total = 0;
  let sorted = true;
  for (let i = 0; i < n; i += 1) {
    const scaled = weights[i] as number;
    const weight = scaled === -Infinity ? 0 : Math.exp(scaled - max);
    weights[i] = weight;
    total += weight;
    if (sorted && i > 0) {
      const previous = weights[i - 1] as number;
      const tieBroken =
        weight === previous &&
        (distribution[i] as Candidate).token.id < (distribution[i - 1] as Candidate).token.id;
      if (weight > previous || tieBroken) sorted = false;
    }
  }
  // Die Eingabe ist meist schon sortiert (INV-10, Temperatur ist monoton): dann kein Sortieren.
  if (sorted) return { weights, total, order: null };
  const id = (index: number) => (distribution[index] as Candidate).token.id;
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => (weights[b] as number) - (weights[a] as number) || id(a) - id(b));
  return { weights, total, order };
}

/** Eingabeindex an Position `position` der absteigenden Reihenfolge. */
function at(order: number[] | null, position: number): number {
  return order === null ? position : (order[position] as number);
}

/**
 * Länge des kürzesten Präfixes (die ersten `length` Positionen von `order`), dessen kumulierte
 * renormierte Summe ≥ p ist; mindestens 1, bei p = 1 alle.
 */
function topPLength(
  weights: ArrayLike<number>,
  order: number[] | null,
  length: number,
  topP: number,
): number {
  // p = 1 heißt aus: auch Kandidaten mit winzigem Rest oder prob = 0 bleiben (§3.2 Schritt 4).
  if (topP >= 1) return Math.max(1, length);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += weights[at(order, i)] as number;
  const target = (topP - TOP_P_TOLERANCE) * total;
  let cumulative = 0;
  for (let i = 0; i < length; i += 1) {
    cumulative += weights[at(order, i)] as number;
    if (cumulative >= target) return Math.max(1, i + 1);
  }
  return Math.max(1, length);
}

/** Kandidaten der ersten `length` Positionen, renormiert über genau diese. */
function build(
  distribution: readonly Candidate[],
  { weights, order }: Tempered,
  length: number,
): Candidate[] {
  let total = 0;
  for (let i = 0; i < length; i += 1) total += weights[at(order, i)] as number;
  const out: Candidate[] = new Array<Candidate>(length);
  for (let i = 0; i < length; i += 1) {
    const index = at(order, i);
    out[i] = copy(distribution[index] as Candidate, (weights[index] as number) / total);
  }
  return out;
}

/** softmax(scores / T), absteigend nach prob (Gleichstand: id aufsteigend). */
export function applyTemperature(
  distribution: readonly Candidate[],
  temperature: number,
): Candidate[] {
  return build(distribution, tempered(distribution, temperature), distribution.length);
}

/** Die ersten min(k, n) Kandidaten; k = 0 heißt aus. Renormiert nicht. */
export function applyTopK(distribution: readonly Candidate[], topK: number): Candidate[] {
  const kept = topK === 0 ? distribution : distribution.slice(0, topK);
  return kept.map((c) => copy(c));
}

/** Kürzestes Präfix mit kumulierter (renormierter) Summe ≥ p, mindestens ein Kandidat. */
export function applyTopP(distribution: readonly Candidate[], topP: number): Candidate[] {
  const probs = Float64Array.from(distribution, (c) => c.prob);
  const end = topPLength(probs, null, distribution.length, topP);
  return distribution.slice(0, end).map((c) => copy(c));
}

export function renormalize(distribution: readonly Candidate[]): Candidate[] {
  const total = distribution.reduce((sum, c) => sum + c.prob, 0);
  return distribution.map((c) => copy(c, c.prob / total));
}

/**
 * Die ganze Kette in der verbindlichen Reihenfolge (CON-0010 SA-01). Gleich
 * renormalize(applyTopP(applyTopK(applyTemperature(d, T), k), p)), rechnet aber auf einem
 * Float64Array und baut die Kandidaten erst am Ende (S-11: 50 257 Kandidaten).
 */
export function transformDistribution(
  distribution: readonly Candidate[],
  settings: SamplingSettings,
): Candidate[] {
  if (distribution.length === 0) throw new Error('Die Verteilung ist leer');
  const result = tempered(distribution, settings.temperature);
  const n = distribution.length;
  const afterK = settings.topK === 0 ? n : Math.min(settings.topK, n);
  const kept = topPLength(result.weights, result.order, afterK, settings.topP);
  return build(distribution, result, kept);
}

/** Erster Index mit kumulierter Wahrscheinlichkeit > random; bei Rundungsrest der letzte. */
export function drawIndex(distribution: readonly Candidate[], random: number): number {
  let cumulative = 0;
  for (let i = 0; i < distribution.length; i += 1) {
    cumulative += distribution[i]?.prob ?? 0;
    if (cumulative > random) return i;
  }
  return distribution.length - 1;
}
