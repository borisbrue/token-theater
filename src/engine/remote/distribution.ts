import { renormalize } from '../../sampling/transform';
import type { Candidate, LogitsStation } from '../../trace/types';
import { noLogprobs } from './errors';
import { bytesText } from './token-bytes';
import type { TokenRegistry } from './token-registry';

/** Ein Kandidat, wie ihn ein Dialekt aus der Antwort liest. */
export interface RawCandidate {
  /** Token-String des Servers (Schlüssel für synthetische IDs). */
  key: string;
  /** Echte Vokabular-ID oder null (Server ohne IDs). */
  id: number | null;
  bytes: number[];
  logprob: number;
}

interface Weighted {
  raw: RawCandidate;
  weight: number;
}

/**
 * Top-N-Verteilung einer Antwort (SPEC-0005 §3.4, CON-0012 RE-04/RE-05): nicht endliche
 * Logprobs entfallen, gleiche IDs werden zusammengefasst, es bleiben die N wahrscheinlichsten;
 * renormiert mit renormalize aus SPEC-0004, Abdeckung = Summe der gelieferten Wahrscheinlichkeiten.
 */
export function toLogitsStation(
  raw: readonly RawCandidate[],
  topN: number,
  registry: TokenRegistry,
): LogitsStation {
  const merged = new Map<string, Weighted>();
  for (const candidate of raw) {
    if (!Number.isFinite(candidate.logprob)) continue;
    const key = candidate.id === null ? `s:${candidate.key}` : `i:${candidate.id}`;
    const weight = Math.exp(candidate.logprob);
    const existing = merged.get(key);
    if (existing === undefined) merged.set(key, { raw: candidate, weight });
    else existing.weight += weight;
  }
  const kept = [...merged.values()]
    .sort((a, b) => b.weight - a.weight || compareKeys(a.raw, b.raw))
    .slice(0, topN);
  if (kept.length === 0) throw noLogprobs();

  const candidates: Candidate[] = kept.map(({ raw: candidate, weight }) => {
    const id = candidate.id ?? registry.idFor(candidate.key);
    registry.remember(id, candidate.bytes);
    return { token: { id, text: bytesText(candidate.bytes) }, logit: null, prob: weight };
  });
  const coverage = Math.min(
    1,
    candidates.reduce((sum, c) => sum + c.prob, 0),
  );
  const distribution = renormalize(candidates).sort(
    (a, b) => b.prob - a.prob || a.token.id - b.token.id,
  );
  return { kind: 'logits', vocabSize: null, distribution, coverage };
}

function compareKeys(a: RawCandidate, b: RawCandidate): number {
  if (a.id !== null && b.id !== null) return a.id - b.id;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
