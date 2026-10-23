import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { createPlaybackController } from '../playback/controller';
import { timeoutScheduler } from '../playback/scheduler';
import { createPlaybackStore, type PlaybackStore } from '../playback/store';
import type { Trace } from '../trace/types';
import { GlossaryView } from '../views/glossary/GlossaryView';
import { StepList } from '../views/step-list/StepList';
import {
  DEFAULT_MAX_TOKENS,
  downloadTrace,
  generateTrace,
  importTrace,
  type EngineChoice,
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  normalizeMaxTokens,
  type ErrorView,
} from './trace-actions';
import { PresentationStage } from './presentation/PresentationStage';
import { Player } from './player/Player';
import {
  usePresentationKeys,
  type PresentationCommand,
} from './presentation/use-presentation-keys';
import { texts } from './texts';
import { TokenizerWorkbench } from './tokenizer/TokenizerWorkbench';
import { EngineSettings, type EngineKind } from './remote/EngineSettings';
import { loadSettings, saveSettings, type StoredSettings } from './remote-settings';
import { loadModelManifest, type ModelEntry } from './gpt2/models';
import type { WeightsProgress } from './gpt2/weights-loader';

import { formatDecimal } from '../views/distribution/format';
import {
  DEFAULT_SEED,
  normalizeSeed,
  normalizeTemperature,
  normalizeTopK,
  normalizeTopP,
  TOP_P_MIN,
  type SamplingChoice,
  type Strategy,
} from './sampling-choice';
import { TEMPERATURE_MAX, TEMPERATURE_MIN, TOP_K_MAX } from '../sampling/transform';

const MEGABYTE = 1_000_000;

function loadText(progress: WeightsProgress): string {
  if (progress.fromCache) return texts.gpt2.fromCache;
  return texts.gpt2.loading(
    formatDecimal(progress.loadedBytes / MEGABYTE, 1),
    formatDecimal(progress.totalBytes / MEGABYTE, 1),
  );
}

const GREEDY: Strategy = 'greedy';
const RANDOM: Strategy = 'sample';

type View = 'run' | 'tokenizer' | 'glossary';
/** Erkunden oder Bühne (SPEC-0009 §3.2); nicht gespeichert. */
type Mode = 'explore' | 'presentation';

const STEP_LABELS = { steps: texts.steps, step: texts.step, layer: texts.layer };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Komposition (SPEC-0002 §3.7): Controller mit echtem Scheduler, genau einmal je App. */
function createAppPlayback(): PlaybackStore {
  return createPlaybackStore(createPlaybackController({ scheduler: timeoutScheduler }));
}

export function App() {
  const [playback] = useState(createAppPlayback);
  const [prompt, setPrompt] = useState('');
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_TOKENS));
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<ErrorView | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('run');
  const [strategy, setStrategy] = useState<Strategy>(GREEDY);
  const [temperature, setTemperature] = useState('1');
  const [topK, setTopK] = useState('0');
  const [topP, setTopP] = useState('1');
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  const [engine, setEngine] = useState<EngineKind>('mock');
  const [remote, setRemote] = useState<StoredSettings>(loadSettings);
  /** Nur im Speicher der Seite, nie gemerkt (SPEC-0005 FR-10). */
  const [apiKey, setApiKey] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [gpt2Models, setGpt2Models] = useState<readonly ModelEntry[] | null>(null);
  const [gpt2Model, setGpt2Model] = useState('');
  const running = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<Mode>('explore');
  const stageRef = useRef<HTMLElement | null>(null);
  const presentRef = useRef<HTMLButtonElement | null>(null);
  /** Fokus nur nach einem echten Wechsel verschieben, nicht beim ersten Rendern. */
  const lastMode = useRef<Mode>('explore');

  useEffect(() => {
    saveSettings(remote);
  }, [remote]);

  // Manifest erst laden, wenn GPT-2 gewählt wird (SPEC-0006 §3.8).
  useEffect(() => {
    if (engine !== 'gpt2' || gpt2Models !== null) return;
    let active = true;
    void loadModelManifest().then((models) => {
      if (!active) return;
      setGpt2Models(models);
      setGpt2Model((current) => current || (models[0]?.id ?? ''));
    });
    return () => {
      active = false;
    };
  }, [engine, gpt2Models]);

  useEffect(() => {
    playback.controller.load(trace);
  }, [playback, trace]);

  // Mediator (SPEC-0009 §3.2): Modusregeln an einer Stelle; der Playback-Zustand bleibt unberührt.
  const onPresentation = useCallback(
    (command: PresentationCommand) => {
      if (command.type === 'exit' || mode === 'presentation') {
        setMode('explore');
        return;
      }
      if (trace === null) return;
      setView('run');
      setMode('presentation');
    },
    [mode, trace],
  );
  usePresentationKeys(
    trace !== null || mode === 'presentation',
    mode === 'presentation',
    onPresentation,
  );

  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    if (mode === 'presentation') stageRef.current?.focus();
    else presentRef.current?.focus();
  }, [mode]);

  // GPT-2 ohne aufgelöstes Modell (Manifest lädt noch oder ist leer): nicht erzeugen, nie still Mock.
  const gpt2Ready = engine !== 'gpt2' || (gpt2Models?.some((m) => m.id === gpt2Model) ?? false);
  const canGenerate = prompt.trim() !== '' && !busy && gpt2Ready;
  const shownText = trace === null ? '' : (trace.steps.at(-1)?.text ?? trace.prompt);

  function engineChoice(): EngineChoice {
    if (engine === 'remote') return { kind: 'remote', ...remote, apiKey };
    if (engine === 'mock') return { kind: 'mock' };
    const model = gpt2Models?.find((m) => m.id === gpt2Model);
    if (model === undefined) throw new Error(texts.gpt2.noModels);
    return { kind: 'gpt2', model };
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    if (!canGenerate) return;
    const count = normalizeMaxTokens(maxTokens);
    setMaxTokens(String(count));
    const sampling: SamplingChoice = {
      strategy,
      settings: {
        temperature: normalizeTemperature(temperature),
        topK: normalizeTopK(topK),
        topP: normalizeTopP(topP),
      },
      seed: normalizeSeed(seed),
    };
    setTopK(String(sampling.settings.topK));
    setSeed(String(sampling.seed));
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    try {
      const result = await generateTrace(prompt, count, sampling, {
        engine: engineChoice(),
        signal: controller.signal,
        onProgress: (step, total) => setProgress(texts.remote.progress(step, total)),
        onLoadProgress: (load) => setProgress(loadText(load)),
      });
      // null: schon vor dem ersten Schritt abgebrochen – nichts ändern, keine Meldung.
      if (result !== null) {
        setTrace(result);
        setError(
          result.finishReason === 'error'
            ? { message: texts.remote.runFailed(result.error?.message ?? ''), details: [] }
            : null,
        );
      }
    } catch (e) {
      setError({ message: texts.errors.generate(messageOf(e)), details: [] });
    } finally {
      running.current = null;
      setProgress(null);
      setBusy(false);
    }
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    let content: string;
    try {
      content = await file.text();
    } catch {
      setError({ message: texts.errors.readFile, details: [] });
      return;
    }
    const result = importTrace(content);
    if (result.ok) {
      setTrace(result.trace);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  if (mode === 'presentation') {
    return (
      <main className="app" data-mode="presentation">
        <PresentationStage
          ref={stageRef}
          playback={playback}
          onExit={() => onPresentation({ type: 'exit' })}
        />
      </main>
    );
  }

  return (
    <main className="app" data-mode="explore">
      <header>
        <h1>{texts.appTitle}</h1>
        <p className="subtitle">{texts.appSubtitle}</p>
      </header>

      <div role="group" aria-label={texts.views.group} className="view-switch">
        <button type="button" aria-pressed={view === 'run'} onClick={() => setView('run')}>
          {texts.views.run}
        </button>
        <button
          type="button"
          aria-pressed={view === 'tokenizer'}
          onClick={() => setView('tokenizer')}
        >
          {texts.views.tokenizer}
        </button>
        <button
          type="button"
          aria-pressed={view === 'glossary'}
          onClick={() => setView('glossary')}
        >
          {texts.views.glossary}
        </button>
      </div>

      {view === 'tokenizer' ? (
        <TokenizerWorkbench />
      ) : view === 'glossary' ? (
        <GlossaryView labels={texts.glossary} />
      ) : (
        <>
          <form className="controls" noValidate onSubmit={(e) => void onGenerate(e)}>
            <label htmlFor="prompt">{texts.promptLabel}</label>
            <input
              id="prompt"
              type="text"
              autoComplete="off"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <label htmlFor="max-tokens">{texts.maxTokensLabel}</label>
            <input
              id="max-tokens"
              type="number"
              min={MIN_MAX_TOKENS}
              max={MAX_MAX_TOKENS}
              step={1}
              inputMode="numeric"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              onBlur={() => setMaxTokens(String(normalizeMaxTokens(maxTokens)))}
            />
            <EngineSettings
              engine={engine}
              onEngine={setEngine}
              settings={remote}
              onSettings={setRemote}
              apiKey={apiKey}
              onApiKey={setApiKey}
              gpt2Models={gpt2Models}
              gpt2Model={gpt2Model}
              onGpt2Model={setGpt2Model}
            />
            <fieldset className="sampling">
              <legend>{texts.sampling.group}</legend>
              <div className="strategy">
                <label>
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === GREEDY}
                    onChange={() => setStrategy(GREEDY)}
                  />
                  {texts.sampling.greedy}
                </label>
                <label>
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === RANDOM}
                    onChange={() => setStrategy(RANDOM)}
                  />
                  {texts.sampling.random}
                </label>
              </div>
              <label htmlFor="temperature">{texts.sampling.temperature}</label>
              <input
                id="temperature"
                type="range"
                min={TEMPERATURE_MIN}
                max={TEMPERATURE_MAX}
                step={0.1}
                disabled={strategy === GREEDY}
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
              <span className="range-value">
                {formatDecimal(normalizeTemperature(temperature), 1)}
              </span>
              <label htmlFor="top-k">{texts.sampling.topK}</label>
              <input
                id="top-k"
                type="number"
                min={0}
                max={TOP_K_MAX}
                step={1}
                inputMode="numeric"
                disabled={strategy === GREEDY}
                value={topK}
                onChange={(e) => setTopK(e.target.value)}
              />
              <span />
              <label htmlFor="top-p">{texts.sampling.topP}</label>
              <input
                id="top-p"
                type="range"
                min={TOP_P_MIN}
                max={1}
                step={0.05}
                disabled={strategy === GREEDY}
                value={topP}
                onChange={(e) => setTopP(e.target.value)}
              />
              <span className="range-value">{formatDecimal(normalizeTopP(topP), 2)}</span>
              <label htmlFor="seed">{texts.sampling.seed}</label>
              <input
                id="seed"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                disabled={strategy === GREEDY}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
              <span />
            </fieldset>
            <button type="submit" disabled={!canGenerate}>
              {busy ? texts.generating : texts.generate}
            </button>
            {busy && engine !== 'mock' && (
              <div className="run-status">
                {progress !== null && <span>{progress}</span>}
                <button type="button" onClick={() => running.current?.abort()}>
                  {texts.remote.cancel}
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={trace === null}
              onClick={() => trace && downloadTrace(trace)}
            >
              {texts.exportTrace}
            </button>
            <button
              type="button"
              ref={presentRef}
              disabled={trace === null}
              onClick={() => onPresentation({ type: 'toggle' })}
            >
              {texts.presentation.start}
            </button>
            <label htmlFor="import" className="file-label">
              {texts.importTrace}
            </label>
            <input
              id="import"
              type="file"
              accept=".json,application/json"
              onChange={(e) => void onImport(e)}
            />
          </form>

          {error !== null && (
            <div role="alert" className="error">
              <p>{error.message}</p>
              {error.details.length > 0 && (
                <ul>
                  {error.details.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {trace !== null && (
            <section className="generated" aria-label={texts.generatedText}>
              {shownText}
            </section>
          )}

          <Player playback={playback} />

          <section className="details">
            <h2 className="label">{texts.details}</h2>
            <StepList steps={trace?.steps ?? []} labels={STEP_LABELS} />
          </section>
        </>
      )}
    </main>
  );
}
