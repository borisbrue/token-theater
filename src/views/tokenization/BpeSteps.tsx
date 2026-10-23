import type { BpeWord } from '../../trace/types';
import { displayBytes, displayText } from './token-display';

export interface BpeStepsLabels {
  bpeRegion: string;
  bpeHeading: (word: string) => string;
  merges: string;
  start: string;
  merge: (round: number, rank: number) => string;
}

/** Markiert je Symbol, ob es in dieser Runde aus zwei Symbolen der Vorstufe entstanden ist. */
function newSymbols(
  previous: readonly number[][] | undefined,
  stage: readonly number[][],
): boolean[] {
  if (previous === undefined) return stage.map(() => false);
  let p = 0;
  return stage.map((symbol) => {
    const merged = symbol.length !== (previous[p]?.length ?? 0);
    p += merged ? 2 : 1;
    return merged;
  });
}

/** Merge-Stufen eines Pre-Tokens (SPEC-0003 FR-11). */
export function BpeSteps({ word, labels }: { word: BpeWord; labels: BpeStepsLabels }) {
  return (
    <section className="bpe-steps" aria-label={labels.bpeRegion}>
      <h3>{labels.bpeHeading(displayText(word.text))}</h3>
      <ol className="merge-list" aria-label={labels.merges}>
        {word.stages.map((stage, s) => {
          const fresh = newSymbols(word.stages[s - 1], stage);
          return (
            <li key={s}>
              <span className="merge-label">
                {s === 0 ? labels.start : labels.merge(s, word.ranks[s - 1] ?? 0)}
              </span>
              <span className="merge-symbols">
                {stage.map((symbol, k) => (
                  <span key={k} className={fresh[k] === true ? 'sym new' : 'sym'}>
                    {displayBytes(symbol)}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
