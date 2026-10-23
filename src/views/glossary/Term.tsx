import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import type { TermId, TermLabels } from './types';
import { termCommandForKey } from './term-keys';

export interface TermProps {
  id: TermId;
  /** Sichtbarer Text, auch gebeugt („Köpfe“). */
  text: string;
  labels: TermLabels;
}

/**
 * Begriff als Knopf mit Erklärung daneben (SPEC-0010 §3.7). Geschlossen ist die Erklärung nicht im
 * DOM; sie schließt bei Fokusverlust, erneutem Klick und Esc, das dann nicht weiterwirkt.
 */
export function Term({ id, text, labels }: TermProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const popover = useRef<HTMLSpanElement | null>(null);
  // Auf der Bühne scrollt die Station in sich: die Erklärung in den sichtbaren Bereich holen.
  useEffect(() => {
    if (open) popover.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  const entry = labels.entries[id];
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (termCommandForKey(event.key, open) !== 'close') return;
    // Chain of Responsibility: die globalen Tasten-Hooks übergehen defaultPrevented.
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };
  return (
    <span className="term-wrap">
      <button
        type="button"
        className="term"
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        {text}
      </button>
      {open && (
        <span
          ref={popover}
          role="tooltip"
          id={popoverId}
          className="term-popover"
          onPointerDown={(event) => event.preventDefault()}
        >
          <strong>{entry.term}</strong>
          {` ${entry.meaning} `}
          <span className="term-in-app">{`${labels.inApp}${entry.inApp}`}</span>
        </span>
      )}
    </span>
  );
}
