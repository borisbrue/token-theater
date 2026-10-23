---
id: CON-0024
project: ""                # PRJ-XXXX
title: "Probe and probe report format v1"
type: data
format: json-schema
spec: SPEC-0012
version: 0.1.0
status: approved
artifact: ".sdd/contracts/data/probe-format-v1.schema.json"
tests: ["TST-0027", "TST-0028"]
---

# Contract: Probe and probe report format v1

> **Spec:** SPEC-0012 · **Typ:** Daten (JSON Schema) · **Status:** approved

## Zweck

Beschreibt zwei JSON-Formate: die **Sonde** (`*.probe.json`, Liste von Prompt-Paaren mit
Zielwörtern; liest `probe.py`) und den **Sonden-Bericht** (`*.probe-report.json`; schreibt
`probe.py`, zeigt die Ansicht „Sonde“). Ein Schema mit `$defs/Probe` und `$defs/ProbeReport`,
unterschieden über `kind` (`"probe"` bzw. `"probe-report"`). `src/probe/probe-format.schema.json`
ist eine inhaltsgleiche Kopie des Artifacts.

Das Schema prüft die Struktur, die Regeln unten die Zusammenhänge. Beides zusammen definiert
„gültige Sonde“ bzw. „gültiger Bericht“.

## Regeln der Sonde

- **PB-01 Eindeutige Paare:** Die `id` der Paare sind paarweise verschieden. Befund am zweiten
  Vorkommen, `path` `/pairs/<i>/id`.
- **PB-02 Verschiedene Ziele:** Die `targets` eines Paars sind paarweise verschieden. Befund
  `/pairs/<i>/targets/<j>` am zweiten Vorkommen.

## Regeln des Berichts

Toleranz `tol(x) = 1e-4 · max(1, |x|)`.

- **RP-01 Eindeutige Paare:** wie PB-01.
- **RP-02 log-Verhältnis:** Bei genau zwei Zielen sind `logRatioA` und `logRatioB` Zahlen, sonst
  beide `null`. Sind `pA` beider Ziele größer als 0, gilt
  `|logRatioA − ln(pA₀ / pA₁)| ≤ tol(logRatioA)`, für B entsprechend. Befund
  `/pairs/<i>/logRatioA` bzw. `…/logRatioB`.
- **RP-03 Umschwung:** `flip` ist `null` genau dann, wenn `logRatioA` `null` ist; sonst
  `flip = (logRatioA > 0 und logRatioB < 0) oder (logRatioA < 0 und logRatioB > 0)`. Befund
  `/pairs/<i>/flip`.
- **RP-04 Zusammenfassung:** `summary.pairs` ist die Zahl der Paare (`/summary/pairs`),
  `summary.flips` die Zahl der Paare mit `flip = true` (`/summary/flips`);
  `meanAbsLogRatioShift` ist der Mittelwert von `|logRatioB − logRatioA|` über die Paare mit
  Zahlen (Toleranz `tol`), `null` genau dann, wenn es keine gibt (`/summary/meanAbsLogRatioShift`).
- **RP-05 Ranglisten:** `topA` und `topB` sind nach `prob` absteigend (gleich erlaubt). Befund
  `/pairs/<i>/topA/<j>` am ersten Eintrag, der größer ist als sein Vorgänger.

## Import-Fehler

Wie CON-0001: Die Kette parse → version → schema → semantic bricht beim ersten Glied ab, das
fehlschlägt, mit `ProbeImportError` (`kind` `parse`, `version`, `schema` oder `semantic`,
`errors` als Liste `{ path, message, rule? }`, höchstens 50).

| kind | Wann | errors |
|---|---|---|
| `parse` | kein JSON oder Wurzel kein Objekt | genau 1, `path: ""` |
| `version` | `schemaVersion` fehlt oder ist nicht 1 | genau 1, `path: "/schemaVersion"` |
| `schema` | Verstoß gegen `$defs/Probe` bzw. `$defs/ProbeReport` | alle Verstöße, `path` als JSON Pointer |
| `semantic` | Verstoß gegen PB-xx bzw. RP-xx | alle Verstöße, `rule` `PB-01` … `RP-05` |

## Validierung

- TST-0027 (`tests/unit/probe-format.test.ts`): Schema-Kopie, gültige und ungültige Beispiele,
  jede Regel mit Befund und Pfad.
- TST-0028 (`tests/unit/probe-tools.test.ts`): Beispielsonden und Bericht-Fixture sind gültig.

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Erstfassung (SPEC-0012) |
