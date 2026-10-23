// TST-0004 · CON-0004: Architektur- und Werkzeugregeln R-01 bis R-08.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertClean,
  assertViolation,
  lintAs,
  loadFixtures,
  repoRoot,
  type LintResult,
} from './helpers/lint-as';

const SLOW = 60_000;

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

function runNode(script: string, args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function majorVersion(range: string | undefined): number | null {
  const match = range === undefined ? null : /(\d+)/.exec(range);
  return match?.[1] === undefined ? null : Number(match[1]);
}

describe('R-01 Skripte und Versionen', () => {
  const pkg = readJson<PackageJson>('package.json');
  const scripts = pkg.scripts ?? {};

  it('R-01: package.json enthält dev, build, test, test:e2e, lint und format', () => {
    for (const name of ['dev', 'build', 'test', 'test:e2e', 'lint', 'format']) {
      expect(scripts[name], `Skript ${name}`).toEqual(expect.any(String));
    }
  });

  it('R-01: build beginnt mit tsc --noEmit und führt danach vite build aus', () => {
    const build = scripts['build'] ?? '';
    expect(build.trimStart().startsWith('tsc --noEmit')).toBe(true);
    expect(build.indexOf('vite build')).toBeGreaterThan(build.indexOf('tsc --noEmit'));
  });

  it('R-01: test ruft vitest run auf, lint führt eslint . und prettier --check . aus', () => {
    expect(scripts['test']).toMatch(/\bvitest run\b/);
    expect(scripts['lint']).toMatch(/\beslint \.(\s|$|&)/);
    expect(scripts['lint']).toMatch(/\bprettier --check \.(\s|$|&)/);
  });

  it('R-01: react und react-dom haben die Hauptversion 18', () => {
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    expect(majorVersion(deps['react'])).toBe(18);
    expect(majorVersion(deps['react-dom'])).toBe(18);
  });
});

interface ShownConfig {
  compilerOptions?: Record<string, unknown>;
  files?: string[];
  include?: string[];
  references?: Array<{ path: string }>;
}

function showConfig(project: string): ShownConfig {
  const { status, output } = runNode('node_modules/typescript/bin/tsc', [
    '--showConfig',
    '-p',
    project,
  ]);
  expect(status, output).toBe(0);
  return JSON.parse(output) as ShownConfig;
}

describe('R-02 TypeScript', () => {
  it(
    'R-02: tsconfig für src setzt strict, noUncheckedIndexedAccess und noImplicitOverride',
    () => {
      const root = showConfig('tsconfig.json');
      const candidates = [
        { project: 'tsconfig.json', config: root },
        ...(root.references ?? []).map((ref) => ({
          project: ref.path,
          config: showConfig(ref.path),
        })),
      ];
      const coversSrc = (config: ShownConfig): boolean =>
        [...(config.files ?? []), ...(config.include ?? [])].some((entry) =>
          /(^|\/)src(\/|$)/.test(entry),
        );
      const relevant = candidates.filter((c) => coversSrc(c.config));
      expect(relevant.length, 'mindestens eine tsconfig deckt src/ ab').toBeGreaterThan(0);
      for (const { project, config } of relevant) {
        const options = config.compilerOptions ?? {};
        expect(options['strict'], `${project}: strict`).toBe(true);
        expect(options['noUncheckedIndexedAccess'], `${project}: noUncheckedIndexedAccess`).toBe(
          true,
        );
        expect(options['noImplicitOverride'], `${project}: noImplicitOverride`).toBe(true);
      }
    },
    SLOW,
  );
});

describe('ESLint-Fixtures (R-02 bis R-05, R-08)', () => {
  const fixtures = loadFixtures();
  const bad = fixtures.filter((f) => f.kind === 'bad');
  const good = fixtures.filter((f) => f.kind === 'good');

  it('Fixture-Abdeckung: jede (F)-Regel hat Verstoß und Gegenbeispiel', () => {
    for (const rule of ['R-02', 'R-03', 'R-04', 'R-05', 'R-08']) {
      expect(
        bad.some((f) => f.rule === rule),
        `${rule}: Verstoß-Fixture`,
      ).toBe(true);
      expect(
        good.some((f) => f.rule === rule),
        `${rule}: Gegenbeispiel`,
      ).toBe(true);
    }
  });

  it('INV-01: Fixtures sind vom normalen Lint-Lauf ausgeschlossen', async () => {
    const first = fixtures[0];
    expect(first).toBeDefined();
    const virtualPath = path.posix.join('tests/fixtures/lint', first?.file ?? '');
    const result = await lintAs(first?.code ?? '', virtualPath);
    expect(result.ignored).toBe(true);
  });

  it.each(bad)('$rule Verstoß: $file', async (fixture) => {
    const result = await lintAs(fixture.code, fixture.target);
    assertViolation(result, fixture.expect);
  });

  it.each(good)('$rule Gegenbeispiel: $file', async (fixture) => {
    const result = await lintAs(fixture.code, fixture.target);
    assertClean(result);
  });
});

describe('INV-02 Bewertung der Fixture-Ergebnisse', () => {
  const ruleHit: LintResult = {
    ruleIds: ['no-restricted-syntax'],
    severities: [2],
    fatal: false,
    ignored: false,
    messages: [
      { ruleId: 'no-restricted-syntax', severity: 2, message: 'x', line: 1, fatal: false },
    ],
  };

  it('INV-02: ein Parse-Fehler zählt nicht als Verstoß', async () => {
    const result = await lintAs('export const = ;\n', 'src/engine/fixture.ts');
    expect(result.fatal).toBe(true);
    expect(() => assertViolation(result, ['no-restricted-syntax'])).toThrow(/Parse-Fehler/);
  });

  it('INV-02: eine Warnung (severity 1) zählt nicht als Verstoß', () => {
    const warning: LintResult = {
      ...ruleHit,
      severities: [1],
      messages: ruleHit.messages.map((m) => ({ ...m, severity: 1 })),
    };
    expect(() => assertViolation(warning, ['no-restricted-syntax'])).toThrow(/severity 2/);
  });

  it('INV-02: eine andere ruleId zählt nicht als Verstoß', () => {
    expect(() => assertViolation(ruleHit, ['no-restricted-properties'])).toThrow();
    expect(() => assertViolation(ruleHit, ['no-restricted-syntax'])).not.toThrow();
  });

  it('INV-02: eine ignorierte Datei zählt weder als Verstoß noch als Gegenbeispiel', () => {
    const ignored: LintResult = { ...ruleHit, ignored: true };
    expect(() => assertViolation(ignored, ['no-restricted-syntax'])).toThrow(/ignoriert/);
    expect(() => assertClean({ ...ignored, messages: [], ruleIds: [], severities: [] })).toThrow(
      /ignoriert/,
    );
  });
});

describe('R-06 Schema-Kopie', () => {
  it('R-06: src/trace/trace.schema.json ist JSON-tief gleich dem Contract-Artifact', () => {
    const copy = readJson<unknown>('src/trace/trace.schema.json');
    const contract = readJson<unknown>(
      '.sdd/contracts/data/trace-serialization-format-v1.schema.json',
    );
    expect(copy).toEqual(contract);
  });
});

describe('R-07 Formatierung', () => {
  it(
    'R-07: prettier --check . endet mit Exit-Code 0',
    () => {
      const { status, output } = runNode('node_modules/prettier/bin/prettier.cjs', [
        '--check',
        '.',
      ]);
      expect(status, output).toBe(0);
    },
    SLOW,
  );
});

// Muster zusammengesetzt, damit diese Datei selbst den Scan besteht.
const SUPPRESSION_PATTERNS = [
  ['eslint', 'disable'].join('-'),
  ['@ts', 'ignore'].join('-'),
  ['@ts', 'expect', 'error'].join('-'),
  ['@ts', 'nocheck'].join('-'),
  ['istanbul', 'ignore'].join(' '),
];

const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.sdd',
  'playwright-report',
  'test-results',
  'coverage',
]);
const SKIPPED_PATHS = new Set([path.join('tests', 'fixtures')]);
// Nur Code- und Konfigurationsdateien: Dokumentation (AGENTS.md, .claude/commands/*.md)
// nennt die verbotenen Kommentare absichtlich als Beispiele.
const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
]);

function scanFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const relative = path.relative(repoRoot, full);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || SKIPPED_PATHS.has(relative)) return [];
      return scanFiles(full);
    }
    return SCANNED_EXTENSIONS.has(path.extname(entry.name)) ? [relative] : [];
  });
}

describe('R-08 Keine Inline-Suppression', () => {
  it('R-08: der Dateiscan findet keine Suppress-Kommentare im Repository', () => {
    const files = scanFiles(repoRoot);
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((file) => {
      const text = readFileSync(path.join(repoRoot, file), 'utf8');
      return SUPPRESSION_PATTERNS.filter((pattern) => text.includes(pattern)).map(
        (pattern) => `${file}: ${pattern}`,
      );
    });
    expect(hits).toEqual([]);
  });

  it('R-08: der Scan schließt nur tests/fixtures aus, nicht tests/', () => {
    const files = scanFiles(repoRoot);
    expect(files).toContain(path.join('tests', 'unit', 'architecture-rules.test.ts'));
    expect(files.some((file) => file.startsWith(path.join('tests', 'fixtures')))).toBe(false);
  });
});
