import type { RawCandidate } from './distribution';
import { badFormat, noLogprobs } from './errors';
import { contentTokenBytes, legacyTokenBytes } from './token-bytes';

/**
 * Dialekte OpenAI-kompatibler Completions-Server (SPEC-0005 §3.2, CON-0012). Alles
 * Dialektwissen steckt hier; Engine, Erkennung und Maxima leiten sich aus DIALECTS ab. Ein neuer
 * Server-Dialekt ist ein weiterer Eintrag.
 */

export type DialectId = 'legacy' | 'content';

/** Ein Token aus dem Echo des Prompts. */
export interface RawToken {
  key: string;
  bytes: number[];
}

export interface RemoteDialect {
  readonly id: DialectId;
  readonly maxTopN: number;
  /** Liefert der Server die Prompt-Tokens (Echo)? */
  readonly canTokenize: boolean;
  requestFields(topN: number, echo: boolean): Record<string, unknown>;
  readStep(json: unknown): RawCandidate[];
  /** Alle echoten Tokens einschließlich des neu erzeugten letzten; nur bei canTokenize. */
  readEcho(json: unknown): RawToken[];
  matches(probe: unknown): boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstChoice(json: unknown): Record<string, unknown> | null {
  const choices = isRecord(json) ? json['choices'] : undefined;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  return isRecord(first) ? first : null;
}

/** choices[0].logprobs als Objekt oder null (wirft nicht; für matches). */
function peekLogprobs(json: unknown): Record<string, unknown> | null {
  const logprobs = firstChoice(json)?.['logprobs'];
  return isRecord(logprobs) ? logprobs : null;
}

/** choices[0].logprobs; ohne choices → format, ohne logprobs → no-logprobs. */
export function logprobsOf(json: unknown): Record<string, unknown> {
  const choice = firstChoice(json);
  if (choice === null) throw badFormat();
  const logprobs = choice['logprobs'];
  if (logprobs === null || logprobs === undefined) throw noLogprobs();
  if (!isRecord(logprobs)) throw badFormat();
  return logprobs;
}

function lastOf<T>(list: readonly T[]): T | undefined {
  return list[list.length - 1];
}

/** vLLM/mittwald: `logprobs: N`, Antwort mit tokens[] und top_logprobs[] als Objekt, ohne IDs. */
const legacy: RemoteDialect = {
  id: 'legacy',
  maxTopN: 20,
  canTokenize: true,
  requestFields: (topN, echo) => (echo ? { logprobs: topN, echo: true } : { logprobs: topN }),
  readStep(json) {
    const top = logprobsOf(json)['top_logprobs'];
    if (!Array.isArray(top)) throw noLogprobs();
    const last: unknown = lastOf(top);
    if (!isRecord(last)) throw noLogprobs();
    return Object.entries(last).map(([key, logprob]) => ({
      key,
      id: null,
      bytes: legacyTokenBytes(key),
      logprob: typeof logprob === 'number' ? logprob : Number.NaN,
    }));
  },
  readEcho(json) {
    const tokens = logprobsOf(json)['tokens'];
    if (!Array.isArray(tokens) || !tokens.every((t): t is string => typeof t === 'string')) {
      throw badFormat();
    }
    return tokens.map((key) => ({ key, bytes: legacyTokenBytes(key) }));
  },
  matches: (probe) => Array.isArray(peekLogprobs(probe)?.['tokens']),
};

/** MLX/OptiQ: `logprobs: true` + `top_logprobs`, Antwort mit content[] samt IDs. */
const content: RemoteDialect = {
  id: 'content',
  maxTopN: 10,
  canTokenize: false,
  requestFields: (topN) => ({ logprobs: true, top_logprobs: topN }),
  readStep(json) {
    const entries = logprobsOf(json)['content'];
    if (!Array.isArray(entries)) throw noLogprobs();
    const last: unknown = lastOf(entries);
    const top = isRecord(last) ? last['top_logprobs'] : undefined;
    if (!Array.isArray(top)) throw noLogprobs();
    return top.flatMap((entry: unknown): RawCandidate[] => {
      if (!isRecord(entry)) return [];
      const { id, token, logprob } = entry;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || typeof token !== 'string') {
        return [];
      }
      return [
        {
          key: token,
          id,
          bytes: contentTokenBytes(token),
          logprob: typeof logprob === 'number' ? logprob : Number.NaN,
        },
      ];
    });
  },
  readEcho() {
    throw badFormat();
  },
  matches: (probe) => Array.isArray(peekLogprobs(probe)?.['content']),
};

export const DIALECTS: readonly RemoteDialect[] = [legacy, content];

export function dialectById(id: DialectId): RemoteDialect {
  const dialect = DIALECTS.find((d) => d.id === id);
  if (dialect === undefined) throw new Error(`Unbekannter Dialekt: ${String(id)}`);
  return dialect;
}
