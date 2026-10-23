import { Fragment } from 'react';

import { parseTerms } from './term-markup';
import { Term } from './Term';
import { isTermId, type TermLabels } from './types';

/** Text mit markierten Begriffen (SPEC-0010 §3.6); unbekannte ids erscheinen als reiner Text. */
export function TermText({ text, labels }: { text: string; labels: TermLabels }) {
  return (
    <>
      {parseTerms(text).map((segment, index) => {
        if (segment.kind === 'text' || !isTermId(labels.entries, segment.id)) {
          return <Fragment key={index}>{segment.text}</Fragment>;
        }
        const shown = segment.text === segment.id ? labels.entries[segment.id].term : segment.text;
        return <Term key={index} id={segment.id} text={shown} labels={labels} />;
      })}
    </>
  );
}
