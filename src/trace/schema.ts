import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import schemaJson from './trace.schema.json';
import type { ImportIssue } from './types';

/** Das Trace-Schema v1, inhaltsgleich mit dem CON-0001-Artifact. */
export const traceSchema = schemaJson;

export const MAX_ISSUES = 50;

export type ValidationResult = { ok: true } | { ok: false; errors: ImportIssue[] };

const STATION_DEFS: Record<string, string> = {
  tokenize: 'TokenizeStation',
  embed: 'EmbedStation',
  attention: 'AttentionStation',
  mlp: 'MlpStation',
  residual: 'ResidualStation',
  logits: 'LogitsStation',
  sample: 'SampleStation',
};

/**
 * Validierungsschema: wie `traceSchema`, nur verzweigt `Station` per if/then über `kind` statt
 * per oneOf. So meldet Ajv nur Fehler des Zweigs, dessen `kind` passt, statt der Fehler aller
 * sieben Zweige (CON-0001, Import-Fehler `schema`). Die angenommene Menge ist dieselbe, weil
 * sich die Zweige über `kind` gegenseitig ausschließen.
 */
function validationSchema(): object {
  const schema = structuredClone(schemaJson) as { $defs: Record<string, unknown> };
  schema.$defs['Station'] = {
    type: 'object',
    required: ['kind'],
    properties: { kind: { $ref: '#/$defs/StationKind' } },
    allOf: Object.entries(STATION_DEFS).map(([kind, def]) => ({
      if: { properties: { kind: { const: kind } }, required: ['kind'] },
      then: { $ref: `#/$defs/${def}` },
    })),
  };
  return schema;
}

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (compiled === undefined) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    compiled = ajv.compile(validationSchema());
  }
  return compiled;
}

function toIssue(error: ErrorObject): ImportIssue {
  return { path: error.instancePath, message: error.message ?? error.keyword };
}

/** Prüft nur die Struktur gegen das Schema; Semantik prüft `checkInvariants`. */
export function validateTrace(json: unknown): ValidationResult {
  const validate = validator();
  if (validate(json)) {
    return { ok: true };
  }
  const errors = (validate.errors ?? [])
    .filter((error) => error.keyword !== 'if')
    .map(toIssue)
    .slice(0, MAX_ISSUES);
  return { ok: false, errors };
}
