/**
 * Rechen-Primitive für GPT-2 in Float32 (SPEC-0006 §3.6). Matrizen sind row-major; `rows` Zeilen
 * zu je `cols` Spalten.
 */

/** LayerNorm je Zeile (Mittelwert und Varianz in double, Ergebnis Float32). */
export function layerNorm(
  x: Float32Array,
  rows: number,
  cols: number,
  g: Float32Array,
  b: Float32Array,
  epsilon: number,
): Float32Array {
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1) {
    const base = r * cols;
    let mean = 0;
    for (let c = 0; c < cols; c += 1) mean += x[base + c] ?? 0;
    mean /= cols;
    let variance = 0;
    for (let c = 0; c < cols; c += 1) variance += ((x[base + c] ?? 0) - mean) ** 2;
    variance /= cols;
    const inv = 1 / Math.sqrt(variance + epsilon);
    for (let c = 0; c < cols; c += 1) {
      out[base + c] = ((x[base + c] ?? 0) - mean) * inv * (g[c] ?? 1) + (b[c] ?? 0);
    }
  }
  return out;
}

/** y = x · W + b mit x [rows, inputs], W [inputs, outputs] (Conv1D von GPT-2). */
export function affine(
  x: Float32Array,
  rows: number,
  inputs: number,
  w: Float32Array,
  b: Float32Array,
  outputs: number,
): Float32Array {
  const out = new Float32Array(rows * outputs);
  const acc = new Float64Array(outputs);
  for (let r = 0; r < rows; r += 1) {
    for (let o = 0; o < outputs; o += 1) acc[o] = b[o] ?? 0;
    for (let i = 0; i < inputs; i += 1) {
      const xi = x[r * inputs + i] ?? 0;
      if (xi === 0) continue;
      const row = i * outputs;
      for (let o = 0; o < outputs; o += 1) acc[o] = (acc[o] ?? 0) + xi * (w[row + o] ?? 0);
    }
    out.set(acc, r * outputs);
  }
  return out;
}

/** GELU in der Tanh-Näherung („gelu_new“ von GPT-2). */
export function gelu(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const k = Math.sqrt(2 / Math.PI);
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i] ?? 0;
    out[i] = 0.5 * v * (1 + Math.tanh(k * (v + 0.044715 * v * v * v)));
  }
  return out;
}

/** Elementweise Summe (Residual Stream). */
export function add(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

/** Softmax über `values[0..length)` in double; schreibt das Ergebnis nach `out`. */
export function softmaxInto(values: Float64Array, length: number, out: Float64Array): void {
  let max = -Infinity;
  for (let i = 0; i < length; i += 1) max = Math.max(max, values[i] ?? -Infinity);
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    const e = Math.exp((values[i] ?? -Infinity) - max);
    out[i] = e;
    sum += e;
  }
  for (let i = 0; i < length; i += 1) out[i] = (out[i] ?? 0) / sum;
}
