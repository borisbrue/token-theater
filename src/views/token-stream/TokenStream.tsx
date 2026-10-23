import { displayText } from '../tokenization/token-display';

export interface TokenStreamProps {
  tokens: readonly { text: string; isNew: boolean }[];
  showNext: boolean;
  labels: { region: string; next: string; placeholder: string };
}

/** Tokenstrom des aktuellen Frames (SPEC-0002 FR-10), Leerraum sichtbar (SPEC-0009 §3.6). */
export function TokenStream({ tokens, showNext, labels }: TokenStreamProps) {
  return (
    <section className="token-stream panel" aria-label={labels.region}>
      <ul className="tokens">
        {tokens.map((token, i) => (
          <li
            key={i}
            className={token.isNew ? 'token new' : 'token'}
            aria-current={token.isNew ? true : undefined}
          >
            {displayText(token.text)}
          </li>
        ))}
        {showNext && (
          <li className="token next" aria-label={labels.next}>
            {labels.placeholder}
          </li>
        )}
      </ul>
    </section>
  );
}
