// TST-0008 · CON-0008: GPT-2-BPE-Tokenizer, Regeln B-01 bis B-12.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { BpeWord } from '@/trace/types';
import { BYTE_TO_UNICODE, UNICODE_TO_BYTE } from '@/engine/tokenizer/byte-level';
import { GPT2_PATTERN, pretokenize } from '@/engine/tokenizer/pretokenize';
import { BpeTokenizer, type BpeTables } from '@/engine/tokenizer/bpe';
import {
  GPT2_ASSET_DIR,
  GPT2_EOS_TOKEN_ID,
  GPT2_MERGE_COUNT,
  GPT2_VOCAB_SIZE,
  loadGpt2Tokenizer,
  parseGpt2Tables,
  TokenizerLoadError,
} from '@/engine/tokenizer/gpt2';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const assetDir = join(repoRoot, 'public', 'tokenizers', 'gpt2');
const VOCAB_JSON = readFileSync(join(assetDir, 'vocab.json'), 'utf8');
const MERGES_TXT = readFileSync(join(assetDir, 'merges.txt'), 'utf8');

interface Reference {
  encode: { text: string; ids: number[] }[];
  pretokenize: { text: string; pretokens: string[] }[];
  explain: { text: string; words: BpeWord[] }[];
}
const reference = JSON.parse(
  readFileSync(join(repoRoot, '.sdd/contracts/behavior/gpt2-bpe-reference.json'), 'utf8'),
) as Reference;
const TEXTS = reference.encode.map((c) => c.text);

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
interface FetchCall {
  url: string;
  init: { signal?: AbortSignal } | undefined;
}

/** fetch, das `<baseUrl>tokenizers/gpt2/<datei>` aus dem Repo liefert und Aufrufe mitschreibt. */
function repoFetch(calls: FetchCall[] = [], files: Record<string, string> = {}): FetchFn {
  return (url, init) => {
    calls.push({ url, init });
    const name = url.slice(url.lastIndexOf('/') + 1);
    const body = files[name] ?? readFileSync(join(assetDir, name), 'utf8');
    return Promise.resolve(new Response(body, { status: 200 }));
  };
}

async function loadFresh(): Promise<BpeTokenizer> {
  return loadGpt2Tokenizer({ baseUrl: '/', fetch: repoFetch() });
}

async function loadError(promise: Promise<unknown>): Promise<TokenizerLoadError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TokenizerLoadError);
    return error as TokenizerLoadError;
  }
  throw new Error('kein Fehler geworfen');
}

function formatError(vocabJson: string, mergesTxt: string): TokenizerLoadError {
  try {
    parseGpt2Tables(vocabJson, mergesTxt);
  } catch (error) {
    expect(error).toBeInstanceOf(TokenizerLoadError);
    expect((error as TokenizerLoadError).kind).toBe('format');
    return error as TokenizerLoadError;
  }
  throw new Error('kein Formatfehler geworfen');
}

function vocabWith(change: (vocab: Record<string, unknown>) => void): string {
  const vocab = JSON.parse(VOCAB_JSON) as Record<string, unknown>;
  change(vocab);
  return JSON.stringify(vocab);
}

function mergeLines(): string[] {
  return MERGES_TXT.split('\n');
}

const encoder = new TextEncoder();
const lossy = new TextDecoder('utf-8');

function symbolBytes(symbol: string): number[] {
  return [...symbol].map((char) => {
    const byte = UNICODE_TO_BYTE.get(char);
    if (byte === undefined) throw new Error(`Zeichen ${char} nicht in der Byte-Tabelle`);
    return byte;
  });
}

function sameBytes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Verschmilzt alle benachbarten Vorkommen (a, b) von links nach rechts. */
function applyMerge(stage: number[][], a: number[], b: number[]): number[][] {
  const out: number[][] = [];
  let i = 0;
  while (i < stage.length) {
    const left = stage[i] ?? [];
    const right = stage[i + 1];
    if (right !== undefined && sameBytes(left, a) && sameBytes(right, b)) {
      out.push([...left, ...right]);
      i += 2;
    } else {
      out.push(left);
      i += 1;
    }
  }
  return out;
}

let gpt2: BpeTokenizer;
let tables: BpeTables;
let mergeBytes: [number[], number[]][];
let mergeKeys: Set<string>;

beforeAll(async () => {
  gpt2 = await loadFresh();
  tables = parseGpt2Tables(VOCAB_JSON, MERGES_TXT);
  mergeBytes = tables.merges.map(([a, b]) => [symbolBytes(a), symbolBytes(b)]);
  mergeKeys = new Set(tables.merges.map(([a, b]) => `${a} ${b}`));
}, 30_000);

describe('B-01 Byte-Tabelle', () => {
  it('B-01: 256 verschiedene Einzelzeichen nach der GPT-2-Konstruktionsregel', () => {
    expect(BYTE_TO_UNICODE).toHaveLength(256);
    expect(new Set(BYTE_TO_UNICODE).size).toBe(256);
    const printable = (b: number) =>
      (b >= 0x21 && b <= 0x7e) || (b >= 0xa1 && b <= 0xac) || (b >= 0xae && b <= 0xff);
    let next = 0x100;
    for (let b = 0; b < 256; b += 1) {
      const char = BYTE_TO_UNICODE[b] ?? '';
      expect([...char]).toHaveLength(1);
      if (printable(b)) {
        expect(char).toBe(String.fromCharCode(b));
      } else {
        expect(char).toBe(String.fromCharCode(next));
        next += 1;
      }
    }
    expect(next - 0x100).toBe(68);
    expect(BYTE_TO_UNICODE[32]).toBe('Ġ');
    expect(BYTE_TO_UNICODE[10]).toBe('Ċ');
    expect(BYTE_TO_UNICODE[0]).toBe('Ā');
  });

  it('B-01: UNICODE_TO_BYTE ist die exakte Umkehrung', () => {
    expect(UNICODE_TO_BYTE.size).toBe(256);
    BYTE_TO_UNICODE.forEach((char, byte) => expect(UNICODE_TO_BYTE.get(char)).toBe(byte));
  });
});

describe('B-02 Vorzerlegung', () => {
  it('B-02: GPT2_PATTERN hat die GPT-2-Quelle und die Flags g und u', () => {
    expect(GPT2_PATTERN.source).toBe(
      "'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+",
    );
    expect(GPT2_PATTERN.flags).toContain('g');
    expect(GPT2_PATTERN.flags).toContain('u');
  });

  it.each(reference.pretokenize)('B-02: pretokenize(%#) wie Referenz', ({ text, pretokens }) => {
    expect(pretokenize(text)).toEqual(pretokens);
    expect(pretokenize(text).join('')).toBe(text);
  });

  it('B-02: pretokenize("") ist leer und zweimal hintereinander gleich (kein lastIndex-Rest)', () => {
    expect(pretokenize('')).toEqual([]);
    expect(pretokenize('a b')).toEqual(pretokenize('a b'));
  });
});

describe('B-03 IDs wie tiktoken', () => {
  it.each(reference.encode)('B-03: encode(%#) wie Referenz', ({ text, ids }) => {
    expect(gpt2.encode(text)).toEqual(ids);
  });

  it('B-03: frischer Tokenizer und warmer Cache liefern dieselben IDs', async () => {
    const fresh = await loadFresh();
    for (const { text, ids } of reference.encode) expect(fresh.encode(text)).toEqual(ids);
    for (const { text, ids } of [...reference.encode].reverse()) {
      expect(fresh.encode(text)).toEqual(ids);
    }
  }, 20_000);
});

describe('B-04 Round-Trip', () => {
  it.each(TEXTS)('B-04: decodeIds(encode(t)) und decode(tokenize(t)) ergeben t (%#)', async (t) => {
    expect(gpt2.decodeIds(gpt2.encode(t))).toBe(t);
    expect(gpt2.decode(await gpt2.tokenize(t))).toBe(t);
  });
});

describe('B-05 Tokens', () => {
  it.each(TEXTS)(
    'B-05: tokenize liefert id und verlustbehafteten Text je Token (%#)',
    async (t) => {
      const tokens = await gpt2.tokenize(t);
      expect(tokens.map((token) => token.id)).toEqual(gpt2.encode(t));
      for (const token of tokens) {
        expect(token.text).toBe(lossy.decode(gpt2.tokenBytes(token.id)));
      }
    },
  );

  it('B-05: tokenBytes(8595) sind die Bytes von " Kat"; halbe Emoji-Folgen werden zu U+FFFD', async () => {
    expect([...gpt2.tokenBytes(8595)]).toEqual([32, 75, 97, 116]);
    expect(gpt2.tokenBytes(8595)).toBeInstanceOf(Uint8Array);
    const [first] = await gpt2.tokenize('🦊');
    expect(first?.id).toBe(8582);
    expect(first?.text).toContain('�');
  });
});

describe('B-06 explain', () => {
  it.each(reference.explain)('B-06: explain(%#) ist gleich der Referenz', ({ text, words }) => {
    expect(JSON.parse(JSON.stringify(gpt2.explain(text).words))).toEqual(words);
  });

  it.each(TEXTS)('B-06: Stufen, Ränge und IDs sind konsistent (%#)', (text) => {
    const detail = gpt2.explain(text);
    expect(detail.words.map((w) => w.text)).toEqual(pretokenize(text));
    for (const w of detail.words) {
      expect(w.bytes).toEqual([...encoder.encode(w.text)]);
      expect(w.stages[0]).toEqual(w.bytes.map((b) => [b]));
      for (const stage of w.stages) expect(stage.flat()).toEqual(w.bytes);
      expect(w.ranks).toHaveLength(w.stages.length - 1);
      w.ranks.forEach((rank, i) => {
        expect(Number.isInteger(rank)).toBe(true);
        if (i > 0) expect(rank).toBeGreaterThan(w.ranks[i - 1] ?? -1);
        const [a, b] = mergeBytes[rank] ?? [[], []];
        const before = w.stages[i] ?? [];
        const after = applyMerge(before, a, b);
        expect(after.length, `Runde ${i} verschmilzt mindestens ein Paar`).toBeLessThan(
          before.length,
        );
        expect(w.stages[i + 1]).toEqual(after);
      });
      const last = w.stages.at(-1) ?? [];
      const symbols = last.map((bytes) => bytes.map((b) => BYTE_TO_UNICODE[b] ?? '').join(''));
      for (let i = 0; i + 1 < symbols.length; i += 1) {
        expect(mergeKeys.has(`${symbols[i]} ${symbols[i + 1]}`)).toBe(false);
      }
      expect(w.ids).toHaveLength(last.length);
      w.ids.forEach((id, i) => expect([...gpt2.tokenBytes(id)]).toEqual(last[i]));
    }
    expect(detail.words.flatMap((w) => w.ids)).toEqual(gpt2.encode(text));
  });

  it('B-06: ein Pre-Token ohne Merge hat genau eine Stufe', () => {
    const [dot] = gpt2.explain('.').words;
    expect(dot?.stages).toEqual([[[46]]]);
    expect(dot?.ranks).toEqual([]);
    expect(dot?.ids).toEqual([13]);
  });
});

describe('B-07 Cache ohne Wirkung', () => {
  function miniTables(): BpeTables {
    const vocab = new Map<string, number>(BYTE_TO_UNICODE.map((char, byte) => [char, byte]));
    vocab.set('ab', 256);
    vocab.set('abc', 257);
    return {
      vocab,
      merges: [
        ['a', 'b'],
        ['ab', 'c'],
      ],
    };
  }

  it('B-07: Mini-Tabellen: encode("abcab") = [257, 256] mit Stufen a b c a b → ab c ab → abc ab', () => {
    const mini = new BpeTokenizer(miniTables(), { eosTokenId: null });
    expect(mini.encode('abcab')).toEqual([257, 256]);
    const [word] = mini.explain('abcab').words;
    expect(word?.ranks).toEqual([0, 1]);
    expect(word?.stages).toEqual([
      [[97], [98], [99], [97], [98]],
      [[97, 98], [99], [97, 98]],
      [
        [97, 98, 99],
        [97, 98],
      ],
    ]);
    expect(mini.vocabSize).toBe(258);
    expect(mini.eosTokenId).toBeNull();
  });

  it('B-07: der Konstruktor prüft nicht; fehlt ein Endsymbol im Vokabular, wirft encode', () => {
    const broken = miniTables();
    const vocab = new Map(broken.vocab);
    vocab.delete('abc');
    const mini = new BpeTokenizer({ vocab, merges: broken.merges }, { eosTokenId: null });
    expect(() => mini.encode('abc')).toThrow(Error);
  });

  it('B-07: veränderte Rückgabewerte beeinflussen spätere Ergebnisse nicht', () => {
    const mini = new BpeTokenizer(miniTables(), { eosTokenId: null });
    const ids = mini.encode('abcab');
    ids.push(999);
    ids[0] = 1;
    expect(mini.encode('abcab')).toEqual([257, 256]);
    const detail = mini.explain('abcab');
    const word = detail.words[0];
    word?.ids.push(5);
    word?.ranks.push(7);
    word?.stages[0]?.push([1]);
    word?.stages[1]?.[0]?.push(1);
    detail.words.push({ text: 'x', bytes: [120], stages: [[[120]]], ranks: [], ids: [120] });
    const again = mini.explain('abcab');
    expect(again.words).toHaveLength(1);
    expect(again.words[0]?.ids).toEqual([257, 256]);
    expect(again.words[0]?.ranks).toEqual([0, 1]);
    expect(again.words[0]?.stages[1]).toEqual([[97, 98], [99], [97, 98]]);
  });

  it('B-07: GPT-2: zweimal explain/encode desselben Textes ist gleich', () => {
    const text = 'Die Katze schläft auf dem Sofa.';
    expect(gpt2.explain(text)).toEqual(gpt2.explain(text));
    expect(gpt2.encode(text)).toEqual(gpt2.encode(text));
  });
});

describe('B-08 Unbekannte IDs', () => {
  it('B-08: decodeIds, tokenBytes und decode werfen RangeError', () => {
    expect(() => gpt2.decodeIds([50257])).toThrow(RangeError);
    expect(() => gpt2.tokenBytes(-1)).toThrow(RangeError);
    expect(() => gpt2.tokenBytes(1.5)).toThrow(RangeError);
    expect(() => gpt2.decode([{ id: 99999, text: '' }])).toThrow(RangeError);
  });
});

describe('B-09 Spezialtoken und Kennzahlen', () => {
  it('B-09: EOS 50256, 50257 Tokens; <|endoftext|> im Text ist normaler Text', () => {
    expect(GPT2_EOS_TOKEN_ID).toBe(50256);
    expect(GPT2_VOCAB_SIZE).toBe(50257);
    expect(GPT2_MERGE_COUNT).toBe(50000);
    expect(gpt2.eosTokenId).toBe(50256);
    expect(gpt2.vocabSize).toBe(50257);
    const expected = reference.encode.find((c) => c.text === '<|endoftext|>')?.ids;
    expect(expected).toHaveLength(7);
    expect(gpt2.encode('<|endoftext|>')).toEqual(expected);
    expect(gpt2.decodeIds([50256])).toBe('<|endoftext|>');
  });
});

describe('B-10 Laden und Prüfen', () => {
  it.each(['/', '/app/'])(
    'B-10: lädt genau zwei Dateien relativ zu baseUrl %s',
    async (baseUrl) => {
      const calls: FetchCall[] = [];
      const controller = new AbortController();
      const tokenizer = await loadGpt2Tokenizer({
        baseUrl,
        fetch: repoFetch(calls),
        signal: controller.signal,
      });
      expect(GPT2_ASSET_DIR).toBe('tokenizers/gpt2/');
      expect(calls.map((c) => c.url).sort()).toEqual(
        [`${baseUrl}tokenizers/gpt2/merges.txt`, `${baseUrl}tokenizers/gpt2/vocab.json`].sort(),
      );
      for (const call of calls) expect(call.init?.signal).toBe(controller.signal);
      expect(tokenizer.encode('Hello world')).toEqual([15496, 995]);
    },
    20_000,
  );

  it('B-10: abgelehntes fetch → network', async () => {
    const error = await loadError(
      loadGpt2Tokenizer({ baseUrl: '/', fetch: () => Promise.reject(new TypeError('offline')) }),
    );
    expect(error.kind).toBe('network');
    expect(error.name).toBe('TokenizerLoadError');
    expect(error).toBeInstanceOf(Error);
  });

  it('B-10: HTTP 404 → network', async () => {
    const fetch: FetchFn = (url) =>
      Promise.resolve(
        url.endsWith('vocab.json')
          ? new Response('not found', { status: 404 })
          : new Response(MERGES_TXT, { status: 200 }),
      );
    expect((await loadError(loadGpt2Tokenizer({ baseUrl: '/', fetch }))).kind).toBe('network');
  }, 20_000);

  it('B-10: ungültiger Inhalt über loadGpt2Tokenizer → format', async () => {
    const fetch = repoFetch([], { 'vocab.json': '[]' });
    expect((await loadError(loadGpt2Tokenizer({ baseUrl: '/', fetch }))).kind).toBe('format');
  });

  const lines = (): string[] => mergeLines();
  const cases: [string, () => [string, string]][] = [
    ['vocab.json kein JSON', () => ['nicht json', MERGES_TXT]],
    ['vocab.json ist ein Array', () => ['[]', MERGES_TXT]],
    ['Wert keine Ganzzahl', () => [vocabWith((v) => (v['!'] = 1.5)), MERGES_TXT]],
    ['Wert ist ein String', () => [vocabWith((v) => (v['!'] = '0')), MERGES_TXT]],
    ['ein Eintrag fehlt', () => [vocabWith((v) => delete v['<|endoftext|>']), MERGES_TXT]],
    ['ID doppelt', () => [vocabWith((v) => (v['"'] = 0)), MERGES_TXT]],
    ['ID außerhalb', () => [vocabWith((v) => (v['!'] = 50257)), MERGES_TXT]],
    [
      'EOS nicht 50256',
      () => [
        vocabWith((v) => {
          v['<|endoftext|>'] = 0;
          v['!'] = 50256;
        }),
        MERGES_TXT,
      ],
    ],
    ['Kopfzeile fehlt', () => [VOCAB_JSON, lines().slice(1).join('\n')]],
    [
      'eine Merge-Zeile fehlt',
      () => {
        const l = lines();
        return [VOCAB_JSON, [...l.slice(0, 1), ...l.slice(2)].join('\n')];
      },
    ],
    [
      'drei Teile',
      () => {
        const l = lines();
        l[1] = 'Ġ t x';
        return [VOCAB_JSON, l.join('\n')];
      },
    ],
    [
      'leerer Teil',
      () => {
        const l = lines();
        l[1] = 'Ġ ';
        return [VOCAB_JSON, l.join('\n')];
      },
    ],
    [
      'Teil nicht im Vokabular',
      () => {
        const l = lines();
        l[1] = 'a ✗';
        return [VOCAB_JSON, l.join('\n')];
      },
    ],
    [
      'Verkettung nicht im Vokabular',
      () => {
        const l = lines();
        l[1] = 'z q';
        return [VOCAB_JSON, l.join('\n')];
      },
    ],
  ];

  it.each(cases)(
    'B-10: %s → format',
    (_name, make) => {
      const [vocabJson, mergesTxt] = make();
      formatError(vocabJson, mergesTxt);
    },
    20_000,
  );

  it('B-10: CRLF-Zeilenenden und Leerzeilen am Ende werden toleriert', () => {
    const crlf = MERGES_TXT.split('\n').join('\r\n') + '\r\n\r\n';
    const parsed = parseGpt2Tables(VOCAB_JSON, crlf);
    expect(parsed.merges).toHaveLength(50000);
    expect(parsed.merges[0]).toEqual(['Ġ', 't']);
    const tokenizer = new BpeTokenizer(parsed, { eosTokenId: GPT2_EOS_TOKEN_ID });
    expect(tokenizer.encode('Die Katze')).toEqual([32423, 8595, 2736]);
  }, 20_000);

  it('B-10: die Originaldateien ergeben Tabellen mit 50257 Einträgen und 50000 Merges', () => {
    expect(tables.vocab.size).toBe(50257);
    expect(tables.vocab.get('<|endoftext|>')).toBe(50256);
    expect(tables.merges).toHaveLength(50000);
  });
});

describe('B-11 Assets', () => {
  const sha256 = (name: string) =>
    createHash('sha256')
      .update(readFileSync(join(assetDir, name)))
      .digest('hex');

  it('B-11: vocab.json und merges.txt sind die Originaldateien', () => {
    expect(sha256('vocab.json')).toBe(
      '196139668be63f3b5d6574427317ae82f612a97c5d1cdaf36ed2256dbf636783',
    );
    expect(sha256('merges.txt')).toBe(
      '1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5',
    );
  });

  it('B-11: LICENSE liegt daneben, Prettier ignoriert die Assets', () => {
    const license = readFileSync(join(assetDir, 'LICENSE'), 'utf8');
    expect(license).toContain('Modified MIT License');
    expect(license).toContain('OpenAI');
    const ignore = readFileSync(join(repoRoot, '.prettierignore'), 'utf8').split('\n');
    expect(ignore.map((line) => line.trim())).toContain('public/tokenizers/');
  });

  it('B-11: kein Modul unter src/ importiert vocab.json oder merges.txt', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx|css)$/.test(name)) files.push(full);
      }
    };
    walk(join(repoRoot, 'src'));
    const importPattern =
      /(import\s[^;]*?from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)['"`][^'"`]*(vocab\.json|merges\.txt)/;
    const offenders = files.filter((file) => importPattern.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('B-12 Performance', () => {
  it('B-12: encode von 10 000 Zeichen dauert auf einem frischen Tokenizer < 500 ms', async () => {
    const fresh = await loadFresh();
    const sentence = 'Die Katze schläft auf dem Sofa.';
    const text = Array.from({ length: 400 }, () => sentence)
      .join(' ')
      .slice(0, 10_000);
    expect(text).toHaveLength(10_000);
    const start = performance.now();
    const ids = fresh.encode(text);
    const elapsed = performance.now() - start;
    expect(ids.length).toBeGreaterThan(3000);
    expect(elapsed).toBeLessThan(500);
  }, 20_000);

  it('B-12: parseGpt2Tables plus Konstruktion dauert < 3000 ms', () => {
    const start = performance.now();
    const parsed = parseGpt2Tables(VOCAB_JSON, MERGES_TXT);
    const tokenizer = new BpeTokenizer(parsed, { eosTokenId: GPT2_EOS_TOKEN_ID });
    const elapsed = performance.now() - start;
    expect(tokenizer.vocabSize).toBe(50257);
    expect(elapsed).toBeLessThan(3000);
  }, 20_000);
});
