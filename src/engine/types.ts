import type {
  BpeDetail,
  EngineInfo,
  LogitsStation,
  SampleStation,
  Station,
  Token,
} from '../trace/types';

/** Zerlegt Text in Tokens und setzt sie wieder zusammen. */
export interface Tokenizer {
  tokenize(text: string): Promise<Token[]>;
  decode(tokens: Token[]): string;
  readonly eosTokenId: number | null;
  /** Optionale Fähigkeit (SPEC-0003 §3.3): BPE-Merge-Stufen für die tokenize-Station. */
  explain?(text: string): BpeDetail;
}

export interface LoadProgress {
  /** 0 bis 1 */
  fraction: number;
  message?: string;
}

/** Lebenszyklus einer Engine (Gewichte laden, Ressourcen freigeben). */
export interface Loadable {
  load(onProgress?: (p: LoadProgress) => void, signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

/** Strategy für die eigentliche Rechnung; Sampling liegt beim Generator (SPEC-0001 §3.3). */
export interface InferenceEngine extends Loadable {
  readonly info: EngineInfo;
  readonly tokenizer: Tokenizer;
  /** Ein Forward-Pass über newPositions; die letzte Station ist immer 'logits'. */
  forward(
    context: Token[],
    newPositions: [number, number],
    signal?: AbortSignal,
  ): AsyncIterable<Station>;
}

/** Seedbarer Zufallsgenerator; next() liefert Werte in [0, 1). */
export interface Rng {
  next(): number;
}

export interface Sampler {
  readonly strategy: string;
  /** Landet in trace.sampling.params (SPEC-0004 FR-05); fehlt bei Greedy. */
  readonly params?: Readonly<Record<string, number | string | boolean>>;
  sample(logits: LogitsStation, rng: Rng): SampleStation;
}

export interface GenerateRequest {
  prompt: string;
  maxTokens: number;
  seed: number;
}

export interface GenerateDeps {
  createRng(seed: number): Rng;
}
