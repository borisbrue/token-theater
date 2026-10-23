/**
 * Anzeige von Tokens (SPEC-0003 §3.6b, CON-0009 TU-05): Leerraum wird sichtbar, Bytes ohne
 * gültiges UTF-8 erscheinen als Hex.
 */

const VISIBLE: Readonly<Record<string, string>> = {
  ' ': '␣',
  '\n': '↵',
  '\t': '⇥',
  '\r': '␍',
};

/** Fatal und ohne BOM-Verschlucken: halbe Folgen werfen, ein BOM-Token bleibt sichtbar. */
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function displayText(text: string): string {
  return text.replace(/[ \n\t\r]/g, (char) => VISIBLE[char] ?? char);
}

export function displayBytes(bytes: readonly number[] | Uint8Array): string {
  const data = Uint8Array.from(bytes);
  try {
    return displayText(strictUtf8.decode(data));
  } catch {
    const hex = Array.from(data, (byte) => byte.toString(16).toUpperCase().padStart(2, '0'));
    return `<${hex.join(' ')}>`;
  }
}
