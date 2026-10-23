# language: de
Funktionalität: Ansichten der Glaskasten-Stationen
  Als Lernende/r oder Vortragende/r
  möchte ich Embedding, Attention, MLP und Residual Stream als Bild und als Text sehen
  um zu verstehen, was in jedem Layer eines Transformers passiert

  # Modell-Server wie in gpt2-ui.feature (CON-0015): Playwright liefert "<Origin>/models/**" mit
  # dem Testmodell aus tests/fixtures/gpt2/. "GPT-2-Lauf" = in der Gruppe "Engine" die Option
  # "GPT-2 (Browser)" wählen, Prompt "Die Katze sitzt", Max. Tokens 3, "Erzeugen", warten bis die
  # Gruppe "Zeitleiste" 3 Knöpfe hat. Kontext-Tokens von Schritt 0: 0 "Die", 1 " Kat", 2 "ze",
  # 3 " sit", 4 "z", 5 "t"; Schritt 1 hängt 6 "inth" an. Tokens erscheinen sichtbar gemacht
  # (Leerzeichen als "␣", CON-0009 TU-05).
  # "Schritt s, Station X" = in der Gruppe "Zeitleiste" den Knopf s + 1 und in der Gruppe
  # "Stationen" den Knopf X wählen. Alle Texte beziehen sich auf die Region "Station".
  # Erwartete Zahlen stammen aus transformers (tiny-gpt2.golden.json, tiny-gpt2.lens.json).
  # "Mock-Lauf" = Engine "Mock" (Default), Prompt "die katze sitzt", Max. Tokens 2, "Erzeugen",
  # warten bis die Gruppe "Zeitleiste" 2 Knöpfe hat; die MockEngine hat 2 Layer, 2 Köpfe, D = 8,
  # M = 32 (CON-0002), der Prompt ergibt 3 Tokens. "Trace exportieren" und "Trace importieren"
  # wie CON-0003; der Test ändert das exportierte JSON selbst.
  # Bilder: role="img" und der Name sitzen direkt am <canvas>; die Mausposition rechnet der Test
  # aus dessen Bounding Box.
  # Zeichenflächen: Die Canvas einer Heatmap umfasst genau ihre Felder (gleich große Zellen, Zeilen
  # von oben nach unten in der Reihenfolge der Matrix, Spalten von links nach rechts); die Canvas
  # eines Vektorstreifens umfasst genau seine Werte (von links nach rechts, eine Zeile).
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Embedding mit drei Vektoren
    Angenommen ein GPT-2-Lauf
    Wenn ich Schritt 0, Station "embed" öffne
    Dann hat die Gruppe "Position" 6 Optionen und "5 · t" ist gewählt
    Und gibt es die Bilder "Token-Embedding · 8 Werte", "Positions-Embedding · 8 Werte" und "Summe · 8 Werte"
    Und zeigt die Liste "Vektoren" "Token-Embedding ‖v‖ = 1,90", "Positions-Embedding ‖v‖ = 1,02" und "Summe ‖v‖ = 1,76"
    Und zeigt die Region den Text "Skala: ±1,04"
    Und enthält die Liste "Tensoren" "sum [6, 8]"

  Szenario: Position im Embedding wählen
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "embed"
    Wenn ich in der Gruppe "Position" "1 · ␣Kat" wähle
    Dann zeigt die Liste "Vektoren" "Summe ‖v‖ = 2,11"

  Szenario: Wert unter der Maus im Vektorstreifen
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "embed"
    Wenn ich mit der Maus über den ersten Wert des Bilds "Summe · 8 Werte" fahre
    Dann zeigt die Region den Text "Dimension 0: -0,59"

  Szenario: Attention-Heatmap von Kopf 0
    Angenommen ein GPT-2-Lauf
    Wenn ich Schritt 0, Station "attention · Layer 0" öffne
    Dann ist in der Gruppe "Kopf" "Kopf 0" gewählt und sie hat die Optionen "Kopf 0", "Kopf 1" und "Mittel"
    Und gibt es das Bild "Attention · Layer 0 · Kopf 0 · 6 × 6"
    Und zeigt die Liste "Beachtete Tokens" der Reihe nach "0 · Die 35,5 %", "4 · z 22,5 %" und "3 · ␣sit 20,7 %"
    Und gibt es keine Checkbox "Frühere Schritte zeigen"

  Szenario: Kopf wechseln und Mittel
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "attention · Layer 1"
    Wenn ich in der Gruppe "Kopf" "Kopf 1" wähle
    Dann gibt es das Bild "Attention · Layer 1 · Kopf 1 · 6 × 6"
    Und zeigt die Liste "Beachtete Tokens" der Reihe nach "0 · Die 63,2 %", "1 · ␣Kat 24,9 %" und "4 · z 4,5 %"
    Wenn ich in der Gruppe "Kopf" "Mittel" wähle
    Dann gibt es das Bild "Attention · Layer 1 · Mittel · 6 × 6"
    Und zeigt die Liste "Beachtete Tokens" der Reihe nach "0 · Die 33,2 %", "3 · ␣sit 23,9 %" und "5 · t 14,7 %"

  Szenario: Zeile der Heatmap wählen
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "attention · Layer 0"
    Wenn ich in der Gruppe "Position" "0 · Die" wähle
    Dann zeigt die Liste "Beachtete Tokens" genau einen Eintrag "0 · Die 100,0 %"

  Szenario: Feld unter der Maus in der Heatmap
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "attention · Layer 0"
    Wenn ich mit der Maus über das Feld in Zeile 5, Spalte 0 des Bilds "Attention · Layer 0 · Kopf 0 · 6 × 6" fahre
    Dann zeigt die Region den Text "„t“ → „Die“: 35,5 %"
    Wenn ich mit der Maus über das Feld in Zeile 5, Spalte 1 fahre
    Dann zeigt die Region den Text "„t“ → „␣Kat“: 0,5 %"
    Wenn ich mit der Maus über das Feld in Zeile 0, Spalte 5 fahre
    Dann zeigt die Region den Text "„Die“ → „t“: maskiert"

  Szenario: KV-Cache-Zeilen im Folgeschritt
    Angenommen ein GPT-2-Lauf
    Wenn ich Schritt 1, Station "attention · Layer 1" öffne
    Dann ist die Checkbox "Frühere Schritte zeigen" angehakt
    Und gibt es das Bild "Attention · Layer 1 · Kopf 0 · 7 × 7"
    Und zeigt die Region den Text "Nur die neue Zeile wurde berechnet. Die Zeilen darüber stammen aus früheren Schritten (KV-Cache)."
    Und hat die Gruppe "Position" genau die Option "6 · inth"
    Und zeigt die Liste "Beachtete Tokens" der Reihe nach "5 · t 36,7 %", "3 · ␣sit 28,3 %" und "2 · ze 14,2 %"
    Wenn ich die Checkbox "Frühere Schritte zeigen" abhake
    Dann gibt es das Bild "Attention · Layer 1 · Kopf 0 · 1 × 7"

  Szenario: MLP-Aktivierungen
    Angenommen ein GPT-2-Lauf
    Wenn ich Schritt 0, Station "mlp · Layer 0" öffne
    Dann gibt es das Bild "Hidden · 32 Werte"
    Und zeigt die Region den Text "Aktiv (> 0): 17 von 32"
    Und zeigt die Liste "Stärkste Neuronen" der Reihe nach "#18 3,45", "#29 3,29", "#9 2,44", "#7 2,11" und "#16 2,01"
    Und zeigt die Liste "Vektoren" "Eingang ‖v‖ = 3,13" und "Ausgang ‖v‖ = 11,33"

  Szenario: Verlauf des Residual Stream
    Angenommen ein GPT-2-Lauf
    Wenn ich Schritt 0, Station "residual · Layer 1 · nach MLP" öffne
    Dann gibt es das Bild "Residual Stream · 8 Werte"
    Und zeigt die Liste "Verlauf" der Reihe nach "embed ‖x‖ = 1,76", "Layer 0 · nach Attention ‖x‖ = 4,13 (Δ 3,81)", "Layer 0 · nach MLP ‖x‖ = 8,95 (Δ 11,33)", "Layer 1 · nach Attention ‖x‖ = 11,70 (Δ 8,02)" und "Layer 1 · nach MLP ‖x‖ = 12,24 (Δ 5,20)"
    Und trägt nur der letzte Eintrag der Liste "Verlauf" aria-current="true"

  Szenario: Logit-Lens nach dem MLP
    Angenommen ein GPT-2-Lauf
    Wenn ich Schritt 0, Station "residual · Layer 0 · nach MLP" öffne
    Dann zeigt die Liste "Logit-Lens" 5 Einträge, der erste beginnt mit "␣annoying"
    Wenn ich Station "residual · Layer 1 · nach MLP" öffne
    Dann beginnt der erste Eintrag der Liste "Logit-Lens" mit "inth" und endet mit "0,7 %"

  Szenario: Hinweis nach der Attention
    Angenommen ein GPT-2-Lauf
    Wenn ich Schritt 0, Station "residual · Layer 0 · nach Attention" öffne
    Dann gibt es keine Liste "Logit-Lens"
    Und zeigt die Region den Text "Die Logit-Lens gibt es nach jedem MLP."

  Szenario: Logit-Lens gilt für die letzte Position
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "residual · Layer 1 · nach MLP"
    Wenn ich in der Gruppe "Position" "0 · Die" wähle
    Dann zeigt die Region den Text "Die Logit-Lens gilt für die letzte Position."
    Und zeigt die Liste "Verlauf" als ersten Eintrag "embed ‖x‖ = 1,51"
    Und zeigt die Liste "Logit-Lens" weiter 5 Einträge, der erste beginnt mit "inth"

  Szenario: Kopf per Tastatur wählen
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "attention · Layer 0"
    Wenn ich den Fokus auf "Kopf 0" setze und die Pfeiltaste nach rechts drücke
    Dann ist in der Gruppe "Kopf" "Kopf 1" gewählt
    Und gibt es das Bild "Attention · Layer 0 · Kopf 1 · 6 × 6"

  Szenario: Auswahl bleibt beim Stationswechsel
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "embed"
    Wenn ich in der Gruppe "Position" "2 · ze" wähle und Station "attention · Layer 0" öffne
    Dann ist in der Gruppe "Position" "2 · ze" gewählt
    Wenn ich in der Gruppe "Kopf" "Kopf 1" wähle und Station "attention · Layer 1" öffne
    Dann ist in der Gruppe "Kopf" "Kopf 1" gewählt
    Wenn ich Schritt 1, Station "attention · Layer 1" öffne
    Dann ist in der Gruppe "Position" "6 · inth" gewählt und in der Gruppe "Kopf" "Kopf 1"

  Szenario: Neuer Lauf setzt die Auswahl zurück
    Angenommen ein GPT-2-Lauf und Schritt 0, Station "attention · Layer 0" mit "Kopf 1" und Position "2 · ze"
    Wenn ich erneut "Erzeugen" klicke und Schritt 0, Station "attention · Layer 0" öffne
    Dann ist in der Gruppe "Kopf" "Kopf 0" gewählt und in der Gruppe "Position" "5 · t"

  Szenario: Mock-Lauf zeigt alle Ansichten
    Wenn ich einen Mock-Lauf erzeuge und Schritt 0 öffne
    Dann gibt es in Station "embed" das Bild "Summe · 8 Werte"
    Und gibt es in Station "attention · Layer 0" das Bild "Attention · Layer 0 · Kopf 0 · 3 × 3"
    Und gibt es in Station "mlp · Layer 1" das Bild "Hidden · 32 Werte"
    Und zeigt in Station "residual · Layer 1 · nach MLP" die Liste "Logit-Lens" 5 Einträge

  Szenario: Importierter Trace ohne Logit-Lens
    Angenommen ich habe einen Mock-Lauf erzeugt und mit "Trace exportieren" heruntergeladen
    Wenn ich das JSON ohne alle Felder "lens" über "Trace importieren" lade und Schritt 0, Station "residual · Layer 0 · nach MLP" öffne
    Dann gibt es keine Liste "Logit-Lens"
    Und zeigt die Region den Text "Dieser Trace enthält keine Logit-Lens."
