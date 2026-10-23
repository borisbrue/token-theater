import type {
  LogitsStation,
  SamplingParams,
  Station,
  StationKind,
  Token,
  TokenizeStation,
  TraceEvent,
} from '../trace/types';
import type { GenerateDeps, GenerateRequest, InferenceEngine, Sampler } from './types';

/**
 * Autoregressive Schleife (SPEC-0001 §3.4, CON-0002). Feste Abfolge: Anfrage prüfen →
 * run-start → tokenize → je Schritt forward → sample → Token anhängen, bis maxTokens oder EOS.
 * Event-Grammatik: run-start (step-start station+ step-end)* (step-start station*)? (done|error).
 */

export const MAX_TOKENS_LIMIT = 32;

export type GenerateErrorKind = 'empty-prompt' | 'invalid-max-tokens' | 'context-too-long';

export class GenerateError extends Error {
  readonly kind: GenerateErrorKind;

  constructor(kind: GenerateErrorKind, message: string) {
    super(message);
    this.name = 'GenerateError';
    this.kind = kind;
  }
}

/** Verstoß einer Engine gegen ihre Pflichten (CON-0002 INV-01). */
class EngineContractError extends Error {}

/** Stationen, die der Generator selbst erzeugt und forward nie liefern darf. */
const GENERATOR_KINDS: ReadonlySet<StationKind> = new Set(['tokenize', 'sample']);

function validate(request: GenerateRequest): void {
  if (request.prompt.trim().length === 0) {
    throw new GenerateError('empty-prompt', 'Der Prompt ist leer');
  }
  const { maxTokens } = request;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_LIMIT) {
    throw new GenerateError(
      'invalid-max-tokens',
      `maxTokens muss eine Ganzzahl in 1–${MAX_TOKENS_LIMIT} sein, ist ${maxTokens}`,
    );
  }
}

/** Eigene Funktion statt Property-Zugriff: Das Signal ändert sich zwischen den yields. */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Die Stationen eines Schritts bis einschließlich logits. Der forward-Durchlauf beginnt mit dem
 * Schritt (vor der tokenize-Station); sein Iterator wird bei jedem Ausstieg geschlossen – nach
 * Abbruch, Fehler oder wenn der Konsument die Iteration verlässt (CON-0002 INV-03).
 * Liefert die logits-Station oder undefined, wenn der Lauf mit done/error geendet hat.
 */
async function* forwardStep(
  engine: InferenceEngine,
  capabilities: ReadonlySet<StationKind>,
  context: readonly Token[],
  newPositions: [number, number],
  tokenize: TokenizeStation,
  index: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<TraceEvent, LogitsStation | undefined, undefined> {
  let iterator: AsyncIterator<Station> | undefined;
  try {
    let last: Station | undefined;
    try {
      iterator = engine.forward([...context], newPositions, signal)[Symbol.asyncIterator]();
    } catch (error) {
      yield { type: 'error', message: messageOf(error) };
      return undefined;
    }
    if (index === 0 && capabilities.has('tokenize')) {
      yield { type: 'station', index, station: tokenize };
      if (aborted(signal)) {
        yield { type: 'done', finishReason: 'aborted' };
        return undefined;
      }
    }
    try {
      for (;;) {
        const result = await iterator.next();
        if (result.done === true) break;
        const station = result.value;
        if (GENERATOR_KINDS.has(station.kind)) {
          throw new EngineContractError(
            `forward darf keine ${station.kind}-Station liefern (erzeugt der Generator)`,
          );
        }
        if (!capabilities.has(station.kind)) {
          throw new EngineContractError(
            `Station ${station.kind} liegt außerhalb der Fähigkeiten der Engine`,
          );
        }
        last = station;
        yield { type: 'station', index, station };
        if (aborted(signal)) {
          yield { type: 'done', finishReason: 'aborted' };
          return undefined;
        }
      }
      if (last?.kind !== 'logits') {
        throw new EngineContractError('forward endet nicht mit einer logits-Station');
      }
      return last;
    } catch (error) {
      // Ein Fehler nach dem Abbruch (z. B. abgebrochene Server-Anfrage) ist ein Abbruch (SPEC-0005 FR-04).
      if (aborted(signal)) {
        yield { type: 'done', finishReason: 'aborted' };
        return undefined;
      }
      yield { type: 'error', message: messageOf(error) };
      return undefined;
    }
  } finally {
    await iterator?.return?.();
  }
}

export async function* generate(
  engine: InferenceEngine,
  sampler: Sampler,
  request: GenerateRequest,
  deps: GenerateDeps,
  signal?: AbortSignal,
): AsyncGenerator<TraceEvent, void, undefined> {
  validate(request);
  const tokenizer = engine.tokenizer;
  const { info } = engine;
  const prompt = await tokenizer.tokenize(request.prompt);
  // BPE-Details nur, wenn der Tokenizer die Fähigkeit hat (SPEC-0003 §3.3, CON-0008 B-13).
  const bpe = tokenizer.explain?.(request.prompt);
  const tokenize: TokenizeStation =
    bpe === undefined
      ? { kind: 'tokenize', tokens: [...prompt] }
      : { kind: 'tokenize', tokens: [...prompt], bpe };
  const contextLength = info.architecture?.contextLength;
  if (contextLength !== undefined && prompt.length + request.maxTokens - 1 > contextLength) {
    throw new GenerateError(
      'context-too-long',
      `Prompt (${prompt.length} Tokens) + maxTokens − 1 überschreitet contextLength ${contextLength}`,
    );
  }

  const rng = deps.createRng(request.seed);
  const capabilities = new Set<StationKind>(info.capabilities);
  const sampling: SamplingParams = {
    strategy: sampler.strategy,
    seed: request.seed,
    params: { ...sampler.params },
  };
  yield {
    type: 'run-start',
    engine: info,
    prompt: request.prompt,
    maxTokens: request.maxTokens,
    sampling,
  };

  const context: Token[] = [...prompt];
  for (let index = 0; index < request.maxTokens; index += 1) {
    if (aborted(signal)) {
      yield { type: 'done', finishReason: 'aborted' };
      return;
    }
    const newPositions: [number, number] =
      index === 0 ? [0, context.length] : [context.length - 1, context.length];
    yield { type: 'step-start', index, contextTokens: [...context], newPositions };
    const logits = yield* forwardStep(
      engine,
      capabilities,
      context,
      newPositions,
      tokenize,
      index,
      signal,
    );
    if (logits === undefined) {
      return;
    }

    let sample;
    try {
      sample = sampler.sample(logits, rng);
    } catch (error) {
      yield { type: 'error', message: messageOf(error) };
      return;
    }
    yield { type: 'station', index, station: sample };
    if (aborted(signal)) {
      yield { type: 'done', finishReason: 'aborted' };
      return;
    }

    const chosen = sample.chosen;
    const text = tokenizer.decode([...context, chosen]);
    yield { type: 'step-end', index, chosen, text };
    if (chosen.id === tokenizer.eosTokenId) {
      yield { type: 'done', finishReason: 'eos' };
      return;
    }
    context.push(chosen);
  }
  yield { type: 'done', finishReason: 'max-tokens' };
}
