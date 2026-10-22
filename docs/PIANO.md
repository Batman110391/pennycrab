# pennycrab: stato, misure e piano

Aggiornato il 22 ottobre 2026. Claude Code 2.1.308, branch `claude/elegant-fermat-ycm7rm`.

## 1. Cosa fa la mod oggi

| Funzione | Stato | Dove |
| --- | --- | --- |
| **Router**: Explore e general-purpose di una sessione Opus o Fable girano su Sonnet (`prudent`); in `aggressive` l'Explore va su Haiku con effort basso | fatto, misurato dal vivo | `hooks/router.ts` |
| **Telemetria**: costo per richiesta a prezzi di listino 5.x, contesto, tempo, strumento in uso | fatto, prezzi verificati sul costo reale della CLI | `hooks/telemetry.ts`, `hooks/prices.ts` |
| **Guardiano**: oltre il budget (o su Haiku oltre 100K di contesto) il sub-agente viene fermato e consegna quello che ha trovato | fatto, verificato dal vivo | `hooks/guard.ts` |
| **Cache calda**: un ping poco prima che la cache della conversazione principale scada, finché dura la finestra dopo l'ultimo turno | fatto, verificato dal vivo | `hooks/cache.ts` |
| **Pannello, banda, riga di stato**: un granchio vestito per modello, costo, risparmio, contesto, stato della cache | fatto, da verificare a occhio in Desktop | `hooks/ui.tsx` |
| **Installazione pulita** dal marketplace GitHub | fatto, installazione provata dal marketplace locale | `.claude-plugin/marketplace.json`, `README.md` |

Opzioni (`/plugin configure pennycrab`): `router` (`prudent`), `budget` (2 dollari), `keepWarm` (30 minuti).

## 2. Cosa è cambiato in questa sessione

1. **Guardiano anti-runaway**: rifiuta gli strumenti del sub-agente fermato con l'istruzione di scrivere la risposta finale; se insiste, alla terza richiesta risponde la mod e il turno si chiude. Un sub-agente ripreso ha di nuovo le sue 2 richieste per chiudere.
2. **Cache calda**: TTL letto nello stesso ordine del motore; ping con `$.model.fork`; stop dei ping se un ping trova la cache già scaduta; risparmio contabilizzato sul messaggio successivo, al netto del costo dei ping.
3. **Bug corretto**: il toast «Pennycrab closed…» non compariva mai (`e.origin` è un oggetto `{ kind }`, non una stringa).
4. **Test**: da 21 a 45. Coprono guardiano, cache (TTL in 9 casi, 6 ping in 30 minuti, nessun ping con cache da 1 ora, stop dopo un ping a vuoto, nessun ping a turno aperto o con l'opzione `off`), riga di stato, strumento in uso.
5. **Pacchetto**: `marketplace.json`, `README.md`, autore, repository, licenza e parole chiave in `plugin.json`. La validazione passa anche con il profilo del catalogo dei plugin.

## 3. Scoperte sul motore (utili per i prossimi passi)

- **Non esiste `$.agent.stop`.** Un sub-agente si ferma in due modi: rifiutando i suoi strumenti in `tool.call` (`{ deny }`, il modello legge il testo come errore) e rispondendo al suo posto in `turn.step` (una risposta senza strumenti chiude il turno).
- **Gli strumenti partono mentre la risposta arriva.** Le chiamate della stessa risposta che supera il budget vengono eseguite comunque; il guardiano agisce dalla risposta dopo.
- **`$.model.fork`** rimanda l'ultima richiesta della conversazione principale con un messaggio in coda: legge il prefisso dalla cache e così ne rinnova la scadenza. È la base della cache calda.
- **TTL della conversazione principale**, nell'ordine del motore: `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, l'impostazione `promptCacheTtl`, `ENABLE_PROMPT_CACHING_1H`, poi l'account (1 ora con un abbonamento Claude entro i limiti, 5 minuti con chiave API, Bedrock, Vertex o Foundry). I sub-agenti scrivono a 5 minuti salvo `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` o `subagentPromptCacheTtl`.
- **Un abbonamento si riconosce** dalle finestre `five_hour` e `seven_day` in `$.session.usage().rateLimits`; con una chiave API non ci sono.
- **In modalità headless** il modulo della mod si carica all'inizio del primo turno, non all'avvio (aspetta un flag di rollout): nessun effetto pratico.
- **Kit di test**: gli hook vanno registrati prima della prima chiamata a `$`; una risposta finta a una chiamata su `$` va data come `{ value }`; il valore finale di uno stream `turn.step` si legge con `next()`, perché `for await` lo scarta; non si può simulare una chiusura del pannello fatta a mano.

## 4. Verifiche

| Verifica | Esito |
| --- | --- |
| `claude plugin test .` | 45 test, 0 falliti |
| Test che falliscono se si rompe la regola che proteggono | provato su 3 regole (ripresa del sub-agente, ping a vuoto, turno aperto) |
| `tsc` con i tipi del motore 2.1.308 | nessun errore |
| `claude plugin validate .` e `--profile directory` | passa; resta solo l'avviso sull'icona |
| Installazione da marketplace (`claude plugin marketplace add` + `install`) | installata e abilitata, 3 opzioni lette |
| Prova dal vivo del guardiano | vedi 5.3 |
| Prova dal vivo del router | vedi 5.1 |
| Prova dal vivo della cache calda | vedi 5.4 |

## 5. Misure reali

Tutte con Claude Code 2.1.308 in modalità headless, costi a prezzi di listino come li calcola la CLI (`modelUsage.costUSD`). Un solo campione per prova: i numeri danno l'ordine di grandezza, non una media.

### 5.1 Router: lo stesso Explore su Sonnet e su Opus

Compito: leggere per intero i 32 file `.js` di `npm/lib/utils` (circa 119 KB) e descriverli. Sessione principale su Opus in entrambi i casi.

| | Router `prudent` (Explore su Sonnet) | Router `off` (Explore su Opus) | Differenza |
| --- | --- | --- | --- |
| File coperti | 32 su 32 | 32 su 32 | uguale |
| Costo del sub-agente | 0,247 $ | 0,509 $ | **−51%** |
| Costo totale della prova | 0,580 $ | 0,839 $ | **−31%** |
| Tempo del sub-agente | 33,4 s | 56,2 s | **−41%** |
| Tempo totale | 49,8 s | 68,5 s | **−27%** |
| Richieste del sub-agente | 3 | 5 | |
| Chiamate a strumenti | 33 | 33 | |

Il «Saved» che mostra pennycrab per la prova A è 0,247 $ (prezzi Opus esattamente doppi di Sonnet sugli stessi token); il risparmio reale misurato è 0,262 $. La stima della mod è quindi prudente, del 6% sotto il reale.

### 5.2 Precisione dei prezzi

Il costo del sub-agente Sonnet calcolato con la formula di `prices.ts` (scritture cache a 5 minuti) è **0,2473 $, identico al centesimo** a quello della CLI. Anche la conferma che i sub-agenti scrivono a 5 minuti viene dal transcript.

### 5.3 Guardiano dal vivo

Budget 0,50 $, Explore su tutti i 109 file di `npm/lib`, su Sonnet.

- Superato il budget arriva il toast `Pennycrab handed over "Survey npm lib": it reached its $0.50 budget.`
- Le 12 letture chieste nella risposta successiva vengono tutte rifiutate con il messaggio del guardiano.
- Al passo dopo il sub-agente scrive la risposta finale: 97 file letti su 109, con l'elenco dei 12 mancanti. Lo stop forzato non è servito.
- Costo totale della prova: 0,88 $, sessione principale compresa.

### 5.4 Cache calda dal vivo

PLACEHOLDER_CACHE

### 5.5 Quanto costa la mod in tempo

Per ogni chiamata a uno strumento di un sub-agente, pennycrab aggiunge una mediana di **5,4–5,9 ms** (p90 6,4–7,9 ms, 64 chiamate misurate). Su un Explore di 33–56 secondi con 33 strumenti sono circa 0,2 secondi, meno dello 0,5%.

## 6. Cosa vale in pratica

PLACEHOLDER_VALUE

## 7. Limiti noti

- **Il guardiano non può fermare le chiamate della risposta che supera il budget**: partono mentre la risposta arriva. Il costo oltre il budget è al massimo una risposta e i suoi strumenti, più le 2 richieste per chiudere.
- **I ping per una sessione abbandonata sono una spesa**: con la cache da 5 minuti e la finestra di 30 minuti sono 6 ping. Il pannello li mostra, ma non vengono sottratti dal «Saved» finché non torni.
- **Durante un turno lungo non si fanno ping** (per esempio un comando di 10 minuti): una cache da 5 minuti può scadere lì in mezzo.
- **I prezzi sono fissi nel codice** (listino del 22 ottobre 2026, solo modelli 5.x); un modello diverso non ha prezzo invece di averne uno sbagliato.
- **Il contesto dei sub-agenti** è misurato su una finestra fissa di 1M, che vale per tutti i modelli 5.x.
- **Icona**: non c'è. Il granchio è derivato da Clawd, la mascotte di Anthropic, quindi per un'icona pubblica conviene un disegno proprio.

## 8. Prossimi passi

1. **Tu: prove visive in Desktop** (punto 3 del piano precedente): riga «Guard» con il Guardiano e «⚑ over budget», banda con «handover», riga «Cache warm · …» nel pannello, toast alla chiusura del pannello, apertura del pannello a ogni ondata, dettagli dei granchi a 24 px.
2. **Unire `claude/elegant-fermat-ycm7rm` in `main`**: il marketplace legge il branch principale.
3. **Installare in modo pulito**: `/plugin install pennycrab --marketplace Batman110391/pennycrab` (in Desktop: **+** → Plugins → Add marketplace → Add plugin), dopo aver tolto `CLAUDE_CODE_PLUGIN_DIRS` se l'avevi rimesso.
4. **Facoltativi**: un'icona propria, il passaggio alla versione 1.0.0 con un tag, ping anche durante i turni molto lunghi.
