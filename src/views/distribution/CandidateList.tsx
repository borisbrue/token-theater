import type { Candidate } from '../../trace/types';
import { displayText } from '../tokenization/token-display';
import { formatDecimal, formatPercent } from './format';

export const SHOWN_CANDIDATES = 10;

export interface CandidateListProps {
  /** Schon absteigend sortiert (INV-10); gezeigt werden die ersten zehn. */
  distribution: readonly Candidate[];
  /** In der sample-Station das gewählte Token. */
  chosenId?: number;
  labels: { candidates: string; noLogit: string };
}

/** Kandidaten als Balken mit Prozent und Logit (SPEC-0004 §3.6). */
export function CandidateList({ distribution, chosenId, labels }: CandidateListProps) {
  const shown = distribution.slice(0, SHOWN_CANDIDATES);
  const max = shown[0]?.prob ?? 1;
  return (
    <ol className="candidate-bars" aria-label={labels.candidates}>
      {shown.map((candidate) => {
        const chosen = candidate.token.id === chosenId;
        return (
          <li
            key={candidate.token.id}
            className={chosen ? 'chosen' : undefined}
            aria-current={chosen ? true : undefined}
          >
            <span className="cand-token">{displayText(candidate.token.text)}</span>
            <span className="cand-bar" aria-hidden={true}>
              <span style={{ width: `${max > 0 ? (candidate.prob / max) * 100 : 0}%` }} />
            </span>
            <span className="cand-prob">{formatPercent(candidate.prob)}</span>
            <span className="cand-logit">
              {candidate.logit === null ? labels.noLogit : formatDecimal(candidate.logit, 2)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
