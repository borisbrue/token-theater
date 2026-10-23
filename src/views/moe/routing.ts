import type { MoeStation, Station } from '../../trace/types';
import { tensorRow } from '../tensor/tensor-math';

/** Reine Rechnungen der MoE-Ansicht (SPEC-0011 §3.4, CON-0022 MU-01): nur Lesen aus dem Trace. */

/** Router-Anteil je Experte: Softmax über alle Router-Logits einer Zeile. */
export function routerProbs(station: MoeStation, row: number): number[] {
  const logits = Array.from(tensorRow(station.routerLogits, row));
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

/** Gate je Experte einer Zeile; nicht gewählte fehlen. */
export function gatesByExpert(station: MoeStation, row: number): Map<number, number> {
  const experts = station.experts[row] ?? [];
  const gates = station.gates[row] ?? [];
  return new Map(experts.map((expert, j) => [expert, gates[j] ?? 0]));
}

export type LayerRoute =
  | { layer: number; kind: 'moe'; gates: Map<number, number> }
  | { layer: number; kind: 'mlp' };

/** Weg einer Zeile durch alle Feed-Forward-Teile des Schritts, in Layer-Reihenfolge. */
export function layerRoutes(stations: readonly Station[], row: number): LayerRoute[] {
  return stations.flatMap((station): LayerRoute[] => {
    if (station.kind === 'moe') {
      return [{ layer: station.layer, kind: 'moe', gates: gatesByExpert(station, row) }];
    }
    if (station.kind === 'mlp') return [{ layer: station.layer, kind: 'mlp' }];
    return [];
  });
}
