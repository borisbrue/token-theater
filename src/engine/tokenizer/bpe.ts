import type { BpeDetail, BpeWord, Token } from '../../trace/types';
import type { Tokenizer } from '../types';
import { BYTE_TO_UNICODE, UNICODE_TO_BYTE } from './byte-level';
import { pretokenize } from './pretokenize';

/**
 * Byte-level BPE (SPEC-0003 §3.2, CON-0008). Symbole stehen intern im GPT-2-Zeichensatz
 * (ein Zeichen je Byte, siehe byte-level.ts); nach außen gehen IDs, Bytes und `BpeDetail`.
 */

export interface BpeTables {
  /** Symbolfolge im GPT-2-Zeichensatz → ID. */
  vocab: ReadonlyMap<string, number>;
  /** Index = Rang der Merge-Regel. */
  merges: readonly (readonly [string, string])[];
}

export interface BpeTokenizerOptions {
  eosTokenId: number | null;
}

/** Ergebnis eines Pre-Tokens; liegt im Cache und verlässt die Klasse nur als Kopie. */
interface WordResult {
  stages: readonly (readonly string[])[];
  ranks: readonly number[];
  ids: readonly number[];
}

const encoder = new TextEncoder();
/** Nicht fatal: unvollständige UTF-8-Folgen werden zu U+FFFD (§3.5). */
const decoder = new TextDecoder('utf-8');

/** Paarschlüssel; Symbole enthalten nie ein Leerzeichen (es ist dort Ġ). */
function pairKey(left: string, right: string): string {
  return `${left} ${right}`;
}

function symbolBytes(symbol: string): number[] {
  return Array.from(symbol, (char) => {
    const byte = UNICODE_TO_BYTE.get(char);
    if (byte === undefined) throw new Error(`Zeichen außerhalb der Byte-Tabelle: ${char}`);
    return byte;
  });
}

/** Verschmilzt jedes benachbarte Vorkommen (left, right) von links nach rechts. */
function mergePair(symbols: readonly string[], left: string, right: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < symbols.length) {
    const current = symbols[i] ?? '';
    if (i + 1 < symbols.length && current === left && symbols[i + 1] === right) {
      out.push(left + right);
      i += 2;
    } else {
      out.push(current);
      i += 1;
    }
  }
  return out;
}

export class BpeTokenizer implements Tokenizer {
  readonly eosTokenId: number | null;
  readonly vocabSize: number;
  private readonly vocab: ReadonlyMap<string, number>;
  private readonly merges: readonly (readonly [string, string])[];
  private readonly ranks = new Map<string, number>();
  /** Index = ID; Lücken bei unvollständigen Tabellen bleiben undefined. */
  private readonly symbols: (string | undefined)[] = [];
  private readonly cache = new Map<string, WordResult>();

  /** Erwartet geprüfte Tabellen (parseGpt2Tables) und prüft selbst nicht (§3.4). */
  constructor(tables: BpeTables, options: BpeTokenizerOptions) {
    this.vocab = tables.vocab;
    this.merges = tables.merges;
    this.vocabSize = tables.vocab.size;
    this.eosTokenId = options.eosTokenId;
    tables.merges.forEach(([left, right], rank) => {
      const key = pairKey(left, right);
      if (!this.ranks.has(key)) this.ranks.set(key, rank);
    });
    for (const [symbol, id] of tables.vocab) this.symbols[id] = symbol;
  }

  encode(text: string): number[] {
    return pretokenize(text).flatMap((word) => [...this.bpe(word).ids]);
  }

  tokenize(text: string): Promise<Token[]> {
    return Promise.resolve(
      this.encode(text).map((id) => ({ id, text: decoder.decode(this.tokenBytes(id)) })),
    );
  }

  decode(tokens: Token[]): string {
    return this.decodeIds(tokens.map((token) => token.id));
  }

  /** Verkettet erst die Bytes aller Tokens und dekodiert dann einmal (§3.5). */
  decodeIds(ids: readonly number[]): string {
    const parts = ids.map((id) => this.tokenBytes(id));
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return decoder.decode(bytes);
  }

  tokenBytes(id: number): Uint8Array {
    const symbol = Number.isInteger(id) && id >= 0 ? this.symbols[id] : undefined;
    if (symbol === undefined) throw new RangeError(`Unbekannte Token-ID: ${id}`);
    return Uint8Array.from(symbolBytes(symbol));
  }

  explain(text: string): BpeDetail {
    return {
      words: pretokenize(text).map((word): BpeWord => {
        const result = this.bpe(word);
        return {
          text: word,
          bytes: Array.from(encoder.encode(word)),
          stages: result.stages.map((stage) => stage.map(symbolBytes)),
          ranks: [...result.ranks],
          ids: [...result.ids],
        };
      }),
    };
  }

  /** BPE eines Pre-Tokens: je Runde das Paar mit dem kleinsten Rang, an allen Stellen. */
  private bpe(word: string): WordResult {
    const cached = this.cache.get(word);
    if (cached !== undefined) return cached;

    let symbols = Array.from(encoder.encode(word), (byte) => BYTE_TO_UNICODE[byte] ?? '');
    const stages: string[][] = [symbols];
    const ranks: number[] = [];
    for (;;) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < symbols.length; i += 1) {
        const rank = this.ranks.get(pairKey(symbols[i] ?? '', symbols[i + 1] ?? ''));
        if (rank !== undefined && rank < best) best = rank;
      }
      const pair = this.merges[best];
      if (pair === undefined) break;
      symbols = mergePair(symbols, pair[0], pair[1]);
      stages.push(symbols);
      ranks.push(best);
    }
    const ids = symbols.map((symbol) => {
      const id = this.vocab.get(symbol);
      if (id === undefined) throw new Error(`Symbol nicht im Vokabular: ${symbol}`);
      return id;
    });
    const result: WordResult = { stages, ranks, ids };
    this.cache.set(word, result);
    return result;
  }
}
