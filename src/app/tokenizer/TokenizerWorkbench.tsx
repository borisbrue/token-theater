import { useEffect, useMemo, useState } from 'react';

import type { BpeTokenizer } from '../../engine/tokenizer/bpe';
import type { BpeDetail, Token } from '../../trace/types';
import { TokenizationView } from '../../views/tokenization/TokenizationView';
import { texts } from '../texts';
import { getGpt2Tokenizer } from './gpt2-loader';

const MAX_TEXT_LENGTH = 1000;
const labels = texts.tokenizer;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; tokenizer: BpeTokenizer }
  | { status: 'error' };

interface Tokenization {
  tokens: Token[];
  bpe: BpeDetail;
}

function tokenizeNow(tokenizer: BpeTokenizer, text: string): Tokenization {
  const bpe = tokenizer.explain(text);
  const tokens = bpe.words
    .flatMap((word) => word.ids)
    .map((id) => ({ id, text: decoder.decode(tokenizer.tokenBytes(id)) }));
  return { tokens, bpe };
}

/** Tokenizer-Werkbank (SPEC-0003 FR-09): Text live mit dem GPT-2-Tokenizer zerlegen. */
export function TokenizerWorkbench() {
  const [text, setText] = useState<string>(labels.defaultText);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoad({ status: 'loading' });
    getGpt2Tokenizer().then(
      (tokenizer) => active && setLoad({ status: 'ready', tokenizer }),
      () => active && setLoad({ status: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const result = useMemo(
    () => (load.status === 'ready' ? tokenizeNow(load.tokenizer, text) : null),
    [load, text],
  );

  return (
    <section className="tokenizer panel" aria-label={labels.region}>
      <label htmlFor="tokenizer-text" className="label">
        {labels.textLabel}
      </label>
      <textarea
        id="tokenizer-text"
        rows={3}
        maxLength={MAX_TEXT_LENGTH}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {load.status === 'loading' && <p className="hint">{labels.loading}</p>}
      {load.status === 'error' && (
        <>
          <div role="alert" className="error">
            <p>{labels.loadError}</p>
          </div>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            {labels.retry}
          </button>
        </>
      )}
      {result !== null && (
        <>
          <ul className="stats" aria-label={labels.stats}>
            <li>{labels.chars([...text].length)}</li>
            <li>{labels.bytes(encoder.encode(text).length)}</li>
            <li>{labels.tokenCount(result.tokens.length)}</li>
          </ul>
          <TokenizationView
            tokens={result.tokens}
            bpe={result.bpe}
            labels={labels}
            afterList={
              <p className="id-line">
                <span className="label">{labels.ids}</span>
                <code>{result.tokens.map((token) => token.id).join(' ')}</code>
              </p>
            }
          />
        </>
      )}
    </section>
  );
}
