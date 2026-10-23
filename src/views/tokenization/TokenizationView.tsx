import { useState, type ReactNode } from 'react';

import type { BpeDetail, Token } from '../../trace/types';
import { BpeSteps, type BpeStepsLabels } from './BpeSteps';
import { displayBytes, displayText } from './token-display';

export interface TokenizationLabels extends BpeStepsLabels {
  tokens: string;
  hint: string;
  noBpe: string;
}

export interface TokenizationViewProps {
  tokens: readonly Token[];
  /** null: der Tokenizer liefert keine Merge-Stufen (z. B. MockEngine). */
  bpe: BpeDetail | null;
  /** Steht zwischen Tokenliste und BPE-Schritten (Werkbank: IDs-Zeile). */
  afterList?: ReactNode;
  labels: TokenizationLabels;
}

interface Chip {
  id: number;
  display: string;
  /** Index des Pre-Tokens in bpe.words, null ohne BPE-Details. */
  word: number | null;
}

/** Ordnet jedem Token Anzeigetext und Pre-Token zu; mit BPE aus den Bytes der letzten Stufe. */
function chipsOf(tokens: readonly Token[], bpe: BpeDetail | null): Chip[] {
  if (bpe === null) {
    return tokens.map((token) => ({ id: token.id, display: displayText(token.text), word: null }));
  }
  const finals = bpe.words.flatMap((word, index) =>
    (word.stages.at(-1) ?? []).map((bytes) => ({ bytes, index })),
  );
  return tokens.map((token, i) => {
    const final = finals[i];
    return final === undefined
      ? { id: token.id, display: displayText(token.text), word: null }
      : { id: token.id, display: displayBytes(final.bytes), word: final.index };
  });
}

/** Tokenliste mit IDs und, bei BPE-Details, wählbaren Pre-Tokens (SPEC-0003 FR-10–FR-12). */
export function TokenizationView({ tokens, bpe, afterList, labels }: TokenizationViewProps) {
  // Die Auswahl gilt nur für die BPE-Details, zu denen sie gehört: neuer Text setzt sie zurück.
  const [selection, setSelection] = useState<{ source: BpeDetail; word: number } | null>(null);
  const selected = selection !== null && selection.source === bpe ? selection.word : null;
  const chips = chipsOf(tokens, bpe);
  const selectedWord = selected === null ? undefined : bpe?.words[selected];

  return (
    <>
      <ol className="token-list" aria-label={labels.tokens}>
        {chips.map((chip, i) => {
          const content = (
            <>
              <span className="tok-text">{chip.display}</span>
              <span className="tok-id">{chip.id}</span>
            </>
          );
          const className = `tok tok-${i % 4}`;
          const word = chip.word;
          return (
            <li key={i}>
              {word === null || bpe === null ? (
                <span className={className}>{content}</span>
              ) : (
                <button
                  type="button"
                  className={className}
                  aria-pressed={word === selected}
                  onClick={() => setSelection({ source: bpe, word })}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {afterList}
      {bpe === null ? (
        <p className="hint">{labels.noBpe}</p>
      ) : selectedWord === undefined ? (
        <p className="hint">{labels.hint}</p>
      ) : (
        <BpeSteps word={selectedWord} labels={labels} />
      )}
    </>
  );
}
