/**
 * GPT-2-Byte-Tabelle `bytes_to_unicode` (SPEC-0003 §3.2, CON-0008 B-01): Jedes Byte bekommt ein
 * druckbares Zeichen. Druckbare Latin-1-Bytes stehen für sich selbst, die übrigen 68 Bytes
 * werden der Reihe nach auf U+0100 ff. gelegt (Leerzeichen → Ġ, Zeilenumbruch → Ċ).
 */

function isDirect(byte: number): boolean {
  return (
    (byte >= 0x21 && byte <= 0x7e) ||
    (byte >= 0xa1 && byte <= 0xac) ||
    (byte >= 0xae && byte <= 0xff)
  );
}

function buildTable(): string[] {
  const table: string[] = [];
  let next = 0x100;
  for (let byte = 0; byte < 256; byte += 1) {
    if (isDirect(byte)) {
      table.push(String.fromCharCode(byte));
    } else {
      table.push(String.fromCharCode(next));
      next += 1;
    }
  }
  return table;
}

export const BYTE_TO_UNICODE: readonly string[] = Object.freeze(buildTable());

export const UNICODE_TO_BYTE: ReadonlyMap<string, number> = new Map(
  BYTE_TO_UNICODE.map((char, byte) => [char, byte]),
);
