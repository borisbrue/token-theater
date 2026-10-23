import { base64ToFloat32, float32ToBase64 } from './base64';
import { runImportChain } from './import-chain';
import type { Trace } from './types';

export { TraceImportError, type TraceImportErrorKind } from './import-chain';
export type { ImportIssue } from './types';

/** JSON mit Tensordaten als Base64 little-endian float32 (CON-0001). */
export function serializeTrace(trace: Trace): string {
  return JSON.stringify(trace, (_key, value: unknown) =>
    value instanceof Float32Array ? float32ToBase64(value) : value,
  );
}

function isSerializedTensor(value: unknown): value is { shape: number[]; data: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)['shape']) &&
    (value as Record<string, unknown>)['dtype'] === 'float32' &&
    typeof (value as Record<string, unknown>)['data'] === 'string'
  );
}

/** Dekodiert die Tensoren einer Station; Feldreihenfolge und Zusatzfelder bleiben erhalten. */
function decodeStation(station: Record<string, unknown>): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(station)) {
    decoded[field] = isSerializedTensor(value)
      ? { ...value, data: base64ToFloat32(value.data) }
      : value;
  }
  return decoded;
}

/**
 * Prüft `json` über die Import-Kette (parse → version → schema → semantik) und dekodiert dann
 * die Tensoren. Wirft TraceImportError beim ersten fehlerhaften Glied.
 */
export function deserializeTrace(json: string): Trace {
  const checked = runImportChain(json);
  const steps = (checked['steps'] as Record<string, unknown>[]).map((step) => ({
    ...step,
    stations: (step['stations'] as Record<string, unknown>[]).map(decodeStation),
  }));
  return { ...checked, steps } as unknown as Trace;
}
