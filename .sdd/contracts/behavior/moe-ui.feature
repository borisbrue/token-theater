# language: de
Funktionalität: MoE-Routing in der App
  Als Lernende/r oder Vortragende/r
  möchte ich sehen, welche Experten ein Mixture-of-Experts-Modell für jedes Token wählt
  um zu verstehen, wie ein MoE-Layer rechnet

  # "Mock-MoE-Lauf": Radio "Mock-MoE" in der Gruppe "Engine", Prompt "die katze sitzt",
  # Max. Tokens 2, "Erzeugen", warten bis die Gruppe "Zeitleiste" 2 Knöpfe hat. Schritt 0 hat 12
  # Stationen: tokenize, embed, je Layer 0 und 1 attention, residual · nach Attention, moe,
  # residual · nach MoE, dann logits und sample. Architektur: 4 Experten, Top-2.
  # "Fixture-Lauf": Import von tests/fixtures/moe/tiny-granitemoe.trace.json (CON-0023 EX-05).
  # "24-Layer-Lauf": Import eines im Test gebauten MoE-Traces (tests/e2e/moe-trace-helpers.ts):
  # 1 Schritt, 2 Prompt-Tokens, 24 Layer, 8 Experten, Top-2, Stationen tokenize, je Layer
  # attention, residual, moe, residual, dann logits und sample.
  # "Station wählen" = Knopf mit diesem Namen in der Gruppe "Stationen".
  # "Position wählen" = Radio mit diesem Namen in der Gruppe "Position" der Region "Station".
  # "Routing" = Tabelle mit caption "Routing" in der Region "Station"; "Alle Layer" = Tabelle mit
  # caption "Experten dieses Tokens in allen Layern"; "Gewählte Experten" = Liste mit aria-label
  # "Gewählte Experten". Zeilen ohne Kopfzeile; "gewählt" = Zelle mit der Klasse "chosen".
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Mock-MoE liefert MoE-Stationen
    Angenommen ein Mock-MoE-Lauf
    Dann hat die Gruppe "Stationen" die Knöpfe "moe · Layer 0" und "residual · Layer 0 · nach MoE"
    Und gibt es keinen Knopf "mlp · Layer 0"
    Und zeigt der Knopf "moe · Layer 1" den Text "X1"

  Szenario: Routing-Tabelle
    Angenommen ein Mock-MoE-Lauf
    Wenn ich die Station "moe · Layer 0" wähle
    Dann hat "Routing" die Spaltenköpfe "E0", "E1", "E2" und "E3"
    Und hat "Routing" die Zeilenköpfe "0 · die", "1 · katze" und "2 · sitzt"
    Und hat jede Zeile von "Routing" genau 2 gewählte Zellen mit einem Text "<Zahl> %"
    Und ergeben die Prozentwerte jeder Zeile zusammen 99 bis 101
    Und hat jede Zelle ein aria-label "Experte <e>: Router <p> %" und gewählte Zellen dazu ", gewählt, Gate <g> %"
    Und hat die Zeile "2 · sitzt" die Klasse "selected"

  Szenario: Gewählte Experten des Tokens
    Angenommen ein Mock-MoE-Lauf
    Wenn ich die Station "moe · Layer 0" wähle
    Dann hat "Gewählte Experten" 2 Einträge "Experte <e> · <g> %", absteigend nach g
    Und sind es die gewählten Experten der Zeile "2 · sitzt" mit denselben Prozentwerten
    Und steht darunter "Summe der Gates: 100 %"
    Wenn ich die Position "1 · katze" wähle
    Dann hat die Zeile "1 · katze" die Klasse "selected"
    Und sind die Einträge von "Gewählte Experten" die gewählten Experten der Zeile "1 · katze"

  Szenario: Token durch alle Layer verfolgen
    Angenommen ein Mock-MoE-Lauf
    Wenn ich die Station "moe · Layer 1" wähle und die Position "1 · katze" wähle
    Dann hat "Alle Layer" die Zeilenköpfe "Layer 0" und "Layer 1"
    Und hat genau die Zeile "Layer 1" die Klasse "current"
    Und sind die gewählten Zellen der Zeile "Layer 1" dieselben Experten mit denselben Prozentwerten wie in der Zeile "1 · katze" von "Routing"
    Und hat die Zeile "Layer 0" genau 2 gewählte Zellen

  Szenario: Layer-Karte eines MoE-Laufs
    Angenommen ein Mock-MoE-Lauf
    Wenn ich die Station "moe · Layer 0" wähle
    Dann hat die Gruppe "Layer 0" der Layer-Karte die Kurztexte "A", "+", "X" und "+"
    Und hat genau das Kästchen "moe · Layer 0" aria-current="step"

  Szenariogrundriss: Teil im MoE-Layer
    Angenommen ein Mock-MoE-Lauf
    Wenn ich die Station "<station>" wähle
    Dann lautet die Zeile ".layer-part" "<zeile>"

    Beispiele:
      | station                       | zeile                                                                     |
      | moe · Layer 0                 | Layer 0 · Teil 3 von 4: Der Router schickt jedes Token an wenige Experten. |
      | residual · Layer 1 · nach MoE | Layer 1 · Teil 4 von 4: Sein Ergebnis wird addiert; der Layer ist fertig.  |

  Szenario: Texte der moe-Station
    Angenommen ein Mock-MoE-Lauf
    Wenn ich die Station "moe · Layer 1" wähle
    Dann lautet der Erklärsatz ("h2 + p") "Statt eines einzigen MLP hat dieser Layer viele Experten. Ein Router wählt für jedes Token wenige davon aus und mischt ihre Ergebnisse nach Gate-Gewichten."
    Und enthält die Liste "Begriffe" genau die Knöpfe "Mixture of Experts", "Router", "Experte", "Gate-Gewicht" und "LayerNorm"
    Wenn ich "Mehr dazu" öffne
    Dann enthält "Mehr dazu" "Dieses Modell hat 4 Experten je MoE-Layer; je Token rechnen 2 davon."
    Und enthält die Liste "Tensoren" "lnIn [3, 8]", "routerLogits [3, 4]" und "out [3, 8]"

  Szenario: Erklärung eines MoE-Begriffs
    Angenommen ein Mock-MoE-Lauf
    Wenn ich die Station "moe · Layer 0" wähle und in der Liste "Begriffe" auf "Router" klicke
    Dann lautet die Erklärung "Router Eine kleine lineare Schicht, die für jedes Token eine Bewertung je Experte berechnet. Die Experten mit den höchsten Bewertungen bekommen das Token. In der App: Die Farbe einer Zelle in der Routing-Tabelle zeigt, wie stark der Router diesen Experten bewertet."

  Szenario: Residual nach MoE
    Angenommen ein Mock-MoE-Lauf
    Wenn ich die Station "residual · Layer 1 · nach MoE" wähle
    Dann enthält der Verlauf der Residual-Ansicht "Layer 0 · nach MoE" und "Layer 1 · nach MoE"
    Und zeigt die Liste "Logit-Lens" 5 Einträge

  Szenario: Exportierter MoE-Trace
    Angenommen ein Fixture-Lauf
    Dann gibt es keine Fehlermeldung und keinen Hinweis (role="note") auf fehlende Interna
    Und hat die Gruppe "Stationen" keinen Knopf "embed" und die Knöpfe "moe · Layer 0" und "moe · Layer 1"
    Wenn ich die Station "moe · Layer 1" wähle
    Dann hat "Routing" die Spaltenköpfe "E0", "E1", "E2" und "E3"
    Und hat jede Zeile von "Routing" genau 2 gewählte Zellen

  Szenario: Ungültiges Routing wird abgelehnt
    Angenommen ein exportierter Mock-MoE-Lauf, in dem bei steps/0/stations/4 der erste gewählte Experte der Zeile 0 durch einen nicht gewählten mit niedrigerer Router-Bewertung ersetzt ist
    Wenn ich ihn über "Trace importieren" lade
    Dann beginnt die Fehlermeldung mit "Der Trace ist inkonsistent."
    Und enthält sie "/steps/0/stations/4/experts/0" und "INV-18"

  Szenario: Verdichtete Layer-Karte
    Angenommen ein 24-Layer-Lauf
    Wenn ich die Station "moe · Layer 7" wähle
    Dann hat die Layer-Karte 26 Gruppen, von "Eingabe" über "Layer 0" bis "Layer 23" und "Ausgabe"
    Und hat die Gruppe "Layer 7" die Kurztexte "A", "+", "X" und "+"
    Und hat jede andere Layer-Gruppe genau ein Kästchen der Klasse "layer-cell-collapsed", etwa "L3" in der Gruppe "Layer 3"
    Und lautet die Zeile ".layer-part" "Layer 7 · Teil 3 von 4: Der Router schickt jedes Token an wenige Experten."

  Szenario: Bühne mit 24 Layern passt in 1280 × 720
    Angenommen das Fenster ist 1280 × 720 groß und ein 24-Layer-Lauf
    Wenn ich auf "Präsentation" klicke und die Station "moe · Layer 7" wähle
    Dann ist die Seite nicht höher als das Fenster
    Und liegen der Tokenstrom, die Layer-Karte, die Überschrift der Region "Station" und die Transportleiste vollständig im Fenster
