import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { GenerationStep, LogitsStation, Token, TraceEvent } from '@/trace/types';
import { createRng } from '@/engine/rng';
import { generate, GenerateError } from '@/engine/generate';
import { GreedySampler } from '@/engine/samplers/greedy';
import { MockEngine } from '@/engine/mock/mock-engine';
import { serializeTrace } from '@/trace/serialize';
import { validateTrace } from '@/trace/schema';
import { checkInvariants } from '@/trace/invariants';
import { createEngine, UnknownEngineError } from '@/app/engine-factory';

import {
  add,
  at,
  collect,
  eventPattern,
  expectClose,
  FIXED_CLOCK,
  FIXED_ID,
  freshSetup,
  kinds,
  lastEvent,
  run,
  SAMPLING_SEED,
  settle,
  stationsOf,
  stepAt,
} from './helpers/engine-setup';
import {
  ExtraAttentionEngine,
  FailingAfterEmbedEngine,
  NoLogitsEngine,
  SampleInForwardEngine,
  SpyEngine,
  SpySampler,
} from './helpers/engine-test-engines';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/engine-and-generator-behavior.feature', import.meta.url),
);

/** Szenariotitel wörtlich aus dem Feature (CON-0002). Der Abgleichtest unten hält beide synchron. */
const T = {
  eventOrder: 'Event-Reihenfolge eines vollständigen Laufs',
  stationsTwoLayers: 'Stationen eines Schritts bei zwei Layern',
  generatorStations: 'tokenize und sample stammen vom Generator',
  kvCache: 'KV-Cache-Sicht der newPositions',
  contextChain: 'Kontextkette',
  structure: 'Strukturelle Korrektheit der Mock-Daten',
  tokenizer: 'Mock-Tokenizer und Decoding',
  determinism: 'Determinismus',
  weightSeed: 'Andere Gewichte ergeben andere Tensoren',
  maxTokensEnd: 'Ende bei maxTokens',
  eosEnd: 'Ende bei EOS',
  eosFirst: 'EOS im ersten Schritt',
  eosLast: 'EOS im letzten erlaubten Schritt',
  abortSignal: 'Abbruch über AbortSignal',
  abortMidStep: 'Abbruch mitten in einem Schritt',
  abortReturn: 'Abbruch über return() des Iterators',
  engineError: 'Engine-Fehler mitten in forward',
  noLogits: 'forward endet nicht mit logits',
  outsideCapabilities: 'Station außerhalb der Fähigkeiten',
  sampleInForward: 'forward liefert eine sample-Station',
  restricted: 'Eingeschränkte Fähigkeiten (Remote-artig)',
  greedy: 'Greedy wählt das wahrscheinlichste Token',
  greedyTie: 'Greedy bei Gleichstand',
  unknownWords: 'Unbekannte Wörter',
  emptyPrompt: 'Leerer Prompt',
  contextTooLong: 'Kontext zu lang',
  recorder: 'Recorder reicht Events weiter und friert den Trace ein',
  buildEarly: 'build() vor dem Ende',
  factory: 'Engine-Erzeugung über die Factory',
  performance: 'Laufzeit der Mock-Engine',
} as const;

const OUTLINE_INVALID_MAX_TOKENS = 'Ungültiges maxTokens';
const INVALID_MAX_TOKENS: readonly number[] = [0, 33, 2.5];

const PROMPT = 'die katze sitzt';
const ALL_STATIONS =
  'tokenize, embed, attention, residual, mlp, residual, attention, residual, mlp, residual, logits, sample';
const STATIONS_NO_TOKENIZE =
  'embed, attention, residual, mlp, residual, attention, residual, mlp, residual, logits, sample';

function expectValidTrace(trace: Parameters<typeof serializeTrace>[0]): void {
  const serialized: unknown = JSON.parse(serializeTrace(trace));
  expect(validateTrace(serialized)).toEqual({ ok: true });
  expect(checkInvariants(serialized)).toEqual([]);
}

function tokens(step: GenerationStep): string {
  return step.contextTokens.map((t) => t.text).join(', ');
}

/** Holt den Ablehnungsgrund des ersten next()-Aufrufs, ohne dass ein Event entsteht. */
async function firstNextRejection(source: AsyncIterable<TraceEvent>): Promise<unknown> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    const result = await iterator.next();
    return new Error(`erwartete Ablehnung, erhielt Event ${JSON.stringify(result.value)}`);
  } catch (error) {
    return error;
  }
}

function logitsStation(entries: ReadonlyArray<[number, number]>): LogitsStation {
  return {
    kind: 'logits',
    vocabSize: 52,
    coverage: 1,
    distribution: entries.map(([id, prob]) => ({
      token: { id, text: `t${id}` },
      logit: Math.log(prob),
      prob,
    })),
  };
}

function eventsOfType<K extends TraceEvent['type']>(
  events: readonly TraceEvent[],
  type: K,
): Extract<TraceEvent, { type: K }>[] {
  return events.filter((e): e is Extract<TraceEvent, { type: K }> => e.type === type);
}

describe('CON-0002 Engine, Generator, Recorder und Sampler', () => {
  it(T.eventOrder, async () => {
    const setup = await freshSetup();
    const { events } = await run(setup, PROMPT, 3);

    expect(eventPattern(events)).toMatch(/^run-start( step-start( station)+ step-end){3} done$/);

    const [runStart] = eventsOfType(events, 'run-start');
    expect(runStart).toBeDefined();
    expect(runStart?.engine.kind).toBe('mock');
    expect(runStart?.prompt).toBe(PROMPT);
    expect(runStart?.maxTokens).toBe(3);
    expect(runStart?.sampling.seed).toBe(SAMPLING_SEED);
    expect(runStart?.sampling.strategy).toBe('greedy');

    const starts = eventsOfType(events, 'step-start');
    expect(starts.map((e) => e.index)).toEqual([0, 1, 2]);
    for (const start of starts) {
      expect(start.contextTokens.length).toBeGreaterThan(0);
      expect(start.newPositions).toHaveLength(2);
    }

    const ends = eventsOfType(events, 'step-end');
    expect(ends.map((e) => e.index)).toEqual([0, 1, 2]);
    const first = ends[0];
    const firstStart = starts[0];
    if (!first || !firstStart) throw new Error('Schritt 0 fehlt');
    expect(first.chosen.id).toBeGreaterThanOrEqual(0);
    expect(first.text).toBe(
      setup.engine.tokenizer.decode([...firstStart.contextTokens, first.chosen]),
    );
    expect(first.text.startsWith('die katze sitzt')).toBe(true);

    const done = lastEvent(events);
    expect(done).toEqual({ type: 'done', finishReason: 'max-tokens' });

    // Nach "done" liefert der Iterator keine weiteren Events.
    const again = await freshSetup();
    const iterator = generate(
      again.engine,
      again.sampler,
      { prompt: PROMPT, maxTokens: 3, seed: SAMPLING_SEED },
      again.deps,
    )[Symbol.asyncIterator]();
    let result = await iterator.next();
    while (!result.done && result.value.type !== 'done') result = await iterator.next();
    expect((await iterator.next()).done).toBe(true);
    expect((await iterator.next()).done).toBe(true);
  });

  it(T.stationsTwoLayers, async () => {
    const { trace } = await run(await freshSetup(), PROMPT, 2);

    expect(kinds(stepAt(trace, 0))).toBe(ALL_STATIONS);
    expect(kinds(stepAt(trace, 1))).toBe(STATIONS_NO_TOKENIZE);
    for (const step of trace.steps) {
      expect(stationsOf(step, 'residual').map((r) => `${r.layer}/${r.after}`)).toEqual([
        '0/attention',
        '0/mlp',
        '1/attention',
        '1/mlp',
      ]);
    }
  });

  it(T.generatorStations, async () => {
    const engine = new SpyEngine();
    const sampler = new SpySampler();
    const setup = await freshSetup({}, engine, sampler);
    const { trace } = await run(setup, PROMPT, 1);

    expect(engine.tokenizeCalls).toBe(1);
    expect(sampler.calls).toHaveLength(1);
    const logits = stationsOf(stepAt(trace, 0), 'logits')[0];
    expect(sampler.calls[0]).toEqual(logits);
    for (const forwardKinds of engine.forwardKinds) {
      expect(forwardKinds).not.toContain('tokenize');
      expect(forwardKinds).not.toContain('sample');
      expect(forwardKinds[forwardKinds.length - 1]).toBe('logits');
    }
  });

  it(T.kvCache, async () => {
    const { trace, events } = await run(await freshSetup(), PROMPT, 3);

    expect(stepAt(trace, 0).newPositions).toEqual([0, 3]);
    expect(stepAt(trace, 1).newPositions).toEqual([3, 4]);
    expect(stepAt(trace, 2).newPositions).toEqual([4, 5]);
    const attention = stationsOf(stepAt(trace, 2), 'attention')[0];
    expect(attention?.weights.shape).toEqual([2, 1, 5]);
    expect(eventsOfType(events, 'step-start').map((e) => e.newPositions)).toEqual([
      [0, 3],
      [3, 4],
      [4, 5],
    ]);
  });

  it(T.contextChain, async () => {
    const { trace } = await run(await freshSetup(), PROMPT, 3);

    for (const i of [1, 2]) {
      const previous = stepAt(trace, i - 1);
      expect(stepAt(trace, i).contextTokens).toEqual([...previous.contextTokens, previous.chosen]);
    }
  });

  it(T.structure, async () => {
    const { trace } = await run(await freshSetup(), PROMPT, 4);

    for (const step of trace.steps) {
      const [a] = step.newPositions;
      for (const attention of stationsOf(step, 'attention')) {
        const [heads = 0, rows = 0, cols = 0] = attention.weights.shape;
        for (let h = 0; h < heads; h++) {
          for (let i = 0; i < rows; i++) {
            let sum = 0;
            for (let j = 0; j < cols; j++) {
              const w = at(attention.weights, [h, i, j]);
              sum += w;
              if (j > a + i) expect(w).toBe(0);
            }
            expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-5);
          }
        }
      }

      const embed = stationsOf(step, 'embed')[0];
      if (!embed) throw new Error('embed fehlt');
      let stream = embed.sum.data;
      // Der Stream vor dem ersten Block ist embed.sum: die erste residual-Station muss
      // embed.sum + attention(0).out sein.
      let lastOut: Float32Array | null = null;
      for (const station of step.stations) {
        if (station.kind === 'attention' || station.kind === 'mlp') lastOut = station.out.data;
        if (station.kind === 'residual') {
          if (!lastOut) throw new Error('residual ohne vorausgehende attention/mlp');
          expectClose(station.stream.data, add(stream, lastOut), 1e-5);
          stream = station.stream.data;
          lastOut = null;
        }
      }

      const logits = stationsOf(step, 'logits')[0];
      expect(logits?.coverage).toBe(1);
      expect(logits?.vocabSize).toBe(52);
      expect(new Set(logits?.distribution.map((c) => c.token.id)).size).toBe(52);
      expect(logits?.distribution).toHaveLength(52);
    }

    expectValidTrace(trace);
  });

  it(T.tokenizer, async () => {
    const engine = new MockEngine({ weightSeed: 1234 });
    await engine.load();
    const result = await engine.tokenizer.tokenize('Die Katze sitzt, der Hund schläft.');

    expect(result.map((t) => t.text)).toEqual([
      'die',
      'katze',
      'sitzt',
      ',',
      'der',
      'hund',
      'schläft',
      '.',
    ]);
    expect(engine.tokenizer.decode(result)).toBe('die katze sitzt, der hund schläft.');
  });

  it(T.determinism, async () => {
    const first = await run(await freshSetup(), PROMPT, 8);
    const second = await run(await freshSetup(), PROMPT, 8);

    expect(first.trace.id).toBe(FIXED_ID);
    expect(first.trace.createdAt).toBe(FIXED_CLOCK);
    expect(serializeTrace(second.trace)).toBe(serializeTrace(first.trace));
  });

  it(T.weightSeed, async () => {
    const a = await run(await freshSetup({ weightSeed: 1234 }), PROMPT, 1);
    const b = await run(await freshSetup({ weightSeed: 1235 }), PROMPT, 1);

    const sumA = stationsOf(stepAt(a.trace, 0), 'embed')[0]?.sum.data;
    const sumB = stationsOf(stepAt(b.trace, 0), 'embed')[0]?.sum.data;
    if (!sumA || !sumB) throw new Error('embed fehlt');
    expect(Array.from(sumA)).not.toEqual(Array.from(sumB));
  });

  it(T.maxTokensEnd, async () => {
    const setup = await freshSetup();
    const { trace } = await run(setup, PROMPT, 5);

    expect(trace.steps).toHaveLength(5);
    expect(trace.finishReason).toBe('max-tokens');
    const eos = setup.engine.tokenizer.eosTokenId;
    for (const step of trace.steps) {
      expect(step.chosen.id).not.toBe(eos);
      expect(step.chosen.text).not.toBe('<eos>');
    }
  });

  it(T.eosEnd, async () => {
    const { trace } = await run(await freshSetup({ eosAt: 1 }), PROMPT, 8);

    expect(trace.steps).toHaveLength(2);
    expect(trace.finishReason).toBe('eos');
    const last = stepAt(trace, 1).chosen;
    expect(last.text).toBe('<eos>');
    expect(last.id).toBe(trace.engine.eosTokenId);
  });

  it(T.eosFirst, async () => {
    const { trace } = await run(await freshSetup({ eosAt: 0 }), PROMPT, 8);

    expect(trace.steps).toHaveLength(1);
    expect(trace.finishReason).toBe('eos');
  });

  it(T.eosLast, async () => {
    const { trace } = await run(await freshSetup({ eosAt: 2 }), PROMPT, 3);

    expect(trace.steps).toHaveLength(3);
    expect(trace.finishReason).toBe('eos');
    expectValidTrace(trace);
  });

  it(T.abortSignal, async () => {
    const controller = new AbortController();
    const { events, trace } = await run(await freshSetup(), PROMPT, 32, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'step-end' && event.index === 2) controller.abort();
      },
    });

    expect(lastEvent(events)).toEqual({ type: 'done', finishReason: 'aborted' });
    expect(trace.finishReason).toBe('aborted');
    expect(trace.steps.map((s) => s.index)).toEqual([0, 1, 2]);
    expectValidTrace(trace);
  });

  it(T.abortMidStep, async () => {
    const controller = new AbortController();
    let seenStep1 = false;
    const { events, trace } = await run(await freshSetup(), PROMPT, 8, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'step-start' && event.index === 1) seenStep1 = true;
        if (seenStep1 && event.type === 'station' && event.index === 1) controller.abort();
      },
    });

    expect(lastEvent(events)).toEqual({ type: 'done', finishReason: 'aborted' });
    expect(trace.steps.map((s) => s.index)).toEqual([0]);
    expectValidTrace(trace);
  });

  it(T.abortReturn, async () => {
    const engine = new SpyEngine();
    const setup = await freshSetup({}, engine);
    const source = generate(
      setup.engine,
      setup.sampler,
      { prompt: PROMPT, maxTokens: 8, seed: SAMPLING_SEED },
      setup.deps,
    );
    const iterator = source[Symbol.asyncIterator]();

    let result = await iterator.next();
    while (!result.done && result.value.type !== 'station') result = await iterator.next();
    expect(result.done).toBe(false);
    await iterator.return?.();
    await settle();

    expect(engine.forwardCalls).toBe(1);
    expect((await iterator.next()).done).toBe(true);

    // Dasselbe über for-await mit break: kein abschließendes Event.
    const breakEngine = new SpyEngine();
    const breakSetup = await freshSetup({}, breakEngine);
    const seen: TraceEvent[] = [];
    for await (const event of generate(
      breakSetup.engine,
      breakSetup.sampler,
      { prompt: PROMPT, maxTokens: 8, seed: SAMPLING_SEED },
      breakSetup.deps,
    )) {
      seen.push(event);
      if (event.type === 'station') break;
    }
    await settle();
    expect(breakEngine.forwardCalls).toBe(1);
    expect(seen.some((e) => e.type === 'done' || e.type === 'error')).toBe(false);
  });

  it(T.engineError, async () => {
    const setup = await freshSetup({}, new FailingAfterEmbedEngine(1, 'kaputt'));
    const { events, trace } = await run(setup, PROMPT, 4);

    expect(eventPattern(events)).toMatch(
      /^run-start step-start( station)+ step-end step-start station error$/,
    );
    expect(lastEvent(events)).toEqual({ type: 'error', message: 'kaputt' });
    expect(trace.steps.map((s) => s.index)).toEqual([0]);
    expect(trace.finishReason).toBe('error');
    expect(trace.error).toEqual({ message: 'kaputt' });
    expectValidTrace(trace);
  });

  it(T.noLogits, async () => {
    const setup = await freshSetup({}, new NoLogitsEngine());
    const { events } = await run(setup, PROMPT, 2);

    const last = lastEvent(events);
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.message).toContain('logits');
  });

  it(T.outsideCapabilities, async () => {
    const setup = await freshSetup({}, new ExtraAttentionEngine());
    const { events } = await run(setup, PROMPT, 1);

    const last = lastEvent(events);
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.message).toContain('attention');
  });

  it(T.sampleInForward, async () => {
    const setup = await freshSetup({}, new SampleInForwardEngine());
    const { events } = await run(setup, PROMPT, 1);

    const last = lastEvent(events);
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.message).toContain('sample');
  });

  it(T.restricted, async () => {
    const setup = await freshSetup({ capabilities: ['tokenize', 'logits', 'sample'] });
    const { trace } = await run(setup, PROMPT, 3);

    expect(kinds(stepAt(trace, 0))).toBe('tokenize, logits, sample');
    expect(kinds(stepAt(trace, 1))).toBe('logits, sample');
    expect(trace.engine.architecture).toBeNull();
    expectValidTrace(trace);
  });

  it(T.greedy, () => {
    const logits = logitsStation([
      [2, 0.5],
      [9, 0.3],
      [5, 0.2],
    ]);
    const sample = new GreedySampler().sample(logits, createRng(SAMPLING_SEED));

    expect(sample.kind).toBe('sample');
    expect(sample.chosen.id).toBe(2);
    expect(sample.random).toBeNull();
    expect(sample.distribution).toEqual(logits.distribution);
  });

  it(T.greedyTie, () => {
    const logits = logitsStation([
      [3, 0.4],
      [7, 0.4],
      [1, 0.2],
    ]);
    const sample = new GreedySampler().sample(logits, createRng(SAMPLING_SEED));

    expect(sample.chosen.id).toBe(3);
  });

  it(T.unknownWords, async () => {
    const { trace } = await run(await freshSetup(), 'quantenchromodynamik katze', 1);

    expect(tokens(stepAt(trace, 0))).toBe('<unk>, katze');
    const tokenize = stationsOf(stepAt(trace, 0), 'tokenize')[0];
    expect(tokenize?.tokens.map((t: Token) => t.text)).toEqual(['<unk>', 'katze']);
    expect(trace.steps).toHaveLength(1);
  });

  it(T.emptyPrompt, async () => {
    const setup = await freshSetup();
    const error = await firstNextRejection(
      generate(setup.engine, setup.sampler, { prompt: '   ', maxTokens: 4, seed: 42 }, setup.deps),
    );

    expect(error).toBeInstanceOf(GenerateError);
    expect(error).toMatchObject({ kind: 'empty-prompt' });
  });

  for (const value of INVALID_MAX_TOKENS) {
    it(`${OUTLINE_INVALID_MAX_TOKENS} (wert=${value})`, async () => {
      const setup = await freshSetup();
      const error = await firstNextRejection(
        generate(
          setup.engine,
          setup.sampler,
          { prompt: 'die katze', maxTokens: value, seed: 42 },
          setup.deps,
        ),
      );

      expect(error).toBeInstanceOf(GenerateError);
      expect(error).toMatchObject({ kind: 'invalid-max-tokens' });
    });
  }

  it(T.contextTooLong, async () => {
    const setup = await freshSetup();
    const prompt = Array.from({ length: 40 }, () => 'katze').join(' ');
    const error = await firstNextRejection(
      generate(setup.engine, setup.sampler, { prompt, maxTokens: 32, seed: 42 }, setup.deps),
    );

    expect(error).toBeInstanceOf(GenerateError);
    expect(error).toMatchObject({ kind: 'context-too-long' });
  });

  it(T.recorder, async () => {
    const setup = await freshSetup();
    const produced: TraceEvent[] = [];
    async function* tap(source: AsyncIterable<TraceEvent>): AsyncIterable<TraceEvent> {
      for await (const event of source) {
        produced.push(event);
        yield event;
      }
    }
    const source = tap(
      generate(setup.engine, setup.sampler, { prompt: PROMPT, maxTokens: 2, seed: 42 }, setup.deps),
    );
    const received = await collect(setup.recorder.record(source));

    expect(received).toHaveLength(produced.length);
    received.forEach((event, i) => expect(event).toBe(produced[i]));

    const trace = setup.recorder.build();
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace.steps)).toBe(true);
    for (const step of trace.steps) {
      expect(Object.isFrozen(step)).toBe(true);
      expect(Object.isFrozen(step.stations)).toBe(true);
      for (const station of step.stations) {
        expect(Object.isFrozen(station)).toBe(true);
        for (const value of Object.values(station) as unknown[]) {
          if (isTensorWrapper(value)) expect(Object.isFrozen(value)).toBe(true);
        }
      }
    }

    const steps = trace.steps as unknown as GenerationStep[];
    expect(() => {
      steps.push(steps[0] as GenerationStep);
    }).toThrow(TypeError);

    const starts = eventsOfType(produced, 'step-start');
    expect(trace.steps.map((s) => s.newPositions)).toEqual(starts.map((s) => s.newPositions));
  });

  it(T.buildEarly, async () => {
    const setup = await freshSetup();
    const source = generate(
      setup.engine,
      setup.sampler,
      { prompt: PROMPT, maxTokens: 2, seed: 42 },
      setup.deps,
    );
    const iterator = setup.recorder.record(source)[Symbol.asyncIterator]();
    await iterator.next();

    expect(() => setup.recorder.build()).toThrow(/unvollständig/);
    await iterator.return?.();
  });

  it(T.factory, () => {
    const deps = {
      createRng,
      idProvider: () => FIXED_ID,
      clock: () => FIXED_CLOCK,
    };
    const engine = createEngine('mock', deps);

    expect(engine.info.kind).toBe('mock');
    expect(engine.info.model).toBe('mock-de-52');
    expect([...engine.info.capabilities].sort()).toEqual(
      ['attention', 'embed', 'logits', 'mlp', 'residual', 'sample', 'tokenize'].sort(),
    );

    const unknownKind = 'unbekannt' as Parameters<typeof createEngine>[0];
    expect(() => createEngine(unknownKind, deps)).toThrow(UnknownEngineError);
    expect(() => createEngine(unknownKind, deps)).toThrow(/unbekannt/);
  });

  it(T.performance, async () => {
    const durations: number[] = [];
    for (let i = 0; i < 5; i++) {
      const setup = await freshSetup();
      const start = performance.now();
      await run(setup, PROMPT, 8);
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);

    expect(durations[2]).toBeLessThan(200);
  });

  it('Feature-Szenarien und Testnamen stimmen überein', () => {
    const feature = readFileSync(FEATURE_PATH, 'utf8');
    const scenarios: string[] = [];
    const outlines: string[] = [];
    for (const line of feature.split('\n')) {
      const scenario = /^\s*Szenario:\s*(.+?)\s*$/.exec(line);
      if (scenario?.[1]) scenarios.push(scenario[1]);
      const outline = /^\s*Szenariogrundriss:\s*(.+?)\s*$/.exec(line);
      if (outline?.[1]) outlines.push(outline[1]);
    }

    expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
    expect(outlines).toEqual([OUTLINE_INVALID_MAX_TOKENS]);

    const examples = feature
      .slice(feature.indexOf(`Szenariogrundriss: ${OUTLINE_INVALID_MAX_TOKENS}`))
      .split('\n')
      .map((line) => /^\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line)?.[1])
      .filter((cell): cell is string => cell !== undefined)
      .slice(1)
      .map(Number);
    expect(examples).toEqual([...INVALID_MAX_TOKENS]);
  });
});

function isTensorWrapper(value: unknown): value is object {
  return (
    typeof value === 'object' &&
    value !== null &&
    'shape' in value &&
    'data' in value &&
    (value as { data: unknown }).data instanceof Float32Array
  );
}
