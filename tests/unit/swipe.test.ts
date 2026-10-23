// TST-0031 · CON-0028 SW-01..SW-06: Wisch-Regeln (@/app/player/swipe), ohne DOM.
import { describe, expect, it } from 'vitest';

import { SWIPE, swipeCommand, swipeIgnored, type SwipePoint } from '@/app/player/swipe';

const start: SwipePoint = { x: 200, y: 300, t: 1000 };
const to = (dx: number, dy = 0, dt = 200): SwipePoint => ({
  x: start.x + dx,
  y: start.y + dy,
  t: start.t + dt,
});

/** Objekt mit den Teilen eines Elements, die swipeIgnored nutzt. */
function element(tagName: string, options: { editable?: boolean; inIgnored?: boolean } = {}) {
  return {
    tagName,
    isContentEditable: options.editable ?? false,
    closest: (selector: string) =>
      selector === '[data-swipe="ignore"]' && options.inIgnored === true ? {} : null,
  } as unknown as EventTarget;
}

describe('SW-01 Richtung', () => {
  it('SW-01: nach links → next, nach rechts → prev', () => {
    expect(swipeCommand(start, to(-120))).toEqual({ type: 'next' });
    expect(swipeCommand(start, to(120))).toEqual({ type: 'prev' });
  });
});

describe('SW-02 Mindestweg', () => {
  it('SW-02: 59 px nicht, 60 px schon', () => {
    expect(SWIPE.minDistance).toBe(60);
    expect(swipeCommand(start, to(-59))).toBeNull();
    expect(swipeCommand(start, to(59))).toBeNull();
    expect(swipeCommand(start, to(-60))).toEqual({ type: 'next' });
    expect(swipeCommand(start, to(60))).toEqual({ type: 'prev' });
  });
});

describe('SW-03 Waagerecht', () => {
  it('SW-03: |dx| < 2·|dy| ist kein Wisch, genau 2 : 1 schon', () => {
    expect(SWIPE.ratio).toBe(2);
    expect(swipeCommand(start, to(-120, 61))).toBeNull();
    expect(swipeCommand(start, to(-120, -61))).toBeNull();
    expect(swipeCommand(start, to(-120, 60))).toEqual({ type: 'next' });
    expect(swipeCommand(start, to(40, 120))).toBeNull();
  });
});

describe('SW-04 Dauer', () => {
  it('SW-04: bis 800 ms ein Wisch, länger oder negativ nicht', () => {
    expect(SWIPE.maxDuration).toBe(800);
    expect(swipeCommand(start, to(-120, 0, 800))).toEqual({ type: 'next' });
    expect(swipeCommand(start, to(-120, 0, 801))).toBeNull();
    expect(swipeCommand(start, to(-120, 0, -1))).toBeNull();
  });
});

describe('SW-05 Ausgenommene Ziele', () => {
  it('SW-05: Eingabefelder und bearbeitbare Elemente', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(swipeIgnored(element(tag)), tag).toBe(true);
    }
    expect(swipeIgnored(element('DIV', { editable: true }))).toBe(true);
  });

  it('SW-05: alles innerhalb von data-swipe="ignore"', () => {
    expect(swipeIgnored(element('CANVAS', { inIgnored: true }))).toBe(true);
    expect(swipeIgnored(element('TD', { inIgnored: true }))).toBe(true);
  });

  it('SW-05: sonst nicht, auch nicht null oder Objekte ohne closest', () => {
    expect(swipeIgnored(element('DIV'))).toBe(false);
    expect(swipeIgnored(element('CANVAS'))).toBe(false);
    expect(swipeIgnored(element('BUTTON'))).toBe(false);
    expect(swipeIgnored(null)).toBe(false);
    expect(swipeIgnored({} as EventTarget)).toBe(false);
  });
});

describe('SW-06 Kommandos', () => {
  it('SW-06: nur next, prev oder null', () => {
    const results = new Set<string>();
    for (let dx = -300; dx <= 300; dx += 15) {
      for (let dy = -150; dy <= 150; dy += 30) {
        const command = swipeCommand(start, to(dx, dy));
        results.add(command === null ? 'null' : command.type);
      }
    }
    expect([...results].sort()).toEqual(['next', 'null', 'prev']);
  });
});
