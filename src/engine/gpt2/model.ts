import type { Candidate, LogitsStation, Station, Tensor } from '../../trace/types';
import { checkLensTopN, lensCandidates } from '../lens';
import type { Gpt2Config } from './config';
import { KvCache } from './kv-cache';
import { createJsKernel, type MatrixKernel } from './kernel';
import { add, gelu, layerNorm, softmaxInto } from './math';
import type { Gpt2Weights } from './weights';

/**
 * GPT-2-Forward-Pass mit Stationen (SPEC-0006 §3.5, CON-0014 G-04/G-05). Rechnet die neuen
 * Positionen [a, b) mit KV-Cache; passt der Cache nicht zum Kontext, ab Position 0 (ausgegeben
 * werden dann trotzdem nur die Zeilen [a, b)). Nach jedem MLP trägt die residual-Station die
 * Logit-Lens der letzten Position (SPEC-0007 §3.2, CON-0016 L-02). Affine Schichten und
 * Vokabular-Projektion rechnet der Rechenkern (SPEC-0008, CON-0019).
 */

export interface Gpt2ModelOptions {
  /** Kandidaten der logits-Station; Default 100. */
  topN?: number;
  /** Kandidaten der Logit-Lens, 0 bis MAX_LENS_TOP_N; Default 5, 0 = aus. */
  lensTopN?: number;
  /** Rechenkern zu den übergebenen Gewichten; Default der JS-Kern. */
  kernel?: MatrixKernel;
}

const DEFAULT_TOP_N = 100;
const DEFAULT_LENS_TOP_N = 5;

function tensor(shape: number[], data: Float32Array): Tensor {
  return { shape, dtype: 'float32', data };
}

/** Zeilen [from, rows) einer row-major-Matrix als eigene Kopie. */
function rowsFrom(data: Float32Array, from: number, cols: number): Float32Array {
  return data.slice(from * cols);
}

/**
 * Die `n` Indizes mit den größten Werten, absteigend (Gleichstand: kleinerer Index zuerst), in
 * einem Durchgang mit sortierter Bestenliste statt das ganze Vokabular zu sortieren.
 */
function topIndices(values: Float64Array, length: number, n: number): number[] {
  const ids: number[] = [];
  const best: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const value = values[i] ?? -Infinity;
    if (ids.length === n && value <= (best[n - 1] ?? -Infinity)) continue;
    let lo = 0;
    let hi = best.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((best[mid] ?? -Infinity) >= value) lo = mid + 1;
      else hi = mid;
    }
    ids.splice(lo, 0, i);
    best.splice(lo, 0, value);
    if (ids.length > n) {
      ids.pop();
      best.pop();
    }
  }
  return ids;
}

export class Gpt2Model {
  private readonly cache: KvCache;
  private readonly topN: number;
  private readonly lensTopN: number;
  private readonly kernel: MatrixKernel;

  constructor(
    private readonly config: Gpt2Config,
    private readonly weights: Gpt2Weights,
    options: Gpt2ModelOptions = {},
  ) {
    this.cache = new KvCache(config.nLayers, config.dModel);
    this.topN = Math.min(options.topN ?? DEFAULT_TOP_N, config.vocabSize);
    this.lensTopN = checkLensTopN(options.lensTopN ?? DEFAULT_LENS_TOP_N);
    this.kernel = options.kernel ?? createJsKernel(config, weights).kernel;
  }

  forward(context: readonly number[], positions: [number, number]): Station[] {
    const [a, b] = positions;
    if (!this.cache.covers(context, a)) this.cache.clear();
    const start = this.cache.length;
    const { dModel: d, dMlp: m, nHeads: heads, nLayers, layerNormEpsilon: eps } = this.config;
    const rows = b - start;
    const skip = a - start;
    const emitted = b - a;
    const stations: Station[] = [];

    const tokenRows = new Float32Array(rows * d);
    const positionRows = new Float32Array(rows * d);
    for (let r = 0; r < rows; r += 1) {
      const id = context[start + r] ?? 0;
      tokenRows.set(this.weights.wte.subarray(id * d, (id + 1) * d), r * d);
      positionRows.set(this.weights.wpe.subarray((start + r) * d, (start + r + 1) * d), r * d);
    }
    let x = add(tokenRows, positionRows);
    stations.push({
      kind: 'embed',
      token: tensor([emitted, d], rowsFrom(tokenRows, skip, d)),
      position: tensor([emitted, d], rowsFrom(positionRows, skip, d)),
      sum: tensor([emitted, d], rowsFrom(x, skip, d)),
    });

    const headWidth = d / heads;
    const scale = 1 / Math.sqrt(headWidth);
    let projected: Float64Array | null = null;
    const scores = new Float64Array(b);
    const probs = new Float64Array(b);
    for (let l = 0; l < nLayers; l += 1) {
      const layer = this.weights.layers[l];
      if (layer === undefined) throw new Error(`Layer ${l} fehlt`);
      const lnIn = layerNorm(x, rows, d, layer.ln1.g, layer.ln1.b, eps);
      const qkv = this.kernel.affine(lnIn, rows, d, layer.attn.w, layer.attn.b, 3 * d);
      const q = new Float32Array(rows * d);
      const k = new Float32Array(rows * d);
      const v = new Float32Array(rows * d);
      for (let r = 0; r < rows; r += 1) {
        q.set(qkv.subarray(r * 3 * d, r * 3 * d + d), r * d);
        k.set(qkv.subarray(r * 3 * d + d, r * 3 * d + 2 * d), r * d);
        v.set(qkv.subarray(r * 3 * d + 2 * d, r * 3 * d + 3 * d), r * d);
      }
      this.cache.append(l, k, v, rows);
      const keys = this.cache.keysOf(l);
      const values = this.cache.valuesOf(l);

      const mixed = new Float32Array(rows * d);
      const weightsOut = new Float32Array(heads * emitted * b);
      for (let r = 0; r < rows; r += 1) {
        const position = start + r;
        for (let h = 0; h < heads; h += 1) {
          const offset = h * headWidth;
          for (let j = 0; j <= position; j += 1) {
            let dot = 0;
            for (let c = 0; c < headWidth; c += 1) {
              dot += (q[r * d + offset + c] ?? 0) * (keys[j * d + offset + c] ?? 0);
            }
            scores[j] = dot * scale;
          }
          softmaxInto(scores, position + 1, probs);
          for (let c = 0; c < headWidth; c += 1) {
            let sum = 0;
            for (let j = 0; j <= position; j += 1)
              sum += (probs[j] ?? 0) * (values[j * d + offset + c] ?? 0);
            mixed[r * d + offset + c] = sum;
          }
          if (r >= skip) {
            const base = (h * emitted + (r - skip)) * b;
            for (let j = 0; j <= position; j += 1) weightsOut[base + j] = probs[j] ?? 0;
          }
        }
      }
      const attnOut = this.kernel.affine(mixed, rows, d, layer.attnProj.w, layer.attnProj.b, d);
      stations.push({
        kind: 'attention',
        layer: l,
        lnIn: tensor([emitted, d], rowsFrom(lnIn, skip, d)),
        q: tensor([emitted, d], rowsFrom(q, skip, d)),
        k: tensor([emitted, d], rowsFrom(k, skip, d)),
        v: tensor([emitted, d], rowsFrom(v, skip, d)),
        weights: tensor([heads, emitted, b], weightsOut),
        out: tensor([emitted, d], rowsFrom(attnOut, skip, d)),
      });
      x = add(x, attnOut);
      stations.push({
        kind: 'residual',
        layer: l,
        after: 'attention',
        stream: tensor([emitted, d], rowsFrom(x, skip, d)),
      });

      const mlpIn = layerNorm(x, rows, d, layer.ln2.g, layer.ln2.b, eps);
      const hidden = gelu(this.kernel.affine(mlpIn, rows, d, layer.fc.w, layer.fc.b, m));
      const mlpOut = this.kernel.affine(hidden, rows, m, layer.mlpProj.w, layer.mlpProj.b, d);
      stations.push({
        kind: 'mlp',
        layer: l,
        lnIn: tensor([emitted, d], rowsFrom(mlpIn, skip, d)),
        hidden: tensor([emitted, m], rowsFrom(hidden, skip, m)),
        out: tensor([emitted, d], rowsFrom(mlpOut, skip, d)),
      });
      x = add(x, mlpOut);
      const residual: Station = {
        kind: 'residual',
        layer: l,
        after: 'mlp',
        stream: tensor([emitted, d], rowsFrom(x, skip, d)),
      };
      if (this.lensTopN > 0) {
        projected = this.project(x.subarray((rows - 1) * d, rows * d));
        residual.lens = this.lens(projected);
      }
      stations.push(residual);
    }
    this.cache.commit(context, b);
    stations.push(this.logits(projected ?? this.project(x.subarray((rows - 1) * d, rows * d))));
    return stations;
  }

  /** ln_f und Unembedding mit wteᵀ: die Logits eines Vektors über das ganze Vokabular. */
  private project(row: Float32Array): Float64Array {
    const { dModel: d, vocabSize, layerNormEpsilon: eps } = this.config;
    const h = layerNorm(row, 1, d, this.weights.lnF.g, this.weights.lnF.b, eps);
    const logits = Float64Array.from(this.kernel.unembed(h, this.weights.wte, vocabSize, d));
    return logits;
  }

  /** Logit-Lens: die lensTopN Kandidaten ohne Texte (die setzt die Engine). */
  private lens(logits: Float64Array): Candidate[] {
    return lensCandidates(logits, this.config.vocabSize, this.lensTopN).map((entry) => ({
      token: { id: entry.id, text: '' },
      logit: entry.logit,
      prob: entry.prob,
    }));
  }

  /** Softmax über das ganze Vokabular, die Top-N renormiert. */
  private logits(logits: Float64Array): LogitsStation {
    const { vocabSize } = this.config;
    const probs = new Float64Array(vocabSize);
    softmaxInto(logits, vocabSize, probs);
    const top = topIndices(logits, vocabSize, this.topN);
    const coverage = top.reduce((sum, id) => sum + (probs[id] ?? 0), 0);
    const distribution: Candidate[] = top.map((id) => ({
      token: { id, text: '' },
      logit: logits[id] ?? 0,
      prob: (probs[id] ?? 0) / coverage,
    }));
    return { kind: 'logits', vocabSize, distribution, coverage };
  }
}
