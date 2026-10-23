// TST-0009 · CON-0008 B-13 und CON-0001 v0.3.0 INV-16: BPE-Details im Trace.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { InferenceEngine } from '@/engine/types';
import type { BpeDetail, EngineInfo, LogitsStation, Station, Trace } from '@/trace/types';
import type { BpeTokenizer } from '@/engine/tokenizer/bpe';
import { loadGpt2Tokenizer } from '@/engine/tokenizer/gpt2';
import { deserializeTrace, serializeTrace } from '@/trace/serialize';
import { TraceImportError } from '@/trace/import-chain';
import { validateTrace } from '@/trace/schema';
import { checkInvariants } from '@/trace/invariants';

import { freshSetup, run } from './helpers/engine-setup';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const assetDir = join(repoRoot, 'public', 'tokenizers', 'gpt2');
const FIXTURE = readFileSync(join(repoRoot, 'tests/fixtures/traces/gpt2-bpe.trace.json'), 'utf8');
const PROMPT = 'Die Katze schläft auf dem Sofa.';

const repoFetch = (url: string): Promise<Response> =>
  Promise.resolve(
    new Response(readFileSync(join(assetDir, url.slice(url.lastIndexOf('/') + 1)), 'utf8')),
  );

/** Test-Engine aus CON-0008 B-13: GPT-2-Tokenizer, nur tokenize/logits/sample. */
class TokenizerOnlyEngine implements InferenceEngine {
  readonly info: EngineInfo = {
    kind: 'test',
    model: 'gpt2-tokenizer-only',
    capabilities: ['tokenize', 'logits', 'sample'],
    architecture: null,
    eosTokenId: 50256,
  };

  constructor(readonly tokenizer: BpeTokenizer) {}

  load(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
  }

  disposed = false;

  /** Genau eine logits-Station je Schritt. */
  async *forward(): AsyncIterable<Station> {
    const logits: LogitsStation = {
      kind: 'logits',
      vocabSize: 50257,
      distribution: [
        { token: { id: 1175, text: ' war' }, logit: null, prob: 0.6 },
        { token: { id: 318, text: ' is' }, logit: null, prob: 0.4 },
      ],
      coverage: null,
    };
    yield await Promise.resolve(logits);
  }
}

type Json = Record<string, unknown>;

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

let tokenizer: BpeTokenizer;
let trace: Trace;
let serialized: string;

beforeAll(async () => {
  tokenizer = await loadGpt2Tokenizer({ baseUrl: '/', fetch: repoFetch });
  const setup = await freshSetup({}, new TokenizerOnlyEngine(tokenizer));
  trace = (await run(setup, PROMPT, 2)).trace;
  serialized = serializeTrace(trace);
}, 30_000);

function tokenizeStation(t: Trace): Station | undefined {
  return t.steps[0]?.stations.find((s) => s.kind === 'tokenize');
}

/** Frische Kopie des serialisierten Traces mit Zugriff auf bpe und tokenize. */
function mutable(): {
  root: Json;
  words: Json[];
  tokens: Json[];
  steps: Json[];
} {
  const root = JSON.parse(serialized) as Json;
  const steps = root['steps'] as Json[];
  const station = (steps[0]?.['stations'] as Json[])[0] as Json;
  const bpe = station['bpe'] as Json;
  return {
    root,
    words: bpe['words'] as Json[],
    tokens: station['tokens'] as Json[],
    steps,
  };
}

function importError(root: Json): TraceImportError {
  try {
    deserializeTrace(JSON.stringify(root));
  } catch (error) {
    expect(error).toBeInstanceOf(TraceImportError);
    return error as TraceImportError;
  }
  throw new Error('Import hat nicht abgelehnt');
}

function expectInv16(root: Json): void {
  const error = importError(root);
  expect(error.kind).toBe('semantic');
  const inv16 = error.errors.filter((e) => e.invariant === 'INV-16');
  expect(inv16.length).toBeGreaterThan(0);
  for (const issue of inv16) expect(issue.path.startsWith('/steps/0/stations/0/bpe')).toBe(true);
  expect(error.errors.every((e) => e.invariant === 'INV-16')).toBe(true);
}

function word(words: Json[], index: number): Json {
  const w = words[index];
  if (w === undefined) throw new Error(`Wort ${index} fehlt`);
  return w;
}

describe('B-13 Generator hängt BPE-Details an', () => {
  it('B-13: tokenize-Station enthält bpe = tokenizer.explain(prompt)', () => {
    const station = tokenizeStation(trace);
    expect(station?.kind).toBe('tokenize');
    if (station?.kind !== 'tokenize') return;
    const bpe: BpeDetail | undefined = station.bpe;
    expect(bpe).toBeDefined();
    expect(asJson(bpe)).toEqual(asJson(tokenizer.explain(PROMPT)));
    expect(station.tokens.map((t) => t.id)).toEqual(tokenizer.encode(PROMPT));
  });

  it('B-13: der Trace besteht Schema, Invarianten und Round-Trip', () => {
    const parsed: unknown = JSON.parse(serialized);
    expect(validateTrace(parsed)).toEqual({ ok: true });
    expect(checkInvariants(parsed)).toEqual([]);
    const again = deserializeTrace(serialized);
    expect(serializeTrace(again)).toBe(serialized);
    const station = tokenizeStation(again);
    expect(station?.kind === 'tokenize' ? asJson(station.bpe) : null).toEqual(
      asJson(tokenizer.explain(PROMPT)),
    );
  });

  it('B-13: MockEngine-Traces haben keinen Schlüssel bpe', async () => {
    const setup = await freshSetup();
    const mockTrace = (await run(setup, 'die katze sitzt', 2)).trace;
    const station = tokenizeStation(mockTrace);
    expect(station).toBeDefined();
    expect(Object.keys(station ?? {})).not.toContain('bpe');
    const json = serializeTrace(mockTrace);
    expect(json).not.toContain('"bpe"');
    expect(() => deserializeTrace(json)).not.toThrow();
  });
});

describe('INV-16 BPE-Details', () => {
  it('INV-16: der Fixture-Trace ist gültig und passt zum Tokenizer', () => {
    const fixture = deserializeTrace(FIXTURE);
    const station = tokenizeStation(fixture);
    expect(station?.kind).toBe('tokenize');
    if (station?.kind !== 'tokenize') return;
    expect(asJson(station.bpe)).toEqual(asJson(tokenizer.explain('Die Katze')));
  });

  it('INV-16: Verkettung der Wörter ungleich prompt', () => {
    const { root } = mutable();
    root['prompt'] = `${PROMPT} `;
    expectInv16(root);
  });

  it('INV-16: bytes ungleich UTF-8 von text', () => {
    const { root, words } = mutable();
    const w = word(words, 0);
    w['text'] = 'Das';
    expectInv16(root);
  });

  it('INV-16: stages[0] sind nicht die Einzelbytes', () => {
    const { root, words } = mutable();
    const w = word(words, 1);
    const stages = w['stages'] as unknown[];
    const ranks = w['ranks'] as unknown[];
    stages.shift();
    ranks.shift();
    expectInv16(root);
  });

  it('INV-16: eine Stufe ergibt verkettet nicht die Bytes', () => {
    const { root, words } = mutable();
    const stages = word(words, 1)['stages'] as number[][][];
    const stage = stages[1];
    if (stage === undefined) throw new Error('Stufe fehlt');
    stage[0] = [0];
    expectInv16(root);
  });

  it('INV-16: eine Stufe hat nicht weniger Symbole als die vorige', () => {
    const { root, words } = mutable();
    const w = word(words, 1);
    const stages = w['stages'] as unknown[];
    const ranks = w['ranks'] as number[];
    stages.splice(1, 0, stages[0]);
    ranks.unshift(0);
    expectInv16(root);
  });

  it('INV-16: ranks hat nicht stages.length − 1 Einträge', () => {
    const { root, words } = mutable();
    (word(words, 1)['ranks'] as number[]).pop();
    expectInv16(root);
  });

  it('INV-16: Ränge nicht streng steigend', () => {
    const { root, words } = mutable();
    const ranks = word(words, 1)['ranks'] as number[];
    expect(ranks.length).toBeGreaterThan(1);
    ranks.reverse();
    expectInv16(root);
  });

  it('INV-16: ids passt nicht zur Symbolzahl der letzten Stufe', () => {
    const { root, words } = mutable();
    (word(words, 0)['ids'] as number[]).push(13);
    expectInv16(root);
  });

  it('INV-16: verkettete ids ungleich den Token-IDs', () => {
    const { root, words } = mutable();
    const ids = word(words, 0)['ids'] as number[];
    ids[0] = (ids[0] ?? 0) + 1;
    expectInv16(root);
  });

  it('INV-16: Token-Text ungleich der Dekodierung der Symbolbytes', () => {
    const { root, tokens, steps } = mutable();
    const changed = { ...(tokens[1] as Json), text: 'X' };
    tokens[1] = changed;
    for (const step of steps) {
      const context = step['contextTokens'] as Json[];
      context[1] = { ...changed };
    }
    expectInv16(root);
  });

  it('INV-16: Traces ohne bpe sind nicht betroffen', () => {
    const { root } = mutable();
    const station = ((root['steps'] as Json[])[0]?.['stations'] as Json[])[0] as Json;
    delete station['bpe'];
    expect(() => deserializeTrace(JSON.stringify(root))).not.toThrow();
  });
});

describe('Schema für bpe (CON-0001 v0.3.0)', () => {
  it('Schema: Byte außerhalb 0..255 → schema mit Pfad', () => {
    const { root, words } = mutable();
    (word(words, 0)['bytes'] as number[])[0] = 256;
    const error = importError(root);
    expect(error.kind).toBe('schema');
    expect(error.errors.map((e) => e.path)).toContain('/steps/0/stations/0/bpe/words/0/bytes/0');
  });

  it('Schema: fehlendes ids → schema', () => {
    const { root, words } = mutable();
    delete word(words, 0)['ids'];
    expect(importError(root).kind).toBe('schema');
  });

  it('Schema: leere stages → schema', () => {
    const { root, words } = mutable();
    word(words, 0)['stages'] = [];
    expect(importError(root).kind).toBe('schema');
  });

  it('Schema: bpe ohne words → schema', () => {
    const { root } = mutable();
    const station = ((root['steps'] as Json[])[0]?.['stations'] as Json[])[0] as Json;
    station['bpe'] = {};
    expect(importError(root).kind).toBe('schema');
  });
});
