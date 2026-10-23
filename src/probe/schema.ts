import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import schemaJson from './probe-format.schema.json';
import type { ProbeIssue } from './types';

/** Das Schema von Sonde und Bericht v1, inhaltsgleich mit dem CON-0024-Artifact. */
export const probeFormatSchema = schemaJson;

export const MAX_ISSUES = 50;

export type ProbeFormat = 'Probe' | 'ProbeReport';

export type ValidationResult = { ok: true } | { ok: false; errors: ProbeIssue[] };

const compiled = new Map<ProbeFormat, ValidateFunction>();

/** Validiert gegen `$defs/<format>` statt gegen das oneOf der Wurzel: Befunde nur dieses Formats. */
function validator(format: ProbeFormat): ValidateFunction {
  const cached = compiled.get(format);
  if (cached !== undefined) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const { $schema, $id, $defs } = schemaJson;
  const validate = ajv.compile({ $schema, $id, $defs, $ref: `#/$defs/${format}` });
  compiled.set(format, validate);
  return validate;
}

function toIssue(error: ErrorObject): ProbeIssue {
  return { path: error.instancePath, message: error.message ?? error.keyword };
}

/** Prüft nur die Struktur; die Regeln PB-xx und RP-xx prüft `rules.ts`. */
export function validateFormat(format: ProbeFormat, json: unknown): ValidationResult {
  const validate = validator(format);
  if (validate(json)) return { ok: true };
  return { ok: false, errors: (validate.errors ?? []).map(toIssue).slice(0, MAX_ISSUES) };
}
