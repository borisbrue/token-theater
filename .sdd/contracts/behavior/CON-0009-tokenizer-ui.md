---
id: CON-0009
project: ""                # PRJ-XXXX
title: "Tokenizer UI"
type: behavior
format: gherkin
spec: SPEC-0003
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/tokenizer-ui.feature"
tests: ["TST-0010"]
---

# Contract: Tokenizer UI

> **Spec:** SPEC-0003 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt die sichtbare Tokenisierung fest: Umschalter „Durchlauf | Tokenizer“, Tokenizer-Werkbank
(Textfeld, Kennzahlen, Tokenliste, IDs, BPE-Schritte, Laden und Fehler) und die Ansicht der
tokenize-Station im Player. CON-0003 und CON-0006 bleiben unverändert gültig.

## Garantien

Die Szenarien im Artifact (`.sdd/contracts/behavior/tokenizer-ui.feature`) sind ausführbare
Spezifikation. Jedes Szenario ist ein Playwright-Test (Chromium), Testname = Szenariotitel
wörtlich. Ein Abgleichtest prüft die Titel gegen die Feature-Datei.

## Invarianten

- **TU-01 Rollen statt Selektoren:** wie CON-0006 UI-01. Ausnahmen (`evaluate`,
  `getComputedStyle`, `boundingBox`) nur in „Benachbarte Tokens haben verschiedene Farben“ und
  „Token-Knöpfe sind groß genug“. Netzwerk-Eingriffe nur über `page.route`.
- **TU-02 Bestehende Contracts:** Alle Szenarien aus CON-0003 und CON-0006 bestehen unverändert.
- **TU-03 Kein fremder Origin:** wie CON-0006 UI-03 (Request-Fixture aus `tests/e2e/helpers.ts`).
- **TU-04 Texte:** Alle sichtbaren Texte stammen aus `src/app/texts.ts` (CON-0004 R-05).
- **TU-05 Anzeige:** Leerzeichen `␣`, Zeilenumbruch `↵`, Tabulator `⇥`, Wagenrücklauf `␍`;
  Bytes ohne gültiges UTF-8 als `<HH HH>` (Hex, Großbuchstaben). Gilt für Tokenliste,
  Merge-Symbole und die Überschrift der BPE-Schritte.

## Bedienelemente

| Element | Rolle / Erkennung | Name |
|---|---|---|
| Ansicht | `group` "Ansicht" mit zwei `button` (`aria-pressed`) | "Durchlauf", "Tokenizer" |
| Werkbank | `region` "Tokenizer" (nur in der Ansicht „Tokenizer“) | – |
| Textfeld | `textbox` mit Label "Text" (`textarea`, `maxlength` 1000) | – |
| Kennzahlen | `list` "Kennzahlen" mit `listitem` "n Zeichen", "n Bytes", "n Tokens" | – |
| Tokenliste | `list` "Tokens"; je Token ein `listitem`, dessen `innerText` mit zu einem Leerzeichen zusammengefasstem Leerraum genau `<Anzeigetext> <ID>` ist (Anzeigetext und ID also getrennte Textblöcke); in der Werkbank und bei Traces mit `bpe` enthält jeder Eintrag einen `button` mit `aria-pressed` | – |
| IDs | Text: IDs mit je einem Leerzeichen getrennt | – |
| Hinweis | Text "Wähle ein Token, um seine BPE-Schritte zu sehen." solange nichts gewählt ist | – |
| BPE-Schritte | `region` "BPE-Schritte" mit `heading` Ebene 3 "BPE-Schritte für „<Anzeigetext des Pre-Tokens>“" und `list` "Merges"; Eintrag 1 beginnt mit "Start", Eintrag i+1 enthält "Merge i · Rang r" und die Symbole | – |
| Laden | Text "GPT-2-Vokabular wird geladen …" | – |
| Fehler | `alert` "Das GPT-2-Vokabular konnte nicht geladen werden." und `button` "Erneut versuchen" | – |
| tokenize-Station | in `region` "Station": Erklärtext, `list` "Tokens"; ohne `bpe` keine Knöpfe und Text "Dieser Trace enthält keine BPE-Schritte." | – |

## Validierung

- Tests: TST-0010 (`tests/e2e/tokenizer.spec.ts`)
