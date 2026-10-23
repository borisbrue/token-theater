/**
 * Trace-Modell (SPEC-0001 §3.2, CON-0001). Ein Trace beschreibt einen Generierungslauf:
 * Schritte (je ein erzeugtes Token) aus geordneten Stationen. Tensordaten liegen hier als
 * Float32Array (row-major), serialisiert als Base64 little-endian float32.
 */

export type StationKind =
  | 'tokenize'
  | 'embed'
  | 'attention'
  | 'mlp'
  | 'moe'
  | 'residual'
  | 'logits'
  | 'sample';

export const STATION_KINDS: readonly StationKind[] = [
  'tokenize',
  'embed',
  'attention',
  'mlp',
  'moe',
  'residual',
  'logits',
  'sample',
];

/** Arten des Feed-Forward-Teils eines Layers: dicht oder Mixture of Experts (SPEC-0011 §3.2). */
export type FeedForwardKind = 'mlp' | 'moe';

export const FEED_FORWARD_KINDS: readonly FeedForwardKind[] = ['mlp', 'moe'];

export interface Token {
  id: number;
  text: string;
}

export interface Tensor {
  shape: number[];
  dtype: 'float32';
  data: Float32Array;
}

export interface Candidate {
  token: Token;
  logit: number | null;
  prob: number;
}

export interface Architecture {
  nLayers: number;
  nHeads: number;
  dModel: number;
  /** Breite des MLP; bei MoE die Breite eines Experten. */
  dMlp: number;
  vocabSize: number;
  contextLength: number;
  /** Nur bei MoE-Modellen (CON-0001 v0.5.0). */
  nExperts?: number;
  topK?: number;
}

export interface EngineInfo {
  kind: string;
  model: string;
  /** Enthält immer 'logits' und 'sample'. */
  capabilities: StationKind[];
  architecture: Architecture | null;
  eosTokenId: number | null;
}

export interface SamplingParams {
  strategy: string;
  seed: number;
  params: Record<string, number | string | boolean>;
}

/** Ein Pre-Token und seine BPE-Merge-Stufen (SPEC-0003 §3.5, CON-0001 INV-16). */
export interface BpeWord {
  /** Pre-Token, z. B. " Katze". */
  text: string;
  /** UTF-8 des Pre-Tokens. */
  bytes: number[];
  /** stages[0] = Einzelbytes, stages[i + 1] = nach Merge-Runde i; je Symbol seine Bytes. */
  stages: number[][][];
  /** Rang der Merge-Regel je Runde, Länge stages.length − 1. */
  ranks: number[];
  /** Token-IDs der Symbole der letzten Stufe. */
  ids: number[];
}

export interface BpeDetail {
  words: BpeWord[];
}

export interface TokenizeStation {
  kind: 'tokenize';
  tokens: Token[];
  /** Nur bei Tokenizern mit explain (byte-level BPE). */
  bpe?: BpeDetail;
}

export interface EmbedStation {
  kind: 'embed';
  token: Tensor;
  position: Tensor;
  sum: Tensor;
}

export interface AttentionStation {
  kind: 'attention';
  layer: number;
  lnIn: Tensor;
  q: Tensor;
  k: Tensor;
  v: Tensor;
  /** Form [nHeads, newPositions, contextBis]. */
  weights: Tensor;
  out: Tensor;
}

export interface MlpStation {
  kind: 'mlp';
  layer: number;
  lnIn: Tensor;
  hidden: Tensor;
  out: Tensor;
}

/** Mixture-of-Experts-Teil eines Layers (SPEC-0011 §3.2, CON-0001 INV-18). */
export interface MoeStation {
  kind: 'moe';
  layer: number;
  /** Eingang nach der Norm, Form [n, D]. */
  lnIn: Tensor;
  /** Rohe Router-Bewertung je Token und Experte, Form [n, nExperts]. */
  routerLogits: Tensor;
  /** Je neue Position die gewählten Experten, absteigend nach Gate. */
  experts: number[][];
  /** Gate-Gewichte passend zu experts. */
  gates: number[][];
  /** Gemischte Ausgabe, die zum Residual Stream addiert wird, Form [n, D]. */
  out: Tensor;
}

/** Höchstzahl der Lens-Kandidaten je Station (CON-0001 INV-17, CON-0016 L-03). */
export const MAX_LENS_TOP_N = 20;

export interface ResidualStation {
  kind: 'residual';
  layer: number;
  after: 'attention' | FeedForwardKind;
  stream: Tensor;
  /** Logit-Lens der letzten Position; absteigend nach prob, nicht renormiert (SPEC-0007 §3.3). */
  lens?: Candidate[];
}

export interface LogitsStation {
  kind: 'logits';
  vocabSize: number | null;
  /** Absteigend nach prob, auf die gelieferten Kandidaten renormiert. */
  distribution: Candidate[];
  /** Wahrscheinlichkeitsmasse vor der Renormierung: 1 (voll), < 1 (Top-N) oder null. */
  coverage: number | null;
}

export interface SampleStation {
  kind: 'sample';
  distribution: Candidate[];
  random: number | null;
  chosen: Token;
}

export type Station =
  | TokenizeStation
  | EmbedStation
  | AttentionStation
  | MlpStation
  | MoeStation
  | ResidualStation
  | LogitsStation
  | SampleStation;

export interface GenerationStep {
  index: number;
  /** Kontext vor diesem Schritt. */
  contextTokens: Token[];
  /** [start, end): neu berechnete Positionen (KV-Cache-Sicht). */
  newPositions: [number, number];
  stations: Station[];
  chosen: Token;
  /** tokenizer.decode([...contextTokens, chosen]). */
  text: string;
}

export type FinishReason = 'max-tokens' | 'eos' | 'aborted' | 'error';

export interface Trace {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  engine: EngineInfo;
  prompt: string;
  maxTokens: number;
  sampling: SamplingParams;
  steps: GenerationStep[];
  finishReason: FinishReason;
  /** Genau bei finishReason 'error'. */
  error?: { message: string };
}

/** Events des Generators (CON-0002). */
export type TraceEvent =
  | {
      type: 'run-start';
      engine: EngineInfo;
      prompt: string;
      maxTokens: number;
      sampling: SamplingParams;
    }
  | { type: 'step-start'; index: number; contextTokens: Token[]; newPositions: [number, number] }
  | { type: 'station'; index: number; station: Station }
  | { type: 'step-end'; index: number; chosen: Token; text: string }
  | { type: 'done'; finishReason: Exclude<FinishReason, 'error'> }
  | { type: 'error'; message: string };

/** Ein Befund aus Schema- oder Semantikprüfung (CON-0001, Import-Fehler). */
export interface ImportIssue {
  /** JSON Pointer (RFC 6901) des betroffenen Werts. */
  path: string;
  message: string;
  invariant?: string;
}
