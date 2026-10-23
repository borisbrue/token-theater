import { useEffect } from 'react';

import { ignoredTarget } from '../player/use-playback-keys';

/** Kommandos des Präsentationsmodus (SPEC-0009 §3.3, Command). */
export type PresentationCommand = { type: 'toggle' } | { type: 'exit' };

/** `p` schaltet um, `Esc` beendet die Präsentation; sonst nichts. */
export function presentationCommandForKey(
  event: KeyboardEvent,
  presenting: boolean,
): PresentationCommand | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === 'p') return { type: 'toggle' };
  if (event.key === 'Escape' && presenting) return { type: 'exit' };
  return null;
}

/** Wie die Wiedergabe-Kürzel: nicht in Eingabefeldern (CON-0006 UI-04). */
export function usePresentationKeys(
  enabled: boolean,
  presenting: boolean,
  dispatch: (command: PresentationCommand) => void,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || ignoredTarget(event.target, event.key)) return;
      const command = presentationCommandForKey(event, presenting);
      if (command === null) return;
      event.preventDefault();
      dispatch(command);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, presenting, dispatch]);
}
