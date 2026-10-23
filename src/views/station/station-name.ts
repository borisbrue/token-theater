import type { Station } from '../../trace/types';

export interface StationNameLabels {
  layer: string;
  afterAttention: string;
  afterMlp: string;
  afterMoe: string;
}

/** Voller Stationsname (CON-0006): kind, " · Layer l", bei residual " · nach …". */
export function stationName(station: Station, labels: StationNameLabels): string {
  const parts: string[] = [station.kind];
  if ('layer' in station) parts.push(`${labels.layer} ${station.layer}`);
  if (station.kind === 'residual') {
    const after = { attention: labels.afterAttention, mlp: labels.afterMlp, moe: labels.afterMoe };
    parts.push(after[station.after]);
  }
  return parts.join(' · ');
}

const SHORT: Record<Station['kind'], string> = {
  tokenize: 'TOK',
  embed: 'EMB',
  attention: 'A',
  mlp: 'M',
  moe: 'X',
  residual: 'R',
  logits: 'LOG',
  sample: 'SMP',
};

/** Kurzlabel für die Stationsleiste (TOK, EMB, A0, R, M0 oder X0, …, LOG, SMP). */
export function stationShort(station: Station): string {
  const base = SHORT[station.kind];
  return station.kind === 'attention' || station.kind === 'mlp' || station.kind === 'moe'
    ? `${base}${station.layer}`
    : base;
}
