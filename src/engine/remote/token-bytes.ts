import { UNICODE_TO_BYTE } from '../tokenizer/byte-level';

/** Bytes und Text von Server-Tokens (SPEC-0005 §3.4, CON-0012 RE-06). */

const utf8 = new TextEncoder();
/** Nicht fatal: halbe UTF-8-Folgen werden zu U+FFFD. */
const lossy = new TextDecoder('utf-8');
const BYTES_PREFIX = 'bytes:';
const ESCAPED_BYTE = /\\x([0-9a-fA-F]{2})/g;

export function utf8Bytes(text: string): number[] {
  return Array.from(utf8.encode(text));
}

/** MLX/HF-Token im GPT-2-Byte-Zeichensatz („ĠDach“); Zeichen außerhalb der Tabelle als UTF-8. */
export function contentTokenBytes(token: string): number[] {
  const bytes: number[] = [];
  for (const char of token) {
    const byte = UNICODE_TO_BYTE.get(char);
    if (byte === undefined) bytes.push(...utf8.encode(char));
    else bytes.push(byte);
  }
  return bytes;
}

/** vLLM-Token: Klartext, bei halben UTF-8-Folgen die Form `bytes:\xNN…`. */
export function legacyTokenBytes(token: string): number[] {
  if (token.startsWith(BYTES_PREFIX)) {
    const escaped = token.slice(BYTES_PREFIX.length);
    const bytes = Array.from(escaped.matchAll(ESCAPED_BYTE), (m) =>
      Number.parseInt(m[1] ?? '', 16),
    );
    if (bytes.length > 0 && bytes.length * 4 === escaped.length) return bytes;
  }
  return utf8Bytes(token);
}

export function bytesText(bytes: readonly number[]): string {
  return lossy.decode(Uint8Array.from(bytes));
}
