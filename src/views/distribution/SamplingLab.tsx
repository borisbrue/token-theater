import { useMemo, useState } from 'react';

import {
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  TOP_K_MAX,
  transformDistribution,
  type SamplingSettings,
} from '../../sampling/transform';
import type { Candidate } from '../../trace/types';
import { displayText } from '../tokenization/token-display';
import { SHOWN_CANDIDATES } from './CandidateList';
import { formatDecimal, formatPercent } from './format';
import { normalizeTopK, TOP_P_MIN } from './sampling-input';

export interface SamplingLabLabels {
  region: string;
  temperature: string;
  topK: string;
  topP: string;
  reset: string;
  list: string;
  arrow: string;
  removed: string;
  hint: string;
}

export interface SamplingLabProps {
  distribution: readonly Candidate[];
  /** Vorbelegung und Ziel von "Zurücksetzen": die Parameter des Traces. */
  initial: SamplingSettings;
  labels: SamplingLabLabels;
}

/** Sampling-Labor (SPEC-0004 FR-08): formt nur diese Verteilung live um, nie den Trace. */
export function SamplingLab({ distribution, initial, labels }: SamplingLabProps) {
  const [temperature, setTemperature] = useState(initial.temperature);
  const [topKText, setTopKText] = useState(String(initial.topK));
  const [topP, setTopP] = useState(initial.topP);
  const settings: SamplingSettings = { temperature, topK: normalizeTopK(topKText), topP };
  const { temperature: t, topK: k, topP: p } = settings;

  const after = useMemo(() => {
    const result = transformDistribution(distribution, { temperature: t, topK: k, topP: p });
    return new Map(result.map((c) => [c.token.id, c.prob]));
  }, [distribution, t, k, p]);

  function reset() {
    setTemperature(initial.temperature);
    setTopKText(String(initial.topK));
    setTopP(initial.topP);
  }

  return (
    <section className="sampling-lab" aria-label={labels.region}>
      <div className="lab-controls">
        <label htmlFor="lab-temperature">{labels.temperature}</label>
        <input
          id="lab-temperature"
          type="range"
          min={TEMPERATURE_MIN}
          max={TEMPERATURE_MAX}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
        />
        <span className="range-value">{formatDecimal(temperature, 1)}</span>
        <label htmlFor="lab-top-k">{labels.topK}</label>
        <input
          id="lab-top-k"
          type="number"
          min={0}
          max={TOP_K_MAX}
          step={1}
          inputMode="numeric"
          value={topKText}
          onChange={(e) => setTopKText(e.target.value)}
        />
        <span />
        <label htmlFor="lab-top-p">{labels.topP}</label>
        <input
          id="lab-top-p"
          type="range"
          min={TOP_P_MIN}
          max={1}
          step={0.05}
          value={topP}
          onChange={(e) => setTopP(Number(e.target.value))}
        />
        <span className="range-value">{formatDecimal(topP, 2)}</span>
      </div>
      <button type="button" onClick={reset}>
        {labels.reset}
      </button>
      <ol className="lab-list" aria-label={labels.list}>
        {distribution.slice(0, SHOWN_CANDIDATES).map((candidate) => {
          const prob = after.get(candidate.token.id);
          return (
            <li key={candidate.token.id} className={prob === undefined ? 'removed' : undefined}>
              <span className="cand-token">{displayText(candidate.token.text)}</span>
              <span className="cand-prob">{formatPercent(candidate.prob)}</span>
              <span className="lab-arrow">{labels.arrow}</span>
              <span className="cand-prob">
                {prob === undefined ? labels.removed : formatPercent(prob)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="hint">{labels.hint}</p>
    </section>
  );
}
