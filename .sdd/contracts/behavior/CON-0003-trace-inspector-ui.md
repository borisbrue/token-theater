---
id: CON-0003
project: ""                # PRJ-XXXX
title: "Trace inspector UI"
type: behavior
format: gherkin
spec: SPEC-0001
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/trace-inspector-ui.feature"
tests: ["TST-0003"]
---

# Contract: Trace inspector UI

> **Spec:** SPEC-0001 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt das beobachtbare Verhalten der ersten Oberfläche fest, des
Trace-Inspectors (SPEC-0001 FR-10): Erzeugen mit der Mock-Engine (Greedy,
Sampling-Seed 42, `weightSeed` 1234), Anzeige der Schritte und Stationen, Export
und Import samt Fehlermeldungen. Der Inspector ist ein Debug- und Lernwerkzeug.
Die eigentlichen Visualisierungen folgen ab SPEC-0002.

## Garantien

Die im Artifact (`.sdd/contracts/behavior/trace-inspector-ui.feature`)
hinterlegten Szenarien sind **ausführbare Spezifikation**. Jedes Szenario ist
durch einen Playwright-Test (Chromium) abgedeckt, Testname = Szenariotitel
wörtlich. Beim Szenariogrundriss heißt jeder Test
`"<Titel> (eingabe=<eingabe>)"`, leere Eingabe als `(eingabe=)`.

## Invarianten (über alle Szenarien hinweg)

- **UI-01 Zugängliche Bedienelemente:** Alle Bedienelemente sind über ihre
  sichtbare Beschriftung per Rolle auffindbar (`getByRole` / `getByLabel`) und
  per Tastatur erreichbar. Tests nutzen keine CSS-Selektoren und keine Test-IDs.
- **UI-02 Fehler verdrängen keinen Trace:** Ein fehlgeschlagener Import ändert den
  angezeigten Trace nicht. Die Fehlermeldung steht in genau einem Element mit
  `role="alert"`. Sie verschwindet beim nächsten erfolgreichen Erzeugen oder
  Import.
- **UI-03 Texte zentral:** Alle sichtbaren Texte und Fehlermeldungen stammen aus
  `src/app/texts.ts`. Die App bildet `TraceImportError.kind` und `errors` auf diese
  Texte ab, technische Meldungen aus `src/trace` erscheinen nur als Detailzeilen.
- **UI-04 Kein fremder Origin:** Die Seite stellt keine Anfragen an einen anderen
  Origin als den des Dev- bzw. Preview-Servers. Der Test zeichnet alle Requests auf
  und prüft das.
- **UI-05 Max. Tokens:** Beim Verlassen des Felds wird der Wert auf eine Ganzzahl
  abgerundet und auf 1–32 begrenzt. Ein leeres oder nicht-numerisches Feld fällt
  auf 8 zurück.

## Fehlermeldungen (`texts.ts`)

| Fall | Meldung (erste Zeile) | Detailzeilen |
|------|------------------------|--------------|
| `parse` | "Die Datei ist kein gültiges JSON." | keine |
| `version`, Feld fehlt | "Die Datei enthält keine Trace-Version (schemaVersion)." | keine |
| `version`, anderer Wert `v` | "Trace-Version {v} wird nicht unterstützt." | keine |
| `schema` | "Die Datei entspricht nicht dem Trace-Format." | je Fehler `"{path}: {message}"`, höchstens 5, danach "… und {n} weitere" |
| `semantic` | "Der Trace ist inkonsistent." | je Fehler `"{path} ({invariant}): {message}"`, höchstens 5, danach "… und {n} weitere" |

## Bedienelemente

| Element | Rolle / Erkennung | Beschriftung |
|---------|-------------------|--------------|
| Überschrift | `heading`, Ebene 1 | "Token Theater" |
| Prompt | `textbox` | "Prompt" |
| Max. Tokens | `spinbutton` | "Max. Tokens" |
| Erzeugen | `button` | "Erzeugen" |
| Trace exportieren | `button` | "Trace exportieren" |
| Trace importieren | Datei-Eingabe (`input type=file`, `accept=".json,application/json"`) mit Label | "Trace importieren" |
| Erzeugter Text | `region`, Name "Erzeugter Text" | `text` des letzten Schritts, bei 0 Schritten `prompt` |
| Schritte | `list`, Name "Schritte", je Schritt ein `listitem` mit `heading` Ebene 2 "Schritt n" und darunter einer `list` der Stationen | |
| Stationszeile | `listitem` der Stationsliste: `kind`, bei Layer-Stationen `" · Layer {l}"`, danach je Tensor `" · {name} [{shape}]"` in Feldreihenfolge des Schemas | z. B. "attention · Layer 0 · lnIn [3, 8] · q [3, 8] · k [3, 8] · v [3, 8] · weights [2, 3, 3] · out [3, 8]" |
| Fehlermeldung | `alert` | siehe Tabelle Fehlermeldungen |

Shapes werden als `[a, b, c]` mit Komma und Leerzeichen dargestellt. Der
Dateiname beim Export ist `<trace.id>.trace.json`. In der App erzeugt
`crypto.randomUUID()` die `id` (erlaubt in `src/app`, CON-0004 R-04).
