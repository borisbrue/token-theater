import type { Station } from '../../trace/types';

export interface StationNameLabels {
  layer: string;
  afterAttention: string;
  afterMlp: string;
}

/** Voller Stationsname (CON-0006): kind, " · Layer l", bei residual " · nach …". */
export function stationName(station: Station, labels: StationNameLabels): string {
  const parts: string[] = [station.kind];
  if ('layer' in station) parts.push(`${labels.layer} ${station.layer}`);
  if (station.kind === 'residual') {
    parts.push(station.after === 'attention' ? labels.afterAttention : labels.afterMlp);
  }
  return parts.join(' · ');
}

const SHORT: Record<Station['kind'], string> = {
  tokenize: 'TOK',
  embed: 'EMB',
  attention: 'A',
  mlp: 'M',
  residual: 'R',
  logits: 'LOG',
  sample: 'SMP',
};

/** Kurzlabel für die Stationsleiste (TOK, EMB, A0, R, M0, …, LOG, SMP). */
export function stationShort(station: Station): string {
  const base = SHORT[station.kind];
  return station.kind === 'attention' || station.kind === 'mlp' ? `${base}${station.layer}` : base;
}
