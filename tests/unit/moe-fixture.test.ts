// TST-0025 · CON-0023 EX-01..EX-08: uv-Projekt des Python-Exporters und sein Fixture, ohne Python.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  AttentionStation,
  LogitsStation,
  MoeStation,
  ResidualStation,
  Station,
  Trace,
} from '@/trace/types';
import { deserializeTrace, serializeTrace } from '@/trace/serialize';

import { add, expectClose } from './helpers/engine-setup';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const exportDir = join(repoRoot, 'scripts/moe-export');
const FIXTURE_PATH = join(repoRoot, 'tests/fixtures/moe/tiny-granitemoe.trace.json');
const TOL = 1e-4;

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');

/** Abschnitt `[name]` einer TOML-Datei bis zum nächsten Abschnittskopf. */
function tomlSection(toml: string, name: string): string {
  const lines = toml.split('\n');
  const start = lines.findIndex(
    (line) => line.trim() === `[${name}]` || line.trim() === `[[${name}]]`,
  );
  if (start < 0) return '';
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

let json: string;
let trace: Trace;

beforeAll(() => {
  json = readFileSync(FIXTURE_PATH, 'utf8');
  trace = deserializeTrace(json);
});

const ofKind = <K extends Station['kind']>(
  stations: readonly Station[],
  kind: K,
): Extract<Station, { kind: K }>[] =>
  stations.filter((s): s is Extract<Station, { kind: K }> => s.kind === kind);

function residual(stations: readonly Station[], layer: number, after: string): ResidualStation {
  const found = ofKind(stations, 'residual').find((s) => s.layer === layer && s.after === after);
  if (found === undefined) throw new Error(`residual ${layer} nach ${after} fehlt`);
  return found;
}

function softmax(values: readonly number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / total);
}

describe('EX-01 uv-Projekt', () => {
  it('EX-01: pyproject.toml mit Abhängigkeiten, CPU-Index für torch und dev-Gruppe', () => {
    const toml = read('scripts/moe-export/pyproject.toml');
    const project = tomlSection(toml, 'project');
    expect(project).toMatch(/requires-python\s*=/);
    for (const name of ['torch', 'transformers', 'safetensors']) {
      expect(project, name).toMatch(new RegExp(`["']${name}([<>=~! ].*)?["']`));
    }
    const index = tomlSection(toml, 'tool.uv.index');
    expect(index).toContain('https://download.pytorch.org/whl/cpu');
    expect(index).toMatch(/explicit\s*=\s*true/);
    const indexName = /name\s*=\s*"([^"]+)"/.exec(index)?.[1];
    expect(indexName).toBeDefined();
    const sources = tomlSection(toml, 'tool.uv.sources');
    expect(sources).toMatch(new RegExp(`torch\\s*=.*index\\s*=\\s*"${indexName ?? ''}"`));
    const groups = tomlSection(toml, 'dependency-groups');
    expect(groups).toMatch(/dev\s*=/);
    expect(groups).toContain('ruff');
    expect(groups).toContain('pytest');
  });

  it('EX-01: uv.lock mit torch, .python-version, kein requirements.txt oder setup.py', () => {
    expect(read('scripts/moe-export/uv.lock')).toContain('name = "torch"');
    expect(existsSync(join(exportDir, '.python-version'))).toBe(true);
    const files = readdirSync(exportDir);
    expect(files.filter((f) => /^requirements.*\.txt$/.test(f) || f === 'setup.py')).toEqual([]);
  });

  it('EX-01: .gitignore schließt die venv des Exporters aus', () => {
    const ignored = read('.gitignore')
      .split('\n')
      .map((line) => line.trim());
    expect(
      ignored.some((line) =>
        ['scripts/moe-export/.venv', 'scripts/moe-export/.venv/', '.venv', '.venv/'].includes(line),
      ),
    ).toBe(true);
  });
});

describe('EX-02 npm-Skript', () => {
  it('EX-02: export-moe ruft den Exporter über uv auf', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['export-moe']).toBe(
      'uv run --project scripts/moe-export scripts/moe-export/export_trace.py',
    );
  });
});

describe('EX-03 Kommandozeile und Adapter', () => {
  it('EX-03: Optionen und Adapter-Klassen im Quelltext', () => {
    const source = read('scripts/moe-export/export_trace.py');
    for (const option of [
      '--model',
      '--prompt',
      '--max-tokens',
      '--strategy',
      '--temperature',
      '--seed',
      '--top-n',
      '--lens-top-n',
      '--out',
      '--tiny-random',
    ]) {
      expect(source, option).toContain(`"${option}"`);
    }
    expect(source).toMatch(/^class GraniteMoeAdapter\b/m);
    expect(source).toMatch(/^class MixtralAdapter\b/m);
  });

  it('EX-03: ein Python-Test für nicht unterstützte Modelle liegt unter tests/', () => {
    const testDir = join(exportDir, 'tests');
    const files = readdirSync(testDir).filter((f) => /^test_.*\.py$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const sources = files.map((f) => readFileSync(join(testDir, f), 'utf8')).join('\n');
    expect(sources).toMatch(/unsupported|nicht unterstützt/i);
  });
});

describe('EX-04 Fixture: Kopf', () => {
  it('EX-04: Import ohne Befund und JSON-tief gleicher Re-Export', () => {
    expect(JSON.parse(serializeTrace(trace))).toEqual(JSON.parse(json));
  });

  it('EX-04: Engine, Fähigkeiten und Architektur', () => {
    expect(trace.engine.kind).toBe('transformers');
    expect(trace.engine.model).toBe('tiny-random-granitemoe');
    expect(trace.engine.capabilities).toEqual([
      'tokenize',
      'attention',
      'moe',
      'residual',
      'logits',
      'sample',
    ]);
    expect(trace.engine.architecture).toMatchObject({
      nLayers: 2,
      nHeads: 4,
      dModel: 64,
      dMlp: 32,
      nExperts: 4,
      topK: 2,
      vocabSize: 49152,
    });
  });

  it('EX-04: Lauf, Sampling und logits', () => {
    expect(trace.prompt).toBe('die katze sitzt');
    expect(trace.maxTokens).toBe(3);
    expect(trace.sampling.strategy).toBe('greedy');
    expect(['max-tokens', 'eos']).toContain(trace.finishReason);
    expect(trace.steps.length).toBeGreaterThan(0);
    for (const step of trace.steps) {
      const [logits] = ofKind(step.stations, 'logits');
      expect(logits?.distribution).toHaveLength(50);
      expect(logits?.coverage ?? 1).toBeLessThan(1);
    }
  });
});

describe('EX-05 Fixture: Residual-Summen', () => {
  it('EX-05: residual = voriger Strom + out, je Schritt und Layer', () => {
    for (const step of trace.steps) {
      for (const moe of ofKind(step.stations, 'moe')) {
        const before = residual(step.stations, moe.layer, 'attention');
        const after = residual(step.stations, moe.layer, 'moe');
        expectClose(after.stream.data, add(before.stream.data, moe.out.data), TOL);
      }
      for (const attention of ofKind(step.stations, 'attention')) {
        if (attention.layer === 0) continue;
        const before = residual(step.stations, attention.layer - 1, 'moe');
        const after = residual(step.stations, attention.layer, 'attention');
        expectClose(after.stream.data, add(before.stream.data, attention.out.data), TOL);
      }
    }
  });
});

describe('EX-06 Fixture: Routing und Gates', () => {
  it('EX-06: Top-2 der Router-Logits, Gates = Softmax der gewählten', () => {
    for (const step of trace.steps) {
      for (const moe of ofKind(step.stations, 'moe') as MoeStation[]) {
        moe.experts.forEach((chosen, i) => {
          const logits = Array.from(moe.routerLogits.data.subarray(i * 4, (i + 1) * 4));
          const top = logits
            .map((value, e) => ({ value, e }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 2)
            .map((entry) => entry.value);
          expect(chosen.map((e) => logits[e] ?? 0)).toEqual(top);
          const expected = softmax(chosen.map((e) => logits[e] ?? 0));
          (moe.gates[i] ?? []).forEach((g, j) =>
            expect(Math.abs(g - (expected[j] ?? 0))).toBeLessThanOrEqual(TOL),
          );
        });
      }
    }
  });
});

describe('EX-07 Fixture: Grouped-Query-Attention aufgefächert', () => {
  it('EX-07: k und v [n, 64], Köpfe einer KV-Gruppe gleich', () => {
    for (const step of trace.steps) {
      const n = step.newPositions[1] - step.newPositions[0];
      for (const attention of ofKind(step.stations, 'attention') as AttentionStation[]) {
        for (const tensor of [attention.k, attention.v]) {
          expect(tensor.shape).toEqual([n, 64]);
          for (let row = 0; row < n; row += 1) {
            const line = tensor.data.subarray(row * 64, (row + 1) * 64);
            expect(Array.from(line.subarray(0, 16))).toEqual(Array.from(line.subarray(16, 32)));
            expect(Array.from(line.subarray(32, 48))).toEqual(Array.from(line.subarray(48, 64)));
          }
        }
      }
    }
  });
});

describe('EX-08 Fixture: Logit-Lens', () => {
  it('EX-08: 5 Einträge nach moe, keine nach der Attention, letzte Lens = logits · coverage', () => {
    for (const step of trace.steps) {
      const residuals = ofKind(step.stations, 'residual');
      for (const station of residuals) {
        if (station.after === 'moe') expect(station.lens).toHaveLength(5);
        else expect('lens' in station).toBe(false);
      }
      const last = residuals.at(-1)?.lens ?? [];
      const [logits] = ofKind(step.stations, 'logits') as LogitsStation[];
      const coverage = logits?.coverage ?? 1;
      const top = logits?.distribution.slice(0, 5) ?? [];
      expect(last.map((c) => c.token.id)).toEqual(top.map((c) => c.token.id));
      last.forEach((c, j) =>
        expect(Math.abs(c.prob - (top[j]?.prob ?? 0) * coverage)).toBeLessThanOrEqual(TOL),
      );
    }
  });
});
