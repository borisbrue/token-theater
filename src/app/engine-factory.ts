import { MOCK_MOE, MockEngine, type MockEngineOptions } from '../engine/mock/mock-engine';
import {
  DIALECT_MAX_TOP_N,
  RemoteEngine,
  type Dialect,
  type RemoteConfig,
  type RemoteDeps,
} from '../engine/remote/remote-engine';
import { Gpt2Engine, type Gpt2EngineDeps, type WorkerLike } from '../engine/gpt2/gpt2-engine';
import type { InferenceEngine, Rng, Tokenizer } from '../engine/types';

/** Für die App-Schicht freigegebene Teile der RemoteEngine (nur diese Datei importiert sie). */
export { detectDialect, listModels } from '../engine/remote/client';
export { DIALECT_MAX_TOP_N };
export type { Dialect, RemoteConfig };

/**
 * Einzige Stelle, an der konkrete Engines entstehen (SPEC-0001 §3.7, Factory Method).
 * Views und Playback sehen nur `InferenceEngine`. SPEC-0005 (remote) und SPEC-0006 ergänzen hier ihre Erzeuger.
 */

export type EngineKind = 'mock' | 'mock-moe' | 'remote' | 'gpt2';

export interface EngineDeps {
  createRng(seed: number): Rng;
  idProvider(): string;
  /** ISO-8601-Zeitstempel. */
  clock(): string;
}

export interface EngineOptions {
  mock?: MockEngineOptions;
  /** Pflicht für 'remote' (SPEC-0005); `fetch` nur für Tests. */
  remote?: RemoteConfig & RemoteDeps;
  /** Pflicht für 'gpt2' (SPEC-0006); `createWorker` nur für Tests. */
  gpt2?: {
    model: string;
    tokenizer: Tokenizer;
    loadWeights: Gpt2EngineDeps['loadWeights'];
    createWorker?: () => WorkerLike;
  };
}

/** Der echte Web Worker; Vite bündelt ihn über das new-URL-Muster. */
function createGpt2Worker(): WorkerLike {
  return new Worker(new URL('../engine/gpt2/worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

export class UnknownEngineError extends Error {
  constructor(readonly kind: string) {
    super(`Unbekannte Engine: ${kind}`);
    this.name = 'UnknownEngineError';
  }
}

type Factory = (deps: EngineDeps, options: EngineOptions) => InferenceEngine;

const FACTORIES: Record<EngineKind, Factory> = {
  // Die Mock-Engine ist deterministisch über weightSeed und braucht deps nicht. Zufall, IDs und
  // Zeit nutzen Generator und Recorder; spätere Engines (Remote, GPT-2) bekommen deps hier.
  mock: (_deps, options) => new MockEngine(options.mock),
  // Mock-MoE (SPEC-0011 §3.3): dieselbe Engine mit Mixture of Experts statt MLP.
  'mock-moe': (_deps, options) => new MockEngine({ ...options.mock, moe: MOCK_MOE }),
  remote: (_deps, options) => {
    if (options.remote === undefined) {
      throw new Error('Die Remote-Engine braucht options.remote (Basis-URL, Key, Modell, Dialekt)');
    }
    const { fetch, ...config } = options.remote;
    return new RemoteEngine(config, fetch === undefined ? {} : { fetch });
  },
  gpt2: (_deps, options) => {
    if (options.gpt2 === undefined) {
      throw new Error('Die GPT-2-Engine braucht options.gpt2 (Modell, Tokenizer, Gewichte)');
    }
    const { model, tokenizer, loadWeights, createWorker } = options.gpt2;
    return new Gpt2Engine(
      { model },
      { tokenizer, loadWeights, createWorker: createWorker ?? createGpt2Worker },
    );
  },
};

export function createEngine(
  kind: EngineKind,
  deps: EngineDeps,
  options: EngineOptions = {},
): InferenceEngine {
  const factory = Object.hasOwn(FACTORIES, kind) ? FACTORIES[kind] : undefined;
  if (factory === undefined) {
    throw new UnknownEngineError(kind);
  }
  return factory(deps, options);
}
