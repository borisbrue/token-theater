import type { GenerationStep } from '../../trace/types';
import { stationLine } from './station-line';

export interface StepListLabels {
  steps: string;
  step: (index: number) => string;
  layer: string;
}

/** Debug-Liste der Schritte und Stationen eines Traces (SPEC-0001 FR-10). */
export function StepList({
  steps,
  labels,
}: {
  steps: readonly GenerationStep[];
  labels: StepListLabels;
}) {
  return (
    <ol className="steps" aria-label={labels.steps}>
      {steps.map((step) => (
        <li key={step.index} className="step">
          <h2>{labels.step(step.index)}</h2>
          <ul className="stations">
            {step.stations.map((station, i) => (
              <li key={i} className="station">
                {stationLine(station, labels.layer)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
