/** Base64 ⇄ little-endian float32 (CON-0001), unabhängig von der Byte-Reihenfolge der Plattform. */

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function float32ToBase64(values: Float32Array): string {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  for (let i = 0; i < values.length; i += 1) {
    view.setFloat32(i * 4, values[i] ?? 0, true);
  }
  return bytesToBase64(new Uint8Array(view.buffer));
}

/** Dekodiert vollständige float32-Werte; überzählige Bytes (< 4) werden ignoriert. */
export function base64ToFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(Math.floor(bytes.byteLength / 4));
  for (let i = 0; i < values.length; i += 1) {
    values[i] = view.getFloat32(i * 4, true);
  }
  return values;
}
