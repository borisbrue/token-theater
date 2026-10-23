import type { EngineInfo, Station, Token } from '../../trace/types';
import type { InferenceEngine, Tokenizer } from '../types';
import { dialectById, DIALECTS, type DialectId, type RemoteDialect } from './dialects';
import { toLogitsStation } from './distribution';
import { badFormat } from './errors';
import { globalFetch, requestJson, type FetchLike } from './http';
import { bytesText, utf8Bytes } from './token-bytes';
import { TokenRegistry } from './token-registry';

/**
 * Engine für OpenAI-kompatible Completions-Server (SPEC-0005, CON-0012): je Schritt eine
 * Anfrage nach den Top-N-Logprobs des nächsten Tokens (`max_tokens: 1`); gezogen wird im Client.
 */

export type Dialect = DialectId;
export type { FetchLike };

export interface RemoteConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dialect: Dialect;
  topN: number;
}

export interface RemoteDeps {
  fetch?: FetchLike;
}

/** Kontext-Token ohne Vokabular-ID (Prompt bei Servern ohne Echo), größer als jedes Vokabular. */
export const PROMPT_TOKEN_ID = 2147483647;

export const DIALECT_MAX_TOP_N = Object.fromEntries(
  DIALECTS.map((d) => [d.id, d.maxTopN]),
) as Readonly<Record<Dialect, number>>;

function topNFor(dialect: RemoteDialect, topN: number): number {
  return Number.isInteger(topN) && topN >= 1 && topN <= dialect.maxTopN ? topN : dialect.maxTopN;
}

class RemoteTokenizer implements Tokenizer {
  readonly eosTokenId = null;

  constructor(private readonly engine: RemoteEngine) {}

  tokenize(text: string): Promise<Token[]> {
    return this.engine.tokenizePrompt(text);
  }

  decode(tokens: Token[]): string {
    return this.engine.decode(tokens);
  }
}

export class RemoteEngine implements InferenceEngine {
  readonly info: EngineInfo;
  readonly tokenizer: Tokenizer;
  private readonly dialect: RemoteDialect;
  private readonly topN: number;
  private readonly registry = new TokenRegistry();
  private readonly fetchFn: FetchLike;

  constructor(
    private readonly config: RemoteConfig,
    deps: RemoteDeps = {},
  ) {
    this.dialect = dialectById(config.dialect);
    this.topN = topNFor(this.dialect, config.topN);
    this.fetchFn = deps.fetch ?? globalFetch;
    this.info = {
      kind: `remote-${this.dialect.id}`,
      model: config.model,
      capabilities: this.dialect.canTokenize
        ? ['tokenize', 'logits', 'sample']
        : ['logits', 'sample'],
      architecture: null,
      eosTokenId: null,
    };
    this.tokenizer = new RemoteTokenizer(this);
  }

  load(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    // Kein Zustand außerhalb des Objekts: Verbindungen hält fetch selbst.
  }

  async *forward(
    context: Token[],
    _newPositions: [number, number],
    signal?: AbortSignal,
  ): AsyncIterable<Station> {
    const json = await this.complete(this.decode(context), false, signal);
    yield toLogitsStation(this.dialect.readStep(json), this.topN, this.registry);
  }

  /**
   * Prompt-Tokens: per Echo (RE-07) oder ein Kontext-Token mit PROMPT_TOKEN_ID. Die Echo-Anfrage
   * läuft ohne AbortSignal, weil das Tokenizer-Interface (CON-0002) keines vorsieht; abbrechbar
   * sind die Schritt-Anfragen in forward.
   */
  async tokenizePrompt(prompt: string): Promise<Token[]> {
    if (!this.dialect.canTokenize) return [{ id: PROMPT_TOKEN_ID, text: prompt }];
    const echoed = this.dialect.readEcho(await this.complete(prompt, true)).slice(0, -1);
    for (let k = 0; k <= echoed.length; k += 1) {
      const rest = echoed.slice(k);
      if (bytesText(rest.flatMap((t) => t.bytes)) !== prompt) continue;
      return rest.map((token) => {
        const id = this.registry.idFor(token.key);
        this.registry.remember(id, token.bytes);
        return { id, text: bytesText(token.bytes) };
      });
    }
    throw badFormat();
  }

  /** Verkettet die Bytes aller Tokens und dekodiert einmal (halbe UTF-8-Folgen bleiben heil). */
  decode(tokens: readonly Token[]): string {
    return bytesText(
      tokens.flatMap((token) =>
        // Das Prompt-Token trägt keine Vokabular-ID: immer die Bytes seines eigenen Textes.
        token.id === PROMPT_TOKEN_ID ? utf8Bytes(token.text) : this.registry.bytesOf(token),
      ),
    );
  }

  private complete(prompt: string, echo: boolean, signal?: AbortSignal): Promise<unknown> {
    const body = {
      model: this.config.model,
      prompt,
      max_tokens: 1,
      temperature: 1,
      ...this.dialect.requestFields(this.topN, echo),
    };
    return requestJson(this.fetchFn, this.config, '/completions', body, signal);
  }
}
