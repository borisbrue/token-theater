# language: de
Funktionalität: Präsentationsmodus und Erklärtexte
  Als Vortragende/r oder Lernende/r
  möchte ich eine aufgeräumte Bühne, Clicker-Tasten und ausführliche Erklärtexte
  um die Arbeit des Modells vorführen und verstehen zu können

  # "Mock-Lauf" = Engine "Mock" (Default), Prompt "die katze sitzt", Max. Tokens 2, "Erzeugen",
  # warten bis die Gruppe "Zeitleiste" 2 Knöpfe hat. Ein Schritt der MockEngine hat in Schritt 0
  # 12 Stationen: tokenize, embed, je Layer 0 und 1 attention, residual (nach Attention), mlp,
  # residual (nach MLP), dann logits und sample (CON-0002).
  # "GPT-2-Lauf" wie station-views-ui.feature (CON-0018): Testmodell per page.route vom eigenen
  # Origin, Engine "GPT-2 (Browser)", Prompt "Die Katze sitzt", Max. Tokens 3; Kontext-Tokens von
  # Schritt 0: "Die", " Kat", "ze", " sit", "z", "t". Testmodell: 2 Layer, 2 Köpfe, D = 8, M = 32,
  # V = 50257.
  # "Lauf ohne Interna" = Mock-Lauf, "Trace exportieren", im JSON engine.capabilities auf
  # ["tokenize", "logits", "sample"] und engine.architecture auf null setzen, aus jedem Schritt
  # alle Stationen außer tokenize, logits und sample entfernen, dann "Trace importieren".
  # "Position" = Text der ersten Zeile der Region "Station" ("Schritt s · Station i / n").
  # "Bühne" = Region "Bühne" (<section aria-label="Bühne">), nur im Präsentationsmodus vorhanden.
  # "Modus" = Attribut data-mode des <main>: "explore" oder "presentation".
  # Tasten werden gedrückt, während kein Eingabefeld fokussiert ist (vorher Klick auf die
  # Überschrift "Token Theater"), außer wo ein Feld genannt ist.
  # Zahlen in Erklärtexten mit Tausenderpunkt ("50.257").
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Präsentation erst mit Trace
    Dann ist der Knopf "Präsentation" deaktiviert und der Modus "explore"
    Wenn ich die Taste "p" drücke
    Dann ist der Modus "explore"
    Wenn ein Mock-Lauf fertig ist
    Dann ist der Knopf "Präsentation" aktiv

  Szenario: Bühne ohne Formular
    Angenommen ein Mock-Lauf
    Wenn ich auf "Präsentation" klicke
    Dann ist der Modus "presentation"
    Und gibt es kein Feld "Prompt", keine Region "Erzeugter Text", keine Überschrift "Details" und keine Gruppe "Ansicht"
    Und enthält die Bühne die Regionen "Tokenstrom", "Station" und "Wiedergabe" und den Knopf "Präsentation beenden"
    Und hat die Bühne den Fokus

  Szenario: Bühne passt in 1280 × 720
    Angenommen das Fenster ist 1280 × 720 groß und ein GPT-2-Lauf
    Wenn ich auf "Präsentation" klicke und in der Gruppe "Stationen" "attention · Layer 0" wähle
    Dann ist die Seite nicht höher als das Fenster
    Und liegen der Tokenstrom, die Überschrift der Region "Station" und die Transportleiste vollständig im Fenster

  Szenario: Größere Schrift auf der Bühne
    Angenommen ein Mock-Lauf
    Und die Schriftgröße des ersten Eintrags im Tokenstrom ist gemerkt
    Wenn ich auf "Präsentation" klicke
    Dann ist die Schriftgröße des ersten Eintrags im Tokenstrom mindestens 1,5-mal so groß

  Szenario: Ein- und Ausschalten per Taste
    Angenommen ein Mock-Lauf
    Wenn ich die Taste "p" drücke
    Dann ist der Modus "presentation"
    Wenn ich die Taste "Escape" drücke
    Dann ist der Modus "explore" und der Knopf "Präsentation" hat den Fokus
    Wenn ich die Taste "p" zweimal drücke
    Dann ist der Modus "explore"

  Szenario: Taste p im Prompt-Feld
    Angenommen ein Mock-Lauf
    Wenn ich im Feld "Prompt" ans Ende "p" tippe
    Dann ist der Modus "explore" und das Feld "Prompt" enthält "die katze sitztp"

  Szenario: Präsentation beenden per Knopf
    Angenommen ein Mock-Lauf und der Präsentationsmodus
    Wenn ich auf "Präsentation beenden" klicke
    Dann ist der Modus "explore", es gibt das Feld "Prompt" und die Region "Erzeugter Text"
    Und hat der Knopf "Präsentation" den Fokus

  Szenario: Cursor bleibt beim Moduswechsel
    Angenommen ein Mock-Lauf
    Wenn ich zweimal "Station vor" klicke und dann auf "Präsentation"
    Dann ist die Position "Schritt 0 · Station 3 / 12"
    Wenn ich die Taste "Escape" drücke
    Dann ist die Position "Schritt 0 · Station 3 / 12"

  Szenario: Clicker auf der Bühne
    Angenommen ein Mock-Lauf und der Präsentationsmodus
    Wenn ich die Taste "PageDown" zweimal drücke
    Dann ist die Position "Schritt 0 · Station 3 / 12"
    Wenn ich die Taste "PageUp" drücke
    Dann ist die Position "Schritt 0 · Station 2 / 12"

  Szenario: Clicker im Erkunden-Modus
    Angenommen ein Mock-Lauf
    Wenn ich die Taste "PageDown" drücke
    Dann ist die Position "Schritt 0 · Station 2 / 12" und der Modus "explore"
    Wenn ich die Taste "PageUp" drücke
    Dann ist die Position "Schritt 0 · Station 1 / 12"

  Szenario: Mehr dazu ist zugeklappt
    Angenommen ein Mock-Lauf
    Dann enthält die Region "Station" eine Aufklappgruppe "Mehr dazu", die geschlossen ist
    Und steht der bisherige Erklärtext "Der Text wird in Tokens zerlegt: Wörter oder Satzzeichen mit einer festen Nummer." direkt unter der Überschrift
    Wenn ich auf "Mehr dazu" klicke
    Dann ist die Aufklappgruppe offen und enthält "Ein Leerzeichen gehört zum folgenden Wort und erscheint als „␣“."

  Szenariogrundriss: Mehr dazu mit den Zahlen des Modells
    Angenommen ein GPT-2-Lauf
    Wenn ich in der Gruppe "Stationen" "<station>" wähle und "Mehr dazu" öffne
    Dann enthält die Aufklappgruppe "<satz>"

    Beispiele:
      | station                       | satz                                                   |
      | tokenize                      | Das Vokabular hat 50.257 Tokens.                       |
      | embed                         | Jeder Vektor hat 8 Zahlen.                             |
      | attention · Layer 0           | Dieses Modell hat 2 Köpfe in jedem seiner 2 Layer.     |
      | residual · Layer 0 · nach Attention | Der Residual Stream ist wie ein Notizblock, der durch alle Layer gereicht wird. |
      | mlp · Layer 1                 | Hier: 8 → 32 → 8 Zahlen.                               |
      | residual · Layer 1 · nach MLP | Die Logit-Lens zeigt, welches Token das Modell vorhersagen würde, wenn es hier aufhörte. |
      | logits                        | Bewertet werden alle 50.257 Tokens des Vokabulars.     |
      | sample                        | Greedy nimmt immer das wahrscheinlichste Token.        |

  Szenario: Mehr dazu ohne Modellzahlen
    Angenommen ein Lauf ohne Interna
    Wenn ich in der Gruppe "Stationen" "logits" wähle und "Mehr dazu" öffne
    Dann enthält die Aufklappgruppe "Ist das Modell unbekannt (etwa bei einem Server), kennt der Trace nur die gelieferten Kandidaten."
    Und enthält sie nicht "Bewertet werden alle"
    Wenn ich "tokenize" wähle und "Mehr dazu" öffne
    Dann enthält die Aufklappgruppe nicht "Das Vokabular hat"

  Szenario: Hinweis bei einem Lauf ohne Interna
    Angenommen ein Lauf ohne Interna
    Dann zeigt die Region "Wiedergabe" einen Hinweis (role="note") mit dem Text "Dieser Lauf zeigt nur Tokens und Wahrscheinlichkeiten. Ein Server liefert keine Interna wie Attention oder MLP; die zeigt die Engine „GPT-2 (Browser)“."
    Und hat die Gruppe "Stationen" 3 Knöpfe
    Wenn ich auf "Präsentation" klicke
    Dann zeigt die Bühne denselben Hinweis

  Szenario: Kein Hinweis mit Interna
    Angenommen ein Mock-Lauf
    Dann gibt es in der Region "Wiedergabe" keinen Hinweis (role="note")

  Szenario: Tokenstrom zeigt Leerzeichen
    Angenommen ein GPT-2-Lauf
    Dann zeigt der Tokenstrom die Einträge "Die", "␣Kat", "ze", "␣sit", "z", "t" und "?"
    Wenn ich auf "Zum Ende" klicke
    Dann hat der letzte Eintrag des Tokenstroms keinen Leerraum außer "␣", "↵" oder "⇥"
