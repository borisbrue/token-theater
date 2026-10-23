import { useEffect } from 'react';

import type { PlaybackCommand } from '../../playback/types';

/** Tastaturbelegung (SPEC-0002 FR-12, Command Pattern): Taste → Kommando. */
export function commandForKey(event: KeyboardEvent): PlaybackCommand | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case ' ':
      return { type: 'toggle' };
    case 'ArrowRight':
      return event.shiftKey ? { type: 'nextStep' } : { type: 'next' };
    case 'ArrowLeft':
      return event.shiftKey ? { type: 'prevStep' } : { type: 'prev' };
    // Präsentations-Fernbedienungen senden Bild ↓ / Bild ↑ (SPEC-0009 §3.3).
    case 'PageDown':
      return { type: 'next' };
    case 'PageUp':
      return { type: 'prev' };
    case 'Home':
      return { type: 'first' };
    case 'End':
      return { type: 'last' };
    default:
      return null;
  }
}

/** CON-0006 UI-04: keine Kürzel in Eingabefeldern; Leertaste nicht auf Knöpfen. */
export function ignoredTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return key === ' ' && tag === 'BUTTON';
}

export function usePlaybackKeys(enabled: boolean, dispatch: (c: PlaybackCommand) => void): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || ignoredTarget(event.target, event.key)) return;
      const command = commandForKey(event);
      if (command === null) return;
      event.preventDefault();
      dispatch(command);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, dispatch]);
}
