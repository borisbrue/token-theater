/**
 * Auswahl der Logit-Lens (SPEC-0007 §3.2, CON-0016 L-01): Softmax über das ganze Vokabular, die
 * Top-N absteigend, Gleichstand kleinere ID zuerst, `prob` nicht renormiert. Gilt für alle
 * Engines; sie liefern nur ihre Projektion ln_f(x) · wteᵀ.
 */

/**
 * Obergrenze für lensTopN, gleich MAX_LENS_TOP_N in src/trace/types (INV-17); engine/ darf aus
 * trace/ nur Typen importieren (CON-0004 R-03).
 */
export const LENS_TOP_N_LIMIT = 20;

export interface LensEntry {
  id: number;
  logit: number;
  prob: number;
}

export function lensCandidates(
  logits: ArrayLike<number>,
  length: number,
  topN: number,
): LensEntry[] {
  if (length > logits.length) {
    throw new RangeError(`length ${length} > ${logits.length} Logits`);
  }
  let max = -Infinity;
  for (let i = 0; i < length; i += 1) max = Math.max(max, logits[i] ?? -Infinity);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += Math.exp((logits[i] ?? -Infinity) - max);

  const count = Math.min(topN, length);
  const ids: number[] = [];
  for (let i = 0; i < length && count > 0; i += 1) {
    const value = logits[i] ?? -Infinity;
    if (ids.length === count && value <= (logits[ids[count - 1] ?? 0] ?? -Infinity)) continue;
    let at = ids.length;
    while (at > 0 && (logits[ids[at - 1] ?? 0] ?? -Infinity) < value) at -= 1;
    ids.splice(at, 0, i);
    if (ids.length > count) ids.pop();
  }
  return ids.map((id) => {
    const logit = logits[id] ?? 0;
    return { id, logit, prob: Math.exp(logit - max) / total };
  });
}

/** Prüft `lensTopN` (CON-0016 L-03): ganze Zahl von 0 bis LENS_TOP_N_LIMIT. */
export function checkLensTopN(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > LENS_TOP_N_LIMIT) {
    throw new RangeError(
      `lensTopN muss eine ganze Zahl von 0 bis ${LENS_TOP_N_LIMIT} sein, nicht ${value}`,
    );
  }
  return value;
}
