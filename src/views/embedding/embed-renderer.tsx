import type { EmbedStation, GenerationStep } from '../../trace/types';
import { formatDecimal } from '../distribution/format';
import { selectedRow, type StationSelection } from '../station/selection';
import { genericRenderer, TensorList, type StationRenderer } from '../station/StationView';
import type { TensorViewLabels, ViewScales } from '../tensor/labels';
import { PositionPicker } from '../tensor/PositionPicker';
import { l2Norm, maxAbs, tensorRow } from '../tensor/tensor-math';
import { VectorStrip } from '../tensor/VectorStrip';

export interface EmbedLabels extends TensorViewLabels {
  token: string;
  positionEmbedding: string;
  sum: string;
}

interface EmbedViewProps {
  station: EmbedStation;
  step: GenerationStep;
  selection: StationSelection;
  select: (patch: Partial<StationSelection>) => void;
  labels: EmbedLabels;
  scales: ViewScales;
}

/** Token-, Positions-Vektor und Summe der gewählten Position (SPEC-0007 FR-07). */
function EmbedView({ station, step, selection, select, labels, scales }: EmbedViewProps) {
  const row = selectedRow(selection, step.newPositions);
  const vectors = [
    { title: labels.token, values: tensorRow(station.token, row) },
    { title: labels.positionEmbedding, values: tensorRow(station.position, row) },
    { title: labels.sum, values: tensorRow(station.sum, row) },
  ];
  const limit = Math.max(...vectors.map((v) => maxAbs(v.values)));
  return (
    <>
      <PositionPicker
        step={step}
        row={row}
        onSelect={(position) => select({ position })}
        labels={labels}
      />
      {vectors.map((v) => (
        <VectorStrip
          key={v.title}
          title={v.title}
          values={v.values}
          limit={limit}
          scale={scales.diverging}
          labels={labels}
        />
      ))}
      <p className="hint">{labels.scale(formatDecimal(limit, 2))}</p>
      <ul className="vector-norms" aria-label={labels.vectors}>
        {vectors.map((v) => (
          <li key={v.title}>{labels.norm(v.title, formatDecimal(l2Norm(v.values), 2))}</li>
        ))}
      </ul>
    </>
  );
}

export function createEmbedRenderer(labels: EmbedLabels, scales: ViewScales): StationRenderer {
  return (context) => {
    const { station, step } = context;
    if (station.kind !== 'embed' || step === null) return genericRenderer(context);
    return (
      <>
        <EmbedView
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
