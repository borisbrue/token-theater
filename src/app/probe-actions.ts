import { parseReport, ProbeImportError } from '../probe/import';
import type { ProbeReport } from '../probe/types';
import { texts } from './texts';
import { limitDetails, type ErrorView } from './trace-actions';

/** Import eines Sonden-Berichts für die Ansicht „Sonde“ (SPEC-0012 §3.5). */

export type ReportImportResult =
  | { ok: true; report: ProbeReport }
  | { ok: false; error: ErrorView };

function versionText(content: string): string {
  try {
    const version = (JSON.parse(content) as Record<string, unknown>)['schemaVersion'];
    if (version === undefined) return texts.probe.errors.versionMissing;
    return texts.probe.errors.versionUnsupported(
      typeof version === 'number' ? String(version) : JSON.stringify(version),
    );
  } catch {
    return texts.probe.errors.versionMissing;
  }
}

/** Bildet ProbeImportError auf die Texte aus SPEC-0012 §3.6 ab. */
export function describeReportError(error: ProbeImportError, content: string): ErrorView {
  switch (error.kind) {
    case 'parse':
      return { message: texts.probe.errors.parse, details: [] };
    case 'version':
      return { message: versionText(content), details: [] };
    case 'schema':
      return {
        message: texts.probe.errors.schema,
        details: limitDetails(error.errors.map((e) => `${e.path}: ${e.message}`)),
      };
    case 'semantic':
      return {
        message: texts.probe.errors.semantic,
        details: limitDetails(
          error.errors.map((e) => `${e.path} (${e.rule ?? '?'}): ${e.message}`),
        ),
      };
  }
}

export function importReport(content: string): ReportImportResult {
  try {
    return { ok: true, report: parseReport(content) };
  } catch (error) {
    if (error instanceof ProbeImportError) {
      return { ok: false, error: describeReportError(error, content) };
    }
    throw error;
  }
}
