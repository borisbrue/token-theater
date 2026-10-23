import type { InferenceEngine, LoadProgress, Rng, Sampler, Tokenizer } from '@/engine/types';
import type {
  EngineInfo,
  LogitsStation,
  SampleStation,
  Station,
  StationKind,
  Token,
} from '@/trace/types';
import { GreedySampler } from '@/engine/samplers/greedy';
import { MockEngine } from '@/engine/mock/mock-engine';
import { DEFAULT_WEIGHT_SEED } from './engine-setup';

/** Basis für Test-Doubles: delegiert an eine echte MockEngine, Unterklassen verändern forward. */
abstract class WrappedEngine implements InferenceEngine {
  protected readonly inner: MockEngine;
  forwardCalls = 0;

  constructor(innerCapabilities?: StationKind[]) {
    this.inner = new MockEngine({
      weightSeed: DEFAULT_WEIGHT_SEED,
      ...(innerCapabilities ? { capabilities: innerCapabilities } : {}),
    });
  }

  get info(): EngineInfo {
    return this.inner.info;
  }

  get tokenizer(): Tokenizer {
    return this.inner.tokenizer;
  }

  load(onProgress?: (p: LoadProgress) => void, signal?: AbortSignal): Promise<void> {
    return this.inner.load(onProgress, signal);
  }

  dispose(): void {
    this.inner.dispose();
  }

  forward(
    context: Token[],
    newPositions: [number, number],
    signal?: AbortSignal,
  ): AsyncIterable<Station> {
    const call = this.forwardCalls++;
    return this.transform(this.inner.forward(context, newPositions, signal), call);
  }

  protected abstract transform(
    source: AsyncIterable<Station>,
    call: number,
  ): AsyncIterable<Station>;
}

/** Wirft in Schritt `failAtCall` nach der embed-Station einen Fehler. */
export class FailingAfterEmbedEngine extends WrappedEngine {
  constructor(
    private readonly failAtCall: number,
    private readonly message: string,
  ) {
    super();
  }

  protected async *transform(source: AsyncIterable<Station>, call: number): AsyncIterable<Station> {
    for await (const station of source) {
      yield station;
      if (call === this.failAtCall && station.kind === 'embed') throw new Error(this.message);
    }
  }
}

/** forward endet nach der embed-Station, ohne logits zu liefern. */
export class NoLogitsEngine extends WrappedEngine {
  protected async *transform(source: AsyncIterable<Station>): AsyncIterable<Station> {
    for await (const station of source) {
      yield station;
      if (station.kind === 'embed') return;
    }
  }
}

/** Meldet nur tokenize, logits, sample, liefert aber eine attention-Station. */
export class ExtraAttentionEngine extends WrappedEngine {
  private readonly full = new MockEngine({ weightSeed: DEFAULT_WEIGHT_SEED });

  constructor() {
    super(['tokenize', 'logits', 'sample']);
  }

  override load(onProgress?: (p: LoadProgress) => void, signal?: AbortSignal): Promise<void> {
    return Promise.all([super.load(onProgress, signal), this.full.load()]).then(() => undefined);
  }

  override forward(
    context: Token[],
    newPositions: [number, number],
    signal?: AbortSignal,
  ): AsyncIterable<Station> {
    this.forwardCalls++;
    const full = this.full.forward(context, newPositions, signal);
    const restricted = this.inner.forward(context, newPositions, signal);
    return (async function* () {
      for await (const station of full) {
        if (station.kind === 'attention') {
          yield station;
          break;
        }
      }
      yield* restricted;
    })();
  }

  protected transform(source: AsyncIterable<Station>): AsyncIterable<Station> {
    return source;
  }
}

/** Liefert vor der logits-Station zusätzlich eine sample-Station. */
export class SampleInForwardEngine extends WrappedEngine {
  protected async *transform(source: AsyncIterable<Station>): AsyncIterable<Station> {
    for await (const station of source) {
      if (station.kind === 'logits') {
        const first = station.distribution[0];
        if (!first) throw new Error('leere Verteilung');
        const fake: SampleStation = {
          kind: 'sample',
          distribution: station.distribution,
          random: null,
          chosen: first.token,
        };
        yield fake;
      }
      yield station;
    }
  }
}

/** Unverändertes Verhalten, zählt aber tokenize- und forward-Aufrufe. */
export class SpyEngine extends WrappedEngine {
  tokenizeCalls = 0;
  readonly forwardKinds: StationKind[][] = [];

  override get tokenizer(): Tokenizer {
    const inner = this.inner.tokenizer;
    return {
      eosTokenId: inner.eosTokenId,
      tokenize: (text: string): Promise<Token[]> => {
        this.tokenizeCalls++;
        return inner.tokenize(text);
      },
      decode: (tokens: Token[]): string => inner.decode(tokens),
    };
  }

  protected async *transform(source: AsyncIterable<Station>, call: number): AsyncIterable<Station> {
    this.forwardKinds[call] = [];
    for await (const station of source) {
      this.forwardKinds[call]?.push(station.kind);
      yield station;
    }
  }
}

/** GreedySampler mit Aufzeichnung der übergebenen logits-Stationen. */
export class SpySampler implements Sampler {
  private readonly inner = new GreedySampler();
  readonly calls: LogitsStation[] = [];

  get strategy(): string {
    return this.inner.strategy;
  }

  sample(logits: LogitsStation, rng: Rng): SampleStation {
    this.calls.push(logits);
    return this.inner.sample(logits, rng);
  }
}
