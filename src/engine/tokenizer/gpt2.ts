import { BpeTokenizer, type BpeTables } from './bpe';

/**
 * Laden und Prüfen des GPT-2-Vokabulars (SPEC-0003 §3.4, CON-0008 B-10). Nur
 * `parseGpt2Tables` baut aus Rohdaten Tabellen; ein kaputtes Vokabular scheitert laut statt
 * still falsche IDs zu liefern. Die Prüfungen laufen in fester Reihenfolge: Struktur, Anzahl,
 * Eindeutigkeit und EOS, zuletzt die Abdeckung der Merges.
 */

export const GPT2_EOS_TOKEN_ID = 50256;
export const GPT2_VOCAB_SIZE = 50257;
export const GPT2_MERGE_COUNT = 50000;
/** Relativ zur Basis-URL der App; die Dateien liegen unter public/ (eigener Origin). */
export const GPT2_ASSET_DIR = 'tokenizers/gpt2/';

const EOS_SYMBOL = '<|endoftext|>';

export type TokenizerLoadErrorKind = 'network' | 'format';

export class TokenizerLoadError extends Error {
  readonly kind: TokenizerLoadErrorKind;

  constructor(kind: TokenizerLoadErrorKind, message: string) {
    super(message);
    this.name = 'TokenizerLoadError';
    this.kind = kind;
  }
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface LoadGpt2Options {
  /** Endet auf '/', z. B. import.meta.env.BASE_URL. */
  baseUrl: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

function formatError(message: string): never {
  throw new TokenizerLoadError('format', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVocab(vocabJson: string): Map<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(vocabJson);
  } catch {
    formatError('vocab.json ist kein gültiges JSON');
  }
  if (!isRecord(parsed)) formatError('vocab.json ist kein JSON-Objekt');
  const entries = Object.entries(parsed);
  if (entries.length !== GPT2_VOCAB_SIZE) {
    formatError(`vocab.json hat ${entries.length} statt ${GPT2_VOCAB_SIZE} Einträge`);
  }
  const vocab = new Map<string, number>();
  const seen = new Set<number>();
  for (const [symbol, id] of entries) {
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      formatError(`vocab.json: ID von ${symbol} ist keine Ganzzahl`);
    }
    if (id < 0 || id >= GPT2_VOCAB_SIZE) formatError(`vocab.json: ID ${id} außerhalb`);
    if (seen.has(id)) formatError(`vocab.json: ID ${id} doppelt`);
    seen.add(id);
    vocab.set(symbol, id);
  }
  if (vocab.get(EOS_SYMBOL) !== GPT2_EOS_TOKEN_ID) {
    formatError(`vocab.json: ${EOS_SYMBOL} ist nicht ${GPT2_EOS_TOKEN_ID}`);
  }
  return vocab;
}

function parseMerges(mergesTxt: string, vocab: ReadonlyMap<string, number>): [string, string][] {
  const lines = mergesTxt.split(/\r?\n/);
  if (!(lines[0] ?? '').startsWith('#version')) {
    formatError('merges.txt beginnt nicht mit #version');
  }
  const body = lines.slice(1);
  while (body.at(-1) === '') body.pop();
  if (body.length !== GPT2_MERGE_COUNT) {
    formatError(`merges.txt hat ${body.length} statt ${GPT2_MERGE_COUNT} Regeln`);
  }
  return body.map((line, index): [string, string] => {
    const parts = line.split(' ');
    const [left, right] = parts;
    if (parts.length !== 2 || !left || !right) {
      formatError(`merges.txt Zeile ${index + 2}: erwartet zwei Teile`);
    }
    if (!vocab.has(left) || !vocab.has(right) || !vocab.has(left + right)) {
      formatError(`merges.txt Zeile ${index + 2}: Symbol nicht im Vokabular`);
    }
    return [left, right];
  });
}

export function parseGpt2Tables(vocabJson: string, mergesTxt: string): BpeTables {
  const vocab = parseVocab(vocabJson);
  return { vocab, merges: parseMerges(mergesTxt, vocab) };
}

async function fetchText(fetchFn: FetchLike, url: string, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(url, { signal });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new TokenizerLoadError('network', `${url}: ${String(error)}`);
  }
  if (!response.ok) throw new TokenizerLoadError('network', `${url}: HTTP ${response.status}`);
  try {
    return await response.text();
  } catch (error) {
    throw new TokenizerLoadError('network', `${url}: ${String(error)}`);
  }
}

/** Factory Method: lädt beide Dateien relativ zu baseUrl und baut den geprüften Tokenizer. */
export async function loadGpt2Tokenizer(options: LoadGpt2Options): Promise<BpeTokenizer> {
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const base = `${options.baseUrl}${GPT2_ASSET_DIR}`;
  const [vocabJson, mergesTxt] = await Promise.all([
    fetchText(fetchFn, `${base}vocab.json`, options.signal),
    fetchText(fetchFn, `${base}merges.txt`, options.signal),
  ]);
  return new BpeTokenizer(parseGpt2Tables(vocabJson, mergesTxt), {
    eosTokenId: GPT2_EOS_TOKEN_ID,
  });
}
