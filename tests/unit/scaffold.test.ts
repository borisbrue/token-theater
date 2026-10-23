import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// T01 (SPEC-0001 FR-01, FR-03) – CON-0004 R-01, R-02 (tsconfig-Seite), R-06, R-07.

const repoRoot = path.resolve(__dirname, '..', '..');

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ShowConfig {
  compilerOptions?: Record<string, unknown> & { paths?: Record<string, string[]> };
  files?: string[];
}

function packageJson(): PackageJson {
  return readJson('package.json') as PackageJson;
}

function nodeModule(...parts: string[]): string {
  return path.join(repoRoot, 'node_modules', ...parts);
}

function showConfig(): ShowConfig {
  const out = execFileSync(
    process.execPath,
    [nodeModule('typescript', 'bin', 'tsc'), '--showConfig', '-p', 'tsconfig.json'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(out) as ShowConfig;
}

describe('R-01 Skripte und Versionen', () => {
  it('package.json existiert', () => {
    expect(existsSync(path.join(repoRoot, 'package.json'))).toBe(true);
  });

  it('enthält die Skripte dev, build, test, test:e2e, lint und format', () => {
    const scripts = packageJson().scripts ?? {};
    for (const name of ['dev', 'build', 'test', 'test:e2e', 'lint', 'format']) {
      expect(scripts[name], `Skript ${name}`).toEqual(expect.any(String));
    }
  });

  it('build beginnt mit tsc --noEmit und führt danach vite build aus', () => {
    const build = packageJson().scripts?.['build'] ?? '';
    expect(build.trimStart().startsWith('tsc --noEmit')).toBe(true);
    const tscAt = build.indexOf('tsc --noEmit');
    const viteAt = build.indexOf('vite build');
    expect(viteAt).toBeGreaterThan(tscAt);
  });

  it('test ruft vitest run auf (kein Watch-Modus)', () => {
    const test = packageJson().scripts?.['test'] ?? '';
    expect(test).toMatch(/\bvitest run\b/);
    expect(test).not.toMatch(/--watch\b/);
  });

  it('test:e2e ruft playwright test auf', () => {
    expect(packageJson().scripts?.['test:e2e'] ?? '').toMatch(/\bplaywright test\b/);
  });

  it('lint führt eslint . und prettier --check . aus', () => {
    const lint = packageJson().scripts?.['lint'] ?? '';
    expect(lint).toMatch(/\beslint \.(\s|$)/);
    expect(lint).toMatch(/\bprettier --check \.(\s|$)/);
  });

  it('react und react-dom haben die Hauptversion 18 (deklariert und installiert)', () => {
    const deps = packageJson().dependencies ?? {};
    for (const name of ['react', 'react-dom']) {
      expect(deps[name], `${name} in dependencies`).toMatch(/^[\^~]?18\./);
      const installed = readJson(path.join('node_modules', name, 'package.json')) as {
        version: string;
      };
      expect(installed.version.split('.')[0], `${name} installiert`).toBe('18');
    }
  });
});

describe('R-02 TypeScript (tsconfig-Seite)', () => {
  it('effektive Konfiguration hat strict, noUncheckedIndexedAccess und noImplicitOverride', () => {
    const options = showConfig().compilerOptions ?? {};
    expect(options['strict']).toBe(true);
    expect(options['noUncheckedIndexedAccess']).toBe(true);
    expect(options['noImplicitOverride']).toBe(true);
  });

  it('resolveJsonModule ist aktiv und der Alias @/* zeigt auf src/*', () => {
    const options = showConfig().compilerOptions ?? {};
    expect(options['resolveJsonModule']).toBe(true);
    const alias = options.paths?.['@/*'] ?? [];
    expect(alias.map((entry) => entry.replace(/^\.\//, ''))).toContain('src/*');
  });

  it('tests/fixtures ist nicht Teil des TypeScript-Projekts', () => {
    const files = showConfig().files ?? [];
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.replace(/^\.\//, '').startsWith('tests/fixtures/'))).toBe(
      false,
    );
  });
});

describe('R-06 Schema-Kopie', () => {
  it('src/trace/trace.schema.json ist JSON-tief gleich dem Contract-Artifact', () => {
    const copy = readJson('src/trace/trace.schema.json');
    const contract = readJson('.sdd/contracts/data/trace-serialization-format-v1.schema.json');
    expect(copy).toEqual(contract);
  });
});

describe('R-07 Formatierung', () => {
  it('prettier --check . endet mit Exit-Code 0', () => {
    const result = spawnSync(
      process.execPath,
      [nodeModule('prettier', 'bin', 'prettier.cjs'), '--check', '.'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 60_000);

  it('.prettierrc.json legt den Projektstil fest', () => {
    expect(readJson('.prettierrc.json')).toMatchObject({
      singleQuote: true,
      semi: true,
      printWidth: 100,
      trailingComma: 'all',
    });
  });

  it('.prettierignore schließt Fixtures, .sdd und Build-Ausgaben aus', () => {
    const ignore = readFileSync(path.join(repoRoot, '.prettierignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\/$/, ''));
    for (const entry of ['tests/fixtures', '.sdd', 'dist', 'playwright-report', 'test-results']) {
      expect(ignore, entry).toContain(entry);
    }
  });
});
