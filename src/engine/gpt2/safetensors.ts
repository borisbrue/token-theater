import { invalidWeights, isRecord } from './errors';

/**
 * safetensors lesen (SPEC-0006 §3.4, CON-0014 G-01): 8 Byte Header-Länge (u64 little-endian),
 * JSON-Header, danach die Daten. F32 wird ohne Kopie gelesen, wenn ausgerichtet; F16 und BF16
 * werden nach Float32 umgerechnet; andere dtypes ergeben `data: null`.
 */

export interface SafeTensor {
  dtype: string;
  shape: number[];
  /** null: dtype nicht unterstützt (z. B. Maskenpuffer). */
  data: Float32Array | null;
}

const DTYPE_BYTES: Readonly<Record<string, number>> = { F32: 4, F16: 2, BF16: 2 };

function product(shape: readonly number[]): number {
  return shape.reduce((a, b) => a * b, 1);
}

function isShape(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((d) => Number.isInteger(d) && d >= 0);
}

/** IEEE-754 binary16 → number. */
function halfToFloat(half: number): number {
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >> 10) & 0x1f;
  const fraction = half & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function decode(buffer: ArrayBuffer, offset: number, count: number, dtype: string): Float32Array {
  if (dtype === 'F32') {
    return offset % 4 === 0
      ? new Float32Array(buffer, offset, count)
      : new Float32Array(buffer.slice(offset, offset + count * 4));
  }
  const view = new DataView(buffer, offset, count * 2);
  const out = new Float32Array(count);
  const bits = new Uint32Array(1);
  const asFloat = new Float32Array(bits.buffer);
  for (let i = 0; i < count; i += 1) {
    const raw = view.getUint16(i * 2, true);
    if (dtype === 'F16') {
      out[i] = halfToFloat(raw);
    } else {
      bits[0] = raw << 16;
      out[i] = asFloat[0] ?? 0;
    }
  }
  return out;
}

export function parseSafetensors(buffer: ArrayBuffer): Map<string, SafeTensor> {
  if (buffer.byteLength < 8) throw invalidWeights('kürzer als 8 Byte');
  const headerLength = Number(new DataView(buffer).getBigUint64(0, true));
  if (!Number.isSafeInteger(headerLength) || 8 + headerLength > buffer.byteLength) {
    throw invalidWeights('die Header-Länge reicht über das Dateiende');
  }
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength)));
  } catch {
    throw invalidWeights('der Header ist kein JSON');
  }
  if (!isRecord(header)) throw invalidWeights('der Header ist kein JSON-Objekt');

  const dataStart = 8 + headerLength;
  const dataLength = buffer.byteLength - dataStart;
  const tensors = new Map<string, SafeTensor>();
  for (const [name, entry] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    const dtype = isRecord(entry) ? entry['dtype'] : undefined;
    const shape = isRecord(entry) ? entry['shape'] : undefined;
    const offsets = isRecord(entry) ? entry['data_offsets'] : undefined;
    if (typeof dtype !== 'string' || !isShape(shape)) {
      throw invalidWeights(`der Eintrag ${name} hat keinen gültigen dtype oder keine Form`);
    }
    const [begin, end] = Array.isArray(offsets) ? (offsets as unknown[]) : [];
    if (
      typeof begin !== 'number' ||
      typeof end !== 'number' ||
      !Number.isInteger(begin) ||
      !Number.isInteger(end) ||
      begin < 0 ||
      end < begin ||
      end > dataLength
    ) {
      throw invalidWeights(`die Offsets von ${name} liegen außerhalb der Daten`);
    }
    const size = DTYPE_BYTES[dtype];
    if (size === undefined) {
      tensors.set(name, { dtype, shape: [...shape], data: null });
      continue;
    }
    const count = product(shape);
    if (end - begin !== count * size) {
      throw invalidWeights(`die Länge von ${name} passt nicht zur Form [${shape.join(', ')}]`);
    }
    tensors.set(name, {
      dtype,
      shape: [...shape],
      data: decode(buffer, dataStart + begin, count, dtype),
    });
  }
  return tensors;
}
