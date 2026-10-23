import type { StationKind } from '../trace/types';
import type { Glossary, TermId } from '../views/glossary/types';

/** Die Begriffe der App mit Bedeutung und Ort in der App (SPEC-0010 §3.4, CON-0021). */
export const GLOSSARY: Glossary = {
  token: {
    term: 'Token',
    meaning:
      'Ein Stück Text mit fester Nummer: ein Wort, ein Wortteil oder ein Satzzeichen. Das Modell sieht nur diese Nummern, nie einzelne Buchstaben.',
    inApp: 'Die Kästchen im Tokenstrom; „␣“ steht für ein Leerzeichen am Anfang des Tokens.',
  },
  vocabulary: {
    term: 'Vokabular',
    meaning: 'Die feste Liste aller Tokens, die ein Modell kennt; GPT-2 kennt 50.257.',
    inApp: 'Die Nummer neben jedem Token und die Kandidaten der logits-Station.',
  },
  bpe: {
    term: 'BPE',
    meaning:
      'Byte-Pair-Encoding: Der Text wird in Bytes zerlegt, dann werden benachbarte Stücke nach einer gelernten Rangliste verschmolzen. Häufige Wörter werden so ein Token, seltene mehrere.',
    inApp: 'Die Ansicht „Tokenizer“ zeigt jeden Merge-Schritt.',
  },
  vector: {
    term: 'Vektor',
    meaning:
      'Eine Liste von Zahlen fester Länge. Damit rechnet das Modell: Jedes Token ist an jeder Stelle ein Vektor.',
    inApp: 'Die farbigen Streifen, ein Feld je Zahl.',
  },
  dimension: {
    term: 'Dimension',
    meaning:
      'Eine einzelne Zahl in einem Vektor, gezählt ab 0. Eine Dimension allein bedeutet meist nichts Greifbares; erst das Muster vieler Zahlen trägt Bedeutung.',
    inApp: 'Zeige auf ein Feld eines Streifens, um Dimension und Wert zu sehen.',
  },
  tensor: {
    term: 'Tensor',
    meaning: 'Ein Block von Zahlen mit einer Form, etwa [6, 768] für 6 Tokens mit je 768 Zahlen.',
    inApp: 'Die Liste „Tensoren“ nennt die Formen einer Station.',
  },
  embedding: {
    term: 'Embedding',
    meaning:
      'Der Vektor, mit dem ein Token ins Modell kommt: eine gelernte Zeile je Token, dazu eine gelernte Zeile je Position (Positions-Embedding).',
    inApp: 'Die embed-Station zeigt beide und ihre Summe.',
  },
  layer: {
    term: 'Layer',
    meaning:
      'Ein Block aus Attention und MLP; beide addieren ihr Ergebnis zum Residual Stream. Das Modell stapelt mehrere gleich gebaute Layer mit eigenen Gewichten, jeder arbeitet mit dem Ergebnis des vorigen. Frühe Layer erfassen eher Wortformen und Nachbarschaft, späte eher Bedeutung und die nächste Vorhersage.',
    inApp:
      'Jeder Layer hat vier Stationen: attention, residual, mlp, residual. Die Layer-Karte zeigt, wo du bist.',
  },
  attention: {
    term: 'Attention',
    meaning:
      'Der Teil eines Layers, in dem Tokens Information voneinander übernehmen. Jedes Token gewichtet die Tokens bis zu sich selbst und mischt ihre Inhalte.',
    inApp: 'Die Heatmap: eine Zeile je Token, eine Spalte je Token, auf das es schaut.',
  },
  head: {
    term: 'Kopf',
    meaning:
      'Eine von mehreren parallelen Attention-Rechnungen in einem Layer. Jeder Kopf hat eigene Gewichte und achtet auf etwas anderes, etwa auf das vorige Wort.',
    inApp: 'Wähle einen Kopf oder „Mittel“, den Durchschnitt aller Köpfe.',
  },
  qkv: {
    term: 'Query, Key, Value',
    meaning:
      'Drei Vektoren, die jedes Token in der Attention bildet: was es sucht (Query), wofür es steht (Key) und was es weitergibt (Value). Passen Query und Key gut zusammen, fließt viel von diesem Value.',
    inApp: 'Die Tensoren q, k und v der attention-Station.',
  },
  mask: {
    term: 'Kausale Maske',
    meaning:
      'Sperrt in der Attention alle späteren Tokens. So kann das Modell beim Vorhersagen nicht in die Zukunft schauen.',
    inApp: 'Die leeren Felder oben rechts in der Heatmap („maskiert“).',
  },
  kvCache: {
    term: 'KV-Cache',
    meaning:
      'Keys und Values früherer Tokens bleiben gespeichert. Ein neuer Schritt rechnet deshalb nur die Zeile des neuen Tokens.',
    inApp: '„Frühere Schritte zeigen“ blendet die gespeicherten Zeilen ein.',
  },
  residual: {
    term: 'Residual Stream',
    meaning:
      'Der Vektor je Token, der von Layer zu Layer weitergereicht wird. Attention und MLP addieren ihr Ergebnis dazu, statt ihn zu ersetzen.',
    inApp: 'Die residual-Stationen und der „Verlauf“ seiner Länge über die Layer.',
  },
  layerNorm: {
    term: 'LayerNorm',
    meaning:
      'Bringt einen Vektor vor Attention und MLP auf einen einheitlichen Maßstab (Mittelwert 0, Streuung 1) und skaliert ihn dann mit gelernten Zahlen.',
    inApp: 'Der Tensor lnIn.',
  },
  norm: {
    term: 'Norm',
    meaning:
      'Die Länge eines Vektors: die Wurzel aus der Summe der Quadrate seiner Zahlen. Sie sagt, wie stark ein Vektor ist, nicht wohin er zeigt.',
    inApp:
      '‖v‖ und ‖x‖ an den Streifen und im Verlauf; Δ ist die Änderung gegenüber dem vorigen Wert.',
  },
  mlp: {
    term: 'MLP',
    meaning:
      'Multi-Layer Perceptron, der zweite Teil eines Layers: ein kleines Netz, das jedes Token für sich verarbeitet. Es vergrößert den Vektor, wendet GELU an und verkleinert ihn wieder.',
    inApp: 'Die mlp-Station mit Eingang, Hidden und Ausgang.',
  },
  hidden: {
    term: 'Hidden',
    meaning:
      'Die breite Mitte des MLP, bei GPT-2 viermal so breit wie der Residual Stream. Jede Zahl darin gehört zu einem Neuron.',
    inApp: 'Der breite Streifen der mlp-Station.',
  },
  neuron: {
    term: 'Neuron',
    meaning:
      'Eine Zahl in der Mitte des MLP. Ist sie groß, „feuert“ das Neuron; manche Neuronen reagieren auf erkennbare Muster im Text.',
    inApp: '„Stärkste Neuronen“ und „Aktiv (> 0)“, die Zahl der Neuronen über 0.',
  },
  gelu: {
    term: 'GELU',
    meaning:
      'Die Nichtlinearität im MLP: Positive Werte gehen fast unverändert durch, negative werden gegen 0 gedrückt. Ohne sie wäre das MLP nur eine einzige lineare Rechnung.',
    inApp: 'Wirkt in der mlp-Station zwischen Eingang und Ausgang.',
  },
  logit: {
    term: 'Logit',
    meaning:
      'Die rohe Bewertung eines Tokens als nächstes Token, eine Zahl je Token im Vokabular. Höher heißt wahrscheinlicher; Logits dürfen negativ sein.',
    inApp: 'Die Spalte neben der Wahrscheinlichkeit in der logits-Station.',
  },
  softmax: {
    term: 'Softmax',
    meaning:
      'Macht aus Logits Wahrscheinlichkeiten: Jede Bewertung wird exponentiert und durch die Summe aller geteilt, zusammen ergeben sie 100 %.',
    inApp: 'Die Prozentwerte der Kandidaten.',
  },
  logitLens: {
    term: 'Logit-Lens',
    meaning:
      'Wendet die Ausgabe des Modells schon auf einen Zwischenstand des Residual Stream an. So sieht man, welches Token das Modell nach diesem Layer vorhersagen würde.',
    inApp: 'Die residual-Stationen nach dem MLP, für die letzte Position.',
  },
  candidate: {
    term: 'Kandidat',
    meaning: 'Ein mögliches nächstes Token mit seiner Wahrscheinlichkeit.',
    inApp:
      'Die Listen der logits- und sample-Station; ein Server liefert nur die besten Kandidaten.',
  },
  sampling: {
    term: 'Sampling',
    meaning: 'Die Wahl des nächsten Tokens aus den Wahrscheinlichkeiten.',
    inApp:
      'Die Einstellungen „Sampling“ im Formular, das Ergebnis in der sample-Station, zum Ausprobieren das Sampling-Labor.',
  },
  greedy: {
    term: 'Greedy',
    meaning:
      'Nimmt immer das wahrscheinlichste Token, ohne Zufall. Derselbe Prompt ergibt denselben Text.',
    inApp: 'Die Einstellung „Greedy“ im Formular.',
  },
  temperature: {
    term: 'Temperatur',
    meaning:
      'Teilt die Logits vor Softmax. Unter 1 wird die Verteilung spitzer, über 1 flacher und der Text überraschender.',
    inApp: 'Die Felder „Temperatur“ im Formular und im Sampling-Labor.',
  },
  topK: {
    term: 'Top-k',
    meaning:
      'Behält nur die k wahrscheinlichsten Tokens und verteilt die Wahrscheinlichkeit unter ihnen neu; 0 heißt aus.',
    inApp: 'Die Felder „Top-k“; entfernte Tokens sind im Labor markiert.',
  },
  topP: {
    term: 'Top-p',
    meaning:
      'Behält die kleinste Gruppe der besten Tokens, die zusammen mindestens p erreichen; 1 heißt aus.',
    inApp: 'Die Felder „Top-p“ im Formular und im Sampling-Labor.',
  },
  seed: {
    term: 'Seed',
    meaning:
      'Der Startwert des Zufallsgenerators. Derselbe Seed ergibt dieselben Zufallszahlen und damit denselben Text.',
    inApp: 'Das Feld „Seed“ und die Zufallszahl in der sample-Station.',
  },
  trace: {
    term: 'Trace',
    meaning:
      'Die Aufzeichnung eines Laufs mit allen Zwischenwerten. Die App spielt ihn nur ab und rechnet dabei nichts neu.',
    inApp: '„Trace exportieren“ speichert ihn als JSON, „Trace importieren“ lädt ihn wieder.',
  },
  step: {
    term: 'Schritt',
    meaning:
      'Ein Durchgang durch das Modell, der genau ein neues Token erzeugt. Schritt 0 verarbeitet den ganzen Prompt.',
    inApp: 'Die Zeitleiste hat einen Knopf je Schritt.',
  },
  station: {
    term: 'Station',
    meaning:
      'Ein Halt innerhalb eines Schritts: tokenize, embed, je Layer attention, residual, mlp, residual, dann logits und sample.',
    inApp: 'Die Stationsleiste und die Position „Station i / n“.',
  },
};

/** Begriffe je Station, in dieser Reihenfolge (SPEC-0010 §3.5). */
export const TERMS_BY_STATION: Readonly<Record<StationKind, readonly TermId[]>> = {
  tokenize: ['token', 'bpe', 'vocabulary', 'trace', 'step', 'station'],
  embed: ['embedding', 'vector', 'dimension', 'tensor'],
  attention: ['attention', 'head', 'qkv', 'mask', 'kvCache', 'layerNorm'],
  residual: ['residual', 'layer', 'norm', 'logitLens'],
  mlp: ['mlp', 'hidden', 'neuron', 'gelu', 'layerNorm'],
  logits: ['logit', 'softmax', 'candidate', 'vocabulary'],
  sample: ['sampling', 'greedy', 'temperature', 'topK', 'topP', 'seed'],
};
