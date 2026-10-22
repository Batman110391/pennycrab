# pennycrab: stato e piano

Aggiornato il 22 ottobre 2026 · versione 0.3.0 · Claude Code 2.1.308 · branch `main`.

Questo file è scritto per la **sessione locale** che riprende il lavoro sul PC di Simone, in Claude Desktop. La logica della mod è finita, misurata dal vivo e coperta da test. **Il prossimo lavoro è la UI**: renderla perfetta e curata per chi la usa ogni giorno. La sezione 2 è il brief completo; le sezioni 1 e 4 servono come contesto.

## 1. Dove siamo

| Parte | Cosa fa | Stato |
| --- | --- | --- |
| Router (`hooks/router.ts`) | `auto`: Explore su Haiku con effort basso da qualsiasi modello superiore; general-purpose su Sonnet da Opus o Fable. `prudent`: entrambi su Sonnet. `off` | finito, misurato |
| Guardiano (`hooks/guard.ts`) | oltre il budget (2 $ di default) rifiuta gli strumenti del sub-agente con l'istruzione di consegnare; se insiste, dopo 2 richieste risponde la mod e il turno si chiude | finito, misurato |
| Cache calda (`hooks/cache.ts`) | `auto`: un ping 45 s prima che la cache scada, finché i ping di un'assenza costano al massimo un quarto della riscrittura che evitano, fino a 8 ore. Si adatta da sola: un ping all'ora con l'abbonamento (cache da 1 ora), pochi ping a consumo (cache da 5 minuti) | finito, misurato |
| Prezzi (`hooks/prices.ts`) | letti una volta al giorno dalla pagina ufficiale di Anthropic, salvati tra le sessioni; nessun prezzo nel codice | finito, verificato dal vivo |
| Configurazione automatica (`hooks/setup.ts`) | al primo turno un toast dice cosa ha rilevato (abbonamento o consumo, cache, router, budget); si ripete solo se cambia | finito, testato |
| Telemetria (`hooks/telemetry.ts`) | costo, contesto, tempo, strumento in uso per ogni sub-agente | finito |
| **UI** (`hooks/ui.tsx`) | pannello, banda sopra il prompt, riga di stato, i 6 Clawd vestiti | **funziona, da rifinire: sezione 2** |

Verifiche: `claude plugin test .` (65 test), `claude plugin validate . --profile directory`, controllo dei tipi con `tsc` sui tipi del motore. Ogni regola importante ha un test che fallisce se la si rompe (provato rompendone 11).

## 2. Brief per la sessione locale: la UI

### 2.1 Obiettivo

Chi apre il pannello deve capire **in due secondi** tre cose: quanto ha risparmiato, chi sta lavorando adesso (e su quale modello), se la cache è calda. Il resto (costo per riga, contesto, tempo) è lì quando lo cerca. Lo stile deve essere curato e coerente su Desktop chiaro e scuro e sul terminale.

Il giudice è Simone, guardando il pannello vero in Desktop: niente si considera finito finché non l'ha visto lui.

### 2.2 Come lavorare

1. Aggiorna il clone locale: `git pull` su `main`, poi crea un branch per la UI.
2. Carica la mod dalla cartella. In Desktop: `CLAUDE_CODE_PLUGIN_DIRS=~/progetti/pennycrab` e `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` nel blocco `env` di `~/.claude/settings.json`, poi riavvia l'app. In alternativa, la copia nella cartella delle mod della sessione, come prima. Ogni salvataggio ricarica la mod a fine turno.
3. Per vedere ogni stato senza spendere: lancia un Explore in background per «running», abbassa il budget a 0,50 $ per «Guard», aspetta oltre la durata della cache per «Cache expired». Per gli stati difficili da provocare, aggiungi un test che monta il pannello (`$.ui.mount`) e controlla cosa disegna.
4. **Tocca solo `hooks/ui.tsx`** (e i suoi test). Router, guardiano, cache, prezzi e telemetria sono finiti e misurati: se la UI ha bisogno di un dato nuovo, aggiungilo allo stato (`types/index.d.ts`) senza cambiare la logica.
5. Prima di ogni push: `claude plugin test .` e `claude plugin validate .` verdi. Prima di cambiare il disegno, una bozza mostrata a Simone; dopo, la prova dal vivo.

### 2.3 Cosa c'è oggi

| Superficie | Cosa disegna | Dove nel codice |
| --- | --- | --- |
| Pannello, Desktop | sfondo a puntini (pezzi alti al massimo 4096 px), 3 schede in alto (Cost, Saved, Main context), pulsante Collapse, riga della cache, sezioni Running · Guard · Finished, una riga SVG da 66 px per sub-agente (granchio, titolo, modello e da dove è stato spostato, strumento, contesto, costo, tempo, barra del contesto, segno di stato) | `renderPane`, `headSvg`, `rowSvg`, `paper` |
| Pannello compatto, Desktop | una fila di granchi e i totali | `shelfSvg` |
| Pannello, terminale | lo stesso in testo, con barre `█░` | `renderPane`, ramo terminale |
| Banda sopra il prompt | fino a 5 granchi da 24 px, «N running · M handover», barra del contesto principale, «saved $X», pulsanti ×N e ✕ | `renderBand`, `bandSvg` |
| Riga di stato | `🦀S 21% 1m59s` per al massimo due sub-agenti, poi «🦀 saved $X» | `statusLine`, `tick` |
| Toast | configurazione al primo turno, chiusura del pannello, guardiano scattato | `setup.ts`, `register.ts`, `guard.ts` |
| Granchi | i 6 Clawd vestiti approvati: Haiku fattorino, Sonnet esploratore, Opus banchiere, Fable re, Pennycrab con la moneta (modello sconosciuto), Guardiano (fermato) | `COSTUMES`, `crab` |

### 2.4 Cosa sappiamo già di Desktop

Queste cose sono costate tentativi: non rifarli.

- **Desktop mette gli elementi fratelli su righe separate**: per un layout orizzontale serve un solo `Svg` per riga.
- **Su Desktop `$.ui.invalidate` non arriva alla banda**: si ridisegna scrivendo un valore di stato che il disegno legge (l'atomo `now`, aggiornato ogni secondo mentre lavorano sub-agenti, ogni 15 s mentre la cache conta).
- **La banda vuota del motore** (`{ type: 'engine' }`) non va messa dentro la nostra: Desktop scarta tutta la banda.
- **Un `Svg` alto più di 4096 px** non viene accettato: lo sfondo va a pezzi.
- **Il terminale elenca `Svg` ma non lo disegna**: si controlla sempre `e.surface`.
- **La riga di stato di pennycrab compare sopra quella di Claude**: è voluto, non va spostata.
- Le indicazioni di Simone: nessuna dipendenza da altre mod, si prende spunto da mod che funzionano (savvy-progress, session-band) ma il codice è nostro; i granchi restano Clawd chiaramente vestiti, perché Clawd è la mascotte di Anthropic.

### 2.5 Problemi da risolvere

*In arrivo: i problemi della UI trovati dalla revisione del codice in corso, verificati uno per uno.*

### 2.6 Direzione di design

- **Gerarchia**: in alto un solo numero grande, il risparmio della sessione, con sotto il costo; il contesto principale come barra sottile. Le schede tutte uguali oggi danno lo stesso peso a tre cose che non pesano uguale.
- **Cache visibile**: la riga di testo diventa un piccolo elemento grafico (stato caldo, in uso o scaduto; tempo residuo; numero e costo dei ping), con le parole giuste per l'abbonamento («ping orari, fino a 8 h») e per il consumo.
- **Abbonamento**: dove si mostrano dollari a un abbonato, dire che sono equivalenti a listino e che contano sui limiti (una nota sottile, non un'etichetta su ogni numero).
- **Righe**: modello e granchio sono l'informazione principale; «↓ from Opus» e «low» come chip leggeri; il costo `?` (prezzi mai scaricati) spiegato con un hover.
- **Colori**: un colore per modello, uguale in pannello, banda e riga di stato; verde solo per i risparmi, ambra solo per il guardiano; tutto leggibile in chiaro e in scuro (oggi i colori dei modelli sono fissi e il tema scuro passa solo per alcune classi CSS).
- **Movimento**: solo i granchi al lavoro camminano; nessuna animazione se il sistema chiede movimento ridotto (già così: va mantenuto).
- **Larghezze**: il pannello da 240 a 900 px, la banda fino a 1600 px; niente testo tagliato senza `…`, niente sovrapposizioni.

### 2.7 Criteri di accettazione

- [ ] Pannello vuoto: dice cosa farà la mod, non solo «No subagents yet».
- [ ] Un sub-agente al lavoro: granchio che cammina, modello, strumento in uso, tempo che scorre.
- [ ] Tre sub-agenti insieme, uno fermato dal guardiano: sezioni chiare, il Guardiano con «⚑ over budget».
- [ ] Cache: calda (con il tempo residuo), in uso, scaduta, con ping; parole diverse per abbonamento e consumo.
- [ ] Prezzi mai scaricati: `?` spiegato.
- [ ] Banda: leggibile a 24 px, i dettagli dei granchi riconoscibili o semplificati.
- [ ] Riga di stato: lettera del modello corretta, `?` per i modelli sconosciuti.
- [ ] Tema chiaro e scuro su Desktop; terminale stretto (40 colonne) e largo.
- [ ] Movimento ridotto rispettato.
- [ ] Test e validazione verdi; Simone ha visto e approvato ogni stato.

## 3. Altri passi, non UI

1. Installazione pulita dal marketplace: `/plugin install pennycrab --marketplace Batman110391/pennycrab` (in Desktop: **+** → Plugins → Add marketplace → Add plugin), dopo aver tolto `CLAUDE_CODE_PLUGIN_DIRS`.
2. Un controllo automatico su GitHub che a ogni push lanci test e validazione.
3. Un'icona disegnata da zero (non Clawd) per il catalogo dei plugin.
4. Da valutare: le tariffe aziendali `modelPricing`, il sovrapprezzo 1,1× per l'inferenza solo negli USA, i ping durante i comandi molto lunghi.

## 4. Misure e scoperte

Tutte con Claude Code 2.1.308 in modalità headless, costi a listino come li calcola la CLI. Un campione per prova.

### 4.1 Misure dal vivo

| Prova | Senza pennycrab | Con pennycrab |
| --- | --- | --- |
| Explore su 32 file da una sessione Opus | 0,509 $, 56,2 s (su Opus) | 0,013 $, 23,7 s (su Haiku), stessi file descritti |
| Lo stesso Explore su Sonnet | 0,247 $, 33,4 s | 0,013 $, 23,7 s |
| Messaggio dopo 8 min 40 s di pausa, 61K token, cache da 5 min | 0,088 $ misurato, ~0,153 $ senza cache condivisa; risposta in 3,5 s | 0,019 $ con 2 ping; risposta in 1,8 s |
| Explore su 109 file con budget 0,50 $ | nessun tetto | fermato al budget, 97 file letti e consegnati con l'elenco dei 12 mancanti |
| Prezzi | | stima di pennycrab uguale al centesimo al costo della CLI |
| Prezzi dal vivo | | pagina scaricata in 0,68 s, 20 modelli letti e salvati |
| Tempo aggiunto | | 5–6 ms per chiamata a strumento |

*In arrivo: la prova dal vivo di un'assenza di 1 ora e 5 minuti con un abbonamento, con e senza cache calda.*

### 4.2 Scoperte sul motore

- **Non esiste `$.agent.stop`**: un sub-agente si ferma rifiutandogli gli strumenti in `tool.call` e rispondendo al suo posto in `turn.step`.
- **Gli strumenti partono mentre la risposta arriva**: le chiamate della risposta che supera il budget vengono eseguite comunque.
- **`$.model.fork`** rimanda l'ultima richiesta della conversazione principale con un messaggio in coda: legge la cache e così la rinnova. Non fa scattare gli hook di turno, quindi non conta come un tuo turno. Dopo un solo turno può riscrivere una volta la parte dei messaggi.
- **La cache è condivisa sull'account** per la parte identica (prompt di sistema e strumenti): un ping di una sessione la tiene viva anche per le altre.
- **TTL**: `FORCE_PROMPT_CACHING_5M`, poi `CLAUDE_CODE_PROMPT_CACHE_TTL`, poi `promptCacheTtl`, poi `ENABLE_PROMPT_CACHING_1H`, poi l'account (1 ora con un abbonamento entro i limiti). Un abbonamento si riconosce dalle finestre `five_hour` e `seven_day` in `$.session.usage().rateLimits`.
- **Claude Code stesso ha i prezzi scritti nel codice** e li aggiorna a ogni rilascio; il catalogo che scarica serve al selettore dei modelli. L'unica fonte pubblica leggibile da una mod è la pagina dei prezzi in Markdown.
- **Explore**: gira sul modello della sessione; con Fable gira su Opus.
- **Kit di test**: gli hook vanno registrati prima della prima chiamata a `$`; le risposte finte alle chiamate su `$` sono `{ value }`; il valore finale di uno stream si legge con `next()`; un `advance` dell'orologio risolve al massimo 10.000 attese; un test lungo chiede `timeoutMs`.

### 4.3 Limiti noti

- Il guardiano non ferma le chiamate della risposta che supera il budget.
- I ping per una sessione abbandonata sono una spesa, limitata da `auto` a un quarto di una riscrittura.
- Il «Saved» della cache sovrastima un po' quando altre sessioni tengono viva la parte comune; quello del router è prudente.
- Nessun ping durante un turno lungo.
- Non contati: tariffe aziendali `modelPricing` e sovrapprezzo 1,1× per l'inferenza solo negli USA.
