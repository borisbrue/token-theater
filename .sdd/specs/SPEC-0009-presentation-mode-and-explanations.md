---
id: SPEC-0009
title: "Presentation mode and explanations"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-22
updated: 2026-10-22
version: 0.2.1
priority: high          # low | medium | high | critical
tags: [ui, presentation, explanations, milestone-m3]
depends_on: ["SPEC-0002", "SPEC-0005", "SPEC-0007"]
contracts: ["CON-0020", "CON-0013"]
tests: ["TST-0022", "TST-0014"]
fr_test_map:
  FR-01: [TST-0022]
  FR-02: [TST-0022]
  FR-03: [TST-0022]
  FR-04: [TST-0022]
  FR-05: [TST-0022]
  FR-06: [TST-0022, TST-0014]
  FR-07: [TST-0022]
---

# Presentation mode and explanations

> **Status:** implemented · **Owner:** Boris · **Version:** 0.2.1
> Grundlage: `.sdd/docs/architecture/vision.md` (Zweck „Vortrag/Unterricht“ und „Selbstlernen“,
> Meilenstein M3 „vorführbar“)

## 1. Kontext & Motivation

Die App rechnet und zeigt inzwischen alles, was ein Transformer tut (SPEC-0001 bis SPEC-0008).
Vorführen lässt sie sich aber schlecht. Ein Blick auf die Oberfläche nach einem Lauf mit
distilgpt2 (1440 × 1000, 2026-10-22) zeigt:

- **Die Bühne liegt unter der Falz.** Oben stehen Prompt, Engine- und Sampling-Einstellungen
  (≈ 900 px), darunter „Erzeugter Text“, erst dann Tokenstrom, Station und Transportleiste. Unter
  dem Player folgt die lange Liste „Details“ mit allen Tensorformen. Wer vorträgt, muss scrollen,
  das Publikum sieht Formulare.
- **„Erzeugter Text“ verrät das Ende.** Er zeigt in Schritt 0 schon den ganzen Text („The cat sat
  on the floor of the house, and“), während der Tokenstrom noch bei „the ?“ steht.
- **Leerzeichen sind im Tokenstrom unsichtbar.** Die tokenize-Station zeigt „␣cat“, der
  Tokenstrom „cat“. Dass GPT-2 das Leerzeichen zum Wort zählt, ist eine der ersten Aha-Stellen im
  Vortrag; im Tokenstrom geht sie verloren.
- **Erklärtexte sind je ein Satz.** Für Selbstlernende reicht das nicht. Sie erfahren weder, wie
  viele Köpfe oder Layer das Modell hat, noch was „nach Attention“ und „nach MLP“ unterscheidet.
- **Server-Läufe sagen nicht, warum Stationen fehlen.** Ein Lauf über einen Server hat nur
  tokenize, logits und sample. Die Vision verlangt, dass die Ansichten das ausdrücklich sagen,
  statt Stationen still wegzulassen.
- **Präsentations-Fernbedienungen** („Clicker“) senden `PageDown`/`PageUp`; die App reagiert
  bisher nur auf Pfeiltasten.

## 2. Zielsetzung

**Primärziel:** Ein Präsentationsmodus, der nur die Bühne zeigt (Tokenstrom, Station,
Transportleiste) und sich mit Tastatur oder Clicker bedienen lässt, dazu ausführlichere
Erklärtexte und klare Hinweise, was ein Trace enthält.

**Erfolgskriterien (messbar):**
- [ ] Im Präsentationsmodus passen Tokenstrom, Stationsüberschrift und Transportleiste bei 1280 × 720 ohne Scrollen auf die Seite; Formular, „Erzeugter Text“ und „Details“ sind nicht vorhanden.
- [ ] Der Tokenstrom ist im Präsentationsmodus mindestens 1,5× so groß wie sonst (berechnete Schriftgröße).
- [ ] Ein- und Ausschalten per Knopf und Taste (`p`, `Esc`), Weiterschalten mit `PageDown`/`PageUp` in beiden Modi.
- [ ] Jede Station hat unter dem bisherigen Satz einen aufklappbaren Abschnitt „Mehr dazu“; die Texte für Attention, Logits und Residual nennen die Zahlen des Modells, wenn der Trace sie kennt.
- [ ] Ein Server-Lauf zeigt einen Hinweis, dass Interna fehlen und wo es sie gibt.
- [ ] Der Tokenstrom zeigt Leerraum wie die tokenize-Station (`␣`, `↵`, `⇥`).
- [ ] Bestehende Contracts bleiben erfüllt (CON-0013 mit einer Anpassung, siehe §9).

**Nicht-Ziele:**
- Geführte Tour, Sprechernotizen, zweiter Bildschirm für Vortragende.
- Vollbild-API: F11 bzw. die Vollbildtaste des Browsers genügen.
- Trace-Export als float16: Tensoren sind schon Base64 (Float32); ein distilgpt2-Lauf mit
  8 Tokens hat wenige MB. Bei Bedarf später.
- Neue Ansichten, Animationen zwischen Stationen, eigene Schriftarten.
- Anzeige des Rechenkerns (SPEC-0008) in der Oberfläche.
- Mehrsprachigkeit: Die Texte bleiben Deutsch.

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/app/App.tsx                Modus run | presentation (State), Knopf „Präsentation“, Tasten p/Esc
src/app/presentation/          Hook usePresentationKeys, Bühnen-Layout (PresentationStage)
src/app/player/Player.tsx      bekommt das Layout als Prop; Hinweis ohne Interna; Architektur an StationView
src/app/player/use-playback-keys.ts  PageDown/PageUp
src/app/texts.ts               Präsentation, „Mehr dazu“, Hinweis, Texte mit Modellzahlen
src/app/theme/presentation.css Bühne: Schriftgrößen, Höhe 100vh, scrollende Stationsfläche
src/views/station/StationView.tsx  „Mehr dazu“ (<details>), Text je Station mit Modellzahlen
src/views/station/explanation.ts   ModelFacts, modelFacts(architecture)
src/views/station/internals.ts     INTERNAL_KINDS, lacksInternals(capabilities)
src/views/token-stream/TokenStream.tsx  displayText (SPEC-0003)
```

`src/views` bleibt ohne Importe aus `src/app` (CON-0004); die Erklärtexte kommen weiter als
Labels herein, jetzt als Funktionen der Station und der Architektur.

### 3.2 Präsentationsmodus

- **Zustand:** `mode: 'explore' | 'presentation'` in `App` (React-State, nicht gespeichert). Der
  Präsentationsmodus ist nur mit Trace erreichbar; verschwindet der Trace (neuer Lauf läuft,
  Fehler), bleibt der Modus, die Bühne zeigt dann nichts außer der Leiste mit „Präsentation
  beenden“.
- **Einschalten:** Knopf „Präsentation“ neben „Trace exportieren“ (nur mit Trace aktiv) oder
  Taste `p` (nicht in Eingabefeldern, ohne Modifier, nur mit Trace).
- **Ausschalten:** Knopf „Präsentation beenden“ oder `Esc` (bzw. `p`). Der Cursor bleibt, wo er
  war.
- **Aufbau:** `<main data-mode="presentation">` mit einer schmalen Kopfzeile (App-Titel klein,
  Position „Schritt s · Station i / n · Name“, Knopf „Präsentation beenden“), darunter
  Tokenstrom, Station und Transportleiste. Formular, Ansichtswechsel, „Erzeugter Text“,
  Fehlermeldungen des Formulars und „Details“ werden **nicht gerendert** (nicht nur versteckt).
- **Layout:** Die Bühne ist genau so hoch wie das Fenster (`100dvh`, Flex-Spalte). Tokenstrom und
  Transportleiste haben ihre natürliche Höhe; die Station füllt den Rest und scrollt in sich.
  So bleibt die Transportleiste immer sichtbar, auch wenn eine Attention-Heatmap hoch ist.
- **Größe:** Auf der Bühne gilt eine größere Schriftskala (`--tt-stage-scale`, 1,5 für den
  Tokenstrom, 1,25 für Stationstexte); Farben unverändert aus dem Theme.
- **Fokus:** Beim Einschalten bekommt die Bühne den Fokus (`tabIndex=-1`), damit Tasten sofort
  wirken und kein Formularfeld mehr fokussiert ist. Beim Ausschalten bekommt der Knopf
  „Präsentation“ den Fokus.

**Koordination:** `App` hält den Modus und setzt alle Regeln an einer Stelle um (nur mit Trace,
Fokus beim Wechsel, Cursor bleibt). Knopf, Tasten-Hook und Bühne melden nur an `App`.
Muster: [Mediator](https://refactoring.guru/design-patterns/mediator), wie die Auswahl im Player
(SPEC-0007). Ein State-Pattern wäre für zwei Modi mit reinem Layout-Unterschied zu schwer (§12).
Der Player bekommt `layout: 'explore' | 'stage'` und rendert dieselben Bausteine; die Ausprägung
steckt im CSS über `main[data-mode]`.

### 3.3 Tasten

| Taste | Modus | Wirkung |
|---|---|---|
| `PageDown` | beide | Station vor (wie `→`) |
| `PageUp` | beide | Station zurück (wie `←`) |
| `p` | beide, nur mit Trace | Präsentationsmodus an/aus |
| `Esc` | Präsentation | Präsentationsmodus aus |

Wie bisher (CON-0006 UI-04): keine Kürzel in Eingabefeldern, keine mit Alt/Strg/Meta.
`commandForKey` ([Command](https://refactoring.guru/design-patterns/command), SPEC-0002) bekommt
die beiden Seitentasten; `p`/`Esc` übersetzt ein eigener Hook in `src/app/presentation/` in die
Kommandos `toggle` und `exit`, weil sie keine Wiedergabe-Kommandos sind. Beide Hooks nutzen
dieselbe Filterregel (CON-0006 UI-04), ausgelagert als `ignoredTarget` in
`src/app/player/use-playback-keys.ts`.

### 3.4 Erklärtexte

Jede Station hat wie bisher einen Satz (unverändert, bestehende Tests prüfen ihn) und darunter
`<details>` mit der Zusammenfassung „Mehr dazu“ (geschlossen) und 2–4 Sätzen. Satz und „Mehr
dazu“ rendert `StationView` einheitlich direkt unter der Überschrift; die Renderer (SPEC-0003,
0004, 0007) zeigen den Satz nicht mehr selbst. Zahlen mit Tausenderpunkt („50.257“,
`formatInteger` neben `formatDecimal` in `src/views/distribution/format.ts`, ohne
Locale-Abhängigkeit). Die verbindlichen Sätze stehen in CON-0020. Die Texte sind
Funktionen `(station, architecture | null) => string`:

- **tokenize:** BPE in einem Satz; Leerzeichen gehört zum folgenden Wort (`␣`); Vokabulargröße,
  falls bekannt („Das Vokabular hat 50.257 Tokens.“).
- **embed:** Token-Embedding als Zeile einer Tabelle, Positions-Embedding, Summe; Breite
  („Jeder Vektor hat 768 Zahlen.“).
- **attention:** Query/Key/Value in Alltagssprache, kausale Maske, Köpfe und Layer („Dieses
  Modell hat 12 Köpfe in jedem seiner 6 Layer.“), KV-Cache in einem Satz.
- **residual nach Attention / nach MLP:** zwei Texte; der Strom als „Notizblock“, der Layer für
  Layer ergänzt wird; nach dem MLP der Verweis auf die Logit-Lens.
- **mlp:** Erweiterung auf `dMlp` Neuronen, GELU, Rückprojektion („768 → 3072 → 768“).
- **logits:** Projektion auf das Vokabular, Softmax; bei Server-Traces der Hinweis, dass nur die
  gelieferten Kandidaten bekannt sind.
- **sample:** Greedy, Temperatur, Top-k, Top-p in je einem Halbsatz; Verweis auf das Sampling-Labor der logits-Station.

Ohne Architektur (`trace.engine.architecture` ist `null`) entfallen die Zahlen, die Sätze
bleiben grammatisch vollständig.

Schnittstelle: `src/views/station/explanation.ts` definiert den schmalen Typ
`ModelFacts = { vocabSize, dModel, dMlp, nHeads, nLayers }` (Teilmenge von `Architecture` aus
`src/trace/types`, das `src/views` schon importieren darf) und `modelFacts(architecture)`.
`StationView` bekommt `facts: ModelFacts | null` und in den Labels die Funktion
`more: (station: Station, facts: ModelFacts | null) => string`, die `src/app/texts.ts` liefert.
Muster: [Factory Method](https://refactoring.guru/design-patterns/factory-method) wie die
Renderer-Fabriken aus SPEC-0003/0004/0007: Die App bindet die Texte, die Views bekommen fertige
Funktionen und importieren nichts aus `src/app`.

### 3.5 Hinweis bei Traces ohne Interna

Die Entscheidung trifft eine reine Funktion `lacksInternals(capabilities)` in
`src/views/station/internals.ts` über der Konstante `INTERNAL_KINDS = ['embed', 'attention',
'mlp', 'residual']`; eine neue interne Station kommt nur dort hinzu. Fehlt in
`trace.engine.capabilities` eine dieser Stationen,
zeigt die Wiedergabe über der Stationsleiste den Hinweis „Dieser Lauf zeigt nur Tokens und
Wahrscheinlichkeiten. Ein Server liefert keine Interna wie Attention oder MLP; die zeigt die
Engine „GPT-2 (Browser)“.“ (`role="note"`). In beiden Modi.

### 3.6 Tokenstrom

`TokenStream` zeigt `displayText(token.text)` (SPEC-0003, `src/views/tokenization/
token-display.ts`): Leerzeichen `␣`, Zeilenumbruch `↵`, Tab `⇥`. Die Mock-Tokens enthalten keinen
Leerraum, ihre Tests ändern sich nicht. Ein Server-Prompt steht als ein Eintrag im Strom; er wird
ebenso sichtbar gemacht („Die␣Katze␣sitzt␣auf␣dem“), CON-0013 wird angepasst.

### 3.7 Festlegungen für die test-first geschriebenen Tests

- Ein Akzeptanztest je Szenario aus `presentation-ui.feature` (CON-0020), Testname =
  Szenariotitel, plus Abgleichtest; GPT-2-Testmodell per `page.route` wie TST-0016/TST-0019;
  Server-Lauf mit den Fixtures aus TST-0014.
- DOM: Knopf „Präsentation“, „Präsentation beenden“; `main[data-mode]`; Region „Bühne“
  (`<section aria-label="Bühne">`) im Präsentationsmodus; `<details>` mit Zusammenfassung
  „Mehr dazu“ in der Region „Station“; `role="note"` für den Hinweis.

## 4. Funktionale Anforderungen

- **FR-01:** Präsentationsmodus nach 3.2: Ein- und Ausschalten per Knopf, Zustand in `App`, nur mit Trace; im Modus nur Kopfzeile, Tokenstrom, Station, Transportleiste.
- **FR-02:** Bühnen-Layout nach 3.2: Fensterhöhe, scrollende Station, Transportleiste sichtbar, größere Schrift, Fokus beim Wechsel.
- **FR-03:** Tasten nach 3.3: `PageDown`/`PageUp` in beiden Modi, `p` und `Esc` für den Modus.
- **FR-04:** Erklärtexte „Mehr dazu“ je Station nach 3.4, mit Modellzahlen aus der Architektur.
- **FR-05:** Hinweis bei Traces ohne Interna nach 3.5.
- **FR-06:** Tokenstrom mit sichtbarem Leerraum nach 3.6.
- **FR-07:** Alle neuen Texte in `src/app/texts.ts`, Farben nur aus dem Theme, `src/views` ohne `src/app`; bestehende Contracts bleiben erfüllt (mit den Anpassungen aus §9).

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                                   | um ...                                                   |
|-------|----------------|------------------------------------------------------------------|----------------------------------------------------------|
| US-01 | Vortragende/r  | mit einem Tastendruck in eine aufgeräumte, große Bühne wechseln  | dem Publikum nur das Modell zu zeigen, keine Formulare    |
| US-02 | Vortragende/r  | mit meinem Clicker Station für Station weiterschalten            | frei vor dem Publikum zu stehen                          |
| US-03 | Lernende/r     | zu jeder Station mehr erfahren, mit den Zahlen dieses Modells    | zu verstehen, was dort passiert und wie groß es ist      |
| US-04 | Lernende/r     | erfahren, warum ein Server-Lauf keine Attention zeigt            | nicht zu glauben, die App sei kaputt                     |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung |
|-----------------|-------------|
| Bedienbarkeit   | Präsentation bei 1280 × 720 ohne Seiten-Scrollen; Transportleiste immer sichtbar |
| Barrierefreiheit | Modus per Knopf und Taste; Fokus wandert beim Wechsel; Hinweis als `role="note"`; `<details>` nativ bedienbar |
| Theme           | Farben nur aus `src/app/theme` (CON-0007 T-03); Größen über CSS-Variablen |
| Architektur     | `src/views` ohne Importe aus `src/app` und `src/engine` (CON-0004) |
| Performance     | Moduswechsel ohne Neuberechnung des Traces (der Playback-Zustand bleibt) |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: Präsentationsmodus

  Scenario: Bühne ohne Formular
    Given ein Lauf mit dem GPT-2-Testmodell
    When ich auf "Präsentation" klicke
    Then gibt es kein Prompt-Feld, keine Region "Erzeugter Text" und keine Überschrift "Details"
    And sind Tokenstrom, Station und Wiedergabe ohne Scrollen sichtbar

  Scenario: Clicker schaltet weiter
    Given der Präsentationsmodus nach einem Lauf
    When ich PageDown drücke
    Then steht die Wiedergabe auf Station 2
```

Die verbindlichen Szenarien stehen im Contract (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Kein Trace: Knopf „Präsentation“ deaktiviert, `p` wirkt nicht.
- `p` im Prompt-Feld tippt ein „p“ und schaltet nichts um.
- Import eines Traces während der Präsentation ist nicht möglich (Formular fehlt); `Esc` führt
  zurück.
- Trace mit einem Schritt und ohne Interna (Server): Bühne mit Hinweis, Stationen tokenize,
  logits, sample.
- Sehr hohe Station (Attention mit 64 Tokens): scrollt innerhalb der Bühne, die Transportleiste
  bleibt stehen.
- Architektur `null` (importierter oder Server-Trace): Erklärtexte ohne Zahlen.

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0020 | behavior (gherkin) | Präsentationsmodus, Bühne, Tasten, „Mehr dazu“ mit und ohne Modellzahlen, Hinweis ohne Interna, Leerraum im Tokenstrom |
| CON-0013 | behavior (gherkin) | v0.2.0: Der Server-Prompt im Tokenstrom erscheint mit sichtbarem Leerraum („Die␣Katze␣sitzt␣auf␣dem“); sonst unverändert |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0022 | acceptance | CON-0020, alle Szenarien, GPT-2-Testmodell per `page.route`, Lauf ohne Interna per Import |
| TST-0014 | acceptance | CON-0013 v0.2.0 (angepasste Erwartung an den Tokenstrom) |

## 11. Implementierungsreihenfolge

Ein Task, eine Testsuite: Alle FRs liegen in der Oberfläche und greifen ineinander (Layout,
Tasten, Texte). Getrennte Suiten würden sich beim GREEN-Gate gegenseitig blockieren.

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | Präsentationsmodus, Tasten, Erklärtexte, Hinweis, Tokenstrom | FR-01–FR-07 | `tests/e2e/presentation.spec.ts` | `src/app/**`, `src/views/**` |

## 12. Offene Fragen

- [x] Eigene Route (`#/praesentation`) oder Zustand? **Antwort (2026-10-22, autonom entschieden):** Zustand in `App`. Eine Route müsste den Trace über einen Neuladen hinweg halten, den die App nicht speichert; der Moduswechsel soll den Playback-Zustand nicht berühren.
- [x] State-Pattern für die Modi? **Antwort (2026-10-22, autonom entschieden):** nein. Zwei Modi unterscheiden sich nur im Layout; ein Diskriminator und ein Layout-Prop sind einfacher und testbar.
- [x] „Erzeugter Text“ an den Cursor koppeln oder ausblenden? **Antwort (2026-10-22, autonom entschieden):** Im Erkunden-Modus bleibt er das Ergebnis des Laufs (sechs bestehende Szenarien prüfen ihn so); auf der Bühne fehlt er, dort erzählt der Tokenstrom.
- [x] float16-Export jetzt? **Antwort (2026-10-22, autonom entschieden):** nein, siehe Nicht-Ziele.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-22 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-22 | 0.2.0   | Boris  | Review: Mediator (App), Command (Tasten), Factory Method (Erklärtexte), schmaler Typ `ModelFacts`, `lacksInternals` mit `INTERNAL_KINDS`; Contracts CON-0020, CON-0013 v0.2.0 |
| 2026-10-22 | 0.2.1   | Boris  | Implementiert; Bühne mit `PresentationStage`, kompakte Transportleiste (Kürzelzeile aus, Stationsleiste einzeilig scrollend) nach Live-Abnahme bei 1280 × 720 |
