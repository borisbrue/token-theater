# Token Theater

Eine Web-App, die zeigt, was ein Sprachmodell Schritt für Schritt tut – verlangsamt, zum
Vortragen und Selbstlernen. Die Oberfläche ist auf Deutsch.

Eine Engine rechnet in normalem Tempo und schreibt jeden Zwischenschritt in einen **Trace**. Ein
Playback-Controller spielt ihn ab wie ein Video: abspielen, anhalten, Station für Station vor und
zurück, Tempo wählen.

## Was man sieht

- **Tokenizer:** GPT-2-BPE mit jedem Merge-Schritt.
- **Embedding, Attention, MLP, Residual Stream:** Vektoren als Farbstreifen, Attention als
  Heatmap je Kopf, KV-Cache, stärkste Neuronen, Logit-Lens nach jedem Layer.
- **Logits und Sampling:** Wahrscheinlichkeiten der Kandidaten, Greedy oder Zufall mit
  Temperatur, Top-k, Top-p und Seed; ein Sampling-Labor zum Ausprobieren.
- **Layer-Karte und Glossar:** Wo die Station im Modell liegt; jeder Fachbegriff lässt sich an Ort
  und Stelle nachschlagen.
- **Präsentationsmodus:** Bühne ohne Formulare, große Schrift, Bedienung per Tastatur oder
  Clicker (`p`, `Esc`, Bild ↑/↓, Pfeiltasten, Leertaste).
- **Trace exportieren und importieren** als JSON.

## Engines

| Engine          | Interna                 | Beschreibung                                                                                     |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Mock            | ja                      | Kleines erfundenes Modell, sofort verfügbar                                                      |
| GPT-2 (Browser) | alle                    | Eigene GPT-2-Implementierung in TypeScript im Web Worker, Matrixrechnung in WebAssembly mit SIMD |
| Server          | nur Tokens und Logprobs | OpenAI-kompatible Server (vLLM, MLX, llama.cpp …)                                                |

## Schnellstart

Voraussetzung: Node.js 20 oder neuer.

```sh
npm ci
npm run fetch-model -- distilgpt2   # optional: Gewichte von Hugging Face nach public/models/
npm run dev
```

Dann `http://localhost:5173` öffnen. Ohne Gewichte steht die Mock-Engine zur Verfügung; mit
`npm run fetch-model -- gpt2` kommt GPT-2 small (124M) dazu.

Server-Presets lassen sich über `.env.local` vorgeben, siehe `.env.example`. API-Keys gehören
nicht dorthin: Die App fragt sie ab und speichert sie nicht.

## Entwicklung

```sh
npm test            # Unit-Tests (Vitest)
npm run test:e2e    # Akzeptanztests (Playwright, Chromium)
npm run lint        # ESLint und Prettier
npm run build       # Typprüfung und Produktions-Build
npm run build:kernel  # WASM-Rechenkern aus src/engine/gpt2/kernel.wat neu bauen
```

Schichten: `app → views → playback → trace → engine`, Abhängigkeiten zeigen nur nach unten.
Die Anforderungen stehen als Specs in `.sdd/specs/`, die ausführbaren Verträge (Gherkin-Features,
JSON-Schemas, Regeln) in `.sdd/contracts/`; die Tests lesen sie direkt. Entstanden ist das
Projekt mit Spec-Driven Development und [Claude Code](https://claude.com/claude-code).

## Lizenz

[MIT](LICENSE)
