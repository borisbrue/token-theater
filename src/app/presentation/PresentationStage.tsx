import { forwardRef } from 'react';

import type { PlaybackStore } from '../../playback/store';
import { Player, statusText } from '../player/Player';
import { texts } from '../texts';

/** Layout des Players auf der Bühne (kein sichtbarer Text). */
const STAGE_LAYOUT = 'stage';

export interface PresentationStageProps {
  playback: PlaybackStore;
  onExit: () => void;
}

/**
 * Bühne des Präsentationsmodus (SPEC-0009 §3.2): schmale Kopfzeile mit Titel, Position und
 * „Präsentation beenden“, darunter der Player im Bühnen-Layout. Den Modus hält App (Mediator).
 */
export const PresentationStage = forwardRef<HTMLElement, PresentationStageProps>(
  function PresentationStage({ playback, onExit }, ref) {
    const position = playback.usePlayback(statusText);
    return (
      <section className="stage" aria-label={texts.presentation.stage} tabIndex={-1} ref={ref}>
        <div className="stage-bar">
          <p className="stage-title">{texts.appTitle}</p>
          <p className="stage-position">{position}</p>
          <button type="button" onClick={onExit}>
            {texts.presentation.exit}
          </button>
        </div>
        <Player playback={playback} layout={STAGE_LAYOUT} />
      </section>
    );
  },
);
