import type { Tensor } from '../../trace/types';

/** Zeilen und Statistik von Tensoren für die Ansichten (SPEC-0007 §3.4, CON-0017 V-01/V-02). */

/** Zeile `row` eines Tensors der Form [r, c] als Kopie. */
export function tensorRow(tensor: Tensor, row: number): Float32Array {
  const [rows, cols] = tensor.shape;
  if (tensor.shape.length !== 2 || rows === undefined || cols === undefined) {
    throw new RangeError(`Tensor der Form [${tensor.shape.join(', ')}] ist nicht zweidimensional`);
  }
  if (!Number.isInteger(row) || row < 0 || row >= rows) {
    throw new RangeError(`Zeile ${row} liegt nicht in 0 … ${rows - 1}`);
  }
  return tensor.data.slice(row * cols, (row + 1) * cols);
}

export function l2Norm(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += (values[i] ?? 0) ** 2;
  return Math.sqrt(sum);
}

export function extent(values: ArrayLike<number>): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

export function maxAbs(values: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < values.length; i += 1) max = Math.max(max, Math.abs(values[i] ?? 0));
  return max;
}

export function countPositive(values: ArrayLike<number>): number {
  let count = 0;
  for (let i = 0; i < values.length; i += 1) if ((values[i] ?? 0) > 0) count += 1;
  return count;
}

/** Prüft eine Anzahl `n` (CON-0017 V-02/V-07): ganze Zahl ≥ 0. */
export function checkCount(n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n muss eine ganze Zahl ≥ 0 sein: ${n}`);
}

/** Die `n` größten Werte mit Index, absteigend; Gleichstand: kleinerer Index zuerst. */
export function topActivations(
  values: ArrayLike<number>,
  n: number,
): { index: number; value: number }[] {
  checkCount(n);
  return Array.from({ length: values.length }, (_, index) => ({ index, value: values[index] ?? 0 }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, n);
}
