import type { GenerationStep, ResidualStation } from '../../trace/types';
import { formatDecimal, formatPercent } from '../distribution/format';
import { selectedRow, type StationSelection } from '../station/selection';
import { genericRenderer, TensorList, type StationRenderer } from '../station/StationView';
import { displayText } from '../tokenization/token-display';
import type { TensorViewLabels, ViewScales } from '../tensor/labels';
import { PositionPicker } from '../tensor/PositionPicker';
import { residualTrajectory, type TrajectoryEntry } from '../tensor/residual-trajectory';
import { maxAbs, tensorRow } from '../tensor/tensor-math';
import { VectorStrip } from '../tensor/VectorStrip';

export interface ResidualLabels extends TensorViewLabels {
  stream: string;
  trajectory: string;
  embed: string;
  entry: (layer: number, after: ResidualStation['after']) => string;
  normEntry: (name: string, norm: string) => string;
  delta: (delta: string) => string;
  lens: string;
  lensEntry: (token: string, percent: string) => string;
  lensAfterMlp: string;
  noLens: string;
  lensLastPosition: string;
}

interface ResidualViewProps {
  station: ResidualStation;
  step: GenerationStep;
  selection: StationSelection;
  select: (patch: Partial<StationSelection>) => void;
  labels: ResidualLabels;
  scales: ViewScales;
}

function entryText(entry: TrajectoryEntry, labels: ResidualLabels): string {
  const name =
    entry.kind === 'embed' || entry.layer === null || entry.after === null
      ? labels.embed
      : labels.entry(entry.layer, entry.after);
  const text = labels.normEntry(name, formatDecimal(entry.norm, 2));
  return entry.delta === null ? text : `${text} ${labels.delta(formatDecimal(entry.delta, 2))}`;
}

/** Strom der gewählten Position, Verlauf über die Layer und Logit-Lens (SPEC-0007 FR-10). */
function ResidualView({ station, step, selection, select, labels, scales }: ResidualViewProps) {
  const row = selectedRow(selection, step.newPositions);
  const stream = tensorRow(station.stream, row);
  const limit = maxAbs(stream);
  const trajectory = residualTrajectory(step.stations, row);
  const current = step.stations.indexOf(station);
  const largest = Math.max(...trajectory.map((e) => e.norm), 0);
  const last = row === step.newPositions[1] - step.newPositions[0] - 1;
  let lens: React.ReactNode;
  if (station.lens !== undefined) {
    lens = (
      <>
        {!last && <p className="hint">{labels.lensLastPosition}</p>}
        <h3 className="list-caption">{labels.lens}</h3>
        <ol className="lens" aria-label={labels.lens}>
          {station.lens.map((c) => (
            <li key={c.token.id}>
              {labels.lensEntry(displayText(c.token.text), formatPercent(c.prob))}
            </li>
          ))}
        </ol>
      </>
    );
  } else {
    lens = (
      <p className="hint">{station.after === 'attention' ? labels.lensAfterMlp : labels.noLens}</p>
    );
  }
  return (
    <>
      <PositionPicker
        step={step}
        row={row}
        onSelect={(position) => select({ position })}
        labels={labels}
      />
      <VectorStrip
        title={labels.stream}
        values={stream}
        limit={limit}
        scale={scales.diverging}
        labels={labels}
      />
      <p className="hint">{labels.scale(formatDecimal(limit, 2))}</p>
      <h3 className="list-caption">{labels.trajectory}</h3>
      <ol className="trajectory" aria-label={labels.trajectory}>
        {trajectory.map((entry) => {
          const isCurrent = entry.stationIndex === current;
          return (
            <li
              key={entry.stationIndex}
              className={isCurrent ? 'current' : undefined}
              aria-current={isCurrent ? true : undefined}
            >
              <span className="trajectory-text">{entryText(entry, labels)}</span>
              <span className="trajectory-bar" aria-hidden={true}>
                <span style={{ width: `${largest > 0 ? (entry.norm / largest) * 100 : 0}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
      {lens}
    </>
  );
}

export function createResidualRenderer(
  labels: ResidualLabels,
  scales: ViewScales,
): StationRenderer {
  return (context) => {
    const { station, step } = context;
    if (station.kind !== 'residual' || step === null) return genericRenderer(context);
    return (
      <>
        <ResidualView
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
