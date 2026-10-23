import type { Station, Tensor } from '../../trace/types';

/** Tensorfelder je Stationsart in Feldreihenfolge des Schemas (CON-0001). */
const TENSOR_FIELDS: Record<Station['kind'], readonly string[]> = {
  tokenize: [],
  embed: ['token', 'position', 'sum'],
  attention: ['lnIn', 'q', 'k', 'v', 'weights', 'out'],
  mlp: ['lnIn', 'hidden', 'out'],
  residual: ['stream'],
  logits: [],
  sample: [],
};

function formatShape(shape: readonly number[]): string {
  return `[${shape.join(', ')}]`;
}

/**
 * Stationszeile nach CON-0003: `kind`, bei Layer-Stationen " · {layerLabel} {l}", danach je
 * Tensor " · {name} [{shape}]".
 */
export function stationLine(station: Station, layerLabel: string): string {
  const parts: string[] = [station.kind];
  if ('layer' in station) {
    parts.push(`${layerLabel} ${station.layer}`);
  }
  const fields = station as unknown as Record<string, Tensor | undefined>;
  for (const field of TENSOR_FIELDS[station.kind]) {
    const tensor = fields[field];
    if (tensor !== undefined) {
      parts.push(`${field} ${formatShape(tensor.shape)}`);
    }
  }
  return parts.join(' · ');
}
