# language: de
Funktionalität: Layer-Karte und Glossar
  Als Lernende/r oder Vortragende/r
  möchte ich sehen, wo eine Station im Modell liegt, und jeden Fachbegriff an Ort und Stelle nachschlagen
  um zu verstehen, was die App zeigt

  # "Mock-Lauf" wie presentation-ui.feature (CON-0020): Engine "Mock", Prompt "die katze sitzt",
  # Max. Tokens 2, "Erzeugen", warten bis die Gruppe "Zeitleiste" 2 Knöpfe hat. Schritt 0 hat 12
  # Stationen: tokenize, embed, je Layer 0 und 1 attention, residual · nach Attention, mlp,
  # residual · nach MLP, dann logits und sample.
  # "GPT-2-Lauf" wie CON-0020: Testmodell per page.route, 2 Layer.
  # "Lauf ohne Interna" wie CON-0020 (Export, capabilities auf tokenize/logits/sample, Import).
  # "Station wählen" = Knopf mit diesem Namen in der Gruppe "Stationen".
  # "Layer-Karte" = Liste mit aria-label "Layer-Karte" in der Region "Station".
  # "Begriffe" = Liste mit aria-label "Begriffe" in der Region "Station".
  # "Begriff X" = Knopf der Klasse "term" mit dem Namen X in der Region "Station".
  # "Erklärung" = Element mit role="tooltip"; ihr Text ist term, Leerzeichen, meaning, dann
  # "In der App: " und inApp (SPEC-0010 §3.4, §3.7).
  # Tasten werden gedrückt, während der genannte Knopf fokussiert ist, sonst nach Klick auf die
  # Überschrift "Token Theater".
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Layer-Karte gruppiert die Stationen
    Angenommen ein Mock-Lauf
    Dann hat die Layer-Karte 4 Gruppen "Eingabe", "Layer 0", "Layer 1" und "Ausgabe"
    Und hat die Gruppe "Eingabe" die Kästchen "tokenize" und "embed"
    Und hat die Gruppe "Layer 0" die Kästchen "attention · Layer 0", "residual · Layer 0 · nach Attention", "mlp · Layer 0" und "residual · Layer 0 · nach MLP" mit den Kurztexten "A", "+", "M" und "+"
    Und hat die Gruppe "Ausgabe" die Kästchen "logits" und "sample"
    Und hat genau das Kästchen "tokenize" aria-current="step"

  Szenariogrundriss: Teil im Layer
    Angenommen ein Mock-Lauf
    Wenn ich die Station "<station>" wähle
    Dann hat genau das Kästchen "<station>" der Layer-Karte aria-current="step"
    Und lautet die Zeile ".layer-part" "<zeile>"

    Beispiele:
      | station                             | zeile                                                                            |
      | embed                               | Vor den Layern: Der Text wird zu Vektoren.                                       |
      | attention · Layer 1                 | Layer 1 · Teil 1 von 4: Die Attention holt Information von früheren Tokens.     |
      | residual · Layer 0 · nach Attention | Layer 0 · Teil 2 von 4: Ihr Ergebnis wird zum Residual Stream addiert.           |
      | mlp · Layer 0                       | Layer 0 · Teil 3 von 4: Das MLP verarbeitet jedes Token für sich.                |
      | residual · Layer 1 · nach MLP       | Layer 1 · Teil 4 von 4: Sein Ergebnis wird addiert; der Layer ist fertig.        |
      | sample                              | Nach den Layern: Aus dem letzten Vektor wird das nächste Token.                  |

  Szenario: Layer-Karte im GPT-2-Lauf
    Angenommen ein GPT-2-Lauf
    Wenn ich die Station "mlp · Layer 1" wähle
    Dann hat die Layer-Karte die Gruppen "Eingabe", "Layer 0", "Layer 1" und "Ausgabe"
    Und hat genau das Kästchen "mlp · Layer 1" aria-current="step"

  Szenario: Keine Layer-Karte ohne Interna
    Angenommen ein Lauf ohne Interna
    Dann gibt es in der Region "Station" keine Layer-Karte und kein Element ".layer-part"
    Und gibt es die Liste "Begriffe" mit "Token", "BPE", "Vokabular", "Trace", "Schritt" und "Station"

  Szenariogrundriss: Begriffe je Station
    Angenommen ein Mock-Lauf
    Wenn ich die Station "<station>" wähle
    Dann enthält die Liste "Begriffe" genau die Knöpfe <begriffe> in dieser Reihenfolge

    Beispiele:
      | station                       | begriffe                                                                     |
      | tokenize                      | "Token", "BPE", "Vokabular", "Trace", "Schritt", "Station"                   |
      | embed                         | "Embedding", "Vektor", "Dimension", "Tensor"                                 |
      | attention · Layer 0           | "Attention", "Kopf", "Query, Key, Value", "Kausale Maske", "KV-Cache", "LayerNorm" |
      | residual · Layer 0 · nach MLP | "Residual Stream", "Layer", "Norm", "Logit-Lens"                             |
      | mlp · Layer 1                 | "MLP", "Hidden", "Neuron", "GELU", "LayerNorm"                               |
      | logits                        | "Logit", "Softmax", "Kandidat", "Vokabular"                                  |
      | sample                        | "Sampling", "Greedy", "Temperatur", "Top-k", "Top-p", "Seed"                 |

  Szenario: Erklärung öffnen und schließen
    Angenommen ein Mock-Lauf
    Wenn ich die Station "attention · Layer 0" wähle
    Dann hat der Begriff "Kopf" im Erklärsatz aria-expanded="false" und es gibt keine Erklärung
    Wenn ich auf den Begriff "Kopf" im Erklärsatz klicke
    Dann hat er aria-expanded="true" und aria-describedby zeigt auf die Erklärung
    Und lautet die Erklärung "Kopf Eine von mehreren parallelen Attention-Rechnungen in einem Layer. Jeder Kopf hat eigene Gewichte und achtet auf etwas anderes, etwa auf das vorige Wort. In der App: Wähle einen Kopf oder „Mittel“, den Durchschnitt aller Köpfe."
    Wenn ich erneut auf den Begriff "Kopf" klicke
    Dann gibt es keine Erklärung

  Szenario: Erklärung per Tastatur
    Angenommen ein Mock-Lauf
    Wenn ich den Begriff "Token" in der Liste "Begriffe" fokussiere und "Enter" drücke
    Dann gibt es genau eine Erklärung, sie beginnt mit "Token Ein Stück Text mit fester Nummer"
    Wenn ich "Escape" drücke
    Dann gibt es keine Erklärung und der Begriff "Token" hat den Fokus
    Wenn ich "Leertaste" drücke
    Dann gibt es genau eine Erklärung und die Position ist weiter "Schritt 0 · Station 1 / 12"
    Wenn ich "Tab" drücke
    Dann gibt es keine Erklärung

  Szenario: Nur eine Erklärung zugleich
    Angenommen ein Mock-Lauf
    Wenn ich in der Liste "Begriffe" auf "Token" und danach auf "BPE" klicke
    Dann gibt es genau eine Erklärung und sie beginnt mit "BPE Byte-Pair-Encoding"

  Szenario: Klick in die Erklärung lässt sie offen
    Angenommen ein Mock-Lauf
    Wenn ich in der Liste "Begriffe" auf "Vokabular" klicke und dann in die Erklärung klicke
    Dann gibt es genau eine Erklärung

  Szenario: Esc auf der Bühne schließt erst die Erklärung
    Angenommen ein Mock-Lauf
    Wenn ich auf "Präsentation" klicke und in der Liste "Begriffe" auf "Token" klicke
    Dann gibt es genau eine Erklärung
    Wenn ich "Escape" drücke
    Dann gibt es keine Erklärung und der Modus ist "presentation"
    Wenn ich "Escape" drücke
    Dann ist der Modus "explore"

  Szenario: Markierte Begriffe im Satz
    Angenommen ein Mock-Lauf
    Dann enthält der Erklärsatz ("h2 + p") genau einen Begriff "Tokens"
    Und lautet der Erklärsatz "Der Text wird in Tokens zerlegt: Wörter oder Satzzeichen mit einer festen Nummer."
    Wenn ich auf "Tokens" klicke
    Dann beginnt die Erklärung mit "Token Ein Stück Text mit fester Nummer"

  Szenariogrundriss: Markierte Begriffe in Mehr dazu
    Angenommen ein GPT-2-Lauf
    Wenn ich die Station "<station>" wähle und "Mehr dazu" öffne
    Dann enthält "Mehr dazu" die Begriffe <begriffe> in dieser Reihenfolge
    Und enthält "Mehr dazu" weiter "<satz>"

    Beispiele:
      | station                             | begriffe                                                     | satz                                                   |
      | tokenize                            | "Byte-Pair-Encoding"                                         | Das Vokabular hat 50.257 Tokens.                       |
      | attention · Layer 0                 | "Query", "kausale Maske", "KV-Cache"                         | Dieses Modell hat 2 Köpfe in jedem seiner 2 Layer.     |
      | residual · Layer 0 · nach Attention | "Residual Stream", "Layer"                                   | Der Residual Stream ist wie ein Notizblock, der durch alle Layer gereicht wird. |
      | residual · Layer 1 · nach MLP       | "MLP", "Logit-Lens"                                          | Die Logit-Lens zeigt, welches Token das Modell vorhersagen würde, wenn es hier aufhörte. |
      | mlp · Layer 1                       | "GELU"                                                       | Hier: 8 → 32 → 8 Zahlen.                               |
      | logits                              | "Logit", "Softmax"                                           | Bewertet werden alle 50.257 Tokens des Vokabulars.     |
      | sample                              | "Greedy", "Temperatur", "Top-k", "Top-p"                     | Greedy nimmt immer das wahrscheinlichste Token.        |

  Szenario: Layer in der Zeile zum Teil
    Angenommen ein Mock-Lauf
    Wenn ich die Station "mlp · Layer 0" wähle und in der Zeile ".layer-part" auf "Layer" klicke
    Dann beginnt die Erklärung mit "Layer Ein Block aus Attention und MLP"
    Und enthält sie "In der App: Jeder Layer hat vier Stationen: attention, residual, mlp, residual. Die Layer-Karte zeigt, wo du bist."

  Szenario: Glossar-Ansicht
    Wenn ich in der Gruppe "Ansicht" auf "Glossar" klicke
    Dann hat der Knopf "Glossar" aria-pressed="true"
    Und enthält die Region "Glossar" 41 Begriffe (dt), alphabetisch nach deutscher Sortierung
    Und ist der erste Begriff "Attention" und der letzte "Vokabular"
    Und hat der Begriff "Logit-Lens" die ID "begriff-logitLens" und die Beschreibung "Wendet die Ausgabe des Modells schon auf einen Zwischenstand des Residual Stream an. So sieht man, welches Token das Modell nach diesem Layer vorhersagen würde." mit dem Absatz "In der App: Die residual-Stationen nach dem MLP, für die letzte Position."
    Wenn ich in der Gruppe "Ansicht" auf "Durchlauf" klicke
    Dann gibt es keine Region "Glossar"

  Szenario: Glossar vollständig
    Dann hat das Glossar in texts genau die 41 IDs aus SPEC-0010 §3.4, SPEC-0011 §3.7 und SPEC-0012 §3.9, jede mit nicht leerem term, meaning und inApp
    Und verweist jede Markierung in allen Erklärsätzen, allen Texten "Mehr dazu" (mit und ohne Modellzahlen) und allen Zeilen zum Teil im Layer auf eine ID des Glossars
    Und steht jede ID in mindestens einer Liste "Begriffe" einer Station oder einer Ansicht (texts.glossary.byView, SPEC-0012 §3.9)
    Und ergibt jeder Text ohne Markierungen genau den Text vor SPEC-0010

  Szenario: Bühne passt weiter in 1280 × 720
    Angenommen das Fenster ist 1280 × 720 groß und ein GPT-2-Lauf
    Wenn ich auf "Präsentation" klicke und die Station "attention · Layer 0" wähle
    Dann ist die Seite nicht höher als das Fenster
    Und liegen der Tokenstrom, die Layer-Karte, die Überschrift der Region "Station" und die Transportleiste vollständig im Fenster
