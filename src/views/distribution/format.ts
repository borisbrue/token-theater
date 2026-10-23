/** Zahlen mit Dezimalkomma (SPEC-0004 FR-12, CON-0011 SU-04). */

export function formatDecimal(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',');
}

/** Ganze Zahl mit Tausenderpunkt ohne Locale-Abhängigkeit: 50257 → "50.257" (SPEC-0009 §3.4). */
export function formatInteger(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Prozent mit einer Nachkommastelle: 0.412 → "41,2 %". */
export function formatPercent(probability: number): string {
  return `${formatDecimal(probability * 100, 1)} %`;
}

/**
 * Zahl mit Vorzeichen „−“ (U+2212) und Dezimalkomma; mit `plus` ein „+“ vor positiven Werten.
 * Was auf 0 rundet, steht ohne Vorzeichen (SPEC-0012 §3.3).
 */
export function formatSigned(value: number, digits: number, plus = false): string {
  const text = formatDecimal(Math.abs(value), digits);
  if (Number(Math.abs(value).toFixed(digits)) === 0) return text;
  if (value < 0) return `\u2212${text}`;
  return plus ? `+${text}` : text;
}
