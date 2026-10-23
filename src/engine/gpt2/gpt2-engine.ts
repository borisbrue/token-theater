import type { Architecture, EngineInfo, Station, StationKind, Token } from '../../trace/types';
import type { InferenceEngine, LoadProgress, Tokenizer } from '../types';
import type { KernelName } from './kernel';
import { Gpt2LoadError, workerCrashed } from './errors';
import type { WorkerCommand, WorkerResponse } from './protocol';

/**
 * GPT-2-Engine im Hauptthread (SPEC-0006 §3.2, Proxy): lädt die Gewichte über die injizierte
 * Funktion, überträgt sie an den Worker und leitet forward an ihn weiter. Gezogen wird wie immer
 * im Generator (SPEC-0004).
 */

export interface WorkerLike {
  postMessage(command: WorkerCommand, transfer?: Transferable[]): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

export interface Gpt2EngineDeps {
  tokenizer: Tokenizer;
  createWorker(): WorkerLike;
  loadWeights(signal?: AbortSignal): Promise<{ config: unknown; weights: ArrayBuffer }>;
}

export interface Gpt2EngineOptions {
  model: string;
  topN?: number;
  maxPromptTokens?: number;
}

const GPT2_EOS = 50256;
const ALL_KINDS: readonly StationKind[] = [
  'tokenize',
  'embed',
  'attention',
  'mlp',
  'residual',
  'logits',
  'sample',
];
const DEFAULT_TOP_N = 100;
const DEFAULT_MAX_PROMPT = 64;

interface Pending {
  resolve(value: Station[]): void;
  reject(error: unknown): void;
}

/** Eigene Funktion: das Signal ändert sich zwischen den awaits (TypeScript verengt sonst falsch). */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function abortError(): DOMException {
  return new DOMException('Der Vorgang wurde abgebrochen.', 'AbortError');
}

export class Gpt2Engine implements InferenceEngine {
  readonly tokenizer: Tokenizer;
  private architecture: Architecture | null = null;
  private kernelName: KernelName | null = null;
  private worker: WorkerLike | null = null;
  private failure: Gpt2LoadError | null = null;
  private ready: { resolve(): void; reject(error: unknown): void } | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextRequest = 1;

  constructor(
    private readonly options: Gpt2EngineOptions,
    private readonly deps: Gpt2EngineDeps,
  ) {
    this.tokenizer = deps.tokenizer;
  }

  /** Rechenkern des Workers (SPEC-0008); null vor load(). */
  get kernel(): KernelName | null {
    return this.kernelName;
  }

  /** Gilt nach load(); vorher ist architecture null. */
  get info(): EngineInfo {
    return {
      kind: 'gpt2',
      model: this.options.model,
      capabilities: [...ALL_KINDS],
      architecture: this.architecture,
      eosTokenId: GPT2_EOS,
    };
  }

  async load(onProgress?: (p: LoadProgress) => void, signal?: AbortSignal): Promise<void> {
    if (aborted(signal)) throw abortError();
    const { config, weights } = await this.deps.loadWeights(signal);
    if (aborted(signal)) throw abortError();
    const worker = this.deps.createWorker();
    this.worker = worker;
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = () => this.crash();
    await new Promise<void>((resolve, reject) => {
      this.ready = { resolve, reject };
      worker.postMessage(
        { type: 'init', config, weights, topN: this.options.topN ?? DEFAULT_TOP_N },
        [weights],
      );
    });
    onProgress?.({ fraction: 1 });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  async *forward(
    context: Token[],
    newPositions: [number, number],
    signal?: AbortSignal,
  ): AsyncIterable<Station> {
    const limit = this.options.maxPromptTokens ?? DEFAULT_MAX_PROMPT;
    if (newPositions[0] === 0 && context.length > limit) {
      throw new Error(
        `Der Prompt hat ${context.length} Tokens; die GPT-2-Engine erlaubt höchstens ${limit}.`,
      );
    }
    const stations = await this.request(
      context.map((t) => t.id),
      newPositions,
      signal,
    );
    for (const station of stations) {
      const candidates =
        station.kind === 'logits'
          ? station.distribution
          : station.kind === 'residual'
            ? (station.lens ?? [])
            : [];
      for (const candidate of candidates) {
        candidate.token.text = this.tokenizer.decode([{ id: candidate.token.id, text: '' }]);
      }
      yield station;
    }
  }

  private request(
    context: number[],
    positions: [number, number],
    signal?: AbortSignal,
  ): Promise<Station[]> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const worker = this.worker;
    if (worker === null) return Promise.reject(new Error('Die GPT-2-Engine ist nicht geladen.'));
    if (aborted(signal)) return Promise.reject(abortError());
    const requestId = this.nextRequest;
    this.nextRequest += 1;
    return new Promise<Station[]>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(requestId);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, {
        resolve: (stations) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(stations);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      worker.postMessage({ type: 'forward', requestId, context, positions });
    });
  }

  private receive(response: WorkerResponse): void {
    switch (response.type) {
      case 'ready':
        this.architecture = response.architecture;
        this.kernelName = response.kernel;
        this.ready?.resolve();
        this.ready = null;
        return;
      case 'init-error':
        this.ready?.reject(new Gpt2LoadError('format', response.message));
        this.ready = null;
        return;
      case 'stations':
        this.pending.get(response.requestId)?.resolve(response.stations);
        this.pending.delete(response.requestId);
        return;
      case 'forward-error':
        this.pending.get(response.requestId)?.reject(new Error(response.message));
        this.pending.delete(response.requestId);
        return;
    }
  }

  private crash(): void {
    const error = workerCrashed();
    this.failure = error;
    this.ready?.reject(error);
    this.ready = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
