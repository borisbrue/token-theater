---
id: CON-0018
project: ""                # PRJ-XXXX
title: "Station views UI"
type: behavior
format: gherkin
spec: SPEC-0007
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/station-views-ui.feature"
tests: ["TST-0019"]
---

# Contract: Station views UI

> **Spec:** SPEC-0007 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt die Ansichten der Stationen `embed`, `attention`, `mlp` und `residual` fest: Bilder mit
Namen, Auswahl von Position und Kopf, KV-Cache-Zeilen, Werte unter der Maus, die Listen mit den
Kernaussagen und die Logit-Lens.

## Garantien

Die Szenarien im Artifact (`.sdd/contracts/behavior/station-views-ui.feature`) sind ausführbare
Spezifikation. Jedes Szenario ist ein Playwright-Test (Chromium), Testname = Szenariotitel
wörtlich; ein Abgleichtest prüft die Titel gegen die Feature-Datei.

## Invarianten

- **SU-01 Rollen statt Selektoren:** wie CON-0006 UI-01; Netzwerk nur über `page.route`. Werte
  unter der Maus prüft der Test über die Position in der Bounding Box der Canvas; `role="img"`
  und der Name sitzen deshalb direkt am `<canvas>`, nicht an einem umgebenden Element.
- **SU-02 Bestehende Contracts:** CON-0003, CON-0006, CON-0009, CON-0011, CON-0013 und CON-0015
  bestehen unverändert; jede Ansicht zeigt weiter die Liste „Tensoren“.
- **SU-03 Kein fremder Origin:** Request-Fixture aus `tests/e2e/helpers.ts`.
- **SU-04 Texte und Zahlen:** Texte aus `src/app/texts.ts`; Zahlen mit Dezimalkomma, Werte und
  Normen mit zwei, Prozent mit einer Nachkommastelle; negative Zahlen mit Bindestrich-Minus
  (U+002D, wie `formatDecimal`); Tokens überall sichtbar gemacht wie in CON-0009 TU-05, auch in
  den Texten unter der Maus.
- **SU-05 Tastatur:** Position und Kopf sind native Radio-Gruppen, „Frühere Schritte zeigen“ ist
  eine native Checkbox.

## Bedienelemente

| Element | Rolle und Name |
|---|---|
| Position | `radiogroup` „Position“, je Zeile ein `radio` „<Position> · <Token>“ |
| Kopf | `radiogroup` „Kopf“ mit `radio` „Kopf 0“ … „Kopf H−1“, „Mittel“ |
| Frühere Schritte | `checkbox` „Frühere Schritte zeigen“ (nur ab Schritt 1) |
| Vektor | `img` „<Titel> · <n> Werte“ (Token-Embedding, Positions-Embedding, Summe, Hidden, Residual Stream) |
| Heatmap | `img` „Attention · Layer l · Kopf h · R × C“ bzw. „Attention · Layer l · Mittel · R × C“ |
| Listen | `list` „Vektoren“, „Beachtete Tokens“, „Stärkste Neuronen“, „Verlauf“, „Logit-Lens“ |
| Hinweise | Texte „Skala: ±<Grenze>“, „Dimension i: <Wert>“, „„<Zeile>“ → „<Spalte>“: <Prozent>“ bzw. „: maskiert“, KV-Cache-Hinweis, Lens-Hinweise |

## Validierung

- Tests: TST-0019 (`tests/e2e/station-views.spec.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.1.0 | Erstfassung |
| 2026-10-22 | 0.2.0 | Review: Canvas trägt Rolle und Namen, Maus-Text mit ␣, Bindestrich-Minus, Mock-Lauf und Export/Import definiert, Tastatur-Szenario, präzisere Lens-Positions-Prüfung |
