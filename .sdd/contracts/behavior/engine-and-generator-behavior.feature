# language: de
Funktionalität: Engine, Generator, Recorder und Sampler
  Als Entwickler einer Engine oder Ansicht
  möchte ich ein festgelegtes Verhalten von generate, TraceRecorder, GreedySampler und MockEngine
  um Engines austauschen und Traces verlässlich abspielen zu können

  # Jedes Szenario baut Engine, Sampler und Recorder frisch auf (keine geteilten Zustände).
  Grundlage:
    Angenommen eine frische MockEngine mit weightSeed 1234 und allen Fähigkeiten
    Und ein GreedySampler
    Und deps mit createRng (mulberry32), idProvider "trace-test" und clock "2026-10-21T12:00:00Z"
    Und der Sampling-Seed 42

  Szenario: Event-Reihenfolge eines vollständigen Laufs
    Wenn ich "die katze sitzt" mit maxTokens 3 erzeuge
    Dann folgen die Event-Typen dem Muster "run-start (step-start station+ step-end){3} done"
    Und trägt run-start engine, prompt, maxTokens und sampling
    Und trägt jedes step-start-Event index, contextTokens und newPositions
    Und trägt jedes step-end-Event index, chosen und text
    Und ist text von Schritt 0 gleich decode(contextTokens + chosen) und beginnt mit "die katze sitzt"
    Und trägt done den finishReason "max-tokens"
    Und liefert der Iterator nach "done" keine weiteren Events

  Szenario: Stationen eines Schritts bei zwei Layern
    Wenn ich "die katze sitzt" mit maxTokens 2 erzeuge
    Dann hat Schritt 0 die Stationen "tokenize, embed, attention, residual, mlp, residual, attention, residual, mlp, residual, logits, sample"
    Und hat Schritt 1 die Stationen "embed, attention, residual, mlp, residual, attention, residual, mlp, residual, logits, sample"
    Und haben die residual-Stationen nacheinander layer/after "0/attention, 0/mlp, 1/attention, 1/mlp"

  Szenario: tokenize und sample stammen vom Generator
    Wenn ich "die katze sitzt" mit maxTokens 1 erzeuge
    Dann rief der Generator tokenizer.tokenize genau einmal auf
    Und rief er sampler.sample genau einmal mit der logits-Station von Schritt 0 auf
    Und lieferte forward selbst keine tokenize- oder sample-Station

  Szenario: KV-Cache-Sicht der newPositions
    Wenn ich "die katze sitzt" mit maxTokens 3 erzeuge
    Dann ist newPositions in Schritt 0 gleich [0, 3]
    Und ist newPositions in Schritt 1 gleich [3, 4]
    Und ist newPositions in Schritt 2 gleich [4, 5]
    Und hat attention.weights in Schritt 2 die Form [2, 1, 5]

  Szenario: Kontextkette
    Wenn ich "die katze sitzt" mit maxTokens 3 erzeuge
    Dann gilt für Schritt 1 und 2: contextTokens = vorheriger Kontext + vorheriges chosen

  Szenario: Strukturelle Korrektheit der Mock-Daten
    Wenn ich "die katze sitzt" mit maxTokens 4 erzeuge
    Dann summiert sich jede Attention-Zeile zu 1 mit Toleranz 1e-5
    Und sind alle Attention-Gewichte rechts der Diagonale 0
    Und ist jeder residual.stream gleich dem vorherigen Stream plus out der vorausgehenden attention- bzw. mlp-Station mit Toleranz 1e-5
    Und ist der Stream vor dem ersten Block gleich embed.sum
    Und ist logits.coverage gleich 1, logits.vocabSize gleich 52 und logits.distribution enthält alle 52 Tokens
    Und erfüllt der Trace alle Invarianten aus CON-0001

  Szenario: Mock-Tokenizer und Decoding
    Wenn ich "Die Katze sitzt, der Hund schläft." tokenisiere
    Dann sind die Tokens "die, katze, sitzt, ',', der, hund, schläft, '.'"
    Und ergibt decode dieser Tokens "die katze sitzt, der hund schläft."

  Szenario: Determinismus
    Wenn ich "die katze sitzt" zweimal mit maxTokens 8 erzeuge, jeweils mit frischer Engine
    Dann sind beide Ergebnisse von serializeTrace bytegleich

  Szenario: Andere Gewichte ergeben andere Tensoren
    Wenn ich "die katze sitzt" mit weightSeed 1234 und mit weightSeed 1235 jeweils mit maxTokens 1 erzeuge
    Dann unterscheiden sich die embed.sum-Tensoren von Schritt 0

  Szenario: Ende bei maxTokens
    Wenn ich "die katze sitzt" mit maxTokens 5 erzeuge
    Dann hat der Trace 5 Schritte und finishReason "max-tokens"
    Und ist in keinem Schritt "<eos>" gewählt

  Szenario: Ende bei EOS
    Angenommen die MockEngine hat die Option eosAt 1
    Wenn ich "die katze sitzt" mit maxTokens 8 erzeuge
    Dann hat der Trace 2 Schritte und finishReason "eos"
    Und ist das letzte chosen das Token "<eos>" mit der id von engine.eosTokenId

  Szenario: EOS im ersten Schritt
    Angenommen die MockEngine hat die Option eosAt 0
    Wenn ich "die katze sitzt" mit maxTokens 8 erzeuge
    Dann hat der Trace 1 Schritt und finishReason "eos"

  Szenario: EOS im letzten erlaubten Schritt
    Angenommen die MockEngine hat die Option eosAt 2
    Wenn ich "die katze sitzt" mit maxTokens 3 erzeuge
    Dann hat der Trace 3 Schritte und finishReason "eos"

  Szenario: Abbruch über AbortSignal
    Angenommen ein AbortController, der nach dem step-end-Event von Schritt 2 auslöst
    Wenn ich "die katze sitzt" mit maxTokens 32 erzeuge
    Dann ist das letzte Event "done" mit finishReason "aborted"
    Und enthält der Trace die Schritte 0 bis 2
    Und erfüllt der Trace alle Invarianten aus CON-0001

  Szenario: Abbruch mitten in einem Schritt
    Angenommen ein AbortController, der nach dem ersten station-Event von Schritt 1 auslöst
    Wenn ich "die katze sitzt" mit maxTokens 8 erzeuge
    Dann ist das letzte Event "done" mit finishReason "aborted"
    Und enthält der Trace genau Schritt 0

  Szenario: Abbruch über return() des Iterators
    Wenn ich nach dem ersten station-Event die Iteration mit break verlasse
    Dann ruft der Generator keinen weiteren forward-Durchlauf auf
    Und wird kein abschließendes Event ausgegeben

  Szenario: Engine-Fehler mitten in forward
    Angenommen eine Test-Engine, die in Schritt 1 nach der embed-Station einen Fehler "kaputt" wirft
    Wenn ich "die katze sitzt" mit maxTokens 4 erzeuge
    Dann folgen die Event-Typen dem Muster "run-start step-start station+ step-end step-start station error"
    Und trägt das error-Event die Meldung "kaputt"
    Und enthält der Trace genau Schritt 0
    Und ist finishReason "error" und error.message "kaputt"

  Szenario: forward endet nicht mit logits
    Angenommen eine Test-Engine, deren forward nach der embed-Station endet
    Wenn ich "die katze sitzt" mit maxTokens 2 erzeuge
    Dann ist das letzte Event "error" mit einer Meldung, die "logits" enthält

  Szenario: Station außerhalb der Fähigkeiten
    Angenommen eine Test-Engine mit den Fähigkeiten "tokenize, logits, sample", die eine attention-Station liefert
    Wenn ich "die katze sitzt" mit maxTokens 1 erzeuge
    Dann ist das letzte Event "error" mit einer Meldung, die "attention" enthält

  Szenario: forward liefert eine sample-Station
    Angenommen eine Test-Engine, deren forward vor logits eine sample-Station liefert
    Wenn ich "die katze sitzt" mit maxTokens 1 erzeuge
    Dann ist das letzte Event "error" mit einer Meldung, die "sample" enthält

  Szenario: Eingeschränkte Fähigkeiten (Remote-artig)
    Angenommen eine MockEngine mit den Fähigkeiten "tokenize, logits, sample"
    Wenn ich "die katze sitzt" mit maxTokens 3 erzeuge
    Dann hat Schritt 0 die Stationen "tokenize, logits, sample"
    Und hat Schritt 1 die Stationen "logits, sample"
    Und ist engine.architecture null
    Und erfüllt der Trace alle Invarianten aus CON-0001

  Szenario: Greedy wählt das wahrscheinlichste Token
    Angenommen eine logits-Station mit den Wahrscheinlichkeiten id 2: 0.5, id 9: 0.3, id 5: 0.2
    Wenn der GreedySampler sampelt
    Dann ist chosen das Token mit id 2
    Und ist random null
    Und ist sample.distribution gleich logits.distribution

  Szenario: Greedy bei Gleichstand
    Angenommen eine logits-Station mit den Wahrscheinlichkeiten id 3: 0.4, id 7: 0.4, id 1: 0.2
    Wenn der GreedySampler sampelt
    Dann ist chosen das Token mit id 3

  Szenario: Unbekannte Wörter
    Wenn ich "quantenchromodynamik katze" mit maxTokens 1 erzeuge
    Dann sind die Tokens von Schritt 0 "<unk>, katze"
    Und hat der Trace 1 Schritt

  Szenario: Leerer Prompt
    Wenn ich "   " mit maxTokens 4 erzeuge
    Dann lehnt der erste next()-Aufruf mit einem GenerateError mit kind "empty-prompt" ab
    Und wurde kein Event ausgegeben

  Szenariogrundriss: Ungültiges maxTokens
    Wenn ich "die katze" mit maxTokens <wert> erzeuge
    Dann lehnt der erste next()-Aufruf mit einem GenerateError mit kind "invalid-max-tokens" ab

    Beispiele:
      | wert |
      | 0    |
      | 33   |
      | 2.5  |

  Szenario: Kontext zu lang
    Angenommen ein Prompt aus 40 Wörtern "katze"
    Wenn ich ihn mit maxTokens 32 erzeuge
    Dann lehnt der erste next()-Aufruf mit einem GenerateError mit kind "context-too-long" ab

  Szenario: Recorder reicht Events weiter und friert den Trace ein
    Wenn ich die Events von "die katze sitzt" mit maxTokens 2 durch den TraceRecorder leite
    Dann erhält der nachgelagerte Konsument dieselben Event-Objekte in derselben Reihenfolge
    Und ist build() ein tief eingefrorener Trace (Object.isFrozen für Trace, steps, jede Station und jeden Tensor-Wrapper)
    Und wirft ein Schreibversuch auf trace.steps einen TypeError
    Und übernimmt der Trace newPositions aus den step-start-Events

  Szenario: build() vor dem Ende
    Wenn ich build() aufrufe, bevor ein done- oder error-Event angekommen ist
    Dann wirft build() einen Fehler, der "unvollständig" nennt

  Szenario: Engine-Erzeugung über die Factory
    Wenn ich createEngine("mock", deps) aufrufe
    Dann ist info.kind "mock", info.model "mock-de-52" und info.capabilities enthält alle sieben Stationsarten
    Und wirft createEngine("unbekannt", deps) einen UnknownEngineError, dessen Meldung "unbekannt" nennt

  Szenario: Laufzeit der Mock-Engine
    Wenn ich "die katze sitzt" mit maxTokens 8 erzeuge und aufzeichne
    Dann dauert es im Median aus 5 Läufen weniger als 200 ms
