/**
 * Zeitquelle als Strategy (SPEC-0002 §3.5, CON-0005 INV-09). Einzige Datei in src/playback mit
 * Zugriff auf Timer- und Zeit-APIs.
 */

export type Cancel = () => void;

export interface Scheduler {
  /** Ruft `callback` nach `ms` auf – nie synchron innerhalb von `schedule`; `ms < 0` gilt als 0. */
  schedule(ms: number, callback: () => void): Cancel;
  /** Aktuelle Zeit in ms. */
  now(): number;
}

export const timeoutScheduler: Scheduler = {
  schedule(ms, callback) {
    let active = true;
    const id = setTimeout(
      () => {
        if (!active) return;
        active = false;
        callback();
      },
      Math.max(0, ms),
    );
    return () => {
      if (!active) return;
      active = false;
      clearTimeout(id);
    };
  },
  now: () => performance.now(),
};

interface Entry {
  due: number;
  seq: number;
  callback: () => void;
  active: boolean;
}

/** Virtuelle Zeit für Tests: Zeit vergeht nur über `advance`. */
export class ManualScheduler implements Scheduler {
  private time = 0;
  private seq = 0;
  private entries: Entry[] = [];

  schedule(ms: number, callback: () => void): Cancel {
    const entry: Entry = {
      due: this.time + Math.max(0, ms),
      seq: this.seq++,
      callback,
      active: true,
    };
    this.entries.push(entry);
    return () => {
      entry.active = false;
      this.entries = this.entries.filter((e) => e !== entry);
    };
  }

  now(): number {
    return this.time;
  }

  pending(): number {
    return this.entries.length;
  }

  /** Führt fällige Einträge in Fälligkeits-, bei Gleichstand Einplanungsreihenfolge aus. */
  advance(ms: number): void {
    const target = this.time + Math.max(0, ms);
    for (;;) {
      const next = this.entries
        .filter((e) => e.due <= target)
        .sort((a, b) => a.due - b.due || a.seq - b.seq)[0];
      if (next === undefined) break;
      this.entries = this.entries.filter((e) => e !== next);
      this.time = next.due;
      if (next.active) {
        next.active = false;
        next.callback();
      }
    }
    this.time = target;
  }
}
