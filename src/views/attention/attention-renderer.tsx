import type { AttentionStation, GenerationStep } from '../../trace/types';
import { formatPercent } from '../distribution/format';
import { selectedHead, selectedRow, type StationSelection } from '../station/selection';
import { genericRenderer, TensorList, type StationRenderer } from '../station/StationView';
import { displayText } from '../tokenization/token-display';
import { attentionMatrix, topAttended } from '../tensor/attention-matrix';
import { Heatmap, type HeatmapLabels } from '../tensor/Heatmap';
import type { TensorViewLabels, ViewScales } from '../tensor/labels';
import { PositionPicker } from '../tensor/PositionPicker';
import { RadioChoice } from '../tensor/RadioChoice';

const TOP_ATTENDED = 3;

export interface AttentionLabels extends TensorViewLabels, HeatmapLabels {
  heads: string;
  head: (index: number) => string;
  mean: string;
  history: string;
  kvCache: string;
  heatmap: (layer: number, head: string, rows: number, cols: number) => string;
  attended: string;
  attendedEntry: (position: number, token: string, percent: string) => string;
}

interface AttentionViewProps {
  station: AttentionStation;
  step: GenerationStep;
  earlierSteps: readonly GenerationStep[];
  selection: StationSelection;
  select: (patch: Partial<StationSelection>) => void;
  labels: AttentionLabels;
  scales: ViewScales;
}

/** Heatmap je Kopf mit KV-Cache-Zeilen, Zeilenwahl und Top 3 (SPEC-0007 FR-08). */
function AttentionView(props: AttentionViewProps) {
  const { station, step, earlierSteps, selection, select, labels, scales } = props;
  const heads = station.weights.shape[0] ?? 0;
  const head = selectedHead(selection, heads);
  const followUp = step.index > 0;
  const history = followUp && selection.history;
  const matrix = attentionMatrix(step, earlierSteps, station.layer, head, history);
  if (matrix === null) return null;
  const row = selectedRow(selection, step.newPositions);
  const tokens = step.contextTokens.map((t) => displayText(t.text));
  const headOptions = [
    ...Array.from({ length: heads }, (_, h) => ({
      value: h as number | 'mean',
      label: labels.head(h),
    })),
    { value: 'mean' as const, label: labels.mean },
  ];
  const headName = head === 'mean' ? labels.mean : labels.head(head);
  return (
    <>
      <RadioChoice
        label={labels.heads}
        options={headOptions}
        value={head}
        onChange={(value) => select({ head: value })}
      />
      {followUp && (
        <label className="check">
          <input
            type="checkbox"
            checked={selection.history}
            onChange={(event) => select({ history: event.target.checked })}
          />
          <span>{labels.history}</span>
        </label>
      )}
      <Heatmap
        matrix={matrix}
        tokens={tokens}
        name={labels.heatmap(station.layer, headName, matrix.rows.length, matrix.cols)}
        scale={scales.sequential}
        labels={labels}
      />
      {followUp && <p className="hint">{labels.kvCache}</p>}
      <PositionPicker
        step={step}
        row={row}
        onSelect={(position) => select({ position })}
        labels={labels}
      />
      <h3 className="list-caption">{labels.attended}</h3>
      <ol className="attended" aria-label={labels.attended}>
        {topAttended(matrix, matrix.current[0] + row, TOP_ATTENDED).map((entry) => (
          <li key={entry.position}>
            {labels.attendedEntry(
              entry.position,
              tokens[entry.position] ?? '',
              formatPercent(entry.weight),
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

export function createAttentionRenderer(
  labels: AttentionLabels,
  scales: ViewScales,
): StationRenderer {
  return (context) => {
    const { station, step } = context;
    if (station.kind !== 'attention' || step === null) return genericRenderer(context);
    return (
      <>
        <AttentionView
          station={station}
          step={step}
          earlierSteps={context.earlierSteps}
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
