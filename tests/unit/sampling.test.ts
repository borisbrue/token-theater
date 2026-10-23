// TST-0011 · CON-0010: Client-Sampling, Regeln S-01 bis S-11.
import { describe, expect, it } from 'vitest';

import type { Rng } from '@/engine/types';
import type { Candidate, LogitsStation, SampleStation, Trace } from '@/trace/types';
import {
  applyTemperature,
  applyTopK,
  applyTopP,
  DEFAULT_SETTINGS,
  drawIndex,
  renormalize,
  scores,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  TOP_K_MAX,
  transformDistribution,
  validateSettings,
  type SamplingSettings,
} from '@/sampling/transform';
import { StochasticSampler } from '@/engine/samplers/stochastic';
import { GreedySampler } from '@/engine/samplers/greedy';
import { serializeTrace } from '@/trace/serialize';
import { validateTrace } from '@/trace/schema';
import { checkInvariants } from '@/trace/invariants';

import { freshSetup, run } from './helpers/engine-setup';
import { assertClean, assertViolation, lintAs } from './helpers/lint-as';

const TOL = 1e-6;

function candidate(id: number, text: string, logit: number | null, prob: number): Candidate {
  return { token: { id, text }, logit, prob };
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function basis(): Candidate[] {
  const probs = softmax([2, 1, 0]);
  return [
    candidate(0, 'a', 2, probs[0] ?? 0),
    candidate(1, 'b', 1, probs[1] ?? 0),
    candidate(2, 'c', 0, probs[2] ?? 0),
  ];
}

function remote(): Candidate[] {
  return [candidate(0, 'a', null, 0.5), candidate(1, 'b', null, 0.3), candidate(2, 'c', null, 0.2)];
}

function settings(temperature: number, topK: number, topP: number): SamplingSettings {
  return { temperature, topK, topP };
}

function expectProbs(result: readonly Candidate[], ids: number[], probs: number[]): void {
  expect(result.map((c) => c.token.id)).toEqual(ids);
  result.forEach((c, i) => expect(Math.abs(c.prob - (probs[i] ?? NaN))).toBeLessThan(TOL));
}

/** CON-0001 INV-10: absteigend (Gleichstand: id aufsteigend), eindeutig, Summe 1 ± 1e-6. */
function expectInv10(result: readonly Candidate[]): void {
  const ids = result.map((c) => c.token.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (let i = 1; i < result.length; i += 1) {
    const prev = result[i - 1];
    const cur = result[i];
    if (prev === undefined || cur === undefined) continue;
    expect(prev.prob > cur.prob || (prev.prob === cur.prob && prev.token.id < cur.token.id)).toBe(
      true,
    );
  }
  const sum = result.reduce((s, c) => s + c.prob, 0);
  expect(Math.abs(sum - 1)).toBeLessThan(TOL);
}

function logitsStation(distribution: Candidate[]): LogitsStation {
  return { kind: 'logits', vocabSize: null, distribution, coverage: 1 };
}

/** Rng-Attrappe: liefert die vorgegebenen Werte der Reihe nach und zählt Aufrufe. */
function queuedRng(values: number[]): Rng & { calls: number } {
  const queue = [...values];
  const rng = {
    calls: 0,
    next(): number {
      rng.calls += 1;
      const value = queue.shift();
      if (value === undefined) throw new Error('Rng-Attrappe leer');
      return value;
    },
  };
  return rng;
}

describe('S-01 Scores', () => {
  it('S-01: Logits, ln(prob) ohne Logits, -Infinity bei prob 0', () => {
    expect(scores(basis())).toEqual([2, 1, 0]);
    const r = scores(remote());
    [0.5, 0.3, 0.2].forEach((p, i) =>
      expect(Math.abs((r[i] ?? NaN) - Math.log(p))).toBeLessThan(TOL),
    );
    const mixed = [candidate(0, 'a', 2, 0.6), candidate(1, 'b', null, 0.4)];
    expect(scores(mixed)).toEqual([Math.log(0.6), Math.log(0.4)]);
    expect(scores([candidate(0, 'a', null, 1), candidate(1, 'b', null, 0)])[1]).toBe(-Infinity);
  });
});

describe('S-02 Temperatur', () => {
  const cases: [string, () => Candidate[], number, number[]][] = [
    ['Basis T=1', basis, 1, [0.665241, 0.244728, 0.090031]],
    ['Basis T=0.5', basis, 0.5, [0.866813, 0.11731, 0.015876]],
    ['Basis T=2', basis, 2, [0.50648, 0.307196, 0.186324]],
    ['Remote T=1', remote, 1, [0.5, 0.3, 0.2]],
    ['Remote T=0.5', remote, 0.5, [0.657895, 0.236842, 0.105263]],
  ];
  it.each(cases)('S-02: %s', (_name, make, t, probs) => {
    const input = make();
    const result = applyTemperature(input, t);
    expectProbs(result, [0, 1, 2], probs);
    result.forEach((c, i) => {
      expect(c.token).toEqual(input[i]?.token);
      expect(c.logit).toBe(input[i]?.logit);
    });
  });

  it('S-02: Gleichstand wird aufsteigend nach token.id sortiert', () => {
    const tie = [candidate(7, 'x', 1, 0.5), candidate(3, 'y', 1, 0.5)];
    expect(applyTemperature(tie, 1).map((c) => c.token.id)).toEqual([3, 7]);
  });
});

describe('S-03 Top-k und Top-p', () => {
  it('S-03: applyTopK', () => {
    const d = applyTemperature(basis(), 1);
    expect(applyTopK(d, 0)).toEqual(d);
    expect(applyTopK(d, 0)).not.toBe(d);
    expect(applyTopK(d, 2).map((c) => c.token.id)).toEqual([0, 1]);
    expect(applyTopK(d, 2)[0]?.prob).toBe(d[0]?.prob);
    expect(applyTopK(d, 9)).toHaveLength(3);
  });

  it('S-03: applyTopP rechnet auf renormierten Werten und renormiert selbst nicht', () => {
    const d = applyTemperature(basis(), 1);
    expect(applyTopP(d, 1)).toHaveLength(3);
    expect(applyTopP(d, 0.7).map((c) => c.token.id)).toEqual([0, 1]);
    expect(applyTopP(d, 0.6).map((c) => c.token.id)).toEqual([0]);
    expect(applyTopP(d, 0.6)[0]?.prob).toBe(d[0]?.prob);
    const halved = d.map((c) => ({ ...c, prob: c.prob / 2 }));
    expect(applyTopP(halved, 0.7).map((c) => c.token.id)).toEqual([0, 1]);
    expect(applyTopP(d, 0.0001)).toHaveLength(1);
  });

  it('S-03: renormalize teilt durch die Summe', () => {
    const r = renormalize([candidate(0, 'a', null, 0.2), candidate(1, 'b', null, 0.6)]);
    expectProbs(r, [0, 1], [0.25, 0.75]);
  });
});

describe('S-04 Umformung', () => {
  const cases: [string, () => Candidate[], SamplingSettings, number[], number[]][] = [
    ['Basis 1/0/1', basis, settings(1, 0, 1), [0, 1, 2], [0.665241, 0.244728, 0.090031]],
    ['Basis 1/2/1', basis, settings(1, 2, 1), [0, 1], [0.731059, 0.268941]],
    ['Basis 1/0/0.7', basis, settings(1, 0, 0.7), [0, 1], [0.731059, 0.268941]],
    ['Basis 1/0/0.6', basis, settings(1, 0, 0.6), [0], [1]],
    ['Basis 2/2/0.6', basis, settings(2, 2, 0.6), [0], [1]],
    ['Basis 2/2/0.65', basis, settings(2, 2, 0.65), [0, 1], [0.622459, 0.377541]],
    ['Basis 1/5/1', basis, settings(1, 5, 1), [0, 1, 2], [0.665241, 0.244728, 0.090031]],
    ['Remote 0.5/0/1', remote, settings(0.5, 0, 1), [0, 1, 2], [0.657895, 0.236842, 0.105263]],
  ];
  it.each(cases)('S-04: %s', (_name, make, s, ids, probs) => {
    const result = transformDistribution(make(), s);
    expectProbs(result, ids, probs);
    expectInv10(result);
  });

  it('S-04: leere Verteilung → Error', () => {
    expect(() => transformDistribution([], DEFAULT_SETTINGS)).toThrow(Error);
  });
});

describe('S-05 Wurf', () => {
  it('S-05: erster Index mit kumulierter Summe > r, sonst der letzte', () => {
    const d = [candidate(0, 'a', null, 0.731059), candidate(1, 'b', null, 0.268941)];
    expect(drawIndex(d, 0)).toBe(0);
    expect(drawIndex(d, 0.5)).toBe(0);
    expect(drawIndex(d, 0.731)).toBe(0);
    expect(drawIndex(d, 0.7311)).toBe(1);
    expect(drawIndex(d, 0.99999)).toBe(1);
    const short = [candidate(0, 'a', null, 0.5), candidate(1, 'b', null, 0.4999999)];
    expect(drawIndex(short, 0.9999999)).toBe(1);
  });
});

describe('S-06 Reinheit', () => {
  it('S-06: keine Funktion verändert ihre Eingabe; Ergebnisse sind neue Objekte', () => {
    const input = basis();
    const copy = structuredClone(input);
    const results = [
      applyTemperature(input, 0.5),
      applyTopK(input, 2),
      applyTopP(input, 0.7),
      renormalize(input),
      transformDistribution(input, settings(0.7, 2, 0.9)),
    ];
    scores(input);
    drawIndex(input, 0.3);
    expect(input).toEqual(copy);
    for (const result of results) {
      expect(result).not.toBe(input);
      result.forEach((c) => expect(input).not.toContain(c));
    }
  });
});

describe('S-07 Einstellungen', () => {
  it('S-07: Konstanten und Default', () => {
    expect(DEFAULT_SETTINGS).toEqual({ temperature: 1, topK: 0, topP: 1 });
    expect(TEMPERATURE_MIN).toBe(0.1);
    expect(TEMPERATURE_MAX).toBe(2);
    expect(TOP_K_MAX).toBe(100);
    expect(() => validateSettings(DEFAULT_SETTINGS)).not.toThrow();
    expect(() => validateSettings(settings(0.1, 0, 0.05))).not.toThrow();
    expect(() => validateSettings(settings(2, 100, 1))).not.toThrow();
  });

  const invalid: [string, SamplingSettings][] = [
    ['T 0.05', settings(0.05, 0, 1)],
    ['T 2.5', settings(2.5, 0, 1)],
    ['T NaN', settings(NaN, 0, 1)],
    ['T Infinity', settings(Infinity, 0, 1)],
    ['k -1', settings(1, -1, 1)],
    ['k 1.5', settings(1, 1.5, 1)],
    ['k 101', settings(1, 101, 1)],
    ['k NaN', settings(1, NaN, 1)],
    ['p 0', settings(1, 0, 0)],
    ['p -0.1', settings(1, 0, -0.1)],
    ['p 1.01', settings(1, 0, 1.01)],
    ['p NaN', settings(1, 0, NaN)],
  ];
  it.each(invalid)('S-07: %s → RangeError', (_name, s) => {
    expect(() => validateSettings(s)).toThrow(RangeError);
    expect(() => new StochasticSampler(s)).toThrow(RangeError);
  });
});

describe('S-08 StochasticSampler', () => {
  it('S-08: Strategie, Parameter und genau ein rng.next() je Schritt', () => {
    const sampler = new StochasticSampler(settings(0.7, 3, 0.9));
    expect(sampler.strategy).toBe('sample');
    expect(sampler.params).toEqual({ temperature: 0.7, topK: 3, topP: 0.9 });
    const rng = queuedRng([0.5]);
    const logits = logitsStation(basis());
    const before = structuredClone(logits);
    const sample: SampleStation = sampler.sample(logits, rng);
    expect(rng.calls).toBe(1);
    expect(sample.kind).toBe('sample');
    expect(sample.random).toBe(0.5);
    const expected = transformDistribution(logits.distribution, settings(0.7, 3, 0.9));
    expect(sample.distribution).toEqual(expected);
    expect(sample.chosen).toEqual(expected[drawIndex(expected, 0.5)]?.token);
    expect(logits).toEqual(before);
    expectInv10(sample.distribution);
  });

  it.each([
    [0.5, 0],
    [0.9, 1],
    [0.95, 2],
  ])('S-08: Basis 1/0/1 mit r = %s → ID %s', (r, id) => {
    const sample = new StochasticSampler(DEFAULT_SETTINGS).sample(
      logitsStation(basis()),
      queuedRng([r]),
    );
    expect(sample.chosen.id).toBe(id);
    expect(sample.random).toBe(r);
  });

  it('S-08: leere Verteilung → Error', () => {
    expect(() =>
      new StochasticSampler(DEFAULT_SETTINGS).sample(logitsStation([]), queuedRng([0.1])),
    ).toThrow(Error);
  });
});

describe('S-09 Generator und Determinismus', () => {
  const PROMPT = 'die katze sitzt';

  async function trace(sampler: GreedySampler | StochasticSampler, seed: number): Promise<Trace> {
    const setup = await freshSetup({}, undefined, sampler);
    return (await run(setup, PROMPT, 4, { seed })).trace;
  }

  function chosenIds(t: Trace): number[] {
    return t.steps.map((step) => step.chosen.id);
  }

  it('S-09: Parameter im Trace, Schema und Invarianten, random in [0, 1)', async () => {
    const t = await trace(new StochasticSampler(DEFAULT_SETTINGS), 7);
    expect(t.sampling).toEqual({
      strategy: 'sample',
      seed: 7,
      params: { temperature: 1, topK: 0, topP: 1 },
    });
    const serialized: unknown = JSON.parse(serializeTrace(t));
    expect(validateTrace(serialized)).toEqual({ ok: true });
    expect(checkInvariants(serialized)).toEqual([]);
    for (const step of t.steps) {
      const sample = step.stations.at(-1);
      expect(sample?.kind).toBe('sample');
      if (sample?.kind !== 'sample') continue;
      expect(sample.random).not.toBeNull();
      expect(sample.random ?? -1).toBeGreaterThanOrEqual(0);
      expect(sample.random ?? 1).toBeLessThan(1);
    }
  });

  it('S-09: gleiche Eingaben ergeben bytegleiche Traces', async () => {
    const a = serializeTrace(await trace(new StochasticSampler(settings(0.8, 10, 0.95)), 7));
    const b = serializeTrace(await trace(new StochasticSampler(settings(0.8, 10, 0.95)), 7));
    expect(a).toBe(b);
  });

  it('S-09: Top-k 1 und Top-p 0.05 wählen wie Greedy', async () => {
    const greedy = chosenIds(await trace(new GreedySampler(), 42));
    expect(chosenIds(await trace(new StochasticSampler(settings(1, 1, 1)), 3))).toEqual(greedy);
    expect(chosenIds(await trace(new StochasticSampler(settings(1, 0, 0.05)), 11))).toEqual(greedy);
  });

  it('S-09: Greedy-Traces behalten params {} und random null', async () => {
    const t = await trace(new GreedySampler(), 42);
    expect(t.sampling).toEqual({ strategy: 'greedy', seed: 42, params: {} });
    for (const step of t.steps) {
      const sample = step.stations.at(-1);
      expect(sample?.kind === 'sample' ? sample.random : 'fehlt').toBeNull();
    }
  });
});

describe('S-10 Schichtregel für src/sampling/', () => {
  const target = 'src/sampling/rule-check.ts';

  it.each([
    [
      "import { generate } from '../engine/generate';\nexport const g = generate;\n",
      ['import-x/no-restricted-paths'],
    ],
    [
      "import { texts } from '../app/texts';\nexport const t = texts;\n",
      ['import-x/no-restricted-paths'],
    ],
    [
      "import { StepList } from '../views/step-list/StepList';\nexport const s = StepList;\n",
      ['import-x/no-restricted-paths'],
    ],
    [
      "import { timeoutScheduler } from '../playback/scheduler';\nexport const s = timeoutScheduler;\n",
      ['import-x/no-restricted-paths'],
    ],
    [
      "import { useState } from 'react';\nexport const u = useState;\n",
      ['@typescript-eslint/no-restricted-imports', 'no-restricted-imports'],
    ],
    [
      "import { deserializeTrace } from '../trace/serialize';\nexport const d = deserializeTrace;\n",
      ['@typescript-eslint/no-restricted-imports'],
    ],
    ['export const r = Math.random();\n', ['no-restricted-syntax', 'no-restricted-properties']],
    ['export const n = Date.now();\n', ['no-restricted-syntax', 'no-restricted-properties']],
    [
      'export function f(x: any): number {\n  return Number(x);\n}\n',
      ['@typescript-eslint/no-explicit-any'],
    ],
  ])('S-10: Verstoß %#', async (code, rules) => {
    assertViolation(await lintAs(code, target), rules);
  });

  it('S-10: Typ-Import aus trace ist erlaubt', async () => {
    const code =
      "import type { Candidate } from '../trace/types';\n\nexport function first(d: readonly Candidate[]): Candidate | undefined {\n  return d[0];\n}\n";
    assertClean(await lintAs(code, target));
  });

  it('S-10: views und engine dürfen sampling importieren', async () => {
    const code =
      "import { DEFAULT_SETTINGS } from '../sampling/transform';\n\nexport const s = DEFAULT_SETTINGS;\n";
    assertClean(await lintAs(code, 'src/views/rule-check.ts'));
    assertClean(await lintAs(code, 'src/engine/rule-check.ts'));
  });
});

describe('S-11 Performance', () => {
  it('S-11: 50 257 Kandidaten werden nach Aufwärmen in < 50 ms umgeformt', () => {
    const n = 50_257;
    const logits = Array.from({ length: n }, (_, i) => 8 - (i * 16) / n);
    const probs = softmax(logits);
    const distribution = logits.map((l, i) => candidate(i, `t${i}`, l, probs[i] ?? 0));
    const s = settings(0.7, 0, 0.9);
    transformDistribution(distribution, s);
    const start = performance.now();
    const result = transformDistribution(distribution, s);
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});
