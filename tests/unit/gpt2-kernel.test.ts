// TST-0021 · CON-0019: GPT-2 mit Rechenkern (K-08 bis K-10), Referenz aus transformers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ResidualStation, Station, Tensor } from '@/trace/types';
import { createRng } from '@/engine/rng';
import { parseSafetensors } from '@/engine/gpt2/safetensors';
import { parseGpt2Config, type Gpt2Config } from '@/engine/gpt2/config';
import { mapGpt2Weights, type Gpt2Weights } from '@/engine/gpt2/weights';
import { Gpt2Model } from '@/engine/gpt2/model';
import { createJsKernel, createWasmKernel, type KernelSetup } from '@/engine/gpt2/kernel';
import type { WorkerCommand, WorkerResponse } from '@/engine/gpt2/protocol';
import { createGpt2WorkerHandler } from '@/engine/gpt2/worker-handler';
import { Gpt2Engine, type WorkerLike } from '@/engine/gpt2/gpt2-engine';
import { loadGpt2Tokenizer } from '@/engine/tokenizer/gpt2';
import type { BpeTokenizer } from '@/engine/tokenizer/bpe';

import { freshSetup, run } from './helpers/engine-setup';

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
interface LensLayer {
  layer: number;
  ids: number[];
  probs: number[];
}
interface LensCase {
  prompt: string;
  ids: number[];
  next: number;
  lens: LensLayer[];
  lensNext: LensLayer[];
}

const golden = JSON.parse(readFileSync(join(fixtureDir, 'tiny-gpt2.golden.json'), 'utf8')) as {
  cases: GoldenCase[];
};
const lensReference = JSON.parse(readFileSync(join(fixtureDir, 'tiny-gpt2.lens.json'), 'utf8')) as {
  cases: LensCase[];
};
const [CASE_A, CASE_B] = golden.cases as [GoldenCase, GoldenCase];

const ACT = 1e-4;
const ATT = 1e-5;
const LOGIT = 1e-3;
const PROB = 1e-5;
const FOREIGN = 'Die Gewichte gehören nicht zu diesem Rechenkern.';

let config: Gpt2Config;
let fileWeights: Gpt2Weights;
let wasm: KernelSetup;
let tokenizer: BpeTokenizer;

beforeAll(async () => {
  config = parseGpt2Config(CONFIG_JSON);
  fileWeights = mapGpt2Weights(parseSafetensors(readBuffer('tiny-gpt2.safetensors')), config);
  wasm = createWasmKernel(config, fileWeights);
  const assetDir = join(repoRoot, 'public', 'tokenizers', 'gpt2');
  tokenizer = await loadGpt2Tokenizer({
    baseUrl: '/',
    fetch: (url) =>
      Promise.resolve(
        new Response(readFileSync(join(assetDir, url.slice(url.lastIndexOf('/') + 1)), 'utf8')),
      ),
  });
}, 30_000);

function wasmModel(lensTopN?: number): Gpt2Model {
  return new Gpt2Model(config, wasm.weights, {
    kernel: wasm.kernel,
    ...(lensTopN === undefined ? {} : { lensTopN }),
  });
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

function headRows(tensor: Tensor, head: number): number[][] {
  const [, n, b] = tensor.shape as [number, number, number];
  return Array.from({ length: n }, (_, i) =>
    Array.from(tensor.data.subarray((head * n + i) * b, (head * n + i + 1) * b)),
  );
}

function expectLens(stationValue: ResidualStation, expected: LensLayer, label: string): void {
  const lens = stationValue.lens ?? [];
  expect(
    lens.map((c) => c.token.id),
    `${label}: IDs`,
  ).toEqual(expected.ids);
  lens.forEach((c, i) =>
    expect(Math.abs(c.prob - (expected.probs[i] ?? NaN)), `${label}[${i}]`).toBeLessThanOrEqual(
      PROB,
    ),
  );
}

/** In-Process-Worker: Nachrichten per structuredClone, asynchron zugestellt. */
function inProcessWorker(): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(command: WorkerCommand) {
      const copy = structuredClone(command);
      queueMicrotask(() => handler(copy));
    },
    terminate() {
      /* nichts zu tun */
    },
  };
  const handler = createGpt2WorkerHandler((response: WorkerResponse) => {
    const copy = structuredClone(response);
    queueMicrotask(() => worker.onmessage?.({ data: copy }));
  });
  return worker;
}

function engineWith(createWorker: () => WorkerLike): Gpt2Engine {
  return new Gpt2Engine(
    { model: 'Tiny GPT-2 (Test)' },
    {
      tokenizer,
      createWorker,
      loadWeights: () =>
        Promise.resolve({ config: CONFIG_JSON, weights: readBuffer('tiny-gpt2.safetensors') }),
    },
  );
}

describe('K-08 Modell mit WASM-Kern gegen die Referenz', () => {
  it.each(golden.cases.map((c) => [c.prompt, c] as const))('K-08: G-04 für %s', (_p, gold) => {
    const n = gold.ids.length;
    const stations = wasmModel().forward(gold.ids, [0, n]);
    const embed = station(stations, 'embed');
    expect(rows(embed.token)).toEqual(
      gold.ids.map((id) => Array.from(fileWeights.wte.subarray(id * 8, id * 8 + 8))),
    );
    expectClose(rows(embed.sum), gold.embed, ACT, 'embed.sum');
    let stream = gold.embed;
    gold.layers.forEach((layer, l) => {
      const attention = station(stations, 'attention', l);
      expectClose(rows(attention.lnIn), layer.lnIn_attn, ACT, `L${l} attention.lnIn`);
      expectClose(rows(attention.q), columns(layer.qkv, 0, 8), ACT, `L${l} q`);
      expectClose(rows(attention.k), columns(layer.qkv, 8, 16), ACT, `L${l} k`);
      expectClose(rows(attention.v), columns(layer.qkv, 16, 24), ACT, `L${l} v`);
      for (let h = 0; h < 2; h += 1) {
        expectClose(
          headRows(attention.weights, h),
          gold.attentions[l]?.[h] ?? [],
          ATT,
          `L${l} weights h${h}`,
        );
      }
      expectClose(rows(attention.out), layer.attn_out, ACT, `L${l} attention.out`);
      expectClose(
        rows(station(stations, 'residual', l, 'attention').stream),
        stream.map((r, i) => r.map((v, j) => v + (layer.attn_out[i]?.[j] ?? NaN))),
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
    expect(logits.distribution.map((c) => c.token.id)).toEqual(gold.top_ids);
    logits.distribution.forEach((c, i) => {
      expect(Math.abs((c.logit ?? NaN) - (gold.top_logits[i] ?? NaN))).toBeLessThanOrEqual(LOGIT);
      expect(Math.abs(c.prob - (gold.top_probs[i] ?? NaN) / gold.coverage100)).toBeLessThanOrEqual(
        PROB,
      );
    });
    expect(Math.abs((logits.coverage ?? NaN) - gold.coverage100)).toBeLessThanOrEqual(1e-6);
  });

  it('K-08: G-05 Folgeschritt und Wechsel des Kontexts', () => {
    const m = wasmModel();
    const n = CASE_A.ids.length;
    m.forward(CASE_A.ids, [0, n]);
    const next = m.forward([...CASE_A.ids, CASE_A.greedy[0] ?? 0], [n, n + 1]);
    expect(station(next, 'attention', 1).weights.shape).toEqual([2, 1, n + 1]);
    const top = station(next, 'logits').distribution.slice(0, 10);
    expect(top.map((c) => c.token.id)).toEqual(CASE_A.next_ids);
    top.forEach((c, i) =>
      expect(Math.abs((c.logit ?? NaN) - (CASE_A.next_logits[i] ?? NaN))).toBeLessThanOrEqual(
        LOGIT,
      ),
    );
    const b = m.forward(CASE_B.ids, [0, CASE_B.ids.length]);
    expect(station(b, 'logits').distribution.map((c) => c.token.id)).toEqual(CASE_B.top_ids);
    expectClose(
      rows(station(b, 'residual', 1, 'mlp').stream),
      CASE_B.layers[1]?.block_out ?? [],
      ACT,
      'B block',
    );
  });

  for (const testCase of lensReference.cases) {
    it(`K-08: Logit-Lens wie CON-0016 („${testCase.prompt}“)`, () => {
      const n = testCase.ids.length;
      const m = wasmModel(5);
      const first = m.forward(testCase.ids, [0, n]);
      for (const expected of testCase.lens) {
        expectLens(
          station(first, 'residual', expected.layer, 'mlp'),
          expected,
          `L${expected.layer}`,
        );
      }
      const next = m.forward([...testCase.ids, testCase.next], [n, n + 1]);
      for (const expected of testCase.lensNext) {
        expectLens(
          station(next, 'residual', expected.layer, 'mlp'),
          expected,
          `next L${expected.layer}`,
        );
      }
    });
  }

  it('K-08: ohne Option kernel rechnet das Modell bitgleich mit dem JS-Kern', () => {
    const n = CASE_A.ids.length;
    const plain = new Gpt2Model(config, fileWeights).forward(CASE_A.ids, [0, n]);
    const explicit = new Gpt2Model(config, fileWeights, {
      kernel: createJsKernel(config, fileWeights).kernel,
    }).forward(CASE_A.ids, [0, n]);
    expect(explicit).toEqual(plain);
  });

  it('K-08: Datei-Gewichte mit dem WASM-Kern scheitern an der Herkunft', () => {
    const wrong = new Gpt2Model(config, fileWeights, { kernel: wasm.kernel });
    expect(() => wrong.forward(CASE_A.ids, [0, CASE_A.ids.length])).toThrow(FOREIGN);
  });

  it('K-08: Greedy über 5 Tokens wie transformers', async () => {
    const engine = engineWith(inProcessWorker);
    await engine.load();
    const setup = await freshSetup({}, engine);
    const { trace } = await run(setup, CASE_A.prompt, 5);
    expect(trace.steps.map((s) => s.chosen.id)).toEqual(CASE_A.greedy);
  });
});

describe('K-09 Worker und Engine', () => {
  it('K-09: ready meldet architecture und kernel', async () => {
    const responses: WorkerResponse[] = [];
    const send = createGpt2WorkerHandler((r) => responses.push(r));
    send({
      type: 'init',
      config: CONFIG_JSON,
      weights: readBuffer('tiny-gpt2.safetensors'),
      topN: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(responses).toEqual([
      {
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
      },
    ]);
  });

  it('K-09: Gpt2Engine.kernel ist vor load() null, danach wasm-simd', async () => {
    const engine = engineWith(inProcessWorker);
    expect(engine.kernel).toBeNull();
    await engine.load();
    expect(engine.kernel).toBe('wasm-simd');
  });

  it('K-09: meldet der Worker js, ist Gpt2Engine.kernel js', async () => {
    const reportsJs = (): WorkerLike => {
      const inner = inProcessWorker();
      const worker: WorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage: (command, transfer) => inner.postMessage(command, transfer),
        terminate: () => inner.terminate(),
      };
      inner.onmessage = (event) => {
        const data =
          event.data.type === 'ready' ? { ...event.data, kernel: 'js' as const } : event.data;
        worker.onmessage?.({ data });
      };
      return worker;
    };
    const engine = engineWith(reportsJs);
    await engine.load();
    expect(engine.kernel).toBe('js');
  });
});

describe('K-10 Tempo', () => {
  const PERF: Gpt2Config = {
    nLayers: 1,
    nHeads: 12,
    dModel: 768,
    dMlp: 3072,
    vocabSize: 50257,
    contextLength: 4,
    layerNormEpsilon: 1e-5,
  };

  function randomArray(length: number, seed: number): Float32Array {
    const rng = createRng(seed);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) out[i] = rng.next() * 2 - 1;
    return out;
  }

  function perfWeights(): Gpt2Weights {
    const { dModel: d, dMlp: m } = PERF;
    let seed = 500;
    const take = (length: number): Float32Array => randomArray(length, (seed += 1));
    const norm = () => ({ g: take(d), b: take(d) });
    return {
      wte: take(PERF.vocabSize * d),
      wpe: take(PERF.contextLength * d),
      layers: [
        {
          ln1: norm(),
          attn: { w: take(d * 3 * d), b: take(3 * d) },
          attnProj: { w: take(d * d), b: take(d) },
          ln2: norm(),
          fc: { w: take(d * m), b: take(m) },
          mlpProj: { w: take(m * d), b: take(d) },
        },
      ],
      lnF: norm(),
    };
  }

  /** Median aus 5 Läufen nach einem Aufwärmlauf (ms). */
  function median(action: () => unknown): number {
    action();
    const times: number[] = [];
    for (let r = 0; r < 5; r += 1) {
      const start = performance.now();
      action();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return times[2] ?? Infinity;
  }

  it('K-10: WASM ≥ 4× schneller bei Projektion und affine', () => {
    const weights = perfWeights();
    const js = createJsKernel(PERF, weights);
    const fast = createWasmKernel(PERF, weights);
    const h = randomArray(768, 1);
    const x = randomArray(768, 2);
    const unembedJs = median(() => js.kernel.unembed(h, js.weights.wte, 50257, 768));
    const unembedWasm = median(() => fast.kernel.unembed(h, fast.weights.wte, 50257, 768));
    const jsFc = js.weights.layers[0]?.fc;
    const wasmFc = fast.weights.layers[0]?.fc;
    if (jsFc === undefined || wasmFc === undefined) throw new Error('fc fehlt');
    const affineJs = median(() => js.kernel.affine(x, 1, 768, jsFc.w, jsFc.b, 3072));
    const affineWasm = median(() => fast.kernel.affine(x, 1, 768, wasmFc.w, wasmFc.b, 3072));
    expect(
      unembedJs / unembedWasm,
      `unembed ${unembedJs} ms vs ${unembedWasm} ms`,
    ).toBeGreaterThanOrEqual(4);
    expect(
      affineJs / affineWasm,
      `affine ${affineJs} ms vs ${affineWasm} ms`,
    ).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('K-10: G-09 mit dem WASM-Kern (6 Tokens < 50 ms nach Aufwärmen)', () => {
    wasmModel().forward(CASE_A.ids, [0, CASE_A.ids.length]);
    const fresh = wasmModel();
    fresh.forward(CASE_B.ids, [0, CASE_B.ids.length]);
    const start = performance.now();
    fresh.forward(CASE_A.ids, [0, CASE_A.ids.length]);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
