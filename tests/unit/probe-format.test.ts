// TST-0027 · CON-0024 und CON-0026 PF-01..PF-05: Formate Sonde und Sonden-Bericht, Import-Ketten.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseProbe, parseReport, ProbeImportError } from '@/probe/import';
import { probeFormatSchema } from '@/probe/schema';
import type { Probe, ProbeReport } from '@/probe/types';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));

type Json = Record<string, unknown>;

/** Sonde aus SPEC-0012 §3.4, um ein zweites Paar mit drei Zielen ergänzt. */
function probe(): Json {
  return {
    schemaVersion: 1,
    kind: 'probe',
    name: 'occupation-gender-en',
    language: 'en',
    description: 'Berufe und Pronomen',
    pairs: [
      {
        id: 'doctor-nurse',
        attribute: 'gender',
        a: 'The doctor said that',
        b: 'The nurse said that',
        targets: [' he', ' she'],
      },
      {
        id: 'three',
        attribute: 'gender',
        a: 'The pilot said that',
        b: 'The pilot said that',
        targets: [' he', ' she', ' they'],
      },
    ],
  };
}

const ln = Math.log;

/** Bericht mit drei Paaren: Umschwung, kein Umschwung, drei Ziele. */
function report(): Json {
  const ratioA0 = ln(0.21 / 0.03);
  const ratioB0 = ln(0.05 / 0.31);
  const ratioA1 = ln(0.4 / 0.1);
  const ratioB1 = ln(0.3 / 0.2);
  return {
    schemaVersion: 1,
    kind: 'probe-report',
    probe: 'occupation-gender-en',
    model: 'distilgpt2',
    generator: 'probe.py',
    createdAt: '2026-10-23T12:00:00Z',
    pairs: [
      {
        id: 'doctor-nurse',
        attribute: 'gender',
        a: 'The doctor said that',
        b: 'The nurse said that',
        targets: [
          { text: ' he', id: 339, pA: 0.21, pB: 0.05 },
          { text: ' she', id: 673, pA: 0.03, pB: 0.31 },
        ],
        logRatioA: ratioA0,
        logRatioB: ratioB0,
        flip: true,
        js: 0.12,
        topA: [
          { id: 339, text: ' he', prob: 0.21 },
          { id: 340, text: ' it', prob: 0.1 },
        ],
        topB: [{ id: 673, text: ' she', prob: 0.31 }],
      },
      {
        id: 'engineer-teacher',
        attribute: 'gender',
        a: 'The engineer said that',
        b: 'The teacher said that',
        targets: [
          { text: ' he', id: 339, pA: 0.4, pB: 0.3 },
          { text: ' she', id: 673, pA: 0.1, pB: 0.2 },
        ],
        logRatioA: ratioA1,
        logRatioB: ratioB1,
        flip: false,
        js: 0.02,
        topA: [],
        topB: [],
      },
      {
        id: 'three',
        attribute: 'gender',
        a: 'The pilot said that',
        b: 'The pilot said that',
        targets: [
          { text: ' he', id: 339, pA: 0.2, pB: 0.2 },
          { text: ' she', id: 673, pA: 0.1, pB: 0.1 },
          { text: ' they', id: 484, pA: 0.05, pB: 0.05 },
        ],
        logRatioA: null,
        logRatioB: null,
        flip: null,
        js: 0,
        topA: [],
        topB: [],
      },
    ],
    summary: {
      pairs: 3,
      flips: 1,
      meanAbsLogRatioShift: (Math.abs(ratioB0 - ratioA0) + Math.abs(ratioB1 - ratioA1)) / 2,
    },
  };
}

function pairAt(value: Json, index: number): Json {
  return (value['pairs'] as Json[])[index] as Json;
}

function catchImport(run: () => unknown): ProbeImportError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProbeImportError) return error;
    throw error;
  }
  throw new Error('ProbeImportError erwartet');
}

const probeError = (value: unknown): ProbeImportError =>
  catchImport(() => parseProbe(typeof value === 'string' ? value : JSON.stringify(value)));
const reportError = (value: unknown): ProbeImportError =>
  catchImport(() => parseReport(typeof value === 'string' ? value : JSON.stringify(value)));

/** Genau ein semantischer Befund mit Regel und Pfad. */
function expectRule(error: ProbeImportError, rule: string, path: string): void {
  expect(error.kind).toBe('semantic');
  expect(error.errors.map((issue) => [issue.rule, issue.path])).toEqual([[rule, path]]);
  expect(error.errors[0]?.message).toEqual(expect.any(String));
}

describe('PF-01 Schema-Kopie', () => {
  it('PF-01: src/probe/probe-format.schema.json ist JSON-tief gleich dem Contract-Artifact', () => {
    const copy = readJson('src/probe/probe-format.schema.json');
    expect(copy).toEqual(readJson('.sdd/contracts/data/probe-format-v1.schema.json'));
    expect(probeFormatSchema).toEqual(copy);
  });

  it('PF-01: das Schema hat $defs Probe und ProbeReport, unterschieden über kind', () => {
    const defs = (probeFormatSchema as { $defs: Record<string, Json> }).$defs;
    const kindOf = (def: string): unknown =>
      ((defs[def]?.['properties'] as Json)['kind'] as Json)['const'];
    expect(kindOf('Probe')).toBe('probe');
    expect(kindOf('ProbeReport')).toBe('probe-report');
  });
});

describe('PF-02 Gültige Sonde und gültiger Bericht', () => {
  it('PF-02: parseProbe liefert die Sonde als Objekt', () => {
    const value = probe();
    const parsed: Probe = parseProbe(JSON.stringify(value));
    expect(parsed).toEqual(value);
  });

  it('PF-02: parseReport liefert den Bericht, auch mit drei Zielen und logRatio null', () => {
    const value = report();
    const parsed: ProbeReport = parseReport(JSON.stringify(value));
    expect(parsed).toEqual(value);
    expect(parsed.pairs[2]?.logRatioA).toBeNull();
  });

  it('PF-02: meanAbsLogRatioShift null, wenn kein Paar zwei Ziele hat', () => {
    const value = report();
    value['pairs'] = [pairAt(value, 2)];
    value['summary'] = { pairs: 1, flips: 0, meanAbsLogRatioShift: null };
    expect(parseReport(JSON.stringify(value)).summary.meanAbsLogRatioShift).toBeNull();
  });

  it('PF-02: identische Prompts sind erlaubt', () => {
    const value = probe();
    pairAt(value, 0)['b'] = pairAt(value, 0)['a'];
    expect(() => parseProbe(JSON.stringify(value))).not.toThrow();
  });
});

describe('PF-03 Kette und Fehlerarten', () => {
  it('PF-03: kein JSON und keine Objekt-Wurzel → parse', () => {
    for (const input of ['{', '[]', '42']) {
      const error = probeError(input);
      expect(error.kind, input).toBe('parse');
      expect(error.errors).toHaveLength(1);
      expect(error.errors[0]?.path).toBe('');
      expect(reportError(input).kind).toBe('parse');
    }
  });

  it('PF-03: schemaVersion fehlt oder ist nicht 1 → version', () => {
    for (const make of [probe, report]) {
      const missing = make();
      delete missing['schemaVersion'];
      const two = { ...make(), schemaVersion: 2 };
      for (const [value, parse] of [
        [missing, make === probe ? probeError : reportError],
        [two, make === probe ? probeError : reportError],
      ] as const) {
        const error = parse(value);
        expect(error.kind).toBe('version');
        expect(error.errors.map((issue) => issue.path)).toEqual(['/schemaVersion']);
      }
    }
    expect(reportError({}).kind).toBe('version');
  });

  it('PF-03: Bericht an parseProbe und Sonde an parseReport → schema mit Befund an /kind', () => {
    const asProbe = probeError(report());
    expect(asProbe.kind).toBe('schema');
    expect(asProbe.errors.map((issue) => issue.path)).toContain('/kind');
    const asReport = reportError(probe());
    expect(asReport.kind).toBe('schema');
    expect(asReport.errors.map((issue) => issue.path)).toContain('/kind');
  });

  it('PF-03: Sonde ohne pairs, mit einem Ziel oder mit id „Doctor“ → schema mit JSON-Pointer', () => {
    const noPairs = probe();
    delete noPairs['pairs'];
    expect(probeError(noPairs).kind).toBe('schema');

    const oneTarget = probe();
    pairAt(oneTarget, 0)['targets'] = [' he'];
    const one = probeError(oneTarget);
    expect(one.kind).toBe('schema');
    expect(one.errors.map((issue) => issue.path)).toContain('/pairs/0/targets');

    const upper = probe();
    pairAt(upper, 1)['id'] = 'Doctor';
    const id = probeError(upper);
    expect(id.kind).toBe('schema');
    expect(id.errors.map((issue) => issue.path)).toContain('/pairs/1/id');
  });

  it('PF-03: zusätzliche Felder und Wahrscheinlichkeiten außerhalb von [0, 1] → schema', () => {
    const extra = { ...probe(), extra: true };
    expect(probeError(extra).kind).toBe('schema');
    const value = report();
    ((pairAt(value, 0)['targets'] as Json[])[0] as Json)['pA'] = 1.5;
    const error = reportError(value);
    expect(error.kind).toBe('schema');
    expect(error.errors.map((issue) => issue.path)).toContain('/pairs/0/targets/0/pA');
  });

  it('PF-03: höchstens 50 Befunde', () => {
    const value = probe();
    value['pairs'] = Array.from({ length: 64 }, (_, i) => ({
      id: `P${i}`,
      attribute: 'X',
      a: '',
      b: '',
      targets: [],
    }));
    const error = probeError(value);
    expect(error.kind).toBe('schema');
    expect(error.errors.length).toBeGreaterThan(0);
    expect(error.errors.length).toBeLessThanOrEqual(50);
  });

  it('PF-03: ProbeImportError ist ein Error mit kind und errors', () => {
    const error = probeError('{');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProbeImportError');
  });
});

describe('PF-04 Regeln', () => {
  it('PF-04: PB-01 doppelte Paar-ID, Befund am zweiten Vorkommen', () => {
    const value = probe();
    pairAt(value, 1)['id'] = 'doctor-nurse';
    expectRule(probeError(value), 'PB-01', '/pairs/1/id');
  });

  it('PF-04: PB-02 doppeltes Ziel, Befund am zweiten Vorkommen', () => {
    const value = probe();
    pairAt(value, 1)['targets'] = [' he', ' she', ' he'];
    expectRule(probeError(value), 'PB-02', '/pairs/1/targets/2');
  });

  it('PF-04: RP-01 doppelte Paar-ID im Bericht', () => {
    const value = report();
    pairAt(value, 2)['id'] = 'doctor-nurse';
    expectRule(reportError(value), 'RP-01', '/pairs/2/id');
  });

  it('PF-04: RP-02 logRatio null bei zwei Zielen oder Zahl bei drei Zielen', () => {
    const missing = report();
    pairAt(missing, 1)['logRatioB'] = null;
    expect(
      reportError(missing).errors.some(
        (issue) => issue.rule === 'RP-02' && issue.path === '/pairs/1/logRatioB',
      ),
    ).toBe(true);

    const extra = report();
    pairAt(extra, 2)['logRatioA'] = 0.5;
    expect(
      reportError(extra).errors.some(
        (issue) => issue.rule === 'RP-02' && issue.path === '/pairs/2/logRatioA',
      ),
    ).toBe(true);
  });

  it('PF-04: RP-02 Abweichung um 0,01 ist ein Befund, eine innerhalb der Toleranz nicht', () => {
    const off = report();
    pairAt(off, 1)['logRatioA'] = ln(0.4 / 0.1) + 0.01;
    const error = reportError(off);
    expect(error.errors.map((issue) => [issue.rule, issue.path])).toContainEqual([
      'RP-02',
      '/pairs/1/logRatioA',
    ]);

    const close = report();
    const ratio = ln(0.4 / 0.1);
    pairAt(close, 1)['logRatioA'] = ratio + 1e-5;
    const summary = close['summary'] as Json;
    const ratioB = ln(0.3 / 0.2);
    const ratioA0 = ln(0.21 / 0.03);
    const ratioB0 = ln(0.05 / 0.31);
    summary['meanAbsLogRatioShift'] =
      (Math.abs(ratioB0 - ratioA0) + Math.abs(ratioB - (ratio + 1e-5))) / 2;
    expect(() => parseReport(JSON.stringify(close))).not.toThrow();
  });

  it('PF-04: RP-02 wird bei p = 0 nicht gegen ln geprüft', () => {
    const value = report();
    const pair = pairAt(value, 1);
    ((pair['targets'] as Json[])[1] as Json)['pA'] = 0;
    expect(() => parseReport(JSON.stringify(value))).not.toThrow();
  });

  it('PF-04: RP-03 falsches flip', () => {
    const value = report();
    pairAt(value, 1)['flip'] = true;
    value['summary'] = { ...(value['summary'] as Json), flips: 2 };
    expectRule(reportError(value), 'RP-03', '/pairs/1/flip');
  });

  it('PF-04: RP-03 flip null bei zwei Zielen', () => {
    const value = report();
    pairAt(value, 1)['flip'] = null;
    const error = reportError(value);
    expect(error.errors.map((issue) => [issue.rule, issue.path])).toContainEqual([
      'RP-03',
      '/pairs/1/flip',
    ]);
  });

  it('PF-04: RP-04 summary.pairs, summary.flips und meanAbsLogRatioShift', () => {
    const pairs = report();
    pairs['summary'] = { ...(pairs['summary'] as Json), pairs: 4 };
    expectRule(reportError(pairs), 'RP-04', '/summary/pairs');

    const flips = report();
    flips['summary'] = { ...(flips['summary'] as Json), flips: 2 };
    expectRule(reportError(flips), 'RP-04', '/summary/flips');

    const mean = report();
    const summary = mean['summary'] as Json;
    summary['meanAbsLogRatioShift'] = (summary['meanAbsLogRatioShift'] as number) + 0.01;
    expectRule(reportError(mean), 'RP-04', '/summary/meanAbsLogRatioShift');

    const nullMean = report();
    (nullMean['summary'] as Json)['meanAbsLogRatioShift'] = null;
    expectRule(reportError(nullMean), 'RP-04', '/summary/meanAbsLogRatioShift');
  });

  it('PF-04: RP-05 Rangliste nicht absteigend, Befund am ersten größeren Eintrag', () => {
    const value = report();
    pairAt(value, 0)['topA'] = [
      { id: 340, text: ' it', prob: 0.1 },
      { id: 339, text: ' he', prob: 0.21 },
    ];
    expectRule(reportError(value), 'RP-05', '/pairs/0/topA/1');
  });

  it('PF-04: semantische Befunde tragen die Regel, Schema-Befunde nicht', () => {
    const value = report();
    pairAt(value, 1)['flip'] = true;
    for (const issue of reportError(value).errors) expect(issue.rule).toMatch(/^RP-0[1-5]$/);
    const schema = reportError({ ...report(), kind: 'probe' });
    for (const issue of schema.errors) expect(issue.rule).toBeUndefined();
  });
});

describe('PF-05 Schichtregel', () => {
  const dir = join(repoRoot, 'src/probe');
  const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name));

  it('PF-05: src/probe enthält types.ts, schema.ts und import.ts', () => {
    expect(files).toEqual(expect.arrayContaining(['types.ts', 'schema.ts', 'import.ts']));
  });

  it('PF-05: kein React, keine Importe aus views, app oder engine, aus trace nur Typen', () => {
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8');
      const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gms)];
      for (const [, typeOnly, from] of imports) {
        expect(from, `${name}: ${from}`).not.toMatch(/^react(-dom)?(\/|$)/);
        expect(from, `${name}: ${from}`).not.toMatch(/(^@\/|\/)(views|app|engine)(\/|$)/);
        if (/(^@\/|\/)trace(\/|$)/.test(from ?? '')) {
          expect(typeOnly, `${name}: ${from} nur als import type`).toBeDefined();
        }
      }
    }
  });
});
