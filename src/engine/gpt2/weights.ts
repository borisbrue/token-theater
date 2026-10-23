import type { Gpt2Config } from './config';
import { invalidWeights } from './errors';
import type { SafeTensor } from './safetensors';

/**
 * GPT-2-Gewichte aus safetensors (SPEC-0006 §3.4, CON-0014 G-03): Namen mit oder ohne Präfix
 * `transformer.`; Maskenpuffer und `lm_head.weight` (= wte) werden nicht gebraucht.
 */

export interface Affine {
  /** Conv1D: Form [in, out], y = x · W + b. */
  w: Float32Array;
  b: Float32Array;
}

export interface Norm {
  g: Float32Array;
  b: Float32Array;
}

export interface Gpt2LayerWeights {
  ln1: Norm;
  attn: Affine;
  attnProj: Affine;
  ln2: Norm;
  fc: Affine;
  mlpProj: Affine;
}

export interface Gpt2Weights {
  wte: Float32Array;
  wpe: Float32Array;
  layers: Gpt2LayerWeights[];
  lnF: Norm;
}

function take(
  tensors: ReadonlyMap<string, SafeTensor>,
  name: string,
  shape: number[],
): Float32Array {
  const tensor = tensors.get(name) ?? tensors.get(`transformer.${name}`);
  if (tensor === undefined) throw invalidWeights(`der Tensor ${name} fehlt`);
  if (tensor.shape.length !== shape.length || tensor.shape.some((d, i) => d !== shape[i])) {
    throw invalidWeights(
      `der Tensor ${name} hat die Form [${tensor.shape.join(', ')}] statt [${shape.join(', ')}]`,
    );
  }
  if (tensor.data === null) {
    throw invalidWeights(`der Tensor ${name} hat den nicht unterstützten Typ ${tensor.dtype}`);
  }
  return tensor.data;
}

export function mapGpt2Weights(
  tensors: ReadonlyMap<string, SafeTensor>,
  config: Gpt2Config,
): Gpt2Weights {
  const { dModel: d, dMlp: m } = config;
  const norm = (name: string): Norm => ({
    g: take(tensors, `${name}.weight`, [d]),
    b: take(tensors, `${name}.bias`, [d]),
  });
  const affine = (name: string, inputs: number, outputs: number): Affine => ({
    w: take(tensors, `${name}.weight`, [inputs, outputs]),
    b: take(tensors, `${name}.bias`, [outputs]),
  });
  return {
    wte: take(tensors, 'wte.weight', [config.vocabSize, d]),
    wpe: take(tensors, 'wpe.weight', [config.contextLength, d]),
    layers: Array.from({ length: config.nLayers }, (_, l) => ({
      ln1: norm(`h.${l}.ln_1`),
      attn: affine(`h.${l}.attn.c_attn`, d, 3 * d),
      attnProj: affine(`h.${l}.attn.c_proj`, d, d),
      ln2: norm(`h.${l}.ln_2`),
      fc: affine(`h.${l}.mlp.c_fc`, d, m),
      mlpProj: affine(`h.${l}.mlp.c_proj`, m, d),
    })),
    lnF: norm('ln_f'),
  };
}
