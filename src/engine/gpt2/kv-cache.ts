/**
 * KV-Cache je Layer (SPEC-0006 §3.5): Schlüssel und Werte aller berechneten Positionen samt der
 * Token-IDs. Passt ein Kontext nicht zum gemerkten Präfix, wird der Cache verworfen.
 */
export class KvCache {
  private tokens: number[] = [];
  private keys: Float32Array[];
  private values: Float32Array[];

  constructor(
    private readonly layers: number,
    private readonly width: number,
  ) {
    this.keys = Array.from({ length: layers }, () => new Float32Array(0));
    this.values = Array.from({ length: layers }, () => new Float32Array(0));
  }

  get length(): number {
    return this.tokens.length;
  }

  /** Gilt der Cache genau für context[0..a)? */
  covers(context: readonly number[], a: number): boolean {
    return this.tokens.length === a && this.tokens.every((id, i) => id === context[i]);
  }

  clear(): void {
    this.tokens = [];
    this.keys = this.keys.map(() => new Float32Array(0));
    this.values = this.values.map(() => new Float32Array(0));
  }

  /** Hängt `rows` neue Zeilen von K und V an Layer `layer` an. */
  append(layer: number, keys: Float32Array, values: Float32Array, rows: number): void {
    this.keys[layer] = concat(
      this.keys[layer] ?? new Float32Array(0),
      keys.subarray(0, rows * this.width),
    );
    this.values[layer] = concat(
      this.values[layer] ?? new Float32Array(0),
      values.subarray(0, rows * this.width),
    );
  }

  keysOf(layer: number): Float32Array {
    return this.keys[layer] ?? new Float32Array(0);
  }

  valuesOf(layer: number): Float32Array {
    return this.values[layer] ?? new Float32Array(0);
  }

  /** Nach einem Schritt: die Token-IDs, für die K und V jetzt vorliegen. */
  commit(context: readonly number[], end: number): void {
    this.tokens = context.slice(0, end);
    if (this.keys.length !== this.layers) throw new Error('KV-Cache inkonsistent');
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
