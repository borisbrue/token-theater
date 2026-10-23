# language: de
Funktionalität: Playback-Controller, Frames und Scheduler
  Als Entwickler einer Ansicht
  möchte ich einen UI-unabhängigen, deterministischen Abspieler für Traces
  um Schritte und Stationen verlässlich vor- und zurückzuspulen und automatisch abzuspielen

  # Basis-Trace B: MockEngine (weightSeed 1234), Greedy, Seed 42, Prompt "die katze sitzt",
  # maxTokens 2 → Schritt 0 mit 12 Stationen, Schritt 1 mit 11 Stationen, 23 Frames.
  # Verweildauer bei 1× (ms): tokenize 1500, embed 1200, attention 2000, residual 700,
  # mlp 1200, logits 1500, sample 1800. Jedes Szenario nutzt einen frischen ManualScheduler und,
  # wo ein Controller vorkommt, einen frischen Controller darauf. Ein Listener ist jeweils vor dem
  # ersten Schritt des Szenarios angemeldet, sofern nicht anders angegeben.
  Grundlage:
    Angenommen ein frischer ManualScheduler

  Szenario: Frames eines Traces
    Wenn ich den Basis-Trace B lade
    Dann gibt es 23 Frames
    Und ist Frame 0 gleich {step 0, station 0} und Frame 12 gleich {step 1, station 0}
    Und ist der Cursor 0, der Modus "paused" und das Tempo 1

  Szenario: Leerer Trace
    Wenn ich einen Trace mit 0 Schritten lade
    Dann gibt es 0 Frames, der Cursor ist null und der Modus "idle"
    Und wurde der Listener durch das Laden genau einmal aufgerufen
    Und bleibt der Zustand nach jedem weiteren Kommando unverändert
    Und wird danach kein Listener mehr aufgerufen und kein Scheduler-Eintrag angelegt

  Szenario: Kein Trace
    Wenn ich load(null) auf einem frischen Controller aufrufe
    Dann ist der Modus "idle" und der Cursor null
    Und wurde der Listener genau einmal aufgerufen

  Szenario: Station vor und zurück
    Angenommen der Basis-Trace B ist geladen
    Wenn ich zweimal "next" auslöse
    Dann ist der Cursor 2 und die Station ist "attention" in Layer 0
    Wenn ich "prev" auslöse
    Dann ist der Cursor 1

  Szenario: Ränder werden nicht überschritten
    Angenommen der Basis-Trace B ist geladen
    Wenn ich "prev" auslöse
    Dann bleibt der Cursor 0 und kein Listener wird aufgerufen
    Wenn ich "last" und danach "next" auslöse
    Dann ist der Cursor 22

  Szenario: Schritt vor und zurück
    Angenommen der Basis-Trace B ist geladen und der Cursor steht auf 5
    Wenn ich "nextStep" auslöse
    Dann ist der Cursor 12
    Wenn ich "next" und danach "prevStep" auslöse
    Dann ist der Cursor 12
    Wenn ich erneut "prevStep" auslöse
    Dann ist der Cursor 0

  Szenario: Zum Anfang und zum Ende
    Angenommen der Basis-Trace B ist geladen
    Wenn ich "last" auslöse
    Dann ist der Cursor 22
    Wenn ich "first" auslöse
    Dann ist der Cursor 0

  Szenario: Gezielt springen
    Angenommen der Basis-Trace B ist geladen
    Wenn ich seek zu Schritt 1, Station 3 auslöse
    Dann ist der Cursor 15
    Wenn ich seek zu Schritt 5, Station 0 auslöse
    Dann bleibt der Cursor 15
    Wenn ich seek zu Schritt 1, Station 3 erneut auslöse
    Dann wird kein Listener aufgerufen

  Szenariogrundriss: Ungültiges seek wird ignoriert
    Angenommen der Basis-Trace B ist geladen und spielt
    Wenn ich seek zu Schritt <step>, Station <station> auslöse
    Dann ist der Modus weiterhin "playing", der Cursor 0 und kein Listener wird aufgerufen

    Beispiele:
      | step | station |
      | 0    | 12      |
      | -1   | 0       |
      | 0.5  | 0       |
      | 2    | 0       |

  Szenario: Automatisches Vorrücken
    Angenommen der Basis-Trace B ist geladen
    Wenn ich "play" auslöse
    Dann ist der Modus "playing" und es gibt genau 1 ausstehenden Scheduler-Eintrag
    Wenn 1499 ms vergehen
    Dann ist der Cursor 0
    Wenn 1 weitere ms vergeht
    Dann ist der Cursor 1 und es gibt genau 1 ausstehenden Scheduler-Eintrag

  Szenario: Tempo verkürzt die Verweildauer
    Angenommen der Basis-Trace B ist geladen und das Tempo ist 2
    Wenn ich "play" auslöse und 750 ms vergehen
    Dann ist der Cursor 1

  Szenario: Wiedergabe endet am letzten Frame
    Angenommen der Basis-Trace B ist geladen und das Tempo ist 2
    Wenn ich "play" auslöse und die halbe Summe der Verweildauern der Frames 0 bis 21 vergeht
    Dann ist der Cursor 22 und der Modus "paused"
    Und gibt es keinen ausstehenden Scheduler-Eintrag

  Szenario: Abspielen am Ende beginnt von vorn
    Angenommen der Basis-Trace B ist geladen und der Cursor steht auf 22
    Wenn ich "play" auslöse
    Dann ist der Cursor 0 und der Modus "playing"

  Szenario: Manuelle Navigation pausiert
    Angenommen der Basis-Trace B ist geladen und spielt
    Wenn ich "next" auslöse
    Dann ist der Modus "paused" und es gibt keinen ausstehenden Scheduler-Eintrag

  Szenario: Umschalten
    Angenommen der Basis-Trace B ist geladen
    Wenn ich "toggle" auslöse
    Dann ist der Modus "playing"
    Wenn ich "toggle" auslöse
    Dann ist der Modus "paused" und es gibt keinen ausstehenden Scheduler-Eintrag

  Szenario: Pause
    Angenommen der Basis-Trace B ist geladen und spielt
    Wenn ich "pause" auslöse
    Dann ist der Modus "paused", der Cursor 0 und es gibt keinen ausstehenden Scheduler-Eintrag
    Wenn ich erneut "pause" auslöse
    Dann wird kein Listener aufgerufen

  Szenario: Gleiches Tempo ist wirkungslos
    Angenommen der Basis-Trace B ist geladen
    Wenn ich das Tempo auf 1 setze
    Dann wird kein Listener aufgerufen

  Szenario: Mehrfaches Abspielen plant nur einmal
    Angenommen der Basis-Trace B ist geladen
    Wenn ich dreimal "play" auslöse
    Dann gibt es genau 1 ausstehenden Scheduler-Eintrag

  Szenario: Tempowechsel während der Wiedergabe wirkt anteilig
    Angenommen der Basis-Trace B ist geladen und der Cursor steht auf 2 (attention, 2000 ms)
    Wenn ich "play" auslöse, 500 ms vergehen und ich das Tempo auf 2 setze
    Dann rückt der Cursor nach weiteren 749 ms noch nicht vor
    Und steht nach 1 weiteren ms auf 3

  Szenario: Tempowechsel kurz vor Frame-Ende
    Angenommen der Basis-Trace B ist geladen und der Cursor steht auf 2 (attention, 2000 ms)
    Wenn ich "play" auslöse, 1999 ms vergehen und ich das Tempo auf 2 setze
    Dann steht der Cursor nach 1 weiteren ms auf 3
    Und gibt es genau 1 ausstehenden Scheduler-Eintrag

  Szenariogrundriss: Ungültiges Tempo
    Angenommen der Basis-Trace B ist geladen
    Wenn ich das Tempo auf <tempo> setze
    Dann bleibt das Tempo 1 und kein Listener wird aufgerufen

    Beispiele:
      | tempo |
      | 0     |
      | 3     |
      | -1    |

  Szenario: Neuer Trace während der Wiedergabe
    Angenommen der Basis-Trace B ist geladen, spielt mit Tempo 0.5 und der Cursor steht auf 4
    Wenn ich einen anderen Trace lade
    Dann ist der Cursor 0, der Modus "paused", das Tempo 0.5
    Und gibt es keinen ausstehenden Scheduler-Eintrag

  Szenario: Listener und Snapshots
    Angenommen der Basis-Trace B ist geladen und ein Listener ist angemeldet
    Wenn ich "next" auslöse
    Dann wird der Listener genau einmal mit dem neuen Zustand aufgerufen
    Und ist der neue Zustand ein anderes, eingefrorenes Objekt als der vorherige
    Wenn ich den Listener abmelde und "next" auslöse
    Dann wird er nicht mehr aufgerufen
    Und ist ein zweites Abmelden wirkungslos

  Szenario: dispose räumt auf
    Angenommen der Basis-Trace B ist geladen und spielt
    Wenn ich dispose() aufrufe
    Dann gibt es keinen ausstehenden Scheduler-Eintrag
    Und bleiben spätere Aufrufe von dispatch und load ohne Wirkung und ohne Listener-Aufruf
    Und liefert getState() weiterhin den letzten Zustand

  Szenario: Remote-artiger Trace
    Wenn ich einen Trace mit den Fähigkeiten "tokenize, logits, sample" und 2 Schritten lade
    Dann gibt es 5 Frames
    Und hat Schritt 0 3 Stationen und Schritt 1 2 Stationen

  Szenario: Abgeleitete Werte eines Frames
    Angenommen der Basis-Trace B ist geladen und der Cursor steht auf 2
    Dann liefert frameInfo Schritt 0, Station 2, Stationsanzahl 12, Schrittanzahl 2
    Und ist der Fortschritt 2/22

  Szenario: Sichtbare Tokens
    Angenommen der Basis-Trace B ist geladen
    Wenn der Cursor auf Frame 10 steht (logits von Schritt 0)
    Dann sind die sichtbaren Tokens "die, katze, sitzt" ohne neues Token und showNext ist wahr
    Wenn der Cursor auf Frame 11 steht (sample von Schritt 0)
    Dann sind die sichtbaren Tokens "die, katze, sitzt" plus das gewählte Token, das als neu markiert ist
    Wenn der Cursor auf Frame 22 steht (sample des letzten Schritts)
    Dann ist showNext falsch

  Szenario: Verweildauern
    Dann liefert durationFor für attention bei Tempo 1 den Wert 2000 und bei Tempo 0.25 den Wert 8000
    Und liefert durationFor für residual bei Tempo 2 den Wert 350

  Szenario: Scheduler ruft nie synchron auf
    Angenommen ein ManualScheduler
    Wenn ich einen Eintrag mit 0 ms plane
    Dann wurde der Callback noch nicht aufgerufen
    Wenn 0 ms vergehen
    Dann wurde der Callback genau einmal aufgerufen

  Szenario: cancel ist idempotent
    Angenommen ein ManualScheduler mit einem Eintrag über 100 ms
    Wenn ich cancel zweimal aufrufe und 200 ms vergehen
    Dann wurde der Callback nie aufgerufen und pending ist 0

  Szenario: Reihenfolge und Neuplanung während advance
    Angenommen ein ManualScheduler mit Einträgen A bei 100 ms und B bei 50 ms und C bei 100 ms
    Und A plant beim Aufruf einen Eintrag D über 20 ms
    Wenn 150 ms vergehen
    Dann liefen die Callbacks in der Reihenfolge "B, A, C, D"
    Und ist now() gleich 150
