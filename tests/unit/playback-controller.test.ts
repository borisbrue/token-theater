import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { PlaybackCommand } from '@/playback/types';
import { durationFor } from '@/playback/durations';
import { frameInfo, visibleTokens } from '@/playback/frames';
import { ManualScheduler } from '@/playback/scheduler';
import type { Trace } from '@/trace/types';

import { assertClean, assertViolation, lintAs } from './helpers/lint-as';
import {
  emptyTraceFrom,
  findStation,
  makeBaseTrace,
  makeTrace,
  setup,
  stationAt,
  sumDurations,
} from './helpers/playback-setup';

const FEATURE_PATH = fileURLToPath(
  new URL('../../.sdd/contracts/behavior/playback-controller-behavior.feature', import.meta.url),
);

/** Szenariotitel wörtlich aus CON-0005; der Abgleichtest hält beide synchron. */
const T = {
  frames: 'Frames eines Traces',
  emptyTrace: 'Leerer Trace',
  noTrace: 'Kein Trace',
  stationNav: 'Station vor und zurück',
  edges: 'Ränder werden nicht überschritten',
  stepNav: 'Schritt vor und zurück',
  firstLast: 'Zum Anfang und zum Ende',
  seek: 'Gezielt springen',
  autoAdvance: 'Automatisches Vorrücken',
  speedShortens: 'Tempo verkürzt die Verweildauer',
  endsAtLast: 'Wiedergabe endet am letzten Frame',
  restartAtEnd: 'Abspielen am Ende beginnt von vorn',
  manualPauses: 'Manuelle Navigation pausiert',
  toggle: 'Umschalten',
  pause: 'Pause',
  sameSpeed: 'Gleiches Tempo ist wirkungslos',
  playOnce: 'Mehrfaches Abspielen plant nur einmal',
  speedProportional: 'Tempowechsel während der Wiedergabe wirkt anteilig',
  speedNearEnd: 'Tempowechsel kurz vor Frame-Ende',
  newTraceWhilePlaying: 'Neuer Trace während der Wiedergabe',
  listeners: 'Listener und Snapshots',
  dispose: 'dispose räumt auf',
  remote: 'Remote-artiger Trace',
  frameInfo: 'Abgeleitete Werte eines Frames',
  visibleTokens: 'Sichtbare Tokens',
  durations: 'Verweildauern',
  schedulerAsync: 'Scheduler ruft nie synchron auf',
  cancelIdempotent: 'cancel ist idempotent',
  schedulerOrder: 'Reihenfolge und Neuplanung während advance',
} as const;

const OUTLINE_SEEK = 'Ungültiges seek wird ignoriert';
const INVALID_SEEKS: ReadonlyArray<{ step: number; station: number }> = [
  { step: 0, station: 12 },
  { step: -1, station: 0 },
  { step: 0.5, station: 0 },
  { step: 2, station: 0 },
];
const OUTLINE_SPEED = 'Ungültiges Tempo';
const INVALID_SPEEDS: readonly number[] = [0, 3, -1];

const ALL_COMMANDS: readonly PlaybackCommand[] = [
  { type: 'play' },
  { type: 'pause' },
  { type: 'toggle' },
  { type: 'next' },
  { type: 'prev' },
  { type: 'nextStep' },
  { type: 'prevStep' },
  { type: 'first' },
  { type: 'last' },
  { type: 'seek', step: 0, station: 0 },
  { type: 'setSpeed', speed: 2 },
];

let base: Trace;
let remote: Trace;
let other: Trace;

beforeAll(async () => {
  base = await makeBaseTrace();
  remote = await makeTrace({ capabilities: ['tokenize', 'logits', 'sample'], maxTokens: 2 });
  other = await makeTrace({ prompt: 'der hund', maxTokens: 1 });
});

describe('CON-0005 Playback-Controller, Frames und Scheduler', () => {
  it(T.frames, () => {
    const { controller } = setup(base);
    const state = controller.getState();

    expect(state.frames).toHaveLength(23);
    expect(state.frames[0]).toEqual({ step: 0, station: 0 });
    expect(state.frames[12]).toEqual({ step: 1, station: 0 });
    expect(state.cursor).toBe(0);
    expect(state.mode).toBe('paused');
    expect(state.speed).toBe(1);
  });

  it(T.emptyTrace, () => {
    const { controller, calls, scheduler } = setup();
    controller.load(emptyTraceFrom(base));
    const state = controller.getState();

    expect(state.frames).toHaveLength(0);
    expect(state.cursor).toBeNull();
    expect(state.mode).toBe('idle');
    expect(calls).toHaveLength(1);

    for (const command of ALL_COMMANDS) {
      controller.dispatch(command);
      expect(controller.getState()).toBe(state);
    }
    expect(calls).toHaveLength(1);
    expect(scheduler.pending()).toBe(0);
  });

  it(T.noTrace, () => {
    const { controller, calls } = setup();
    controller.load(null);

    expect(controller.getState().mode).toBe('idle');
    expect(controller.getState().cursor).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it(T.stationNav, () => {
    const { controller } = setup(base);
    controller.dispatch({ type: 'next' });
    controller.dispatch({ type: 'next' });

    expect(controller.getState().cursor).toBe(2);
    const station = stationAt(controller.getState(), 2);
    expect(station.kind).toBe('attention');
    expect(station.kind === 'attention' ? station.layer : -1).toBe(0);

    controller.dispatch({ type: 'prev' });
    expect(controller.getState().cursor).toBe(1);
  });

  it(T.edges, () => {
    const { controller, calls } = setup(base);
    const before = calls.length;
    controller.dispatch({ type: 'prev' });

    expect(controller.getState().cursor).toBe(0);
    expect(calls).toHaveLength(before);

    controller.dispatch({ type: 'last' });
    controller.dispatch({ type: 'next' });
    expect(controller.getState().cursor).toBe(22);
  });

  it(T.stepNav, () => {
    const { controller } = setup(base);
    controller.dispatch({ type: 'seek', step: 0, station: 5 });
    expect(controller.getState().cursor).toBe(5);

    controller.dispatch({ type: 'nextStep' });
    expect(controller.getState().cursor).toBe(12);

    controller.dispatch({ type: 'next' });
    controller.dispatch({ type: 'prevStep' });
    expect(controller.getState().cursor).toBe(12);

    controller.dispatch({ type: 'prevStep' });
    expect(controller.getState().cursor).toBe(0);
  });

  it(T.firstLast, () => {
    const { controller } = setup(base);
    controller.dispatch({ type: 'last' });
    expect(controller.getState().cursor).toBe(22);

    controller.dispatch({ type: 'first' });
    expect(controller.getState().cursor).toBe(0);
  });

  it(T.seek, () => {
    const { controller, calls } = setup(base);
    controller.dispatch({ type: 'seek', step: 1, station: 3 });
    expect(controller.getState().cursor).toBe(15);

    controller.dispatch({ type: 'seek', step: 5, station: 0 });
    expect(controller.getState().cursor).toBe(15);

    const before = calls.length;
    controller.dispatch({ type: 'seek', step: 1, station: 3 });
    expect(calls).toHaveLength(before);
  });

  for (const { step, station } of INVALID_SEEKS) {
    it(`${OUTLINE_SEEK} (step=${step}, station=${station})`, () => {
      const { controller, calls } = setup(base);
      controller.dispatch({ type: 'play' });
      const before = calls.length;

      controller.dispatch({ type: 'seek', step, station });

      expect(controller.getState().mode).toBe('playing');
      expect(controller.getState().cursor).toBe(0);
      expect(calls).toHaveLength(before);
    });
  }

  it(T.autoAdvance, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'play' });

    expect(controller.getState().mode).toBe('playing');
    expect(scheduler.pending()).toBe(1);

    scheduler.advance(1499);
    expect(controller.getState().cursor).toBe(0);

    scheduler.advance(1);
    expect(controller.getState().cursor).toBe(1);
    expect(scheduler.pending()).toBe(1);
  });

  it(T.speedShortens, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'setSpeed', speed: 2 });
    controller.dispatch({ type: 'play' });
    scheduler.advance(750);

    expect(controller.getState().cursor).toBe(1);
  });

  it(T.endsAtLast, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'setSpeed', speed: 2 });
    const total = sumDurations(controller.getState(), 0, 21, 1);
    expect(sumDurations(controller.getState(), 0, 21, 2)).toBe(total / 2);

    controller.dispatch({ type: 'play' });
    scheduler.advance(total / 2);

    expect(controller.getState().cursor).toBe(22);
    expect(controller.getState().mode).toBe('paused');
    expect(scheduler.pending()).toBe(0);
  });

  it(T.restartAtEnd, () => {
    const { controller } = setup(base);
    controller.dispatch({ type: 'last' });
    expect(controller.getState().cursor).toBe(22);

    controller.dispatch({ type: 'play' });
    expect(controller.getState().cursor).toBe(0);
    expect(controller.getState().mode).toBe('playing');
  });

  it(T.manualPauses, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'play' });
    controller.dispatch({ type: 'next' });

    expect(controller.getState().mode).toBe('paused');
    expect(scheduler.pending()).toBe(0);
  });

  it(T.toggle, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'toggle' });
    expect(controller.getState().mode).toBe('playing');

    controller.dispatch({ type: 'toggle' });
    expect(controller.getState().mode).toBe('paused');
    expect(scheduler.pending()).toBe(0);
  });

  it(T.pause, () => {
    const { controller, scheduler, calls } = setup(base);
    controller.dispatch({ type: 'play' });
    controller.dispatch({ type: 'pause' });

    expect(controller.getState().mode).toBe('paused');
    expect(controller.getState().cursor).toBe(0);
    expect(scheduler.pending()).toBe(0);

    const before = calls.length;
    controller.dispatch({ type: 'pause' });
    expect(calls).toHaveLength(before);
  });

  it(T.sameSpeed, () => {
    const { controller, calls } = setup(base);
    const before = calls.length;
    controller.dispatch({ type: 'setSpeed', speed: 1 });

    expect(calls).toHaveLength(before);
  });

  it(T.playOnce, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'play' });
    controller.dispatch({ type: 'play' });
    controller.dispatch({ type: 'play' });

    expect(scheduler.pending()).toBe(1);
  });

  it(T.speedProportional, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'seek', step: 0, station: 2 });
    expect(stationAt(controller.getState(), 2).kind).toBe('attention');

    controller.dispatch({ type: 'play' });
    scheduler.advance(500);
    controller.dispatch({ type: 'setSpeed', speed: 2 });

    scheduler.advance(749);
    expect(controller.getState().cursor).toBe(2);
    scheduler.advance(1);
    expect(controller.getState().cursor).toBe(3);
  });

  it(T.speedNearEnd, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'seek', step: 0, station: 2 });
    controller.dispatch({ type: 'play' });
    scheduler.advance(1999);
    controller.dispatch({ type: 'setSpeed', speed: 2 });

    scheduler.advance(1);
    expect(controller.getState().cursor).toBe(3);
    expect(scheduler.pending()).toBe(1);
  });

  for (const tempo of INVALID_SPEEDS) {
    it(`${OUTLINE_SPEED} (tempo=${tempo})`, () => {
      const { controller, calls } = setup(base);
      const before = calls.length;
      controller.dispatch({ type: 'setSpeed', speed: tempo });

      expect(controller.getState().speed).toBe(1);
      expect(calls).toHaveLength(before);
    });
  }

  it(T.newTraceWhilePlaying, () => {
    const { controller, scheduler } = setup(base);
    controller.dispatch({ type: 'setSpeed', speed: 0.5 });
    controller.dispatch({ type: 'seek', step: 0, station: 4 });
    controller.dispatch({ type: 'play' });
    expect(controller.getState().mode).toBe('playing');
    expect(controller.getState().cursor).toBe(4);

    controller.load(other);
    const state = controller.getState();
    expect(state.cursor).toBe(0);
    expect(state.mode).toBe('paused');
    expect(state.speed).toBe(0.5);
    expect(state.trace).toBe(other);
    expect(scheduler.pending()).toBe(0);
  });

  it(T.listeners, () => {
    const { controller, calls, unsubscribe } = setup(base);
    const before = controller.getState();
    const count = calls.length;

    controller.dispatch({ type: 'next' });
    expect(calls).toHaveLength(count + 1);
    const after = calls[calls.length - 1];
    expect(after).toBe(controller.getState());
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(after?.cursor).toBe(1);

    unsubscribe();
    controller.dispatch({ type: 'next' });
    expect(calls).toHaveLength(count + 1);
    expect(() => unsubscribe()).not.toThrow();
  });

  it(T.dispose, () => {
    const { controller, scheduler, calls } = setup(base);
    controller.dispatch({ type: 'play' });
    controller.dispose();

    expect(scheduler.pending()).toBe(0);
    const last = controller.getState();
    const count = calls.length;

    controller.dispatch({ type: 'next' });
    controller.dispatch({ type: 'play' });
    controller.load(other);
    scheduler.advance(10_000);

    expect(calls).toHaveLength(count);
    expect(controller.getState()).toBe(last);
    expect(scheduler.pending()).toBe(0);

    const late: unknown[] = [];
    const off = controller.subscribe((state) => late.push(state));
    controller.dispatch({ type: 'next' });
    expect(late).toHaveLength(0);
    expect(() => off()).not.toThrow();
  });

  it(T.remote, () => {
    const { controller } = setup(remote);
    const { frames } = controller.getState();

    expect(frames).toHaveLength(5);
    expect(frames.filter((f) => f.step === 0)).toHaveLength(3);
    expect(frames.filter((f) => f.step === 1)).toHaveLength(2);
  });

  it(T.frameInfo, () => {
    const { controller } = setup(base);
    controller.dispatch({ type: 'seek', step: 0, station: 2 });

    expect(frameInfo(controller.getState())).toEqual({
      step: 0,
      station: 2,
      stationCount: 12,
      stepCount: 2,
      progress: 2 / 22,
    });
  });

  it(T.visibleTokens, () => {
    const { controller } = setup(base);

    controller.dispatch({ type: 'seek', step: 0, station: 10 });
    expect(stationAt(controller.getState(), 10).kind).toBe('logits');
    const atLogits = visibleTokens(controller.getState());
    expect(atLogits.tokens.map((t) => t.text)).toEqual(['die', 'katze', 'sitzt']);
    expect(atLogits.tokens.some((t) => t.isNew)).toBe(false);
    expect(atLogits.showNext).toBe(true);

    controller.dispatch({ type: 'seek', step: 0, station: 11 });
    expect(stationAt(controller.getState(), 11).kind).toBe('sample');
    const atSample = visibleTokens(controller.getState());
    const chosen = base.steps[0]?.chosen;
    expect(atSample.tokens.map((t) => t.text)).toEqual(['die', 'katze', 'sitzt', chosen?.text]);
    expect(atSample.tokens.map((t) => t.isNew)).toEqual([false, false, false, true]);

    controller.dispatch({ type: 'seek', step: 1, station: 10 });
    expect(controller.getState().cursor).toBe(22);
    expect(visibleTokens(controller.getState()).showNext).toBe(false);
  });

  it(T.durations, () => {
    const attention = findStation(base, 'attention');
    const residual = findStation(base, 'residual');

    expect(durationFor(attention, 1)).toBe(2000);
    expect(durationFor(attention, 0.25)).toBe(8000);
    expect(durationFor(residual, 2)).toBe(350);
  });

  it(T.schedulerAsync, () => {
    const scheduler = new ManualScheduler();
    let calls = 0;
    scheduler.schedule(0, () => {
      calls += 1;
    });

    expect(calls).toBe(0);
    scheduler.advance(0);
    expect(calls).toBe(1);
  });

  it(T.cancelIdempotent, () => {
    const scheduler = new ManualScheduler();
    let calls = 0;
    const cancel = scheduler.schedule(100, () => {
      calls += 1;
    });

    cancel();
    cancel();
    scheduler.advance(200);

    expect(calls).toBe(0);
    expect(scheduler.pending()).toBe(0);
  });

  it(T.schedulerOrder, () => {
    const scheduler = new ManualScheduler();
    const order: string[] = [];
    scheduler.schedule(100, () => {
      order.push('A');
      scheduler.schedule(20, () => order.push('D'));
    });
    scheduler.schedule(50, () => order.push('B'));
    scheduler.schedule(100, () => order.push('C'));

    scheduler.advance(150);

    expect(order.join(', ')).toBe('B, A, C, D');
    expect(scheduler.now()).toBe(150);
  });

  it('INV-08 Zeit-APIs sind in src/playback verboten', async () => {
    const timer = await lintAs(
      'export function later(cb: () => void): void {\n  setTimeout(cb, 0);\n}\n',
      'src/playback/fixture.ts',
    );
    assertViolation(timer, ['no-restricted-syntax', 'no-restricted-globals']);

    const clock = await lintAs(
      'export const now = (): number => performance.now();\n',
      'src/playback/fixture.ts',
    );
    assertViolation(clock, [
      'no-restricted-syntax',
      'no-restricted-globals',
      'no-restricted-properties',
    ]);
  });

  it('INV-08 scheduler.ts darf Zeit-APIs nutzen', async () => {
    const result = await lintAs(
      'export function later(cb: () => void): void {\n  setTimeout(cb, 0);\n}\n' +
        'export const now = (): number => performance.now();\n',
      'src/playback/scheduler.ts',
    );
    assertClean(result);
  });

  it('Feature-Szenarien und Testnamen stimmen überein', () => {
    const feature = readFileSync(FEATURE_PATH, 'utf8');
    const scenarios: string[] = [];
    const outlines: string[] = [];
    for (const line of feature.split('\n')) {
      const scenario = /^\s*Szenario:\s*(.+?)\s*$/.exec(line);
      if (scenario?.[1]) scenarios.push(scenario[1]);
      const outline = /^\s*Szenariogrundriss:\s*(.+?)\s*$/.exec(line);
      if (outline?.[1]) outlines.push(outline[1]);
    }

    expect([...scenarios].sort()).toEqual([...Object.values(T)].sort());
    expect([...outlines].sort()).toEqual([OUTLINE_SEEK, OUTLINE_SPEED].sort());

    const rows = (title: string): string[][] =>
      feature
        .slice(feature.indexOf(`Szenariogrundriss: ${title}`))
        .split(/\n\s*\n\s*(?:Szenario|Szenariogrundriss):/)[0]
        ?.split('\n')
        .filter((line) => /^\s*\|/.test(line))
        .slice(1)
        .map((line) =>
          line
            .split('|')
            .slice(1, -1)
            .map((cell) => cell.trim()),
        ) ?? [];

    expect(rows(OUTLINE_SEEK).map(([step, station]) => [Number(step), Number(station)])).toEqual(
      INVALID_SEEKS.map((s) => [s.step, s.station]),
    );
    expect(rows(OUTLINE_SPEED).map(([tempo]) => Number(tempo))).toEqual([...INVALID_SPEEDS]);
  });
});
