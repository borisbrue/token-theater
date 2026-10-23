import { checkProbe, checkReport } from './rules';
import { MAX_ISSUES, validateFormat, type ProbeFormat } from './schema';
import type { Probe, ProbeIssue, ProbeReport } from './types';

/**
 * Import von Sonde und Bericht (SPEC-0012 §3.4, Chain of Responsibility wie CON-0001):
 * parse → version → schema → semantic. Jedes Glied liefert den Wert für das nächste oder bricht
 * mit einem ProbeImportError ab.
 */

export type ProbeImportErrorKind = 'parse' | 'version' | 'schema' | 'semantic';

export class ProbeImportError extends Error {
  readonly kind: ProbeImportErrorKind;
  readonly errors: readonly ProbeIssue[];

  constructor(kind: ProbeImportErrorKind, errors: readonly ProbeIssue[]) {
    super(errors[0]?.message ?? kind);
    this.name = 'ProbeImportError';
    this.kind = kind;
    this.errors = errors;
  }
}

export const SUPPORTED_PROBE_VERSION = 1;

type Link = (input: unknown) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const parse: Link = (input) => {
  let value: unknown;
  try {
    value = JSON.parse(String(input));
  } catch {
    throw new ProbeImportError('parse', [{ path: '', message: 'Kein gültiges JSON' }]);
  }
  if (!isPlainObject(value)) {
    throw new ProbeImportError('parse', [{ path: '', message: 'Die Wurzel ist kein Objekt' }]);
  }
  return value;
};

const version: Link = (input) => {
  const value = input as Record<string, unknown>;
  if (!('schemaVersion' in value)) {
    throw new ProbeImportError('version', [
      { path: '/schemaVersion', message: 'schemaVersion fehlt' },
    ]);
  }
  if (value['schemaVersion'] !== SUPPORTED_PROBE_VERSION) {
    throw new ProbeImportError('version', [
      {
        path: '/schemaVersion',
        message: `Version ${JSON.stringify(value['schemaVersion'])} wird nicht unterstützt`,
      },
    ]);
  }
  return value;
};

const schema =
  (format: ProbeFormat): Link =>
  (input) => {
    const result = validateFormat(format, input);
    if (!result.ok) throw new ProbeImportError('schema', result.errors);
    return input;
  };

const semantic =
  <T>(check: (value: T) => ProbeIssue[]): Link =>
  (input) => {
    const issues = check(input as T);
    if (issues.length > 0) throw new ProbeImportError('semantic', issues.slice(0, MAX_ISSUES));
    return input;
  };

function runChain(json: string, chain: readonly Link[]): unknown {
  return chain.reduce<unknown>((value, link) => link(value), json);
}

const PROBE_CHAIN: readonly Link[] = [parse, version, schema('Probe'), semantic(checkProbe)];
const REPORT_CHAIN: readonly Link[] = [
  parse,
  version,
  schema('ProbeReport'),
  semantic(checkReport),
];

/** Liest eine Sonde (`*.probe.json`); wirft ProbeImportError. */
export function parseProbe(json: string): Probe {
  return runChain(json, PROBE_CHAIN) as Probe;
}

/** Liest einen Sonden-Bericht (`*.probe-report.json`); wirft ProbeImportError. */
export function parseReport(json: string): ProbeReport {
  return runChain(json, REPORT_CHAIN) as ProbeReport;
}
