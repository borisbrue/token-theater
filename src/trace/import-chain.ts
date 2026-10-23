import { checkInvariants } from './invariants';
import { MAX_ISSUES, validateTrace } from './schema';
import type { ImportIssue } from './types';

/**
 * Import-Kette (SPEC-0001 §3.6, Chain of Responsibility): parse → version → schema → semantik.
 * Jedes Glied liefert den Wert für das nächste oder bricht mit einem TraceImportError ab.
 * Das Dekodieren der Tensoren hängt `deserializeTrace` an.
 */

export type TraceImportErrorKind = 'parse' | 'version' | 'schema' | 'semantic';

export class TraceImportError extends Error {
  readonly kind: TraceImportErrorKind;
  readonly errors: readonly ImportIssue[];

  constructor(kind: TraceImportErrorKind, errors: readonly ImportIssue[]) {
    super(errors[0]?.message ?? kind);
    this.name = 'TraceImportError';
    this.kind = kind;
    this.errors = errors;
  }
}

export const SUPPORTED_SCHEMA_VERSION = 1;

type Link = (input: unknown) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const parse: Link = (input) => {
  let value: unknown;
  try {
    value = JSON.parse(String(input));
  } catch {
    throw new TraceImportError('parse', [{ path: '', message: 'Kein gültiges JSON' }]);
  }
  if (!isPlainObject(value)) {
    throw new TraceImportError('parse', [{ path: '', message: 'Die Wurzel ist kein Objekt' }]);
  }
  return value;
};

const version: Link = (input) => {
  const value = input as Record<string, unknown>;
  if (!('schemaVersion' in value)) {
    throw new TraceImportError('version', [
      { path: '/schemaVersion', message: 'schemaVersion fehlt' },
    ]);
  }
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new TraceImportError('version', [
      {
        path: '/schemaVersion',
        message: `Trace-Version ${JSON.stringify(schemaVersion)} wird nicht unterstützt`,
      },
    ]);
  }
  return value;
};

const schema: Link = (input) => {
  const result = validateTrace(input);
  if (!result.ok) {
    throw new TraceImportError('schema', result.errors);
  }
  return input;
};

const semantic: Link = (input) => {
  const issues = checkInvariants(input);
  if (issues.length > 0) {
    throw new TraceImportError('semantic', issues.slice(0, MAX_ISSUES));
  }
  return input;
};

export const IMPORT_CHAIN: readonly Link[] = [parse, version, schema, semantic];

/** Führt die Kette aus und liefert das geprüfte, noch serialisierte Objekt. */
export function runImportChain(json: string): Record<string, unknown> {
  return IMPORT_CHAIN.reduce<unknown>((value, link) => link(value), json) as Record<
    string,
    unknown
  >;
}
