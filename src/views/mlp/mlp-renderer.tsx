import type { GenerationStep, MlpStation } from '../../trace/types';
import { formatDecimal } from '../distribution/format';
import { selectedRow, type StationSelection } from '../station/selection';
import { genericRenderer, TensorList, type StationRenderer } from '../station/StationView';
import type { TensorViewLabels, ViewScales } from '../tensor/labels';
import { PositionPicker } from '../tensor/PositionPicker';
import { countPositive, l2Norm, maxAbs, tensorRow, topActivations } from '../tensor/tensor-math';
import { VectorStrip } from '../tensor/VectorStrip';

const TOP_NEURONS = 5;

export interface MlpLabels extends TensorViewLabels {
  hidden: string;
  active: (count: number, total: number) => string;
  neurons: string;
  neuron: (index: number, value: string) => string;
  input: string;
  output: string;
}

interface MlpViewProps {
  station: MlpStation;
  step: GenerationStep;
  selection: StationSelection;
  select: (patch: Partial<StationSelection>) => void;
  labels: MlpLabels;
  scales: ViewScales;
}

/** Aktivierungen der versteckten Schicht und die stärksten Neuronen (SPEC-0007 FR-09). */
function MlpView({ station, step, selection, select, labels, scales }: MlpViewProps) {
  const row = selectedRow(selection, step.newPositions);
  const hidden = tensorRow(station.hidden, row);
  const limit = maxAbs(hidden);
  const norms = [
    { title: labels.input, norm: l2Norm(tensorRow(station.lnIn, row)) },
    { title: labels.output, norm: l2Norm(tensorRow(station.out, row)) },
  ];
  return (
    <>
      <PositionPicker
        step={step}
        row={row}
        onSelect={(position) => select({ position })}
        labels={labels}
      />
      <VectorStrip
        title={labels.hidden}
        values={hidden}
        limit={limit}
        scale={scales.diverging}
        labels={labels}
      />
      <p className="hint">{labels.scale(formatDecimal(limit, 2))}</p>
      <p>{labels.active(countPositive(hidden), hidden.length)}</p>
      <h3 className="list-caption">{labels.neurons}</h3>
      <ol className="neurons" aria-label={labels.neurons}>
        {topActivations(hidden, TOP_NEURONS).map((n) => (
          <li key={n.index}>{labels.neuron(n.index, formatDecimal(n.value, 2))}</li>
        ))}
      </ol>
      <ul className="vector-norms" aria-label={labels.vectors}>
        {norms.map((v) => (
          <li key={v.title}>{labels.norm(v.title, formatDecimal(v.norm, 2))}</li>
        ))}
      </ul>
    </>
  );
}

export function createMlpRenderer(labels: MlpLabels, scales: ViewScales): StationRenderer {
  return (context) => {
    const { station, step } = context;
    if (station.kind !== 'mlp' || step === null) return genericRenderer(context);
    return (
      <>
        <MlpView
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
