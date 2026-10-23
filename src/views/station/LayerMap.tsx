import type { LayerGroup, LayerMapModel } from './layer-map';
import { stationName, type StationNameLabels } from './station-name';

export interface LayerMapLabels {
  region: string;
  input: string;
  inputShort: string;
  output: string;
  outputShort: string;
  layer: (layer: number) => string;
  layerShort: (layer: number) => string;
}

function groupLabel(group: LayerGroup, labels: LayerMapLabels): [string, string] {
  if (group.kind === 'input') return [labels.input, labels.inputShort];
  if (group.kind === 'output') return [labels.output, labels.outputShort];
  const layer = group.layer ?? 0;
  return [labels.layer(layer), labels.layerShort(layer)];
}

/** Layer-Karte (SPEC-0010 §3.2): reine Anzeige, die aktuelle Station mit aria-current. */
export function LayerMap({
  model,
  labels,
  names,
}: {
  model: LayerMapModel;
  labels: LayerMapLabels;
  names: StationNameLabels;
}) {
  return (
    <ol className="layer-map" aria-label={labels.region}>
      {model.groups.map((group) => {
        const [label, short] = groupLabel(group, labels);
        return (
          <li
            key={label}
            aria-label={label}
            className={`layer-group layer-group-${group.kind}${group.current ? ' current' : ''}`}
          >
            {!group.collapsed && (
              <span className="layer-group-short" aria-hidden>
                {short}
              </span>
            )}
            <ol>
              {group.collapsed && (
                <li aria-label={label} className="layer-cell layer-cell-collapsed">
                  {short}
                </li>
              )}
              {!group.collapsed &&
                group.cells.map((cell) => (
                  <li
                    key={cell.index}
                    aria-label={stationName(cell.station, names)}
                    aria-current={cell.current ? 'step' : undefined}
                    className={`layer-cell layer-cell-${cell.station.kind}`}
                  >
                    {cell.short}
                  </li>
                ))}
            </ol>
          </li>
        );
      })}
    </ol>
  );
}
