import { useCallback, useEffect, useRef, useState } from 'react';

import { currentStation, frameInfo, visibleTokens } from '../../playback/frames';
import type { PlaybackStore } from '../../playback/store';
import type { PlaybackCommand, PlaybackState } from '../../playback/types';
import type { Trace } from '../../trace/types';
import { modelFacts } from '../../views/station/explanation';
import { lacksInternals } from '../../views/station/internals';
import { DEFAULT_SELECTION, type StationSelection } from '../../views/station/selection';
import { StationView, type StationRenderers } from '../../views/station/StationView';
import { stationName, stationShort } from '../../views/station/station-name';
import { StationStrip } from '../../views/transport/StationStrip';
import { StepTimeline } from '../../views/transport/StepTimeline';
import { TransportBar } from '../../views/transport/TransportBar';
import { TokenStream } from '../../views/token-stream/TokenStream';
import { createTokenizeRenderer } from '../../views/tokenization/tokenize-renderer';
import { createLogitsRenderer, createSampleRenderer } from '../../views/distribution/renderers';
import { createEmbedRenderer } from '../../views/embedding/embed-renderer';
import { createAttentionRenderer } from '../../views/attention/attention-renderer';
import { createMlpRenderer } from '../../views/mlp/mlp-renderer';
import { createMoeRenderer } from '../../views/moe/MoeView';
import { createResidualRenderer } from '../../views/residual/residual-renderer';
import type { ViewScales } from '../../views/tensor/labels';
import { texts } from '../texts';
import { DATA_SCALE, DIVERGING_SCALE } from '../theme/tokens';
import { usePlaybackKeys } from './use-playback-keys';
import { useSwipe } from './use-swipe';

const STATION_LABELS = { ...texts.station, layerMap: texts.layerMap, glossary: texts.glossary };
/** Farbskalen aus dem Theme als Daten für die Ansichten (SPEC-0007 §3.1). */
const SCALES: ViewScales = { sequential: DATA_SCALE, diverging: DIVERGING_SCALE };
/** Eigene Ansichten (SPEC-0003 FR-12, SPEC-0004 FR-07/FR-09, SPEC-0007), sonst generisch. */
const RENDERERS: StationRenderers = {
  tokenize: createTokenizeRenderer(texts.tokenizer),
  embed: createEmbedRenderer(texts.stationViews.embed, SCALES),
  attention: createAttentionRenderer(texts.stationViews.attention, SCALES),
  mlp: createMlpRenderer(texts.stationViews.mlp, SCALES),
  moe: createMoeRenderer(texts.stationViews.moe, SCALES),
  residual: createResidualRenderer(texts.stationViews.residual, SCALES),
  logits: createLogitsRenderer(texts.distribution),
  sample: createSampleRenderer(texts.distribution),
};

/** Text der Statusmeldung für einen Zustand (CON-0006 Statusmeldung); auch Kopfzeile der Bühne. */
export function statusText(state: PlaybackState): string {
  const info = frameInfo(state);
  const station = currentStation(state);
  if (info === null || station === null) return '';
  return texts.status(
    info.step,
    info.station + 1,
    info.stationCount,
    stationName(station, STATION_LABELS),
  );
}

/**
 * Statusmeldung (FR-13, UI-06): nach load und manuellen Wechseln sofort; während der
 * Wiedergabe nur beim Wechsel in einen neuen Schritt.
 */
function useAnnouncement(state: PlaybackState): string {
  const [message, setMessage] = useState(() => statusText(state));
  const announced = useRef<{ trace: PlaybackState['trace']; step: number | null }>({
    trace: null,
    step: null,
  });
  useEffect(() => {
    const info = frameInfo(state);
    const sameRun = announced.current.trace === state.trace;
    if (state.mode === 'playing' && sameRun && info?.step === announced.current.step) return;
    announced.current = { trace: state.trace, step: info?.step ?? null };
    setMessage(statusText(state));
  }, [state]);
  return message;
}

/**
 * Auswahl der Stationsansichten (SPEC-0007 §3.8, Mediator): gilt für einen Trace; ein neuer Trace
 * beginnt mit DEFAULT_SELECTION, ein Stationswechsel ändert sie nicht.
 */
function useSelection(
  trace: Trace | null,
): [StationSelection, (patch: Partial<StationSelection>) => void] {
  const [held, setHeld] = useState<{ trace: Trace | null; value: StationSelection }>({
    trace,
    value: DEFAULT_SELECTION,
  });
  const value = held.trace === trace ? held.value : DEFAULT_SELECTION;
  const select = useCallback(
    (patch: Partial<StationSelection>) =>
      setHeld((previous) => ({
        trace,
        value: { ...(previous.trace === trace ? previous.value : DEFAULT_SELECTION), ...patch },
      })),
    [trace],
  );
  return [value, select];
}

export interface PlayerProps {
  playback: PlaybackStore;
  /** Erkunden: Bausteine untereinander; Bühne: in einer Flex-Spalte, die Station scrollt (SPEC-0009). */
  layout?: 'explore' | 'stage';
}

/** Wiedergabe: Tokenstrom, Stationsansicht, Transportleiste (SPEC-0002 §3.10). */
export function Player({ playback, layout = 'explore' }: PlayerProps) {
  const state = playback.usePlayback((s) => s);
  const { controller } = playback;
  const dispatch = useCallback(
    (command: PlaybackCommand) => controller.dispatch(command),
    [controller],
  );
  const info = frameInfo(state);
  const station = currentStation(state);
  usePlaybackKeys(info !== null, dispatch);
  useSwipe(info !== null, dispatch);
  const message = useAnnouncement(state);
  const [selection, select] = useSelection(state.trace);

  const statusRegion = (
    <p role="status" className="visually-hidden">
      {message}
    </p>
  );
  if (info === null || station === null || state.trace === null || state.cursor === null) {
    return statusRegion;
  }

  const trace = state.trace;
  const last = state.frames.length - 1;
  const { tokens, showNext } = visibleTokens(state);
  const stepStations = trace.steps[info.step]?.stations ?? [];

  const parts = (
    <>
      <TokenStream tokens={tokens} showNext={showNext} labels={texts.tokenStream} />
      <StationView
        frame={{ step: info.step, station: info.station, count: info.stationCount }}
        station={station}
        renderers={RENDERERS}
        sampling={trace.sampling}
        step={trace.steps[info.step] ?? null}
        earlierSteps={trace.steps.slice(0, info.step)}
        selection={selection}
        select={select}
        facts={modelFacts(trace.engine.architecture)}
        labels={STATION_LABELS}
      />
      <section className="playback panel" aria-label={texts.playback.region}>
        <TransportBar
          playing={state.mode === 'playing'}
          speed={state.speed}
          canBack={state.cursor > 0}
          canForward={state.cursor < last}
          canStepBack={info.step > 0 || info.station > 0}
          canStepForward={info.step < info.stepCount - 1}
          onCommand={dispatch}
          labels={texts.playback}
        />
        <StepTimeline
          steps={trace.steps.map((_, index) => ({ index, label: texts.step(index) }))}
          current={info.step}
          onSeek={(step) => dispatch({ type: 'seek', step, station: 0 })}
          labels={texts.playback}
        />
        {lacksInternals(trace.engine.capabilities) && (
          <p role="note" className="hint">
            {texts.playback.noInternals}
          </p>
        )}
        <StationStrip
          stations={stepStations.map((s) => ({
            short: stationShort(s),
            name: stationName(s, STATION_LABELS),
          }))}
          current={info.station}
          onSeek={(index) => dispatch({ type: 'seek', step: info.step, station: index })}
          labels={texts.playback}
        />
      </section>
    </>
  );
  return (
    <>
      {statusRegion}
      {layout === 'stage' ? <div className="stage-body">{parts}</div> : parts}
    </>
  );
}
