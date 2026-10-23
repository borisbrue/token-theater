import type { Station } from '../../trace/types';
import { l2Norm, tensorRow } from './tensor-math';

/** Verlauf des Residual Stream über die Stationen eines Schritts (SPEC-0007 §3.7, CON-0017 V-08). */

export interface TrajectoryEntry {
  /** Index in stations. */
  stationIndex: number;
  kind: 'embed' | 'residual';
  /** null bei embed. */
  layer: number | null;
  /** null bei embed. */
  after: 'attention' | 'mlp' | null;
  norm: number;
  /** null beim ersten Eintrag. */
  delta: number | null;
}

export function residualTrajectory(stations: readonly Station[], row: number): TrajectoryEntry[] {
  const entries: TrajectoryEntry[] = [];
  let previous: Float32Array | null = null;
  stations.forEach((station, stationIndex) => {
    if (station.kind !== 'embed' && station.kind !== 'residual') return;
    const vector = tensorRow(station.kind === 'embed' ? station.sum : station.stream, row);
    const before = previous;
    entries.push({
      stationIndex,
      kind: station.kind,
      layer: station.kind === 'embed' ? null : station.layer,
      after: station.kind === 'embed' ? null : station.after,
      norm: l2Norm(vector),
      delta: before === null ? null : l2Norm(vector.map((v, i) => v - (before[i] ?? 0))),
    });
    previous = vector;
  });
  return entries;
}
