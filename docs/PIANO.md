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
2. **Cache calda**: TTL letto nello stesso ordine del motore; ping con `$.model.fork` 45 secondi prima della scadenza; nessun ping su una cache già scaduta; stop dei ping se un ping ha dovuto riscrivere più di metà del contesto; risparmio contabilizzato sul messaggio successivo, al netto del costo dei ping. Le ultime due regole vengono dalla prova dal vivo (sezione 5.4).
3. **Bug corretto**: il toast «Pennycrab closed…» non compariva mai (`e.origin` è un oggetto `{ kind }`, non una stringa).
4. **Test**: da 21 a 47. Coprono guardiano, cache (TTL in 9 casi, 6 ping in 30 minuti, nessun ping con cache da 1 ora, una riscrittura parziale non ferma i ping, una riscrittura di quasi tutto sì, nessun ping su una cache scaduta, a turno aperto o con l'opzione `off`), riga di stato, strumento in uso.
5. **Pacchetto**: `marketplace.json`, `README.md`, autore, repository, licenza e parole chiave in `plugin.json`. La validazione passa anche con il profilo del catalogo dei plugin.
6. **Tipi**: tolto dalla cache il campo `held`, di cui non si conosceva lo scopo; al suo posto i campi che servono alla cache calda (fine dell'ultimo turno, turno aperto, ping del tratto in corso, risparmio).

## 3. Scoperte sul motore (utili per i prossimi passi)

- **Non esiste `$.agent.stop`.** Un sub-agente si ferma in due modi: rifiutando i suoi strumenti in `tool.call` (`{ deny }`, il modello legge il testo come errore) e rispondendo al suo posto in `turn.step` (una risposta senza strumenti chiude il turno).
- **Gli strumenti partono mentre la risposta arriva.** Le chiamate della stessa risposta che supera il budget vengono eseguite comunque; il guardiano agisce dalla risposta dopo.
- **`$.model.fork`** rimanda l'ultima richiesta della conversazione principale con un messaggio in coda: legge il prefisso dalla cache e così ne rinnova la scadenza. È la base della cache calda. Dopo un solo turno può riscrivere una volta la parte dei messaggi, perché li rimanda come li tiene il transcript; dal secondo turno legge tutto.
- **La cache è condivisa sull'account**: due sessioni con lo stesso prompt di sistema e gli stessi strumenti leggono la stessa voce per quella parte. Un ping di una sessione tiene viva quella parte anche per le altre.
- **La CLI conta i ping nel costo della sessione** (`total_cost_usd`): il costo di un ping misurato dalla mod e quello della CLI coincidono.
- **TTL della conversazione principale**, nell'ordine del motore: `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, l'impostazione `promptCacheTtl`, `ENABLE_PROMPT_CACHING_1H`, poi l'account (1 ora con un abbonamento Claude entro i limiti, 5 minuti con chiave API, Bedrock, Vertex o Foundry). I sub-agenti scrivono a 5 minuti salvo `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` o `subagentPromptCacheTtl`.
- **Un abbonamento si riconosce** dalle finestre `five_hour` e `seven_day` in `$.session.usage().rateLimits`; con una chiave API non ci sono.
- **In modalità headless** il modulo della mod si carica all'inizio del primo turno, non all'avvio (aspetta un flag di rollout): nessun effetto pratico.
- **Kit di test**: gli hook vanno registrati prima della prima chiamata a `$`; una risposta finta a una chiamata su `$` va data come `{ value }`; il valore finale di uno stream `turn.step` si legge con `next()`, perché `for await` lo scarta; non si può simulare una chiusura del pannello fatta a mano.

## 4. Verifiche

| Verifica | Esito |
| --- | --- |
| `claude plugin test .` | 47 test, 0 falliti |
| Test che falliscono se si rompe la regola che proteggono | provato su 4 regole (ripresa del sub-agente, ping a vuoto, turno aperto, soglia di riscrittura) |
| `tsc` con i tipi del motore 2.1.308 | nessun errore |
| `claude plugin validate .` e `--profile directory` | passa; resta solo l'avviso sull'icona |
| Installazione da marketplace (`claude plugin marketplace add` + `install`) | installata e abilitata, 3 opzioni lette |
| Prova dal vivo del guardiano | vedi 5.3 |
| Prova dal vivo del router | vedi 5.1 |
| Prova dal vivo della cache calda | vedi 5.4 |
| **Non provati dal vivo** | il guardiano su Haiku oltre 100K, il router `aggressive`, la cache calda con la cache da 1 ora di un abbonamento (dove la finestra predefinita non fa ping), tutta la parte grafica |

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

Sessione su Sonnet tenuta aperta, cache forzata a 5 minuti (`FORCE_PROMPT_CACHING_5M=1`), `keepWarm` a 30 minuti contro `off`.

**Prova principale**: conversazione di 3 messaggi; il primo legge 5 file e porta il contesto a 61K token; dopo il secondo, una pausa di 8 minuti e 40 secondi, poi il terzo.

| Terzo messaggio dopo la pausa | Con i ping | Senza ping (misurato) | Senza ping (nessuna cache condivisa) |
| --- | --- | --- | --- |
| Token letti / scritti in cache | 61.140 / 64 | 27.148 / 34.023 | 0 / ~61.200 |
| Costo del messaggio | 0,0063 $ | 0,0878 $ | ~0,153 $ |
| Costo dei ping | 2 × 0,0064 $ | | |
| **Totale** | **0,0190 $** | **0,0878 $** | **~0,153 $** |
| Tempo alla prima risposta (TTFT) | 1,8 s | 3,5 s | |

- **Ogni ping ha letto tutta la conversazione** (61.081 e 61.140 token letti, 59 e 0 scritti), in 1,3–3,7 secondi. Un ping è costato 1/24 di una riscrittura, come prevede il listino (lettura a 0,1 $ per milione contro scrittura a 2,5 $ su Sonnet).
- **Risparmio sul messaggio di ritorno: −78% misurato, −88% senza cache condivisa.** Il «Saved» calcolato da pennycrab per questa sessione è 0,134 $ (riscrittura evitata meno i ping), cioè il caso senza cache condivisa.
- **Perché il «senza ping» ha letto 27K token:** la parte iniziale della richiesta (prompt di sistema e strumenti) era identica nelle due sessioni e la cache è condivisa sullo stesso account; i ping della sessione calda l'hanno tenuta viva anche per l'altra. Nell'uso reale, altre sessioni aperte possono fare lo stesso: in quel caso il «Saved» di pennycrab sovrastima un po'.

**Prima prova**, con un solo turno (35K token) e 6 minuti e 40 secondi di pausa: il ping ha letto 27K token e ne ha **riscritti 7,8K** (la parte dei messaggi), 0,022 $; il messaggio dopo ha letto tutti i 34.793 token e ne ha scritti 65. La riscrittura succede una volta sola: il fork rimanda la conversazione come la tiene il transcript, che dopo il primo turno può differire da come era partita la prima richiesta. Da qui le due correzioni al keep-warm: nessuno stop per una riscrittura parziale, nessun ping su una cache già scaduta. Il TTFT di quella prova (2,9 s con i ping, 2,1 s senza) non mostra differenze: a 35K token il tempo è rumore.

Costo di tutte le prove dal vivo: circa 2,83 $ a prezzi di listino.

### 5.5 Quanto costa la mod in tempo

Per ogni chiamata a uno strumento di un sub-agente, pennycrab aggiunge una mediana di **5,4–5,9 ms** (p90 6,4–7,9 ms, 64 chiamate misurate). Su un Explore di 33–56 secondi con 33 strumenti sono circa 0,2 secondi, meno dello 0,5%.

## 6. Cosa vale in pratica

Stime costruite sulle misure sopra; un solo campione per prova, quindi ordini di grandezza.

**Router** (attivo di default, per chi lavora su Opus o Fable):
- per un Explore come quello misurato: **−0,26 $ e −23 secondi**, con lo stesso risultato;
- con 10 Explore al giorno: circa **2,6 $ e 4 minuti** al giorno; il costo del sub-agente si dimezza sempre, perché Sonnet costa metà di Opus su ogni tipo di token.

**Cache calda** (conta per chi ha la cache a 5 minuti: chiave API, Bedrock, Vertex, Foundry, o un abbonamento oltre i limiti):
- ogni volta che torni dopo una pausa fra 5 e 30 minuti risparmi la riscrittura del contesto, meno i ping: **0,13 $ con 61K token su Sonnet**, **circa 0,88 $ con 200K token su Opus** (riscrittura 0,96 $, 2 ping 0,08 $);
- se non torni, i ping costano: con 200K token su Opus e la finestra di 30 minuti sono 6 ping, circa 0,24 $. Conviene se torni almeno una volta su quattro;
- con un abbonamento entro i limiti la cache dura già 1 ora: la finestra di 30 minuti non fa partire nessun ping e non costa nulla.

**Guardiano**: il risparmio dipende da quanto avrebbe speso il sub-agente fuori controllo. Nella prova si è fermato a 97 file su 109 consegnando quello che aveva; il valore è il tetto alla spesa, non una percentuale.

**Prezzo in tempo della mod**: circa 5–6 ms per chiamata a uno strumento, meno dello 0,5% di un Explore.

Con un abbonamento i dollari sono l'equivalente a listino: il beneficio reale è sull'utilizzo dei limiti, non sulla bolletta.

## 7. Limiti noti

- **Il guardiano non può fermare le chiamate della risposta che supera il budget**: partono mentre la risposta arriva. Il costo oltre il budget è al massimo una risposta e i suoi strumenti, più le 2 richieste per chiudere.
- **I ping per una sessione abbandonata sono una spesa**: con la cache da 5 minuti e la finestra di 30 minuti sono 6 ping. Il pannello li mostra, ma non vengono sottratti dal «Saved» finché non torni.
- **Il «Saved» della cache sovrastima un po' quando altre sessioni** con lo stesso prompt di sistema tengono viva la parte iniziale: senza ping quella parte sarebbe stata letta lo stesso.
- **Il «Saved» del router è leggermente prudente**: assume che Opus avrebbe usato gli stessi token; nella prova Opus ne ha usati di più (risparmio reale 0,262 $, stimato 0,247 $).
- **Durante un turno lungo non si fanno ping** (per esempio un comando di 10 minuti): una cache da 5 minuti può scadere lì in mezzo.
- **I prezzi sono fissi nel codice** (listino del 22 ottobre 2026, solo modelli 5.x); un modello diverso non ha prezzo invece di averne uno sbagliato.
- **Il contesto dei sub-agenti** è misurato su una finestra fissa di 1M, che vale per tutti i modelli 5.x.
- **Icona**: non c'è. Il granchio è derivato da Clawd, la mascotte di Anthropic, quindi per un'icona pubblica conviene un disegno proprio.

## 8. Prossimi passi

1. **Tu: prove visive in Desktop** (punto 3 del piano precedente): riga «Guard» con il Guardiano e «⚑ over budget», banda con «handover», riga «Cache warm · …» nel pannello, toast alla chiusura del pannello, apertura del pannello a ogni ondata, dettagli dei granchi a 24 px.
2. **Unire `claude/elegant-fermat-ycm7rm` in `main`**: il marketplace legge il branch principale.
3. **Installare in modo pulito**: `/plugin install pennycrab --marketplace Batman110391/pennycrab` (in Desktop: **+** → Plugins → Add marketplace → Add plugin), dopo aver tolto `CLAUDE_CODE_PLUGIN_DIRS` se l'avevi rimesso.
4. **Facoltativi**: un'icona propria, il passaggio alla versione 1.0.0 con un tag, ping anche durante i turni molto lunghi.
