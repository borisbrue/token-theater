import type { Station, StationKind } from '../../trace/types';

/** Lage einer Station in ihrem Layer: Teil `part` von `parts`, ab 1 gezählt (SPEC-0010 §3.2). */
export interface LayerPlace {
  layer: number;
  part: number;
  parts: number;
}

export type LayerGroupKind = 'input' | 'layer' | 'output';

export interface LayerCell {
  station: Station;
  /** Index der Station im Schritt. */
  index: number;
  short: string;
  current: boolean;
}

export interface LayerGroup {
  kind: LayerGroupKind;
  /** Nur bei kind 'layer'. */
  layer: number | null;
  cells: LayerCell[];
  current: boolean;
  /** Verdichtet: ein einzelnes Kästchen statt der Stationen (SPEC-0011 §3.5). */
  collapsed: boolean;
}

/** Ab mehr Layern als diesen zeigt nur der aktuelle Layer seine Stationen (SPEC-0011 §3.5). */
export const MAX_EXPANDED_LAYERS = 8;

export interface LayerMapModel {
  groups: LayerGroup[];
  /** Lage der aktuellen Station oder null außerhalb der Layer. */
  place: LayerPlace | null;
}

/** Kurztexte der Kästchen; eine neue Stationsart erzwingt hier einen Typfehler. */
const CELL_SHORT: Record<StationKind, string> = {
  tokenize: 'TOK',
  embed: 'EMB',
  attention: 'A',
  residual: '+',
  mlp: 'M',
  moe: 'X',
  logits: 'LOG',
  sample: 'SMP',
};

const layerOf = (station: Station): number | null => ('layer' in station ? station.layer : null);

/**
 * Gruppiert die Stationen eines Schritts in Eingabe, Layer 0 … n−1 und Ausgabe. Die Layer kommen
 * aus den Stationen, nicht aus der Architektur; ohne Layer-Stationen gibt es keine Karte (null).
 */
export function layerMap(stations: readonly Station[], current: number): LayerMapModel | null {
  const layered = stations.flatMap((station, index) => (layerOf(station) === null ? [] : [index]));
  const first = layered[0];
  const last = layered.at(-1);
  if (first === undefined || last === undefined) return null;

  const groups: LayerGroup[] = [];
  const groupFor = (kind: LayerGroupKind, layer: number | null): LayerGroup => {
    const previous = groups.at(-1);
    if (previous !== undefined && previous.kind === kind && previous.layer === layer) {
      return previous;
    }
    const created: LayerGroup = { kind, layer, cells: [], current: false, collapsed: false };
    groups.push(created);
    return created;
  };

  stations.forEach((station, index) => {
    const layer = layerOf(station);
    const kind: LayerGroupKind = index < first ? 'input' : index > last ? 'output' : 'layer';
    const target = groupFor(kind, kind === 'layer' ? layer : null);
    const isCurrent = index === current;
    target.cells.push({ station, index, short: CELL_SHORT[station.kind], current: isCurrent });
    if (isCurrent) target.current = true;
  });

  const layerGroups = groups.filter((g) => g.kind === 'layer');
  if (layerGroups.length > MAX_EXPANDED_LAYERS) {
    for (const g of layerGroups) g.collapsed = !g.current;
  }

  let place: LayerPlace | null = null;
  const currentGroup = groups.find((g) => g.current);
  if (currentGroup?.kind === 'layer' && currentGroup.layer !== null) {
    const part = currentGroup.cells.findIndex((cell) => cell.current) + 1;
    place = { layer: currentGroup.layer, part, parts: currentGroup.cells.length };
  }
  return { groups, place };
}
