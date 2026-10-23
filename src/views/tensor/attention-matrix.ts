import type { AttentionStation, GenerationStep } from '../../trace/types';
import { checkCount } from './tensor-math';

/**
 * Attention-Matrix eines Layers mit den Zeilen früherer Schritte (KV-Cache) und kausaler Maske
 * (SPEC-0007 §3.5, CON-0017 V-06/V-07).
 */

export interface AttentionMatrix {
  /** Absolute Positionen, aufsteigend. */
  rows: number[];
  /** Spalten 0 … cols − 1. */
  cols: number;
  /** rows.length × cols, row-major. */
  values: Float32Array;
  /** [from, to): Zeilen des aktuellen Schritts als Indizes in rows. */
  current: [number, number];
}

interface SourceRow {
  position: number;
  station: AttentionStation;
  row: number;
}

function stationOf(step: GenerationStep, layer: number): AttentionStation | undefined {
  return step.stations.find(
    (s): s is AttentionStation => s.kind === 'attention' && s.layer === layer,
  );
}

/** Prüft e = b − a für eine Station und liefert ihre Zeilen als Positionen. */
function rowsOf(step: GenerationStep, station: AttentionStation): SourceRow[] {
  const [a, b] = step.newPositions;
  const [, e, width] = station.weights.shape;
  if (e !== b - a || width !== b) {
    throw new RangeError(
      `weights [${station.weights.shape.join(', ')}] passt nicht zu newPositions [${a}, ${b})`,
    );
  }
  return Array.from({ length: e }, (_, row) => ({ position: a + row, station, row }));
}

function cell(station: AttentionStation, head: number | 'mean', row: number, col: number): number {
  const [heads = 0, e = 0, width = 0] = station.weights.shape;
  if (col >= width) return 0;
  const at = (h: number): number => station.weights.data[(h * e + row) * width + col] ?? 0;
  if (head !== 'mean') return at(head);
  let sum = 0;
  for (let h = 0; h < heads; h += 1) sum += at(h);
  return heads > 0 ? sum / heads : 0;
}

export function attentionMatrix(
  step: GenerationStep,
  earlierSteps: readonly GenerationStep[],
  layer: number,
  head: number | 'mean',
  history: boolean,
): AttentionMatrix | null {
  const station = stationOf(step, layer);
  if (station === undefined) return null;
  const heads = station.weights.shape[0] ?? 0;
  if (head !== 'mean' && (!Number.isInteger(head) || head < 0 || head >= heads)) {
    throw new RangeError(`Kopf ${head} liegt nicht in 0 … ${heads - 1}`);
  }
  const currentRows = rowsOf(step, station);
  const start = step.newPositions[0];
  const earlier = new Map<number, SourceRow>();
  if (history) {
    for (const previous of earlierSteps) {
      const source = stationOf(previous, layer);
      if (source === undefined) continue;
      for (const entry of rowsOf(previous, source)) {
        if (entry.position < start && !earlier.has(entry.position)) {
          earlier.set(entry.position, entry);
        }
      }
    }
  }
  const sources = [
    ...[...earlier.values()].sort((x, y) => x.position - y.position),
    ...currentRows,
  ];
  const cols = step.newPositions[1];
  const values = new Float32Array(sources.length * cols);
  sources.forEach((source, r) => {
    for (let j = 0; j <= source.position && j < cols; j += 1) {
      values[r * cols + j] = cell(source.station, head, source.row, j);
    }
  });
  return {
    rows: sources.map((s) => s.position),
    cols,
    values,
    current: [sources.length - currentRows.length, sources.length],
  };
}

/** Die `n` am stärksten beachteten Positionen der Zeile `rowIndex` (nur Spalten ≤ Position). */
export function topAttended(
  matrix: AttentionMatrix,
  rowIndex: number,
  n: number,
): { position: number; weight: number }[] {
  const position = matrix.rows[rowIndex];
  if (!Number.isInteger(rowIndex) || position === undefined) {
    throw new RangeError(`Zeile ${rowIndex} liegt nicht in 0 … ${matrix.rows.length - 1}`);
  }
  checkCount(n);
  const visible = Math.min(position + 1, matrix.cols);
  return Array.from({ length: visible }, (_, j) => ({
    position: j,
    weight: matrix.values[rowIndex * matrix.cols + j] ?? 0,
  }))
    .sort((a, b) => b.weight - a.weight || a.position - b.position)
    .slice(0, n);
}
