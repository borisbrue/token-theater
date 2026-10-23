// TST-0017 · CON-0016: Logit-Lens in Trace und Engines (L-01 bis L-07), Referenz aus transformers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Candidate, LogitsStation, ResidualStation, Station, Trace } from '@/trace/types';
import { MAX_LENS_TOP_N } from '@/trace/types';
import { lensCandidates } from '@/engine/lens';
import { parseSafetensors, type SafeTensor } from '@/engine/gpt2/safetensors';
import { parseGpt2Config, type Gpt2Config } from '@/engine/gpt2/config';
import { mapGpt2Weights } from '@/engine/gpt2/weights';
import { Gpt2Model } from '@/engine/gpt2/model';
import type { WorkerCommand, WorkerResponse } from '@/engine/gpt2/protocol';
import { createGpt2WorkerHandler } from '@/engine/gpt2/worker-handler';
import { Gpt2Engine, type WorkerLike } from '@/engine/gpt2/gpt2-engine';
import { loadGpt2Tokenizer } from '@/engine/tokenizer/gpt2';
import type { BpeTokenizer } from '@/engine/tokenizer/bpe';
import { MOCK_VOCAB, MockEngine } from '@/engine/mock/mock-engine';
import { deserializeTrace, serializeTrace, TraceImportError } from '@/trace/serialize';
import { validateTrace } from '@/trace/schema';
import { checkInvariants } from '@/trace/invariants';

import { freshSetup, run, stepAt } from './helpers/engine-setup';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureDir = join(repoRoot, 'tests/fixtures/gpt2');
const readBuffer = (name: string): ArrayBuffer => {
  const bytes = readFileSync(join(fixtureDir, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const CONFIG_JSON: unknown = JSON.parse(
  readFileSync(join(fixtureDir, 'tiny-gpt2.config.json'), 'utf8'),
);

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
const reference = JSON.parse(readFileSync(join(fixtureDir, 'tiny-gpt2.lens.json'), 'utf8')) as {
  cases: LensCase[];
};
const CASES = reference.cases;

const PROB = 1e-5;
const MOCK_PROMPT = 'die katze sitzt';

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

function model(options: { lensTopN?: number } = {}): Gpt2Model {
  return new Gpt2Model(config, mapGpt2Weights(tensors, config), options);
}

function residuals(stations: readonly Station[]): ResidualStation[] {
  return stations.filter((s): s is ResidualStation => s.kind === 'residual');
}

function residualAt(
  stations: readonly Station[],
  layer: number,
  after: 'attention' | 'mlp',
): ResidualStation {
  const found = residuals(stations).find((s) => s.layer === layer && s.after === after);
  if (found === undefined) throw new Error(`residual ${layer}/${after} fehlt`);
  return found;
}

function logitsOf(stations: readonly Station[]): LogitsStation {
  const found = stations.find((s): s is LogitsStation => s.kind === 'logits');
  if (found === undefined) throw new Error('logits fehlt');
  return found;
}

function lensOf(station: ResidualStation): Candidate[] {
  if (station.lens === undefined) throw new Error(`Lens fehlt an Layer ${station.layer}`);
  return station.lens;
}

function expectLens(actual: Candidate[], expected: LensLayer, label: string): void {
  expect(
    actual.map((c) => c.token.id),
    `${label}: IDs`,
  ).toEqual(expected.ids);
  actual.forEach((candidate, i) => {
    expect(
      Math.abs(candidate.prob - (expected.probs[i] ?? Number.NaN)),
      `${label}: prob ${i}`,
    ).toBeLessThanOrEqual(PROB);
  });
}

async function mockTrace(
  options: ConstructorParameters<typeof MockEngine>[0] = {},
): Promise<Trace> {
  const setup = await freshSetup({}, new MockEngine({ weightSeed: 1234, ...options }));
  return (await run(setup, MOCK_PROMPT, 3)).trace;
}

function expectValid(trace: Trace): void {
  const serialized: unknown = JSON.parse(serializeTrace(trace));
  expect(validateTrace(serialized)).toEqual({ ok: true });
  expect(checkInvariants(serialized)).toEqual([]);
}

describe('L-01 Auswahl aus den Logits', () => {
  it('L-01: Softmax über alle Werte, Top-N absteigend, Gleichstand kleinere ID zuerst', () => {
    const result = lensCandidates([0, 2, 2, 1], 4, 3);
    expect(result.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(result.map((e) => e.logit)).toEqual([2, 2, 1]);
    const expected = [0.3995, 0.3995, 0.147];
    result.forEach((entry, i) => {
      expect(Math.abs(entry.prob - (expected[i] ?? Number.NaN))).toBeLessThanOrEqual(1e-4);
    });
  });

  it('L-01: prob bleibt Anteil am ganzen Vokabular (nicht renormiert)', () => {
    const logits = [3, 1, 0.5, -1, 2];
    const max = Math.max(...logits);
    const total = logits.reduce((sum, v) => sum + Math.exp(v - max), 0);
    const result = lensCandidates(logits, logits.length, 2);
    expect(result.map((e) => e.id)).toEqual([0, 4]);
    expect(result[0]?.prob).toBeCloseTo(Math.exp(0) / total, 12);
    expect(result[1]?.prob).toBeCloseTo(Math.exp(-1) / total, 12);
    expect((result[0]?.prob ?? 0) + (result[1]?.prob ?? 0)).toBeLessThan(1);
  });

  it('L-01: nur die ersten length Werte zählen', () => {
    const result = lensCandidates(Float64Array.from([1, 0, 9]), 2, 5);
    expect(result.map((e) => e.id)).toEqual([0, 1]);
    expect((result[0]?.prob ?? 0) + (result[1]?.prob ?? 0)).toBeCloseTo(1, 12);
  });

  it('L-01: topN 0 ergibt eine leere Liste', () => {
    expect(lensCandidates([1, 2, 3], 3, 0)).toEqual([]);
  });

  it('L-01: große Logits bleiben stabil (Max-Subtraktion)', () => {
    const result = lensCandidates([1000, 999], 2, 2);
    expect(Number.isFinite(result[0]?.prob)).toBe(true);
    expect(result[0]?.prob).toBeCloseTo(1 / (1 + Math.exp(-1)), 12);
  });
});

describe('L-02 Lens im GPT-2-Modell', () => {
  for (const testCase of CASES) {
    it(`L-02: Schritt 0 gleich transformers („${testCase.prompt}“)`, () => {
      const n = testCase.ids.length;
      const stations = model().forward(testCase.ids, [0, n]);
      for (const expected of testCase.lens) {
        const station = residualAt(stations, expected.layer, 'mlp');
        const lens = lensOf(station);
        expect(lens).toHaveLength(5);
        expectLens(lens, expected, `L${expected.layer}`);
        lens.forEach((c) => expect(c.token.text).toBe(''));
      }
    });

    it(`L-02: Folgeschritt mit KV-Cache gleich transformers („${testCase.prompt}“)`, () => {
      const n = testCase.ids.length;
      const m = model();
      m.forward(testCase.ids, [0, n]);
      const stations = m.forward([...testCase.ids, testCase.next], [n, n + 1]);
      for (const expected of testCase.lensNext) {
        expectLens(
          lensOf(residualAt(stations, expected.layer, 'mlp')),
          expected,
          `L${expected.layer}`,
        );
      }
    });
  }

  it('L-02: residual nach Attention hat kein Feld lens', () => {
    const caseA = CASES[0];
    if (caseA === undefined) throw new Error('Fall fehlt');
    const stations = model().forward(caseA.ids, [0, caseA.ids.length]);
    const afterAttention = residuals(stations).filter((s) => s.after === 'attention');
    expect(afterAttention).toHaveLength(config.nLayers);
    afterAttention.forEach((s) => expect('lens' in s).toBe(false));
  });
});

describe('L-03 Wertebereich von lensTopN', () => {
  it('L-03: MAX_LENS_TOP_N ist 20', () => {
    expect(MAX_LENS_TOP_N).toBe(20);
  });

  for (const bad of [-1, 21, 2.5, Number.NaN]) {
    it(`L-03: lensTopN ${String(bad)} → RangeError (Gpt2Model und MockEngine)`, () => {
      expect(() => model({ lensTopN: bad })).toThrow(RangeError);
      expect(() => new MockEngine({ lensTopN: bad })).toThrow(RangeError);
    });
  }

  it('L-03: lensTopN 0 schaltet die Lens ab', async () => {
    const caseA = CASES[0];
    if (caseA === undefined) throw new Error('Fall fehlt');
    const stations = model({ lensTopN: 0 }).forward(caseA.ids, [0, caseA.ids.length]);
    residuals(stations).forEach((s) => expect('lens' in s).toBe(false));
    const trace = await mockTrace({ lensTopN: 0 });
    trace.steps.forEach((step) =>
      residuals(step.stations).forEach((s) => expect('lens' in s).toBe(false)),
    );
  });

  it('L-03: lensTopN 20 liefert 20 Einträge und erfüllt INV-17', async () => {
    const caseA = CASES[0];
    if (caseA === undefined) throw new Error('Fall fehlt');
    const stations = model({ lensTopN: 20 }).forward(caseA.ids, [0, caseA.ids.length]);
    residuals(stations)
      .filter((s) => s.after === 'mlp')
      .forEach((s) => expect(lensOf(s)).toHaveLength(20));
    const trace = await mockTrace({ lensTopN: 20 });
    residuals(stepAt(trace, 0).stations)
      .filter((s) => s.after === 'mlp')
      .forEach((s) => expect(lensOf(s)).toHaveLength(20));
    expectValid(trace);
  });
});

describe('L-04 Lens des letzten Layers = logits', () => {
  function expectConsistent(stations: readonly Station[], lastLayer: number): void {
    const lens = lensOf(residualAt(stations, lastLayer, 'mlp'));
    const logits = logitsOf(stations);
    const top = logits.distribution[0];
    if (top === undefined || logits.coverage === null) throw new Error('logits unvollständig');
    expect(lens[0]?.token.id).toBe(top.token.id);
    expect(
      Math.abs((lens[0]?.prob ?? Number.NaN) - top.prob * logits.coverage),
    ).toBeLessThanOrEqual(1e-6);
  }

  for (const testCase of CASES) {
    it(`L-04: Gpt2Model („${testCase.prompt}“)`, () => {
      expectConsistent(model().forward(testCase.ids, [0, testCase.ids.length]), config.nLayers - 1);
    });
  }

  it('L-04: MockEngine, jeder Schritt', async () => {
    const trace = await mockTrace();
    const layers = trace.engine.architecture?.nLayers ?? 0;
    expect(layers).toBeGreaterThan(0);
    trace.steps.forEach((step) => expectConsistent(step.stations, layers - 1));
  });
});

/** In-Process-Worker wie in TST-0015: Nachrichten per structuredClone, asynchron zugestellt. */
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

describe('L-05 Token-Texte', () => {
  it('L-05: Gpt2Engine dekodiert die Lens wie die logits-Kandidaten', async () => {
    const engine = new Gpt2Engine(
      { model: 'Tiny GPT-2 (Test)' },
      {
        tokenizer,
        createWorker: () => inProcessWorker(),
        loadWeights: () =>
          Promise.resolve({ config: CONFIG_JSON, weights: readBuffer('tiny-gpt2.safetensors') }),
      },
    );
    await engine.load();
    const setup = await freshSetup({}, engine);
    const trace = (await run(setup, CASES[0]?.prompt ?? '', 2)).trace;
    let checked = 0;
    for (const step of trace.steps) {
      for (const station of residuals(step.stations).filter((s) => s.after === 'mlp')) {
        for (const candidate of lensOf(station)) {
          expect(candidate.token.text).toBe(
            tokenizer.decode([{ id: candidate.token.id, text: '' }]),
          );
          checked += 1;
        }
      }
    }
    expect(checked).toBe(2 * config.nLayers * 5);
    expectValid(trace);
    engine.dispose();
  });

  it('L-05: MockEngine nimmt die Texte aus MOCK_VOCAB', async () => {
    const trace = await mockTrace();
    for (const step of trace.steps) {
      for (const station of residuals(step.stations).filter((s) => s.after === 'mlp')) {
        lensOf(station).forEach((c) => expect(c.token.text).toBe(MOCK_VOCAB[c.token.id]));
      }
    }
  });
});

describe('L-06 MockEngine', () => {
  it('L-06: Default 5 Einträge nach jedem MLP, keine nach der Attention', async () => {
    const trace = await mockTrace();
    for (const step of trace.steps) {
      for (const station of residuals(step.stations)) {
        if (station.after === 'mlp') expect(lensOf(station)).toHaveLength(5);
        else expect('lens' in station).toBe(false);
      }
    }
    expectValid(trace);
  });

  it('L-06: absteigend, eindeutig, Summe ≤ 1', async () => {
    const trace = await mockTrace();
    for (const step of trace.steps) {
      for (const station of residuals(step.stations).filter((s) => s.after === 'mlp')) {
        const lens = lensOf(station);
        const ids = lens.map((c) => c.token.id);
        expect(new Set(ids).size).toBe(ids.length);
        lens.slice(1).forEach((c, i) => expect(c.prob).toBeLessThanOrEqual(lens[i]?.prob ?? 0));
        expect(lens.reduce((sum, c) => sum + c.prob, 0)).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it('L-06: ohne residual in capabilities keine Lens', async () => {
    const trace = await mockTrace({
      capabilities: ['tokenize', 'embed', 'attention', 'mlp', 'logits', 'sample'],
    });
    trace.steps.forEach((step) => expect(residuals(step.stations)).toEqual([]));
    expect(serializeTrace(trace)).not.toContain('"lens"');
  });

  it('L-06: deterministisch', async () => {
    const a = await mockTrace();
    const b = await mockTrace();
    const lenses = (t: Trace): Candidate[][] =>
      t.steps.flatMap((s) => residuals(s.stations).flatMap((r) => (r.lens ? [r.lens] : [])));
    expect(lenses(a)).toEqual(lenses(b));
    expect(lenses(a).length).toBeGreaterThan(0);
  });
});

describe('L-07 Trace-Format', () => {
  it('L-07: beide Schema-Dateien sind inhaltsgleich und kennen lens', () => {
    const app: unknown = JSON.parse(
      readFileSync(join(repoRoot, 'src/trace/trace.schema.json'), 'utf8'),
    );
    const contract: unknown = JSON.parse(
      readFileSync(
        join(repoRoot, '.sdd/contracts/data/trace-serialization-format-v1.schema.json'),
        'utf8',
      ),
    );
    expect(app).toEqual(contract);
    const defs = (app as { $defs: Record<string, { properties: Record<string, unknown> }> }).$defs;
    expect(defs['ResidualStation']?.properties['lens']).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { $ref: '#/$defs/Candidate' },
    });
  });

  it('L-07: Export und Import erhalten die Lens', async () => {
    const trace = await mockTrace();
    const restored = deserializeTrace(serializeTrace(trace));
    const lenses = (t: Trace): unknown[] =>
      t.steps.flatMap((s) => residuals(s.stations).map((r) => r.lens ?? null));
    expect(lenses(restored)).toEqual(lenses(trace));
  });

  it('L-07: Trace ohne lens bleibt gültig', async () => {
    const trace = await mockTrace({ lensTopN: 0 });
    expectValid(trace);
    expect(() => deserializeTrace(serializeTrace(trace))).not.toThrow();
  });

  type SerializedTrace = {
    engine: { architecture: { vocabSize: number } | null };
    steps: { stations: Record<string, unknown>[] }[];
  };

  async function serializedWithLens(): Promise<{ json: SerializedTrace; index: number }> {
    const json = JSON.parse(serializeTrace(await mockTrace())) as SerializedTrace;
    const index = json.steps[0]?.stations.findIndex(
      (s) => s['kind'] === 'residual' && s['after'] === 'mlp',
    );
    if (index === undefined || index < 0) throw new Error('keine Lens-Station');
    return { json, index };
  }

  function lensField(json: SerializedTrace, index: number): Candidate[] {
    return json.steps[0]?.stations[index]?.['lens'] as Candidate[];
  }

  function semanticIssues(json: SerializedTrace): { invariant?: string; path: string }[] {
    try {
      deserializeTrace(JSON.stringify(json));
    } catch (error) {
      if (error instanceof TraceImportError && error.kind === 'semantic') return [...error.errors];
      throw error;
    }
    return [];
  }

  const violations: [string, (lens: Candidate[], vocab: number) => void][] = [
    [
      'doppelte ID',
      (lens) => {
        const first = lens[0];
        const second = lens[1];
        if (first && second) second.token = { ...first.token };
      },
    ],
    [
      'steigende prob',
      (lens) => {
        const first = lens[0];
        const last = lens.at(-1);
        if (first && last) [first.prob, last.prob] = [last.prob, first.prob];
      },
    ],
    ['Summe > 1', (lens) => lens.forEach((c) => (c.prob = 0.5))],
    [
      'ID ≥ vocabSize',
      (lens, vocab) => {
        const last = lens.at(-1);
        if (last) last.token = { id: vocab, text: 'x' };
      },
    ],
  ];

  for (const [name, mutate] of violations) {
    it(`L-07: INV-17 meldet ${name}`, async () => {
      const { json, index } = await serializedWithLens();
      mutate(lensField(json, index), json.engine.architecture?.vocabSize ?? 0);
      const issues = semanticIssues(json).filter((i) => i.invariant === 'INV-17');
      expect(issues.length).toBeGreaterThan(0);
      issues.forEach((issue) =>
        expect(issue.path.startsWith(`/steps/0/stations/${index}/lens`)).toBe(true),
      );
    });
  }

  for (const [name, length, prob] of [
    ['leere Lens', 0, 0.01],
    ['mehr als 20 Einträge', 21, 0.01],
    ['prob > 1', 1, 1.5],
  ] as const) {
    it(`L-07: ${name} ist ein Schemafehler`, async () => {
      const { json, index } = await serializedWithLens();
      const replaced = Array.from({ length }, (_, i) => ({
        token: { id: i, text: `t${i}` },
        logit: 0,
        prob,
      }));
      const station = json.steps[0]?.stations[index];
      if (station) station['lens'] = replaced;
      let kind: string | undefined;
      try {
        deserializeTrace(JSON.stringify(json));
      } catch (error) {
        if (error instanceof TraceImportError) kind = error.kind;
      }
      expect(kind).toBe('schema');
    });
  }
});
