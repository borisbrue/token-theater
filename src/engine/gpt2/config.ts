import { invalidConfig, isRecord } from './errors';

/** GPT-2-Konfiguration aus config.json (SPEC-0006 §3.4, CON-0014 G-02). */

export interface Gpt2Config {
  nLayers: number;
  nHeads: number;
  dModel: number;
  dMlp: number;
  vocabSize: number;
  contextLength: number;
  layerNormEpsilon: number;
}

const ACTIVATIONS = new Set(['gelu_new', 'gelu']);
const DEFAULT_EPSILON = 1e-5;

export function parseGpt2Config(json: unknown): Gpt2Config {
  if (!isRecord(json)) throw invalidConfig('kein JSON-Objekt');
  const positive = (key: string): number => {
    const value = json[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw invalidConfig(`${key} fehlt oder ist keine positive Ganzzahl`);
    }
    return value;
  };
  const nLayers = positive('n_layer');
  const nHeads = positive('n_head');
  const dModel = positive('n_embd');
  const contextLength = positive('n_positions');
  const vocabSize = positive('vocab_size');
  const dMlp =
    json['n_inner'] === null || json['n_inner'] === undefined ? 4 * dModel : positive('n_inner');
  const epsilon = json['layer_norm_epsilon'] ?? DEFAULT_EPSILON;
  if (typeof epsilon !== 'number' || !(epsilon > 0)) {
    throw invalidConfig('layer_norm_epsilon ist keine positive Zahl');
  }
  const activation = json['activation_function'] ?? 'gelu_new';
  if (typeof activation !== 'string' || !ACTIVATIONS.has(activation)) {
    throw invalidConfig(`Aktivierung ${String(activation)} wird nicht unterstützt`);
  }
  if (dModel % nHeads !== 0) throw invalidConfig('n_embd ist nicht durch n_head teilbar');
  return { nLayers, nHeads, dModel, dMlp, vocabSize, contextLength, layerNormEpsilon: epsilon };
}
