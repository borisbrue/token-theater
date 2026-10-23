import type { GenerationStep, MoeStation } from '../../trace/types';
import { selectedRow, type StationSelection } from '../station/selection';
import { genericRenderer, TensorList, type StationRenderer } from '../station/StationView';
import { sampleScale } from '../tensor/color-scale';
import type { TensorViewLabels, ViewScales } from '../tensor/labels';
import { PositionPicker } from '../tensor/PositionPicker';
import { displayText } from '../tokenization/token-display';
import { gatesByExpert, layerRoutes, routerProbs } from './routing';

export interface MoeLabels extends TensorViewLabels {
  routing: string;
  expertHead: (expert: number) => string;
  rowHead: (position: number, token: string) => string;
  cell: (expert: number, router: string) => string;
  chosenCell: (expert: number, router: string, gate: string) => string;
  percent: (value: number) => string;
  chosen: string;
  chosenEntry: (expert: number, gate: string) => string;
  gateSum: (sum: string) => string;
  allLayers: string;
  layerHead: (layer: number) => string;
  dense: string;
}

/** Werte des Attributs scope, keine sichtbaren Texte. */
const COLUMN = 'col';
const ROW = 'row';

interface MoeViewProps {
  station: MoeStation;
  step: GenerationStep;
  selection: StationSelection;
  select: (patch: Partial<StationSelection>) => void;
  labels: MoeLabels;
  scales: ViewScales;
}

/** Spaltenköpfe E0 … E(n − 1); die erste Spalte gehört den Zeilenköpfen. */
function ExpertHeads({ count, labels }: { count: number; labels: MoeLabels }) {
  return (
    <thead>
      <tr>
        <td />
        {Array.from({ length: count }, (_, e) => (
          <th key={e} scope={COLUMN}>
            {labels.expertHead(e)}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * Routing einer moe-Station (SPEC-0011 FR-03): Router-Anteile und Wahl je Token, die Experten des
 * gewählten Tokens und sein Weg durch alle Layer. Alle Zahlen stammen aus dem Trace (MU-01).
 */
function MoeView({ station, step, selection, select, labels, scales }: MoeViewProps) {
  const [a] = step.newPositions;
  const row = selectedRow(selection, step.newPositions);
  const count = station.routerLogits.shape[1] ?? 0;
  const rows = station.experts.map((_, i) => i);
  const chosen = (station.experts[row] ?? []).map((expert, j) => ({
    expert,
    gate: station.gates[row]?.[j] ?? 0,
  }));
  const sum = chosen.reduce((total, entry) => total + entry.gate, 0);
  const routes = layerRoutes(step.stations, row);
  return (
    <>
      <PositionPicker
        step={step}
        row={row}
        onSelect={(position) => select({ position })}
        labels={labels}
      />
      <div className="moe-scroll">
        <table className="moe-table moe-routing">
          <caption>{labels.routing}</caption>
          <ExpertHeads count={count} labels={labels} />
          <tbody>
            {rows.map((i) => {
              const probs = routerProbs(station, i);
              const gates = gatesByExpert(station, i);
              const token = displayText(step.contextTokens[a + i]?.text ?? '');
              return (
                <tr key={i} className={i === row ? 'selected' : undefined}>
                  <th scope={ROW}>{labels.rowHead(a + i, token)}</th>
                  {probs.map((p, e) => {
                    const gate = gates.get(e);
                    const router = labels.percent(p);
                    return (
                      <td
                        key={e}
                        className={gate === undefined ? undefined : 'chosen'}
                        style={{ backgroundColor: sampleScale(scales.sequential, p) }}
                        aria-label={
                          gate === undefined
                            ? labels.cell(e, router)
                            : labels.chosenCell(e, router, labels.percent(gate))
                        }
                      >
                        {gate === undefined ? '' : labels.percent(gate)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3 className="list-caption">{labels.chosen}</h3>
      <ol className="moe-chosen" aria-label={labels.chosen}>
        {chosen.map((entry) => (
          <li key={entry.expert}>
            <span>{labels.chosenEntry(entry.expert, labels.percent(entry.gate))}</span>
            <span className="moe-bar" aria-hidden={true}>
              <span style={{ width: `${entry.gate * 100}%` }} />
            </span>
          </li>
        ))}
      </ol>
      <p className="hint">{labels.gateSum(labels.percent(sum))}</p>
      <div className="moe-scroll">
        <table className="moe-table moe-layers">
          <caption>{labels.allLayers}</caption>
          <ExpertHeads count={count} labels={labels} />
          <tbody>
            {routes.map((route) => (
              <tr
                key={route.layer}
                className={route.layer === station.layer ? 'current' : undefined}
              >
                <th scope={ROW}>{labels.layerHead(route.layer)}</th>
                {route.kind === 'mlp' ? (
                  <td colSpan={count}>{labels.dense}</td>
                ) : (
                  Array.from({ length: count }, (_, e) => {
                    const gate = route.gates.get(e);
                    return (
                      <td key={e} className={gate === undefined ? undefined : 'chosen'}>
                        {gate === undefined ? '' : labels.percent(gate)}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function createMoeRenderer(labels: MoeLabels, scales: ViewScales): StationRenderer {
  return (context) => {
    const { station, step } = context;
    if (station.kind !== 'moe' || step === null) return genericRenderer(context);
    return (
      <>
        <MoeView
          station={station}
          step={step}
          selection={context.selection}
          select={context.select}
          labels={labels}
          scales={scales}
        />
        <TensorList station={station} label={context.labels.tensors} />
      </>
    );
  };
}
