import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Kleiner CSS-Parser für die Theme-Regeln (CON-0007): Regeln, Selektoren, Deklarationen, @media. */

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const themeDir = path.join(repoRoot, 'src', 'app', 'theme');

export interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

export interface CssRule {
  selectors: string[];
  declarations: Declaration[];
  /** Bedingung des umgebenden @media-Blocks, sonst null. */
  media: string | null;
  file: string;
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseDeclarations(body: string): Declaration[] {
  const result: Declaration[] = [];
  // Semikolons in Klammern (z. B. url(data:…;…)) kommen im Theme nicht vor.
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim();
    let value = part.slice(colon + 1).trim();
    if (property === '' || value === '') continue;
    const important = /!important\s*$/i.test(value);
    if (important) value = value.replace(/!important\s*$/i, '').trim();
    result.push({ property, value, important });
  }
  return result;
}

/** Findet zum `{` an `open` die passende `}`. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('CSS: unbalancierte Klammern');
}

function parseBlock(css: string, media: string | null, file: string, out: CssRule[]): void {
  let pos = 0;
  while (pos < css.length) {
    const open = css.indexOf('{', pos);
    if (open < 0) break;
    const prelude = css.slice(pos, open).trim();
    const close = matchBrace(css, open);
    const body = css.slice(open + 1, close);
    // Anweisungen ohne Block (z. B. @import …;) vor dem Prelude abtrennen.
    const lastStatement = prelude.lastIndexOf(';');
    const head = (lastStatement >= 0 ? prelude.slice(lastStatement + 1) : prelude).trim();
    if (head.startsWith('@media')) {
      parseBlock(body, head.replace(/^@media\s*/, '').trim(), file, out);
    } else if (head.startsWith('@')) {
      // @font-face, @keyframes, @supports …: für die Regeln hier ohne Belang.
    } else if (head !== '') {
      out.push({
        selectors: head
          .split(',')
          .map((s) => s.trim().replace(/\s+/g, ' '))
          .filter((s) => s !== ''),
        declarations: parseDeclarations(body),
        media,
        file,
      });
    }
    pos = close + 1;
  }
}

export function parseCss(css: string, file = '<inline>'): CssRule[] {
  const rules: CssRule[] = [];
  parseBlock(stripComments(css), null, file, rules);
  return rules;
}

export function listFiles(dir: string, predicate: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, predicate);
    return predicate(full) ? [full] : [];
  });
}

export function themeCssFiles(): string[] {
  return listFiles(themeDir, (f) => f.endsWith('.css')).sort();
}

export function allSrcCssFiles(): string[] {
  return listFiles(path.join(repoRoot, 'src'), (f) => f.endsWith('.css')).sort();
}

export function parseFiles(files: readonly string[]): CssRule[] {
  return files.flatMap((file) => parseCss(readFileSync(file, 'utf8'), file));
}

/** Regeln, deren Selektorliste genau `selectors` ist (Reihenfolge egal, Leerraum normiert). */
export function rulesWithSelectors(rules: readonly CssRule[], selectors: string[]): CssRule[] {
  const wanted = [...selectors].map((s) => s.replace(/\s+/g, ' ')).sort();
  return rules.filter((rule) => {
    const actual = [...rule.selectors].sort();
    return actual.length === wanted.length && actual.every((s, i) => s === wanted[i]);
  });
}

export function declaration(rule: CssRule, property: string): Declaration | undefined {
  return [...rule.declarations].reverse().find((d) => d.property === property);
}

/** Die :root-Regeln einer Datei außerhalb von @media. */
export function rootRules(rules: readonly CssRule[]): CssRule[] {
  return rules.filter((r) => r.media === null && r.selectors.includes(':root'));
}

/** Alle Custom Properties der :root-Regeln (spätere Deklarationen gewinnen). */
export function rootVariables(rules: readonly CssRule[]): Map<string, string> {
  const vars = new Map<string, string>();
  for (const rule of rootRules(rules)) {
    for (const d of rule.declarations) {
      if (d.property.startsWith('--')) vars.set(d.property, d.value);
    }
  }
  return vars;
}

// ── WCAG 2.1 ──

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Kein #rrggbb: ${hex}`);
  return [parseInt(m[1] ?? '0', 16), parseInt(m[2] ?? '0', 16), parseInt(m[3] ?? '0', 16)];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Längenangabe in px (nur px und 0 werden akzeptiert), sonst null. */
export function pxValue(token: string): number | null {
  if (token === '0') return 0;
  const m = /^(\d+(?:\.\d+)?)px$/.exec(token);
  return m ? Number(m[1]) : null;
}
