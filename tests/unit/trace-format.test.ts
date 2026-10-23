import { beforeAll, describe, expect, it } from 'vitest';

import contractSchema from '../../.sdd/contracts/data/trace-serialization-format-v1.schema.json';
import schemaCopy from '@/trace/trace.schema.json';
import { checkInvariants } from '@/trace/invariants';
import { traceSchema, validateTrace } from '@/trace/schema';
import { deserializeTrace, serializeTrace, TraceImportError } from '@/trace/serialize';
import type { Trace } from '@/trace/types';

import {
  allTensors,
  at,
  catchImportError,
  decodeBytes,
  decodeF32,
  distributionOf,
  encodeBytes,
  encodeF32,
  expectSchemaValid,
  expectValid,
  expectViolation,
  findStation,
  importJson,
  makeTrace,
  parseSerialized,
  pathStartingWith,
  removeField,
  type STrace,
  tensorOf,
  toSerialized,
} from './helpers/trace-format-fixtures';

/** Gültiges Beispiel aus CON-0001, wörtlich. */
const CONTRACT_EXAMPLE = `{
  "schemaVersion": 1,
  "id": "trace-0001",
  "createdAt": "2026-10-21T12:00:00Z",
  "engine": { "kind": "mock", "model": "mock-de-52", "capabilities": ["tokenize", "logits", "sample"],
              "architecture": null, "eosTokenId": 1 },
  "prompt": "die katze",
  "maxTokens": 1,
  "sampling": { "strategy": "greedy", "seed": 42, "params": {} },
  "steps": [{
    "index": 0,
    "contextTokens": [{ "id": 2, "text": "die" }, { "id": 7, "text": "katze" }],
    "newPositions": [0, 2],
    "stations": [
      { "kind": "tokenize", "tokens": [{ "id": 2, "text": "die" }, { "id": 7, "text": "katze" }] },
      { "kind": "logits", "vocabSize": 52, "coverage": 1,
        "distribution": [{ "token": { "id": 18, "text": "sitzt" }, "logit": 2.1, "prob": 0.7 },
                         { "token": { "id": 19, "text": "schläft" }, "logit": 1.25, "prob": 0.3 }] },
      { "kind": "sample", "random": null, "chosen": { "id": 18, "text": "sitzt" },
        "distribution": [{ "token": { "id": 18, "text": "sitzt" }, "logit": 2.1, "prob": 0.7 },
                         { "token": { "id": 19, "text": "schläft" }, "logit": 1.25, "prob": 0.3 }] }
    ],
    "chosen": { "id": 18, "text": "sitzt" },
    "text": "die katze sitzt"
  }],
  "finishReason": "max-tokens"
}`;

/** Basis: "die katze sitzt", maxTokens 4, alle Fähigkeiten, Greedy, Seed 42, weightSeed 1234. */
let baseTrace: Trace;
let baseJson: string;
let remoteJson: string;
let eosJson: string;

/** Frische, veränderbare Kopie der serialisierten Basis. */
function fresh(): STrace {
  return parseSerialized(baseJson);
}

beforeAll(async () => {
  baseTrace = await makeTrace();
  baseJson = serializeTrace(baseTrace);
  remoteJson = serializeTrace(
    await makeTrace({ capabilities: ['tokenize', 'logits', 'sample'], maxTokens: 3 }),
  );
  eosJson = serializeTrace(await makeTrace({ eosAt: 1, maxTokens: 8 }));
});

describe('Struktur und gültige Traces', () => {
  it('Mock-Trace mit allen Fähigkeiten ist gültig', () => {
    const trace = fresh();
    expect(trace.engine.architecture).not.toBeNull();
    expect(trace.steps).toHaveLength(4);
    expectValid(trace);
  });

  it('Remote-artiger Mock-Trace (tokenize, logits, sample) ist gültig', () => {
    const trace = parseSerialized(remoteJson);
    expect(trace.engine.architecture).toBeNull();
    expect(at(trace.steps, 0).stations.map((s) => s.kind)).toEqual([
      'tokenize',
      'logits',
      'sample',
    ]);
    expectValid(trace);
  });

  it('Gültiges Beispiel aus CON-0001 ist gültig', () => {
    const trace = parseSerialized(CONTRACT_EXAMPLE);
    expectValid(trace);
    const imported = deserializeTrace(CONTRACT_EXAMPLE);
    expect(at(imported.steps, 0).text).toBe('die katze sitzt');
  });

  it('Leerer Trace (0 Schritte, aborted) ist gültig', () => {
    const trace = fresh();
    trace.steps = [];
    trace.finishReason = 'aborted';
    expectValid(trace);
  });

  it('EOS-Trace ist gültig', () => {
    const trace = parseSerialized(eosJson);
    expect(trace.finishReason).toBe('eos');
    expect(at(trace.steps, trace.steps.length - 1).chosen.id).toBe(trace.engine.eosTokenId);
    expectValid(trace);
  });

  it('EOS im letzten erlaubten Schritt ist gültig', async () => {
    const trace = toSerialized(await makeTrace({ eosAt: 2, maxTokens: 3 }));
    expect(trace.steps).toHaveLength(3);
    expect(trace.finishReason).toBe('eos');
    expectValid(trace);
  });

  it('error mit error-Objekt und weniger Schritten als maxTokens ist gültig', () => {
    const trace = fresh();
    trace.steps.pop();
    trace.finishReason = 'error';
    trace.error = { message: 'kaputt' };
    expectValid(trace);
  });
});

describe('Round-Trip', () => {
  it('Round-Trip: deserializeTrace(serializeTrace(t)) ist tief gleich t', () => {
    const imported = deserializeTrace(baseJson);
    expect(imported).toEqual(baseTrace);
  });

  it('Round-Trip: erneutes Serialisieren ist bytegleich', () => {
    expect(serializeTrace(deserializeTrace(baseJson))).toBe(baseJson);
  });

  it('Round-Trip: Tensoren sind Float32Array mit bitgleichem Inhalt', () => {
    const imported = deserializeTrace(baseJson);
    const step0 = at(imported.steps, 0);
    const embed = step0.stations.find((s) => s.kind === 'embed');
    if (embed?.kind !== 'embed') {
      throw new Error('embed-Station fehlt');
    }
    expect(embed.sum.data).toBeInstanceOf(Float32Array);

    const originalStep0 = at(baseTrace.steps, 0);
    const originalEmbed = originalStep0.stations.find((s) => s.kind === 'embed');
    if (originalEmbed?.kind !== 'embed') {
      throw new Error('embed-Station fehlt');
    }
    const bits = (values: Float32Array): number[] =>
      Array.from(new Uint32Array(values.buffer, values.byteOffset, values.length));
    expect(bits(embed.sum.data)).toEqual(bits(originalEmbed.sum.data));
  });

  it('Round-Trip: Tensordaten sind Base64 little-endian float32', () => {
    const serialized = fresh();
    const { station } = findStation(at(serialized.steps, 0), 'embed');
    const sum = tensorOf(station, 'sum');

    const originalStep0 = at(baseTrace.steps, 0);
    const originalEmbed = originalStep0.stations.find((s) => s.kind === 'embed');
    if (originalEmbed?.kind !== 'embed') {
      throw new Error('embed-Station fehlt');
    }
    expect(sum.dtype).toBe('float32');
    expect(sum.shape).toEqual(originalEmbed.sum.shape);
    expect(Array.from(decodeF32(sum.data))).toEqual(Array.from(originalEmbed.sum.data));
  });
});

describe('INV-14 Erweiterbarkeit', () => {
  it('INV-14 Zusatzfelder auf Trace-, Schritt- und Stationsebene überleben den Round-Trip', () => {
    const trace = fresh();
    trace.annotation = { author: 'test', tags: ['a', 'b'] };
    at(trace.steps, 0).note = 'erster Schritt';
    findStation(at(trace.steps, 1), 'attention', 0).station.comment = { level: 2 };
    trace.engine.vendor = 'mock-inc';
    trace.sampling.params.custom = 'x';
    expectValid(trace);

    const reexported = JSON.parse(
      serializeTrace(deserializeTrace(JSON.stringify(trace))),
    ) as unknown;
    expect(reexported).toEqual(trace);
  });
});

describe('Fehlerklassen', () => {
  it('Fehlerklasse parse: kein gültiges JSON', () => {
    const error = catchImportError(importJson('hallo'));
    expect(error.kind).toBe('parse');
    expect(error.errors).toHaveLength(1);
    expect(at(error.errors, 0).path).toBe('');
  });

  it.each(['[1, 2]', '42', 'null', '"text"'])(
    'Fehlerklasse parse: Wurzel ist kein Objekt (%s)',
    (json) => {
      const error = catchImportError(importJson(json));
      expect(error.kind).toBe('parse');
      expect(error.errors).toHaveLength(1);
      expect(at(error.errors, 0).path).toBe('');
    },
  );

  it('Fehlerklasse version: schemaVersion fehlt', () => {
    const error = catchImportError(importJson('{"id":"x"}'));
    expect(error.kind).toBe('version');
    expect(error.errors).toHaveLength(1);
    expect(at(error.errors, 0).path).toBe('/schemaVersion');
  });

  it('Fehlerklasse version: Version 2 wird nicht unterstützt', () => {
    const error = catchImportError(importJson('{"schemaVersion":2}'));
    expect(error.kind).toBe('version');
    expect(error.errors).toHaveLength(1);
    expect(at(error.errors, 0).path).toBe('/schemaVersion');
    expect(at(error.errors, 0).message).toContain('2');
  });

  it('Fehlerklasse version: "1" als String', () => {
    const trace = fresh();
    trace.schemaVersion = '1';
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('version');
    expect(at(error.errors, 0).path).toBe('/schemaVersion');
  });

  it('Fehlerklasse version: keine Ganzzahl (1.5)', () => {
    const trace = fresh();
    trace.schemaVersion = 1.5;
    expect(catchImportError(importJson(JSON.stringify(trace))).kind).toBe('version');
  });

  it('Fehlerklasse version greift vor dem Schema', () => {
    const error = catchImportError(importJson('{"schemaVersion":2,"id":"x"}'));
    expect(error.kind).toBe('version');
  });

  it('Fehlerklasse schema: fehlendes Pflichtfeld chosen', () => {
    const trace = fresh();
    removeField(at(trace.steps, 0), 'chosen');
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('schema');
    expect(error.errors.some((e) => e.path === '/steps/0')).toBe(true);
    expect(validateTrace(trace).ok).toBe(false);
  });

  it('Fehlerklasse schema: unbekannter Stationstyp', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'embed');
    station.kind = 'telepathie';
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('schema');
    expect(
      error.errors.some((e) => pathStartingWith(`/steps/0/stations/${index}`).test(e.path)),
    ).toBe(true);
  });

  it('Fehlerklasse schema: Zusatzfeld in Token (additionalProperties)', () => {
    const trace = fresh();
    const token = at(at(trace.steps, 0).contextTokens, 0) as unknown as Record<string, unknown>;
    token.extra = 1;
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('schema');
    expect(
      error.errors.some((e) => pathStartingWith('/steps/0/contextTokens/0').test(e.path)),
    ).toBe(true);
  });

  it('Fehlerklasse schema: Zusatzfeld in Tensor', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'embed');
    (tensorOf(station, 'sum') as unknown as Record<string, unknown>).scale = 2;
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('schema');
    expect(
      error.errors.some((e) => pathStartingWith(`/steps/0/stations/${index}/sum`).test(e.path)),
    ).toBe(true);
  });

  it('Fehlerklasse schema: Zusatzfeld in Candidate', () => {
    const trace = fresh();
    const { station } = findStation(at(trace.steps, 0), 'logits');
    (at(distributionOf(station), 0) as unknown as Record<string, unknown>).rank = 1;
    expect(catchImportError(importJson(JSON.stringify(trace))).kind).toBe('schema');
  });

  it('Fehlerklasse schema: Base64 mit ungültigem Zeichen', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'embed');
    tensorOf(station, 'token').data = '!!!!';
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('schema');
    expect(
      error.errors.some((e) => pathStartingWith(`/steps/0/stations/${index}/token`).test(e.path)),
    ).toBe(true);
  });

  it('Fehlerklasse schema: oneOf meldet nur den passenden Stationszweig', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'attention', 0);
    removeField(station, 'q');
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('schema');
    expect(error.errors.length).toBeGreaterThan(0);
    for (const issue of error.errors) {
      expect(issue.path).toMatch(pathStartingWith(`/steps/0/stations/${index}`));
      expect(issue.message).not.toMatch(/oneOf|exactly one|must be equal to constant/i);
      expect(issue.message).not.toMatch(/'(tokens|distribution|hidden|stream|after)'/);
    }
    expect(error.errors.some((e) => e.message.includes('q'))).toBe(true);
  });

  it('Fehlerklasse schema: höchstens 50 Einträge', () => {
    const trace = fresh();
    at(trace.steps, 0).contextTokens = Array.from({ length: 60 }, () => ({ id: -1, text: 'x' }));
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('schema');
    expect(error.errors).toHaveLength(50);
  });

  it('Fehlerklasse semantic: höchstens 50 Einträge', () => {
    const trace = fresh();
    for (const tensor of allTensors(trace)) {
      tensor.data = encodeF32(new Float32Array(decodeF32(tensor.data).length).fill(Number.NaN));
    }
    expect(allTensors(trace).length).toBeGreaterThan(50);
    const error = catchImportError(importJson(JSON.stringify(trace)));
    expect(error.kind).toBe('semantic');
    expect(error.errors).toHaveLength(50);
    expect(error.errors.every((e) => typeof e.invariant === 'string')).toBe(true);
  });

  it('Fehlerklasse: TraceImportError ist ein Error mit message = errors[0].message', () => {
    const error = catchImportError(importJson('{"schemaVersion":2}'));
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TraceImportError);
    expect(error.message).toBe(at(error.errors, 0).message);
  });

  it('Fehlerklasse: ungültiges Beispiel aus CON-0001 (weights mit 4 Bytes)', () => {
    const trace = fresh();
    const step = at(trace.steps, 1);
    const { station, index } = findStation(step, 'attention', 0);
    station.weights = { shape: [2, 1, 4], dtype: 'float32', data: 'AACAPw==' };
    expectViolation(trace, 'INV-01', `/steps/1/stations/${index}/weights`);
  });
});

describe('Invarianten', () => {
  it('INV-01 Tensorlänge: weights um genau 4 Bytes gekürzt', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'attention', 0);
    const weights = tensorOf(station, 'weights');
    weights.data = encodeBytes(decodeBytes(weights.data).slice(0, -4));
    expectViolation(trace, 'INV-01', `/steps/0/stations/${index}/weights`);
  });

  it('INV-01 Tensorlänge: NaN in Tensordaten', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'mlp', 0);
    const hidden = tensorOf(station, 'hidden');
    const values = decodeF32(hidden.data);
    values[0] = Number.NaN;
    hidden.data = encodeF32(values);
    expectViolation(trace, 'INV-01', `/steps/0/stations/${index}/hidden`);
  });

  it('INV-01 Tensorlänge: Infinity in Tensordaten', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 1), 'embed');
    const sum = tensorOf(station, 'sum');
    const values = decodeF32(sum.data);
    values[values.length - 1] = Number.NEGATIVE_INFINITY;
    sum.data = encodeF32(values);
    expectViolation(trace, 'INV-01', `/steps/1/stations/${index}/sum`);
  });

  it('INV-02 Schrittindex', () => {
    const trace = fresh();
    at(trace.steps, 1).index = 5;
    expectViolation(trace, 'INV-02', '/steps/1');
  });

  it('INV-03 Kontextkette', () => {
    const trace = fresh();
    at(trace.steps, 2).contextTokens[0] = { id: 3, text: 'der' };
    expectViolation(trace, 'INV-03', '/steps/2');
  });

  it('INV-04 KV-Cache-Sicht: Folgeschritt rechnet den ganzen Kontext', () => {
    const trace = fresh();
    at(trace.steps, 1).newPositions = [0, 4];
    expectViolation(trace, 'INV-04', '/steps/1');
  });

  it('INV-04 KV-Cache-Sicht: Schritt 0 beginnt nicht bei 0', () => {
    const trace = fresh();
    at(trace.steps, 0).newPositions = [1, 3];
    expectViolation(trace, 'INV-04', '/steps/0');
  });

  it('INV-05 Stationsreihenfolge: mlp vor residual(attention)', () => {
    const trace = fresh();
    const step = at(trace.steps, 1);
    const mlp = findStation(step, 'mlp', 0);
    const residual = findStation(step, 'residual', 0, 'attention');
    step.stations[mlp.index] = residual.station;
    step.stations[residual.index] = mlp.station;
    expectViolation(trace, 'INV-05', '/steps/1');
  });

  it('INV-05 Stationsreihenfolge: tokenize außerhalb von Schritt 0', () => {
    const trace = fresh();
    const step = at(trace.steps, 1);
    step.stations.unshift({ kind: 'tokenize', tokens: [...step.contextTokens] });
    expectViolation(trace, 'INV-05', '/steps/1');
  });

  it('INV-05 Stationsreihenfolge: layer außerhalb von 0..L−1', () => {
    const trace = fresh();
    findStation(at(trace.steps, 0), 'attention', 1).station.layer = 5;
    expectViolation(trace, 'INV-05', '/steps/0');
  });

  it('INV-05 Stationsreihenfolge: logits fehlt am Ende', () => {
    const trace = fresh();
    const step = at(trace.steps, 0);
    const logits = findStation(step, 'logits');
    step.stations.splice(logits.index, 1);
    expectViolation(trace, 'INV-05', '/steps/0');
  });

  it('INV-06 Fähigkeiten: Station außerhalb von capabilities', () => {
    const trace = fresh();
    trace.engine.capabilities = trace.engine.capabilities.filter((c) => c !== 'mlp');
    expectViolation(trace, 'INV-06', '/steps/0');
  });

  it('INV-06 Fähigkeiten: Interna ohne architecture', () => {
    const trace = parseSerialized(remoteJson);
    trace.engine.capabilities = [...trace.engine.capabilities, 'embed'];
    expectViolation(trace, 'INV-06', '/engine');
  });

  it('INV-07 Tokenize', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'tokenize');
    station.tokens = [{ id: 3, text: 'der' }, ...(station.tokens ?? []).slice(1)];
    expectViolation(trace, 'INV-07', `/steps/0/stations/${index}`);
  });

  it('INV-08 Tensorformen: residual.stream mit falscher Zeilenzahl', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'residual', 0, 'attention');
    const stream = tensorOf(station, 'stream');
    stream.shape = [1, 8];
    stream.data = encodeF32(new Float32Array(8));
    expectViolation(trace, 'INV-08', `/steps/0/stations/${index}/stream`);
  });

  it('INV-08 Tensorformen: attention.weights mit falscher Kontextbreite', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 1), 'attention', 1);
    const weights = tensorOf(station, 'weights');
    // Schritt 1: n = 1, b = 4 → korrekt [2, 1, 4]; hier [2, 1, 3] mit passender Bytelänge
    const values = new Float32Array(6).fill(1 / 3);
    weights.shape = [2, 1, 3];
    weights.data = encodeF32(values);
    expectViolation(trace, 'INV-08', `/steps/1/stations/${index}/weights`);
  });

  it('INV-09 Kausale Attention: Zeilensumme ungleich 1', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'attention', 0);
    const weights = tensorOf(station, 'weights');
    const values = decodeF32(weights.data);
    // Kopf 0, Zeile 0: nur j = 0 ist erlaubt und hat Gewicht 1
    values[0] = 0.5;
    weights.data = encodeF32(values);
    expectViolation(trace, 'INV-09', `/steps/0/stations/${index}/weights`);
  });

  it('INV-09 Kausale Attention: Gewicht rechts der Diagonale', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'attention', 0);
    const weights = tensorOf(station, 'weights');
    const values = decodeF32(weights.data);
    // Kopf 0, Zeile 0 (Position a + 0 = 0): Summe bleibt 1, aber j = 1 > 0
    values[0] = 0.5;
    values[1] = 0.5;
    weights.data = encodeF32(values);
    expectViolation(trace, 'INV-09', `/steps/0/stations/${index}/weights`);
  });

  it('INV-09 Kausale Attention: negatives Gewicht', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 1), 'attention', 0);
    const weights = tensorOf(station, 'weights');
    const values = decodeF32(weights.data);
    // Schritt 1: Form [2, 1, 4]; Zeile von Kopf 0 = values[0..3]
    values[0] = (values[0] ?? 0) + 0.25;
    values[1] = (values[1] ?? 0) - 0.25 - 1;
    values[2] = (values[2] ?? 0) + 1;
    weights.data = encodeF32(values);
    expectViolation(trace, 'INV-09', `/steps/1/stations/${index}/weights`);
  });

  it('INV-10 Verteilungen: logits.distribution nicht absteigend sortiert', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'logits');
    station.distribution = [...distributionOf(station)].reverse();
    expectViolation(trace, 'INV-10', `/steps/0/stations/${index}`);
  });

  it('INV-10 Verteilungen: sample.distribution nicht absteigend sortiert', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 1), 'sample');
    station.distribution = [...distributionOf(station)].reverse();
    expectViolation(trace, 'INV-10', `/steps/1/stations/${index}`);
  });

  it('INV-10 Verteilungen: doppelte token.id', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'logits');
    const distribution = distributionOf(station);
    at(distribution, 1).token = { ...at(distribution, 0).token };
    expectViolation(trace, 'INV-10', `/steps/0/stations/${index}`);
  });

  it('INV-10 Verteilungen: Summe ungleich 1', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'logits');
    for (const candidate of distributionOf(station)) {
      candidate.prob = candidate.prob / 2;
    }
    expectViolation(trace, 'INV-10', `/steps/0/stations/${index}`);
  });

  it('INV-11 Wahl: sample.chosen weicht von step.chosen ab', () => {
    const trace = fresh();
    const step = at(trace.steps, 0);
    const { station } = findStation(step, 'sample');
    const other = distributionOf(station).find((c) => c.token.id !== step.chosen.id);
    if (other === undefined) {
      throw new Error('Kein alternativer Kandidat');
    }
    station.chosen = { ...other.token };
    expectViolation(trace, 'INV-11', '/steps/0');
  });

  it('INV-11 Wahl: chosen fehlt in sample.distribution', () => {
    const trace = fresh();
    const step = at(trace.steps, 0);
    const { station } = findStation(step, 'sample');
    const remaining = distributionOf(station).filter((c) => c.token.id !== step.chosen.id);
    const mass = remaining.reduce((total, c) => total + c.prob, 0);
    station.distribution = remaining.map((c) => ({ ...c, prob: c.prob / mass }));
    expectViolation(trace, 'INV-11', '/steps/0');
  });

  it('INV-12 Ende: eos ohne EOS-Token am Ende', () => {
    const trace = fresh();
    trace.finishReason = 'eos';
    expectViolation(trace, 'INV-12', '');
  });

  it('INV-12 Ende: eos bei eosTokenId null', () => {
    const trace = parseSerialized(eosJson);
    trace.engine.eosTokenId = null;
    expectViolation(trace, 'INV-12', '');
  });

  it('INV-12 Ende: EOS vor dem letzten Schritt', () => {
    const trace = fresh();
    trace.engine.eosTokenId = at(trace.steps, 0).chosen.id;
    expectViolation(trace, 'INV-12', '');
  });

  it('INV-12 Ende: max-tokens mit weniger Schritten als maxTokens', () => {
    const trace = fresh();
    trace.steps.pop();
    expectViolation(trace, 'INV-12', '');
  });

  it('INV-12 Ende: aborted mit len(steps) = maxTokens', () => {
    const trace = fresh();
    trace.finishReason = 'aborted';
    expectViolation(trace, 'INV-12', '');
  });

  it('INV-12 Ende: error ohne error-Objekt', () => {
    const trace = fresh();
    trace.steps.pop();
    trace.finishReason = 'error';
    expectViolation(trace, 'INV-12', '');
  });

  it('INV-12 Ende: error-Objekt bei max-tokens', () => {
    const trace = fresh();
    trace.error = { message: 'kaputt' };
    expectViolation(trace, 'INV-12', '');
  });

  it('INV-13 Wertebereiche: logits.vocabSize ungleich architecture.vocabSize', () => {
    const trace = fresh();
    const { station, index } = findStation(at(trace.steps, 0), 'logits');
    station.vocabSize = 51;
    expectViolation(trace, 'INV-13', `/steps/0/stations/${index}`);
  });

  it('INV-13 Wertebereiche: Kontext länger als contextLength', () => {
    const trace = fresh();
    const architecture = trace.engine.architecture;
    if (architecture === null) {
      throw new Error('architecture fehlt');
    }
    architecture.contextLength = 2;
    expectViolation(trace, 'INV-13', '/steps/0');
  });

  it('INV-13 Wertebereiche: token.id außerhalb des Vokabulars', () => {
    const trace = fresh();
    const step = at(trace.steps, 0);
    const { station, index } = findStation(step, 'logits');
    const distribution = distributionOf(station);
    const last = at(distribution, distribution.length - 1);
    last.token = { id: 99, text: 'neu' };
    expectViolation(trace, 'INV-13', `/steps/0/stations/${index}`);
  });

  it('INV-13 Wertebereiche: eosTokenId außerhalb des Vokabulars', () => {
    const trace = fresh();
    trace.engine.eosTokenId = 60;
    expectViolation(trace, 'INV-13', '/engine');
  });

  it('INV-15 Text: leerer Text trotz Tokens', () => {
    const trace = fresh();
    at(trace.steps, 0).text = '';
    expectViolation(trace, 'INV-15', '/steps/0');
  });

  it('INV-15 Text: wird beim Import nicht neu berechnet', () => {
    const trace = fresh();
    at(trace.steps, 0).text = 'beliebiger Text';
    expectValid(trace);
    expect(at(deserializeTrace(JSON.stringify(trace)).steps, 0).text).toBe('beliebiger Text');
  });
});

describe('validateTrace und checkInvariants', () => {
  it('validateTrace prüft nur das Schema, nicht die Semantik', () => {
    const trace = fresh();
    at(trace.steps, 1).index = 7;
    expectSchemaValid(trace);
    expect(checkInvariants(trace).length).toBeGreaterThan(0);
  });

  it('validateTrace liefert JSON-Pointer-Pfade', () => {
    const trace = fresh();
    removeField(trace, 'prompt');
    const result = validateTrace(trace);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.every((e) => e.path === '' || e.path.startsWith('/'))).toBe(true);
    }
  });
});

describe('Schema-Kopie (R-06, FR-03)', () => {
  it('src/trace/trace.schema.json ist JSON-tief gleich dem Contract-Artifact', () => {
    expect(schemaCopy).toEqual(contractSchema);
  });

  it('traceSchema entspricht dem Contract-Artifact', () => {
    expect(traceSchema).toEqual(contractSchema);
  });
});
