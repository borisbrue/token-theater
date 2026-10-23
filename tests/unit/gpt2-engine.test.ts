// TST-0015 · CON-0014: GPT-2-Engine gegen Referenzwerte aus Hugging Face transformers (G-01 bis G-09).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Station, Tensor, Trace } from '@/trace/types';
import { STATION_KINDS } from '@/trace/types';
import { parseSafetensors, type SafeTensor } from '@/engine/gpt2/safetensors';
import { parseGpt2Config, type Gpt2Config } from '@/engine/gpt2/config';
import { mapGpt2Weights } from '@/engine/gpt2/weights';
import { Gpt2Model } from '@/engine/gpt2/model';
import { Gpt2LoadError } from '@/engine/gpt2/errors';
import type { WorkerCommand, WorkerResponse } from '@/engine/gpt2/protocol';
import { createGpt2WorkerHandler } from '@/engine/gpt2/worker-handler';
import { Gpt2Engine, type Gpt2EngineDeps, type WorkerLike } from '@/engine/gpt2/gpt2-engine';
import { loadGpt2Tokenizer } from '@/engine/tokenizer/gpt2';
import type { BpeTokenizer } from '@/engine/tokenizer/bpe';
import { serializeTrace } from '@/trace/serialize';
import { validateTrace } from '@/trace/schema';
import { checkInvariants } from '@/trace/invariants';
import { createEngine } from '@/app/engine-factory';
import { createRng } from '@/engine/rng';

import { freshSetup, run } from './helpers/engine-setup';
import { assertViolation, lintAs } from './helpers/lint-as';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureDir = join(repoRoot, 'tests/fixtures/gpt2');
const readBuffer = (name: string): ArrayBuffer => {
  const bytes = readFileSync(join(fixtureDir, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const CONFIG_JSON: unknown = JSON.parse(
  readFileSync(join(fixtureDir, 'tiny-gpt2.config.json'), 'utf8'),
);

interface GoldenLayer {
  lnIn_attn: number[][];
  qkv: number[][];
  attn_out: number[][];
  lnIn_mlp: number[][];
  hidden: number[][];
  mlp_out: number[][];
  block_out: number[][];
}
interface GoldenCase {
  prompt: string;
  ids: number[];
  embed: number[][];
  layers: GoldenLayer[];
  attentions: number[][][][];
  top_ids: number[];
  top_logits: number[];
  top_probs: number[];
  coverage100: number;
  greedy: number[];
  next_ids: number[];
  next_logits: number[];
}
const golden = JSON.parse(readFileSync(join(fixtureDir, 'tiny-gpt2.golden.json'), 'utf8')) as {
  cases: GoldenCase[];
};
const [CASE_A, CASE_B] = golden.cases as [GoldenCase, GoldenCase];

const ACT = 1e-4;
const ATT = 1e-5;
const LOGIT = 1e-3;
const PROB = 1e-5;

let config: Gpt2Config;
let tensors: Map<string, SafeTensor>;
let tokenizer: BpeTokenizer;

beforeAll(async () => {
  tensors = parseSafetensors(readBuffer('tiny-gpt2.safetensors'));
  config = parseGpt2Config(CONFIG_JSON);
  const assetDir = join(repoRoot, 'public', 'tokenizers', 'gpt2');
  tokenizer = await loadGpt2Tokenizer({
    baseUrl: '/',
    fetch: (url) =>
      Promise.resolve(
        new Response(readFileSync(join(assetDir, url.slice(url.lastIndexOf('/') + 1)), 'utf8')),
      ),
  });
}, 30_000);

function model(topN?: number): Gpt2Model {
  return new Gpt2Model(config, mapGpt2Weights(tensors, config), topN === undefined ? {} : { topN });
}

function rows(tensor: Tensor): number[][] {
  const [n, d] = tensor.shape as [number, number];
  return Array.from({ length: n }, (_, i) => Array.from(tensor.data.subarray(i * d, (i + 1) * d)));
}

function expectClose(actual: number[][], expected: number[][], tol: number, label: string): void {
  expect(actual.length, `${label}: Zeilen`).toBe(expected.length);
  actual.forEach((row, i) => {
    expect(row.length, `${label}: Spalten`).toBe(expected[i]?.length);
    row.forEach((value, j) => {
      const want = expected[i]?.[j] ?? NaN;
      expect(
        Math.abs(value - want),
        `${label}[${i}][${j}] ${value} vs ${want}`,
      ).toBeLessThanOrEqual(tol);
    });
  });
}

function columns(matrix: number[][], from: number, to: number): number[][] {
  return matrix.map((row) => row.slice(from, to));
}

function add(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((v, j) => v + (b[i]?.[j] ?? NaN)));
}

function station<K extends Station['kind']>(
  stations: Station[],
  kind: K,
  layer?: number,
  after?: 'attention' | 'mlp',
): Extract<Station, { kind: K }> {
  const found = stations.find(
    (s) =>
      s.kind === kind &&
      (layer === undefined || ('layer' in s && s.layer === layer)) &&
      (after === undefined || ('after' in s && s.after === after)),
  );
  if (found === undefined) throw new Error(`Station ${kind} ${layer ?? ''} ${after ?? ''} fehlt`);
  return found as Extract<Station, { kind: K }>;
}

function weightsMatrix(tensor: Tensor): number[][][] {
  const [h, n, b] = tensor.shape as [number, number, number];
  return Array.from({ length: h }, (_, hi) =>
    Array.from({ length: n }, (_, i) =>
      Array.from(tensor.data.subarray((hi * n + i) * b, (hi * n + i + 1) * b)),
    ),
  );
}

async function gpt2Error(action: () => unknown): Promise<Gpt2LoadError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(Gpt2LoadError);
    return error as Gpt2LoadError;
  }
  throw new Error('kein Gpt2LoadError');
}

/** safetensors-Puffer aus Header und Datenbytes. */
function buildSafetensors(header: Record<string, unknown>, data: Uint8Array): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + json.length + data.length);
  new DataView(out.buffer).setBigUint64(0, BigInt(json.length), true);
  out.set(json, 8);
  out.set(data, 8 + json.length);
  return out.buffer;
}

describe('G-01 safetensors', () => {
  it('G-01: Testmodell mit 28 F32-Tensoren und Formen', () => {
    expect(tensors.size).toBe(28);
    expect(tensors.has('__metadata__')).toBe(false);
    for (const t of tensors.values()) expect(t.dtype).toBe('F32');
    expect(tensors.get('wte.weight')?.shape).toEqual([50257, 8]);
    expect(tensors.get('wpe.weight')?.shape).toEqual([64, 8]);
    expect(tensors.get('h.0.attn.c_attn.weight')?.shape).toEqual([8, 24]);
    expect(tensors.get('h.1.mlp.c_fc.weight')?.shape).toEqual([8, 32]);
    expect(tensors.get('wte.weight')?.data).toHaveLength(50257 * 8);
  });

  it('G-01: F16 wird nach Float32 umgerechnet', () => {
    const f16 = parseSafetensors(readBuffer('f16-sample.safetensors'));
    for (const [name, rowsCount] of [
      ['wpe.weight', 4],
      ['ln_f.bias', 1],
    ] as const) {
      const half = f16.get(name);
      const full = tensors.get(name);
      expect(half?.dtype).toBe('F16');
      const data = half?.data ?? new Float32Array();
      const reference = full?.data?.subarray(0, data.length) ?? new Float32Array();
      expect(data.length).toBe(rowsCount * 8);
      data.forEach((v, i) => {
        const want = reference[i] ?? NaN;
        expect(Math.abs(v - want)).toBeLessThanOrEqual(Math.abs(want) * 2 ** -10 + 1e-7);
      });
    }
  });

  it('G-01: BF16 wird umgerechnet, andere dtypes ergeben data null', () => {
    const bf16 = new Uint8Array([0x80, 0x3f, 0x00, 0xc0]);
    const parsed = parseSafetensors(
      buildSafetensors(
        {
          a: { dtype: 'BF16', shape: [2], data_offsets: [0, 4] },
          m: { dtype: 'I64', shape: [1], data_offsets: [4, 12] },
          __metadata__: { format: 'pt' },
        },
        new Uint8Array([...bf16, 1, 0, 0, 0, 0, 0, 0, 0]),
      ),
    );
    expect(Array.from(parsed.get('a')?.data ?? [])).toEqual([1, -2]);
    expect(parsed.get('m')?.data).toBeNull();
  });

  it.each([
    ['zu kurz', () => new Uint8Array([1, 2, 3]).buffer],
    [
      'Header über das Ende',
      () => {
        const b = new Uint8Array(16);
        new DataView(b.buffer).setBigUint64(0, 999n, true);
        return b.buffer;
      },
    ],
    [
      'Header kein JSON',
      () => {
        const json = new TextEncoder().encode('{kaputt');
        const b = new Uint8Array(8 + json.length);
        new DataView(b.buffer).setBigUint64(0, BigInt(json.length), true);
        b.set(json, 8);
        return b.buffer;
      },
    ],
    [
      'Offsets außerhalb',
      () =>
        buildSafetensors(
          { a: { dtype: 'F32', shape: [2], data_offsets: [0, 8] } },
          new Uint8Array(4),
        ),
    ],
    [
      'Offsets rückwärts',
      () =>
        buildSafetensors(
          { a: { dtype: 'F32', shape: [1], data_offsets: [4, 0] } },
          new Uint8Array(4),
        ),
    ],
    [
      'Länge passt nicht zur Form',
      () =>
        buildSafetensors(
          { a: { dtype: 'F32', shape: [3], data_offsets: [0, 8] } },
          new Uint8Array(8),
        ),
    ],
  ])('G-01: %s → format', async (_name, make) => {
    const error = await gpt2Error(() => parseSafetensors(make()));
    expect(error.kind).toBe('format');
    expect(error.name).toBe('Gpt2LoadError');
  });
});

describe('G-02 Konfiguration', () => {
  it('G-02: Testmodell und Varianten', () => {
    expect(config).toEqual({
      nLayers: 2,
      nHeads: 2,
      dModel: 8,
      dMlp: 32,
      vocabSize: 50257,
      contextLength: 64,
      layerNormEpsilon: 1e-5,
    });
    const base = CONFIG_JSON as Record<string, unknown>;
    expect(parseGpt2Config({ ...base, n_inner: 16 }).dMlp).toBe(16);
    const withoutEps = { ...base };
    delete withoutEps['layer_norm_epsilon'];
    expect(parseGpt2Config(withoutEps).layerNormEpsilon).toBe(1e-5);
    expect(parseGpt2Config({ ...base, activation_function: 'gelu' }).nLayers).toBe(2);
  });

  it.each([
    ['n_layer fehlt', { n_layer: undefined }],
    ['n_head 0', { n_head: 0 }],
    ['n_embd nicht teilbar', { n_embd: 9 }],
    ['relu', { activation_function: 'relu' }],
  ])('G-02: %s → format', async (_name, change) => {
    const error = await gpt2Error(() =>
      parseGpt2Config({ ...(CONFIG_JSON as Record<string, unknown>), ...change }),
    );
    expect(error.kind).toBe('format');
  });
});

describe('G-03 Gewichte', () => {
  function variant(change: (map: Map<string, SafeTensor>) => void): Map<string, SafeTensor> {
    const copy = new Map(tensors);
    change(copy);
    return copy;
  }

  it('G-03: mit und ohne Präfix gleich; Puffer und lm_head stören nicht', () => {
    const prefixed = new Map([...tensors].map(([k, v]) => [`transformer.${k}`, v]));
    prefixed.set('transformer.h.0.attn.bias', { dtype: 'I64', shape: [1], data: null });
    prefixed.set('transformer.h.0.attn.masked_bias', {
      dtype: 'F32',
      shape: [],
      data: new Float32Array([-1e4]),
    });
    prefixed.set('lm_head.weight', tensors.get('wte.weight') as SafeTensor);
    const a = new Gpt2Model(config, mapGpt2Weights(tensors, config)).forward(CASE_A.ids, [
      0,
      CASE_A.ids.length,
    ]);
    const b = new Gpt2Model(config, mapGpt2Weights(prefixed, config)).forward(CASE_A.ids, [
      0,
      CASE_A.ids.length,
    ]);
    expect(b).toEqual(a);
  });

  it.each([
    ['fehlt', (m: Map<string, SafeTensor>) => m.delete('h.1.ln_2.bias'), 'h.1.ln_2.bias'],
    [
      'falsche Form',
      (m: Map<string, SafeTensor>) =>
        m.set('wpe.weight', { dtype: 'F32', shape: [63, 8], data: new Float32Array(63 * 8) }),
      'wpe.weight',
    ],
    [
      'data null',
      (m: Map<string, SafeTensor>) =>
        m.set('ln_f.weight', { dtype: 'I64', shape: [8], data: null }),
      'ln_f.weight',
    ],
  ])('G-03: Tensor %s → format mit Namen', async (_name, change, tensorName) => {
    const error = await gpt2Error(() =>
      mapGpt2Weights(
        variant((m) => void change(m)),
        config,
      ),
    );
    expect(error.kind).toBe('format');
    expect(error.message).toContain(tensorName);
  });
});

describe('G-04 Rechnung gegen die Referenz', () => {
  it.each(golden.cases.map((c) => [c.prompt, c] as const))('G-04: %s', (_prompt, gold) => {
    const n = gold.ids.length;
    const stations = model().forward(gold.ids, [0, n]);
    const kinds = stations.map((s) => (s.kind === 'residual' ? `residual:${s.after}` : s.kind));
    expect(kinds).toEqual([
      'embed',
      'attention',
      'residual:attention',
      'mlp',
      'residual:mlp',
      'attention',
      'residual:attention',
      'mlp',
      'residual:mlp',
      'logits',
    ]);

    const embed = station(stations, 'embed');
    const wte = tensors.get('wte.weight')?.data ?? new Float32Array();
    const wpe = tensors.get('wpe.weight')?.data ?? new Float32Array();
    expect(rows(embed.token)).toEqual(
      gold.ids.map((id) => Array.from(wte.subarray(id * 8, id * 8 + 8))),
    );
    expect(rows(embed.position)).toEqual(
      gold.ids.map((_, i) => Array.from(wpe.subarray(i * 8, i * 8 + 8))),
    );
    expectClose(rows(embed.sum), gold.embed, ACT, 'embed.sum');

    let stream = gold.embed;
    gold.layers.forEach((layer, l) => {
      const attention = station(stations, 'attention', l);
      expectClose(rows(attention.lnIn), layer.lnIn_attn, ACT, `L${l} attention.lnIn`);
      expectClose(rows(attention.q), columns(layer.qkv, 0, 8), ACT, `L${l} q`);
      expectClose(rows(attention.k), columns(layer.qkv, 8, 16), ACT, `L${l} k`);
      expectClose(rows(attention.v), columns(layer.qkv, 16, 24), ACT, `L${l} v`);
      expect(attention.weights.shape).toEqual([2, n, n]);
      weightsMatrix(attention.weights).forEach((head, h) =>
        expectClose(head, gold.attentions[l]?.[h] ?? [], ATT, `L${l} weights h${h}`),
      );
      expectClose(rows(attention.out), layer.attn_out, ACT, `L${l} attention.out`);
      const afterAttention = add(stream, layer.attn_out);
      expectClose(
        rows(station(stations, 'residual', l, 'attention').stream),
        afterAttention,
        ACT,
        `L${l} residual`,
      );
      const mlp = station(stations, 'mlp', l);
      expectClose(rows(mlp.lnIn), layer.lnIn_mlp, ACT, `L${l} mlp.lnIn`);
      expectClose(rows(mlp.hidden), layer.hidden, ACT, `L${l} mlp.hidden`);
      expectClose(rows(mlp.out), layer.mlp_out, ACT, `L${l} mlp.out`);
      expectClose(
        rows(station(stations, 'residual', l, 'mlp').stream),
        layer.block_out,
        ACT,
        `L${l} block`,
      );
      stream = layer.block_out;
    });

    const logits = station(stations, 'logits');
    expect(logits.vocabSize).toBe(50257);
    expect(logits.distribution.map((c) => c.token.id)).toEqual(gold.top_ids);
    logits.distribution.forEach((c, i) => {
      expect(Math.abs((c.logit ?? NaN) - (gold.top_logits[i] ?? NaN))).toBeLessThanOrEqual(LOGIT);
      expect(Math.abs(c.prob - (gold.top_probs[i] ?? NaN) / gold.coverage100)).toBeLessThanOrEqual(
        PROB,
      );
      expect(c.token.text).toBe('');
    });
    expect(Math.abs((logits.coverage ?? NaN) - gold.coverage100)).toBeLessThanOrEqual(1e-6);
  });

  it('G-04: Attention-Gewichte erfüllen INV-09 (kausal, Zeilensumme 1)', () => {
    const stations = model().forward(CASE_A.ids, [0, CASE_A.ids.length]);
    for (const s of stations) {
      if (s.kind !== 'attention') continue;
      weightsMatrix(s.weights).forEach((head) =>
        head.forEach((row, i) => {
          row.forEach((w, j) => {
            expect(w).toBeGreaterThanOrEqual(0);
            if (j > i) expect(w).toBe(0);
          });
          expect(Math.abs(row.reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(1e-5);
        }),
      );
    }
  });
});

describe('G-05 KV-Cache', () => {
  it('G-05: Folgeschritt nutzt den Cache und stimmt mit der Referenz', () => {
    const m = model();
    const n = CASE_A.ids.length;
    m.forward(CASE_A.ids, [0, n]);
    const next = m.forward([...CASE_A.ids, CASE_A.greedy[0] ?? 0], [n, n + 1]);
    const attention = station(next, 'attention', 1);
    expect(attention.q.shape).toEqual([1, 8]);
    expect(attention.weights.shape).toEqual([2, 1, n + 1]);
    expect(station(next, 'mlp', 0).hidden.shape).toEqual([1, 32]);
    expect(station(next, 'embed').sum.shape).toEqual([1, 8]);
    const top = station(next, 'logits').distribution.slice(0, 10);
    expect(top.map((c) => c.token.id)).toEqual(CASE_A.next_ids);
    top.forEach((c, i) =>
      expect(Math.abs((c.logit ?? NaN) - (CASE_A.next_logits[i] ?? NaN))).toBeLessThanOrEqual(
        LOGIT,
      ),
    );
  });

  it('G-05: anderer Kontext verwirft den Cache; Wiederholung ist gleich', () => {
    const m = model();
    m.forward(CASE_A.ids, [0, CASE_A.ids.length]);
    const b = m.forward(CASE_B.ids, [0, CASE_B.ids.length]);
    expect(station(b, 'logits').distribution.map((c) => c.token.id)).toEqual(CASE_B.top_ids);
    expectClose(
      rows(station(b, 'residual', 1, 'mlp').stream),
      CASE_B.layers[1]?.block_out ?? [],
      ACT,
      'B block',
    );
    const again = m.forward(CASE_B.ids, [0, CASE_B.ids.length]);
    expect(again).toEqual(b);
  });
});

/** In-Process-Worker: Nachrichten per structuredClone, asynchron zugestellt. */
function inProcessWorker(): WorkerLike & { terminated: boolean; crash(): void } {
  const worker: WorkerLike & { terminated: boolean; crash(): void } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(command: WorkerCommand) {
      const copy = structuredClone(command);
      queueMicrotask(() => handler(copy));
    },
    terminate() {
      worker.terminated = true;
    },
    crash() {
      queueMicrotask(() => worker.onerror?.(new Error('boom')));
    },
  };
  const handler = createGpt2WorkerHandler((response: WorkerResponse) => {
    const copy = structuredClone(response);
    queueMicrotask(() => worker.onmessage?.({ data: copy }));
  });
  return worker;
}

describe('G-06 Worker-Protokoll', () => {
  function recordingHandler(): { send: (c: WorkerCommand) => void; responses: WorkerResponse[] } {
    const responses: WorkerResponse[] = [];
    return { send: createGpt2WorkerHandler((r) => responses.push(r)), responses };
  }

  it('G-06: init → ready, forward → stations mit requestId', async () => {
    const { send, responses } = recordingHandler();
    send({ type: 'forward', requestId: 1, context: CASE_A.ids, positions: [0, 6] });
    send({
      type: 'init',
      config: CONFIG_JSON,
      weights: readBuffer('tiny-gpt2.safetensors'),
      topN: 100,
    });
    send({ type: 'forward', requestId: 2, context: CASE_A.ids, positions: [0, 6] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responses[0]).toMatchObject({ type: 'forward-error', requestId: 1 });
    expect(responses[1]).toEqual({
      type: 'ready',
      architecture: {
        nLayers: 2,
        nHeads: 2,
        dModel: 8,
        dMlp: 32,
        vocabSize: 50257,
        contextLength: 64,
      },
      kernel: 'wasm-simd',
    });
    const stations = responses[2];
    expect(stations?.type).toBe('stations');
    if (stations?.type === 'stations') {
      expect(stations.requestId).toBe(2);
      expect(stations.stations.at(-1)?.kind).toBe('logits');
    }
  });

  it('G-06: kaputter Puffer → init-error', async () => {
    const { send, responses } = recordingHandler();
    send({
      type: 'init',
      config: CONFIG_JSON,
      weights: new Uint8Array([1, 2, 3]).buffer,
      topN: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responses[0]?.type).toBe('init-error');
    if (responses[0]?.type === 'init-error') {
      expect(responses[0].message.startsWith('Die Gewichtsdatei ist ungültig: ')).toBe(true);
    }
  });
});

describe('G-07 Engine (Proxy)', () => {
  function deps(
    overrides: Partial<Gpt2EngineDeps> = {},
    worker = inProcessWorker(),
  ): Gpt2EngineDeps {
    return {
      tokenizer,
      createWorker: () => worker,
      loadWeights: () =>
        Promise.resolve({ config: CONFIG_JSON, weights: readBuffer('tiny-gpt2.safetensors') }),
      ...overrides,
    };
  }

  async function greedyRun(
    engine: Gpt2Engine,
    maxTokens = 5,
    signal?: AbortSignal,
  ): Promise<Trace> {
    const setup = await freshSetup({}, engine);
    return (await run(setup, CASE_A.prompt, maxTokens, signal === undefined ? {} : { signal }))
      .trace;
  }

  it('G-07: info nach load, Greedy wie transformers, gültiger Trace mit BPE', async () => {
    const engine = new Gpt2Engine({ model: 'Tiny GPT-2 (Test)' }, deps());
    await engine.load();
    expect(engine.info).toEqual({
      kind: 'gpt2',
      model: 'Tiny GPT-2 (Test)',
      capabilities: STATION_KINDS.filter((kind) => kind !== 'moe'),
      architecture: {
        nLayers: 2,
        nHeads: 2,
        dModel: 8,
        dMlp: 32,
        vocabSize: 50257,
        contextLength: 64,
      },
      eosTokenId: 50256,
    });
    expect(engine.tokenizer).toBe(tokenizer);
    const trace = await greedyRun(engine);
    expect(trace.steps.map((s) => s.chosen.id)).toEqual(CASE_A.greedy);
    const serialized: unknown = JSON.parse(serializeTrace(trace));
    expect(validateTrace(serialized)).toEqual({ ok: true });
    expect(checkInvariants(serialized)).toEqual([]);
    const tokenize = trace.steps[0]?.stations[0];
    expect(tokenize?.kind === 'tokenize' ? tokenize.bpe : undefined).toBeDefined();
    const logits = trace.steps[0]?.stations.find((s) => s.kind === 'logits');
    if (logits?.kind !== 'logits') throw new Error('keine logits-Station');
    for (const c of logits.distribution.slice(0, 5)) {
      expect(c.token.text).toBe(tokenizer.decode([{ id: c.token.id, text: '' }]));
    }
  });

  it('G-07: Ladefehler aus loadWeights und init-error', async () => {
    const failing = new Gpt2Engine(
      { model: 'm' },
      deps({ loadWeights: () => Promise.reject(new Error('offline')) }),
    );
    await expect(failing.load()).rejects.toThrow('offline');
    const broken = new Gpt2Engine(
      { model: 'm' },
      deps({
        loadWeights: () => Promise.resolve({ config: CONFIG_JSON, weights: new ArrayBuffer(4) }),
      }),
    );
    const error = await gpt2Error(() => broken.load());
    expect(error.kind).toBe('format');
    expect(error.message.startsWith('Die Gewichtsdatei ist ungültig: ')).toBe(true);
  });

  it('G-07: Abbruch vor dem Laden und während eines Schritts', async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = new Gpt2Engine({ model: 'm' }, deps());
    await expect(engine.load(undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    const running = new Gpt2Engine({ model: 'm' }, deps());
    await running.load();
    const stop = new AbortController();
    const setup = await freshSetup({}, running);
    const result = run(setup, CASE_A.prompt, 5, {
      signal: stop.signal,
      onEvent: (event) => {
        if (event.type === 'step-end' && event.index === 1) stop.abort();
      },
    });
    const { trace } = await result;
    expect(trace.finishReason).toBe('aborted');
    expect(trace.steps.length).toBeLessThan(5);
  });

  it('G-07: Absturz des Workers wird gemeldet', async () => {
    const worker = inProcessWorker();
    const engine = new Gpt2Engine({ model: 'm' }, deps({}, worker));
    await engine.load();
    worker.crash();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trace = await greedyRun(engine);
    expect(trace.finishReason).toBe('error');
    expect(trace.error?.message).toBe('Der GPT-2-Worker ist abgestürzt.');
  });

  it('G-07: Prompt-Grenze und dispose', async () => {
    const worker = inProcessWorker();
    const engine = new Gpt2Engine({ model: 'm', maxPromptTokens: 4 }, deps({}, worker));
    await engine.load();
    const trace = await greedyRun(engine, 2);
    expect(trace.finishReason).toBe('error');
    expect(trace.error?.message).toBe(
      'Der Prompt hat 6 Tokens; die GPT-2-Engine erlaubt höchstens 4.',
    );
    engine.dispose();
    expect(worker.terminated).toBe(true);
  });
});

describe('G-08 Factory und Schichtregel', () => {
  const engineDeps = { createRng, idProvider: () => 'id', clock: () => '2026-10-22T00:00:00Z' };

  it('G-08: createEngine("gpt2") ohne Optionen wirft', () => {
    expect(() => createEngine('gpt2', engineDeps)).toThrow(Error);
  });

  it('G-08: nur engine-factory.ts darf src/engine/gpt2 importieren', async () => {
    const code =
      "import { Gpt2Engine } from '../engine/gpt2/gpt2-engine';\n\nexport const G = Gpt2Engine;\n";
    assertViolation(await lintAs(code, 'src/app/gpt2-check.ts'), ['import-x/no-restricted-paths']);
    const factory = await lintAs(code, 'src/app/engine-factory.ts');
    expect(factory.ruleIds).not.toContain('import-x/no-restricted-paths');
    const inner = "import { Gpt2Model } from './gpt2/model';\n\nexport const M = Gpt2Model;\n";
    assertViolation(await lintAs(inner, 'src/engine/gpt2-check.ts'), [
      'import-x/no-restricted-paths',
    ]);
  });

  it('G-08: src/engine/gpt2 erfüllt R-02 bis R-04', async () => {
    const target = 'src/engine/gpt2/rule-check.ts';
    assertViolation(await lintAs('export const r = Math.random();\n', target), [
      'no-restricted-syntax',
      'no-restricted-properties',
    ]);
    assertViolation(
      await lintAs(
        "import { deserializeTrace } from '../../trace/serialize';\nexport const d = deserializeTrace;\n",
        target,
      ),
      ['@typescript-eslint/no-restricted-imports'],
    );
    assertViolation(
      await lintAs('export function f(x: any): number {\n  return Number(x);\n}\n', target),
      ['@typescript-eslint/no-explicit-any'],
    );
  });
});

describe('G-09 Performance', () => {
  it('G-09: Testmodell über 6 Tokens nach Aufwärmen < 50 ms', () => {
    const m = model();
    m.forward(CASE_A.ids, [0, CASE_A.ids.length]);
    const fresh = model();
    fresh.forward(CASE_B.ids, [0, CASE_B.ids.length]);
    const start = performance.now();
    fresh.forward(CASE_A.ids, [0, CASE_A.ids.length]);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
