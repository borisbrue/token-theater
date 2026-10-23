import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { COLORS, DATA_SCALE } from '@/app/theme/tokens';

import {
  allSrcCssFiles,
  contrast,
  declaration,
  listFiles,
  parseCss,
  parseFiles,
  pxValue,
  repoRoot,
  rootRules,
  rootVariables,
  rulesWithSelectors,
  stripComments,
  themeCssFiles,
  themeDir,
} from './helpers/css-rules';

// TST-0007 – Aurora-Theme-Regeln T-01 bis T-08 (CON-0007, ADR-0001).

const TOKENS_CSS = path.join(themeDir, 'tokens.css');

const EXPECTED: Readonly<Record<string, string>> = {
  bg: '#070b14',
  surface: '#0d1424',
  'surface-2': '#121c31',
  line: '#1f2b45',
  'line-strong': '#2a3a5e',
  text: '#e6f1ff',
  'text-soft': '#d4e2f7',
  'text-muted': '#8ea3c4',
  mint: '#34f5a4',
  cyan: '#2ee6e6',
  blue: '#4c7dff',
  'blue-deep': '#1b3a8a',
  violet: '#8b5cf6',
  error: '#ff5c8a',
  'on-accent': '#04131a',
};

/** Normative Regexe aus CON-0007 T-03. */
const HEX_RE = /(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const COLOR_FN_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

const COLOR_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'fill',
  'stroke',
]);
const ALLOWED_KEYWORDS = new Set(['transparent', 'inherit', 'currentcolor']);
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet ' +
    'brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
    'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta ' +
    'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue ' +
    'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
    'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray ' +
    'green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush ' +
    'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray ' +
    'lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon ' +
    'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
    'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna ' +
    'silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle ' +
    'tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

function readTokensCss(): string {
  if (!existsSync(TOKENS_CSS)) {
    throw new Error(`src/app/theme/tokens.css fehlt (CON-0007 T-01)`);
  }
  return readFileSync(TOKENS_CSS, 'utf8');
}

function themeRules() {
  const files = themeCssFiles();
  expect(files, 'Theme-CSS unter src/app/theme/').not.toEqual([]);
  return parseFiles(files);
}

function rel(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function scannedFiles(): string[] {
  const src = listFiles(path.join(repoRoot, 'src'), (f) => /\.(ts|tsx|css|html)$/.test(f)).filter(
    (f) => !f.startsWith(themeDir + path.sep),
  );
  return [...src, path.join(repoRoot, 'index.html')].sort();
}

function colorLiteralHits(text: string): string[] {
  const hits: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (HEX_RE.test(line) || COLOR_FN_RE.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
  });
  return hits;
}

function namedColorHits(css: string): string[] {
  const hits: string[] = [];
  for (const rule of parseCss(css)) {
    for (const d of rule.declarations) {
      if (!COLOR_PROPERTIES.has(d.property)) continue;
      const words = stripComments(d.value)
        .replace(/var\([^)]*\)/g, ' ')
        .toLowerCase()
        .split(/[^a-z-]+/)
        .filter((w) => w !== '');
      for (const word of words) {
        if (NAMED_COLORS.has(word) && !ALLOWED_KEYWORDS.has(word)) {
          hits.push(`${rule.selectors.join(', ')} { ${d.property}: ${d.value} }`);
        }
      }
    }
  }
  return hits;
}

/** Erster Eintrag einer font-family-Liste, Anführungszeichen entfernt. */
function firstFamily(value: string): string {
  return (value.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');
}

describe('T-01 Tokens', () => {
  it('T-01 tokens.css existiert unter src/app/theme', () => {
    expect(existsSync(TOKENS_CSS)).toBe(true);
  });

  it('T-01 :root in tokens.css definiert alle Farb-Tokens mit exakt den ADR-Werten', () => {
    const vars = rootVariables(parseCss(readTokensCss(), TOKENS_CSS));
    for (const [name, hex] of Object.entries(EXPECTED)) {
      expect(vars.get(`--tt-${name}`), `--tt-${name}`).toBe(hex);
    }
  });

  it('T-01 COLORS in tokens.ts stimmt mit den ADR-Werten überein (Schlüssel ohne --tt-)', () => {
    for (const [name, hex] of Object.entries(EXPECTED)) {
      expect((COLORS as Record<string, string>)[name], name).toBe(hex);
    }
    for (const key of Object.keys(COLORS)) {
      expect(key.startsWith('--') || key.startsWith('tt-'), key).toBe(false);
    }
  });

  it('T-01 Verläufe sind definiert und bestehen nur aus var() und color-mix()', () => {
    const vars = rootVariables(parseCss(readTokensCss(), TOKENS_CSS));
    for (const name of ['--tt-gradient-aurora', '--tt-gradient-sky', '--tt-gradient-data']) {
      const value = vars.get(name);
      expect(value, name).toBeDefined();
      expect(value ?? '', name).toMatch(/var\(--tt-/);
    }
  });

  it('T-01 weitere Farbvariablen enthalten keine Farbliterale', () => {
    const vars = rootVariables(themeRules());
    const base = new Set(Object.keys(EXPECTED).map((k) => `--tt-${k}`));
    for (const [name, value] of vars) {
      if (base.has(name)) continue;
      const withoutMix = value.replace(/color-mix\(/g, 'mix(');
      expect(HEX_RE.test(withoutMix) || COLOR_FN_RE.test(withoutMix), `${name}: ${value}`).toBe(
        false,
      );
    }
  });

  it('T-01 DATA_SCALE hat die Stopps 0 / 0.35 / 0.72 / 1 aus den Basis-Tokens', () => {
    expect(DATA_SCALE).toEqual([
      { at: 0, color: COLORS.surface },
      { at: 0.35, color: COLORS['blue-deep'] },
      { at: 0.72, color: COLORS.cyan },
      { at: 1, color: COLORS.mint },
    ]);
  });
});

describe('T-02 Kontrast', () => {
  const textPairs: ReadonlyArray<[string, string[]]> = [
    ['text', ['bg', 'surface', 'surface-2']],
    ['text-soft', ['bg', 'surface', 'surface-2']],
    ['text-muted', ['bg', 'surface', 'surface-2']],
    ['mint', ['bg', 'surface', 'surface-2']],
    ['cyan', ['bg', 'surface', 'surface-2']],
    ['error', ['bg', 'surface', 'surface-2']],
    ['on-accent', ['mint', 'cyan', 'blue']],
  ];
  const colors = COLORS as Record<string, string>;

  for (const [fg, bgs] of textPairs) {
    for (const bg of bgs) {
      it(`T-02 ${fg} auf ${bg} erreicht mindestens 4.5:1`, () => {
        const ratio = contrast(colors[fg] ?? '', colors[bg] ?? '');
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const bg of ['bg', 'surface', 'surface-2']) {
    it(`T-02 Fokusring cyan gegen ${bg} erreicht mindestens 3:1`, () => {
      expect(contrast(colors['cyan'] ?? '', colors[bg] ?? '')).toBeGreaterThanOrEqual(3);
    });
  }

  it('T-02 die Kontrastfunktion rechnet nach WCAG (Schwarz/Weiß = 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('T-03 Farbwerte nur im Theme', () => {
  it('T-03 der Hex-Regex trifft Farben, aber keine Anker, Entities oder Pfade', () => {
    for (const hit of ['color: #fff;', '#070b14', 'a #1b3a8aff b', 'border: 1px solid #abcd']) {
      expect(HEX_RE.test(hit), hit).toBe(true);
    }
    for (const miss of ['&#39;', 'href="/a/#top"', 'id#1234567', '#zzz', 'route/#abc', 'x#fff']) {
      expect(HEX_RE.test(miss), miss).toBe(false);
    }
  });

  it('T-03 der Funktions-Regex trifft Farbfunktionen, aber keine anderen Aufrufe', () => {
    for (const hit of ['rgb(1,2,3)', 'rgba(0, 0, 0, .5)', 'hsl(1 2% 3%)', 'oklch(70% .1 200)']) {
      expect(COLOR_FN_RE.test(hit), hit).toBe(true);
    }
    for (const miss of ['colorize(x)', 'var(--tt-bg)', 'color-mix(in srgb, x, y)', 'scale(2)']) {
      expect(COLOR_FN_RE.test(miss), miss).toBe(false);
    }
  });

  it('T-03 außerhalb von src/app/theme stehen keine Farbliterale (inkl. index.html)', () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(1);
    const hits = files.flatMap((file) =>
      colorLiteralHits(readFileSync(file, 'utf8')).map((hit) => `${rel(file)}:${hit}`),
    );
    expect(hits).toEqual([]);
  });

  it('T-03 die Erkennung benannter Farben greift (Gegentest)', () => {
    expect(namedColorHits('a { color: red; background: transparent; }')).toHaveLength(1);
    expect(namedColorHits('a { color: currentColor; fill: var(--tt-mint); }')).toEqual([]);
  });

  it('T-03 CSS außerhalb des Themes nutzt keine benannten Farben', () => {
    const files = allSrcCssFiles().filter((f) => !f.startsWith(themeDir + path.sep));
    const hits = files.flatMap((file) =>
      namedColorHits(readFileSync(file, 'utf8')).map((hit) => `${rel(file)}: ${hit}`),
    );
    expect(hits).toEqual([]);
  });
});

describe('T-04 Schriften gebündelt', () => {
  const packages = [
    '@fontsource/space-grotesk',
    '@fontsource-variable/inter',
    '@fontsource/jetbrains-mono',
  ];

  it('T-04 die Schriftpakete stehen in dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const name of packages) {
      expect(pkg.dependencies?.[name], name).toEqual(expect.any(String));
    }
  });

  it('T-04 eine Datei unter src/app/theme importiert jede Schrift', () => {
    const sources = listFiles(themeDir, (f) => /\.(ts|tsx|css)$/.test(f)).map((f) =>
      readFileSync(f, 'utf8'),
    );
    for (const name of packages) {
      const imported = sources.some(
        (text) => text.includes(`'${name}`) || text.includes(`"${name}`),
      );
      expect(imported, name).toBe(true);
    }
  });

  it('T-04 keine Google-Fonts-Adressen in src/ und index.html', () => {
    const files = [
      ...listFiles(path.join(repoRoot, 'src'), (f) => /\.(ts|tsx|css|html)$/.test(f)),
      path.join(repoRoot, 'index.html'),
    ];
    const hits = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes('fonts.googleapis.com') || text.includes('fonts.gstatic.com');
    });
    expect(hits.map(rel)).toEqual([]);
  });

  it('T-04 :root setzt --tt-font-display, --tt-font-body und --tt-font-mono', () => {
    const vars = rootVariables(parseCss(readTokensCss(), TOKENS_CSS));
    expect(firstFamily(vars.get('--tt-font-display') ?? '')).toBe('Space Grotesk');
    expect(firstFamily(vars.get('--tt-font-body') ?? '')).toBe('Inter Variable');
    expect(firstFamily(vars.get('--tt-font-mono') ?? '')).toBe('JetBrains Mono');
  });
});

describe('T-05 Reduzierte Bewegung', () => {
  it('T-05 @media (prefers-reduced-motion: reduce) setzt Übergänge und Animationen auf 0s', () => {
    const rules = themeRules().filter(
      (r) => r.media !== null && /prefers-reduced-motion\s*:\s*reduce/.test(r.media),
    );
    const matching = rulesWithSelectors(rules, ['*', '*::before', '*::after']);
    expect(matching.length, 'Regel *, *::before, *::after').toBeGreaterThan(0);
    const ok = matching.some((rule) => {
      const transition = declaration(rule, 'transition-duration');
      const animation = declaration(rule, 'animation-duration');
      const iterations = declaration(rule, 'animation-iteration-count');
      return (
        transition?.value === '0s' &&
        transition.important &&
        animation?.value === '0s' &&
        animation.important &&
        iterations?.value === '1' &&
        iterations.important
      );
    });
    expect(ok).toBe(true);
  });
});

describe('T-06 Nur Dark Mode', () => {
  it('T-06 :root in tokens.css setzt color-scheme: dark', () => {
    const roots = rootRules(parseCss(readTokensCss(), TOKENS_CSS));
    const schemes = roots.map((r) => declaration(r, 'color-scheme')?.value).filter(Boolean);
    expect(schemes).toContain('dark');
  });

  it('T-06 kein CSS unter src/ enthält prefers-color-scheme: light', () => {
    const hits = allSrcCssFiles().filter((file) =>
      /prefers-color-scheme\s*:\s*light/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(hits.map(rel)).toEqual([]);
  });
});

describe('T-07 Fokusring', () => {
  it('T-07 :focus-visible setzt outline mit var(--tt-cyan) ≥ 2px und outline-offset ≥ 2px', () => {
    const rules = themeRules().filter((r) => r.media === null);
    const focus = rulesWithSelectors(rules, [':focus-visible']);
    expect(focus.length, 'Regel :focus-visible').toBeGreaterThan(0);
    const ok = focus.some((rule) => {
      const outline = declaration(rule, 'outline')?.value ?? '';
      const width = outline
        .split(/\s+/)
        .map(pxValue)
        .find((v): v is number => v !== null);
      const offset = pxValue(declaration(rule, 'outline-offset')?.value ?? '');
      return (
        outline.includes('var(--tt-cyan)') &&
        width !== undefined &&
        width >= 2 &&
        offset !== null &&
        offset >= 2
      );
    });
    expect(ok).toBe(true);
  });
});

describe('T-08 ADR und Code stimmen überein', () => {
  it('T-08 jede Token-Zeile der ADR-0001-Tabelle hat denselben Wert in COLORS und umgekehrt', () => {
    const adr = readFileSync(
      path.join(repoRoot, 'docs', 'adr', 'ADR-0001-aurora-design-language.md'),
      'utf8',
    );
    const rows = [
      ...adr.matchAll(/^\|[^|]*\|\s*`--tt-([a-z0-9-]+)`\s*\|\s*`(#[0-9a-f]{6})`\s*\|/gim),
    ];
    const table = new Map(rows.map((m) => [m[1] ?? '', (m[2] ?? '').toLowerCase()]));
    expect(table.size).toBeGreaterThan(0);
    const colors = COLORS as Record<string, string>;
    for (const [name, hex] of table) {
      expect(colors[name], name).toBe(hex);
    }
    for (const key of Object.keys(colors)) {
      expect(table.has(key), `COLORS.${key} fehlt in ADR-0001`).toBe(true);
    }
  });
});
