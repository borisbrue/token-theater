import { DEFAULT_SETTINGS, type SamplingSettings } from '../../sampling/transform';
import type { SamplingParams } from '../../trace/types';
import type { StationRenderer } from '../station/StationView';
import { genericRenderer } from '../station/StationView';
import { displayText } from '../tokenization/token-display';
import { CandidateList, SHOWN_CANDIDATES } from './CandidateList';
import { formatDecimal, formatPercent } from './format';
import { SamplingLab, type SamplingLabLabels } from './SamplingLab';
import { settingsFrom } from './sampling-input';

export interface DistributionLabels {
  candidates: string;
  noLogit: string;
  rest: (count: number, percent: string) => string;
  coverage: (count: number, percent: string) => string;
  coverageUnknown: string;
  lab: SamplingLabLabels;
  strategyGreedy: string;
  strategyOther: (strategy: string) => string;
  params: (temperature: string, topK: string, topP: string, seed: number) => string;
  topKOff: string;
  draw: (random: string, token: string) => string;
  greedyDraw: (token: string) => string;
}

/** Labor-Vorbelegung aus trace.sampling; Greedy oder ungültige Werte → 1/0/1. */
export function labSettings(sampling: SamplingParams | null): SamplingSettings {
  if (sampling?.strategy !== 'sample') return DEFAULT_SETTINGS;
  return settingsFrom(sampling.params) ?? DEFAULT_SETTINGS;
}

/** Ein Parameter so, wie er im Trace steht; fehlt er oder ist er keine Zahl: "–". */
function paramText(value: unknown, digits: number, labels: DistributionLabels): string {
  return typeof value === 'number' ? formatDecimal(value, digits) : labels.noLogit;
}

/** Parameterzeile aus trace.sampling (§3.7), ohne Werte zu ergänzen, die dort nicht stehen. */
function paramsLine(sampling: SamplingParams | null, labels: DistributionLabels): string {
  if (sampling === null || sampling.strategy === 'greedy') return labels.strategyGreedy;
  if (sampling.strategy !== 'sample') return labels.strategyOther(sampling.strategy);
  const { temperature, topK, topP } = sampling.params;
  return labels.params(
    paramText(temperature, 1, labels),
    topK === 0 ? labels.topKOff : paramText(topK, 0, labels),
    paramText(topP, 2, labels),
    sampling.seed,
  );
}

/** Station logits: Balken, Rest, Abdeckung und Sampling-Labor (SPEC-0004 FR-07, FR-08). */
export function createLogitsRenderer(labels: DistributionLabels): StationRenderer {
  return (context) => {
    const { station, sampling } = context;
    if (station.kind !== 'logits') return genericRenderer(context);
    const { distribution, coverage } = station;
    const rest = distribution.slice(SHOWN_CANDIDATES);
    const restMass = rest.reduce((sum, c) => sum + c.prob, 0);
    const initial = labSettings(sampling);
    return (
      <>
        <CandidateList distribution={distribution} labels={labels} />
        {rest.length > 0 && (
          <p className="hint">{labels.rest(rest.length, formatPercent(restMass))}</p>
        )}
        {coverage === null ? (
          <p className="hint">{labels.coverageUnknown}</p>
        ) : (
          coverage < 1 && (
            <p className="hint">{labels.coverage(distribution.length, formatPercent(coverage))}</p>
          )
        )}
        <SamplingLab
          key={JSON.stringify(initial)}
          distribution={distribution}
          initial={initial}
          labels={labels.lab}
        />
      </>
    );
  };
}

/** Station sample: Parameter, sichtbarer Zufallswurf, Kandidaten mit Wahl (SPEC-0004 FR-09). */
export function createSampleRenderer(labels: DistributionLabels): StationRenderer {
  return (context) => {
    const { station, sampling } = context;
    if (station.kind !== 'sample') return genericRenderer(context);
    const { distribution, random, chosen } = station;
    const token = displayText(chosen.text);
    let start = 0;
    return (
      <>
        <p className="sampling-params">{paramsLine(sampling, labels)}</p>
        {random === null ? (
          <p className="draw">{labels.greedyDraw(token)}</p>
        ) : (
          <>
            <p className="draw">{labels.draw(formatDecimal(random, 3), token)}</p>
            <div className="number-line" aria-hidden={true}>
              {distribution.map((candidate, i) => {
                const left = start;
                start += candidate.prob;
                const picked = candidate.token.id === chosen.id;
                return (
                  <span
                    key={candidate.token.id}
                    className={`seg seg-${i % 4}${picked ? ' chosen' : ''}`}
                    style={{ left: `${left * 100}%`, width: `${candidate.prob * 100}%` }}
                  />
                );
              })}
              <span className="marker" style={{ left: `${random * 100}%` }} />
            </div>
          </>
        )}
        <CandidateList distribution={distribution} chosenId={chosen.id} labels={labels} />
      </>
    );
  };
}
