import { useEffect } from 'react';

import type { PlaybackCommand } from '../../playback/types';
import { swipeCommand, swipeIgnored, type SwipePoint } from './swipe';

const STATION = '.station-view';

function insideStation(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(STATION) !== null;
}

/**
 * Wischen über die Station schickt Playback-Kommandos wie die Pfeiltasten (SPEC-0013 §3.3,
 * Command). Nur Touch-Zeiger; Ziele mit eigener Geste behalten den Wisch (`swipeIgnored`).
 */
export function useSwipe(enabled: boolean, dispatch: (command: PlaybackCommand) => void): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let start: (SwipePoint & { id: number }) | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      start =
        insideStation(event.target) && !swipeIgnored(event.target)
          ? { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId }
          : null;
    };
    const onUp = (event: PointerEvent) => {
      if (start === null || event.pointerId !== start.id) return;
      const command = swipeCommand(start, {
        x: event.clientX,
        y: event.clientY,
        t: event.timeStamp,
      });
      start = null;
      if (command !== null) dispatch(command);
    };
    const onCancel = () => {
      start = null;
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
  }, [enabled, dispatch]);
}
