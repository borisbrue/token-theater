# language: de
Funktionalität: Token Theater auf dem Smartphone
  Als Besucher/in mit einem Smartphone
  möchte ich die App ohne Zoomen bedienen und mich durch einen Lauf wischen
  um zu sehen, wie ein Sprachmodell rechnet, auch unterwegs

  # "Smartphone" = Fenster 390 × 844 mit Touch und mobilem Viewport (Playwright: hasTouch, isMobile,
  # deviceScaleFactor 3, Chromium); "schmales Smartphone" = 360 × 740. "Mock-Lauf" = Prompt
  # "die katze sitzt", Max. Tokens 2, Tipp auf "Erzeugen", warten bis die Gruppe "Zeitleiste"
  # 2 Knöpfe hat. "Seite nicht breiter als das Fenster" = documentElement.scrollWidth ≤ innerWidth.
  # "Wisch" = PointerEvents vom Typ touch (pointerdown, pointermove, pointerup) über dem Element
  # ".station-view", 120 px waagerecht in 200 ms. Status = Region role="status" des Players.
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenariogrundriss: Keine waagerechte Seite
    Angenommen ein <gerät>
    Wenn ich nacheinander die Ansichten "Durchlauf" (vor und nach einem Mock-Lauf, Stationen "attention · Layer 0", "mlp · Layer 0" und "logits"), "Tokenizer", "Glossar", "Vergleich" mit einem Vergleichstrace und "Sonde" mit dem Bericht-Fixture öffne
    Dann ist die Seite jedes Mal nicht breiter als das Fenster

    Beispiele:
      | gerät                |
      | Smartphone           |
      | schmales Smartphone  |

  Szenario: Einspaltige Steuerung
    Angenommen ein Smartphone
    Dann steht jedes Label der Steuerung ("Prompt", "Max. Tokens") über seinem Feld
    Und ist das Feld "Prompt" mindestens 280 px breit
    Und liegen alle Radios der Gruppe "Engine" ganz im Fenster
    Und lässt sich "Erzeugen" antippen (kein anderes Element liegt über seiner Mitte)

  Szenario: Ansicht-Knöpfe vollständig
    Angenommen ein schmales Smartphone
    Dann liegt jeder Knopf der Gruppe "Ansicht" ganz im Fenster
    Und schneidet keiner seine Beschriftung ab (scrollWidth ≤ clientWidth)

  Szenario: Touch-Ziele
    Angenommen ein Smartphone und ein Mock-Lauf
    Dann sind alle sichtbaren Knöpfe der Gruppe "Ansicht", der Region "Wiedergabe" und alle Radio-Chips mindestens 44 × 44 px groß
    Und ist der Absatz ".shortcuts" nicht sichtbar

  Szenario: Transportleiste bleibt erreichbar
    Angenommen ein Smartphone und ein Mock-Lauf
    Wenn ich zur Überschrift der Region "Station" scrolle
    Dann liegen die Knöpfe "Station vor" und "Abspielen" ganz im Fenster am unteren Rand
    Wenn ich ans Ende der Seite scrolle
    Dann liegt das letzte Element der Region "Details" über der Transportleiste

  Szenario: Wischen über die Station
    Angenommen ein Smartphone und ein Mock-Lauf auf Station 1 von Schritt 0
    Wenn ich über die Station nach links wische
    Dann meldet der Status "Schritt 0 · Station 2 von 12 · embed"
    Wenn ich über die Station nach rechts wische
    Dann meldet der Status "Schritt 0 · Station 1 von 12 · tokenize"

  Szenario: Senkrechter Zug schaltet nicht
    Angenommen ein Smartphone und ein Mock-Lauf auf Station 1 von Schritt 0
    Wenn ich über die Station 40 px waagerecht und 120 px senkrecht ziehe
    Dann zeigt die Station weiter die Überschrift "tokenize"

  Szenario: Wisch in einer Eingabe zählt nicht
    Angenommen ein Smartphone und ein Mock-Lauf auf der Station "logits"
    Wenn ich auf dem Regler "Labor-Temperatur" nach links wische
    Dann zeigt die Station weiter die Überschrift "logits"

  Szenario: Tippen zeigt den Wert der Heatmap
    Angenommen ein Smartphone und ein Mock-Lauf auf der Station "attention · Layer 0"
    Wenn ich auf die Mitte der Heatmap tippe
    Dann ist ".readout" der Heatmap nicht leer und bleibt nach dem Tipp stehen

  Szenario: Begriff als Blatt
    Angenommen ein Smartphone und ein Mock-Lauf auf der Station "attention · Layer 0"
    Wenn ich in der Liste "Begriffe" auf den letzten Begriff tippe
    Dann liegt die Erklärung (role="tooltip") ganz im Fenster, links und rechts mindestens 8 px vom Rand

  Szenariogrundriss: Bühne auf dem Smartphone
    Angenommen ein Smartphone im <format> und ein Mock-Lauf
    Wenn ich auf "Präsentation" tippe
    Dann ist die Seite nicht höher und nicht breiter als das Fenster
    Und liegen die Überschrift der Region "Station" und der Knopf "Station vor" ganz im Fenster
    Wenn ich über die Station nach links wische
    Dann meldet der Status "Station 2 von 12"

    Beispiele:
      | format                 |
      | Hochformat 390 × 844   |
      | Querformat 844 × 390   |

  Szenario: Desktop unverändert
    Angenommen das Fenster ist 1280 × 720 groß ohne Touch und ein Mock-Lauf
    Dann ist ".shortcuts" sichtbar
    Und sind die Transportknöpfe nicht fixiert (position nicht "fixed")
