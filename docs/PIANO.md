# pennycrab: stato e piano

Aggiornato il 22 ottobre 2026 · versione 0.3.1 · Claude Code 2.1.308 · branch `main`.

Questo file è scritto per la **sessione locale** che riprende il lavoro sul PC di Simone, in Claude Desktop. La logica della mod è finita, misurata dal vivo, rivista da una revisione completa del codice e coperta da test. **Il prossimo lavoro è la UI**: renderla perfetta e curata per chi la usa ogni giorno. La sezione 2 è il brief completo; le sezioni 1 e 4 servono come contesto.

## 1. Dove siamo

| Parte | Cosa fa | Stato |
| --- | --- | --- |
| Router (`hooks/router.ts`) | `auto`: Explore su Haiku con effort basso da qualsiasi modello superiore; general-purpose su Sonnet da Opus o Fable. `prudent`: entrambi su Sonnet. `off` | finito, misurato |
| Guardiano (`hooks/guard.ts`) | oltre il budget (2 $ di default) rifiuta gli strumenti del sub-agente con l'istruzione di consegnare; se insiste, dopo 2 richieste risponde la mod e il turno si chiude | finito, misurato |
| Cache calda (`hooks/cache.ts`) | `auto`: un ping 45 s prima che la cache scada, finché i ping di un'assenza costano al massimo un quarto della riscrittura che evitano, fino a 8 ore. Si adatta da sola: un ping all'ora con l'abbonamento (cache da 1 ora), pochi ping a consumo (cache da 5 minuti). Un ping rifiutato dall'API si riprova dopo 15 s | finito, misurato con entrambe le cache |
| Prezzi (`hooks/prices.ts`) | letti una volta al giorno dalla pagina ufficiale di Anthropic (ogni 10 minuti finché non la raggiunge), salvati tra le sessioni; nessun prezzo nel codice | finito, verificato dal vivo |
| Configurazione automatica (`hooks/setup.ts`) | al primo turno un toast dice cosa ha rilevato (abbonamento o consumo, cache, router, budget); si ripete solo se cambia | finito, testato |
| Telemetria (`hooks/telemetry.ts`) | costo, contesto, tempo, strumento in uso per ogni sub-agente; da dove è stato spostato e con che effort, nella sua riga (sopravvive a un ricaricamento); un sub-agente ripreso tiene la sua spesa | finito |
| **UI** (`hooks/ui.tsx`) | pannello, banda sopra il prompt, riga di stato, i 6 Clawd vestiti | **funziona, da rifinire: sezione 2** |

Verifiche: `claude plugin test .` (88 test), `claude plugin validate . --profile directory`, controllo dei tipi con `tsc` sui tipi del motore. Ogni regola importante ha un test che fallisce se la si rompe: provato rompendo una a una le 26 correzioni della revisione (sezione 4.4), più le 11 regole di prima.

## 2. Brief per la sessione locale: la UI

### 2.1 Obiettivo

Chi apre il pannello deve capire **in due secondi** tre cose: quanto ha risparmiato, chi sta lavorando adesso (e su quale modello), se la cache è calda. Il resto (costo per riga, contesto, tempo) è lì quando lo cerca. Lo stile deve essere curato e coerente su Desktop chiaro e scuro e sul terminale.

A giudicare è Simone, guardando il pannello vero in Desktop: niente si considera finito prima che Simone l'abbia visto.

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
- **Ogni `Svg` è un'immagine**: quando il suo sorgente cambia (il tempo di una riga, ogni secondo), Desktop la sostituisce e le animazioni CSS ripartono da zero.
- **La banda non deve leggere `now` né `cache`**: un disegno si rifà quando cambia un valore che legge, e la banda si porta dietro quella di ogni altra mod. Oggi legge solo `agents`, `main`, `savings`, `ui` (c'è un test).
- **Un pannello aperto senza che la persona lo chieda** va aperto solo dove si aggancia di lato (`e.viewport.isFullscreen`), non sullo schermo principale del terminale, dove finirebbe sopra il prompt. Sotto i 144 colonne resta in attesa, non disegnato (`$.ui.panes()`: `isPlaced: false`).
- **La riga di stato di pennycrab compare sopra quella di Claude**: è voluto, non va spostata.
- Le indicazioni di Simone: nessuna dipendenza da altre mod, si prende spunto da mod che funzionano (savvy-progress, session-band) ma il codice è nostro; i granchi restano Clawd chiaramente vestiti, perché Clawd è la mascotte di Anthropic.

### 2.5 Problemi da risolvere

La revisione del codice del 22 ottobre (4 lenti: tempi e stato, API del motore, economia, UI e test; 46 segnalazioni, ognuna verificata da un secondo agente) ha trovato 40 problemi reali. Quelli di logica e di numeri sbagliati a schermo sono già corretti, con un test ciascuno (sezione 4.4). Restano questi, tutti di disegno, tutti in `hooks/ui.tsx`:

1. **Contrasto nel tema scuro.** Il verde dei risparmi (`GOOD`, #3B6D11) sulla scheda scura (#2A2A28) ha un contrasto di 2,3:1, nella banda di 2,7:1; il rosso della croce (`BAD`, #A32D2D) di 2,0:1. Per un testo di quella misura serve almeno 4,5:1: il numero più importante del pannello è il meno leggibile al buio. Soluzione: GOOD, BAD e i colori dei modelli usati come testo (`<tspan fill>`) diventano classi in `STYLE` con la loro variante scura, per esempio `.good{fill:#3B6D11}` e, sotto `prefers-color-scheme: dark`, `.good{fill:#97C459}`.
2. **Le animazioni ripartono ogni secondo** (vedi 2.4). Quelle con un periodo che divide 1 s ripartono pulite; il puntino che pulsa (1,2 s) e la moneta che gira (1,6 s) scattano. Soluzione: periodi di 1 s o 0,5 s, oppure il tempo che scorre fuori dall'`Svg` della riga.
3. **Nessun test preme un pulsante**: ✕ e ×N della banda, Collapse/Expand, Finished. Prima di rifarli, un test ciascuno con `press()`: per esempio, ✕ nasconde la banda e il sub-agente successivo la riporta.
4. **I sub-agenti fermati dal guardiano restano in «Guard» anche finiti**, disegnati come quelli ancora attivi, finché non ne finiscono altri 20. Da decidere con Simone: spostarli in Finished con il segno «⚑ over budget».
5. **Dollari per un abbonato.** Con un abbonamento nulla si paga a token: Cost e Saved sono equivalenti a listino, che contano sui limiti delle 5 ore e settimanali. Oggi lo dice solo il README. Serve un dato nuovo nello stato (abbonato sì o no: `ttlOf` lo sa già dalle `rateLimits`, va tenuto separato da `ttlSource`, che le variabili possono cambiare) e una nota sottile nel pannello.
6. **«Cache in use» durante un turno lungo.** Mentre un turno è aperto non parte nessun ping (è voluto), anche quando il turno aspetta un permesso da 20 minuti; intanto la riga dice «Cache in use» mentre la cache scade. Servono parole che non ingannino, senza cambiare la logica.
7. **Icona.** `claude plugin validate` avvisa `ICON_MISSING`: serve un PNG quadrato da 512 a 2048 px in `.claude-plugin/icon.png`. Il catalogo la prende solo la prima volta che il plugin viene inviato: va fatta bene prima dell'invio.

Già sistemati, da non rompere (ognuno ha un test): il pannello si apre da solo una volta per ondata anche quando più sub-agenti partono insieme, e non sullo schermo principale del terminale; `/pennycrab` mostra un pannello rimasto in attesa invece di chiuderlo; una perdita si scrive «−$0.02» e non in verde; `?` per un costo che non si conosce (una riga con un modello che la pagina non elenca, `isUnpriced`; i ping senza prezzi); la riga della cache finisce sempre su «Cache expired»; ×N e «N running» contano solo i sub-agenti al lavoro; le cifre della riga sono separate da « · » perché l'SVG compatta gli spazi; ogni testo passa da `esc()`.

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
- [ ] Prezzi mai scaricati, o modello che la pagina non elenca: `?` spiegato.
- [ ] Tema scuro: ogni testo almeno 4,5:1 (punto 1 della 2.5).
- [ ] Animazioni che non scattano quando la riga si aggiorna (punto 2).
- [ ] Ogni pulsante coperto da un test che lo preme (punto 3).
- [ ] Banda: leggibile a 24 px, i dettagli dei granchi riconoscibili o semplificati.
- [ ] Riga di stato: lettera del modello corretta, `?` per i modelli sconosciuti.
- [ ] Tema chiaro e scuro su Desktop; terminale stretto (40 colonne) e largo.
- [ ] Movimento ridotto rispettato.
- [ ] Test e validazione verdi; Simone ha visto e approvato ogni stato.

## 3. Altri passi, non UI

1. Installazione pulita dal marketplace: `/plugin install pennycrab --marketplace Batman110391/pennycrab` (in Desktop: **+** → Plugins → Add marketplace → Add plugin), dopo aver tolto `CLAUDE_CODE_PLUGIN_DIRS`.
2. Un controllo automatico su GitHub che a ogni push lanci test e validazione.
3. Un'icona disegnata da zero (non Clawd) per il catalogo dei plugin: punto 7 della 2.5.
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
| Messaggio dopo 65 min di assenza, 61K token, abbonamento (cache da 1 ora), Sonnet 5.5 | 0,244 $: cache scaduta, tutti i 61.077 token riscritti; risposta in 5,8 s | 0,013 $ con il ping: un solo ping a 59 min 15 s, poi il messaggio legge 60.934 token dalla cache e ne scrive 115; risposta in 3,3 s |
| Tempo aggiunto | | 5–6 ms per chiamata a strumento |

La prova da 65 minuti è il caso che conta per chi ha un abbonamento: la cache da 1 ora copre già le pause più brevi, e senza pennycrab il ritorno dopo l'ora paga tutto il contesto di nuovo. Con pennycrab: −95% sul primo messaggio e risposta quasi doppiamente veloce.

### 4.2 Scoperte sul motore

- **Non esiste `$.agent.stop`**: un sub-agente si ferma rifiutandogli gli strumenti in `tool.call` e rispondendo al suo posto in `turn.step`.
- **Gli strumenti partono mentre la risposta arriva**: le chiamate della risposta che supera il budget vengono eseguite comunque.
- **`$.model.fork`** rimanda l'ultima richiesta della conversazione principale con un messaggio in coda: legge la cache e così la rinnova. Non fa scattare gli hook di turno, quindi non conta come un tuo turno. Dopo un solo turno può riscrivere una volta la parte dei messaggi.
- **La cache è condivisa sull'account** per la parte identica (prompt di sistema e strumenti): un ping di una sessione la tiene viva anche per le altre.
- **TTL**: `FORCE_PROMPT_CACHING_5M`, poi `CLAUDE_CODE_PROMPT_CACHE_TTL`, poi `promptCacheTtl`, poi `ENABLE_PROMPT_CACHING_1H`, poi l'account (1 ora con un abbonamento entro i limiti). Un abbonamento si riconosce dalle finestre `five_hour` e `seven_day` in `$.session.usage().rateLimits`.
- **Claude Code stesso ha i prezzi scritti nel codice** e li aggiorna a ogni rilascio; il catalogo che scarica serve al selettore dei modelli. L'unica fonte pubblica leggibile da una mod è la pagina dei prezzi in Markdown.
- **Explore**: gira sul modello della sessione; con Fable gira su Opus.
- **`$.model.fork` che fallisce** (429, 529, interruzione) risponde con `usage` a zero: va distinto da un ping riuscito guardando i token letti e scritti, non la presenza di `usage`.
- **Un sub-agente ripreso** (SendMessage) ripassa da `agent.spawn` con `e.resume` e lo stesso id: la sua riga va ripresa, non rifatta.
- **Un hook di `turn.step` che fallisce** dopo la risposta del modello viene saltato e lo stream arriva intero, una volta sola (c'è un test): un `.catch` lì non aggiunge nulla.
- **`$.session.usage().cost`** è il costo dell'intera sessione, sub-agenti e ping compresi; `$.session.model()` è il modello come lo mostra `/model`.
- **Kit di test**: gli hook vanno registrati prima della prima chiamata a `$`; le risposte finte alle chiamate su `$` sono `{ value }`; il valore finale di uno stream si legge con `next()`; un `advance` dell'orologio risolve al massimo 10.000 attese; un test lungo chiede `timeoutMs`; `clock.sleep(ms)` in un hook finto fa rispondere il motore in ritardo; `$.command.run` lancia un comando.

### 4.3 Limiti noti

- Il guardiano non ferma le chiamate della risposta che supera il budget.
- I ping per una sessione abbandonata sono una spesa, limitata da `auto` a un quarto di una riscrittura.
- Il «Saved» della cache sovrastima un po' quando altre sessioni tengono viva la parte comune; quello del router è prudente.
- Nessun ping durante un turno aperto, anche se aspetta un permesso.
- Un sub-agente su un modello che la pagina non elenca mostra `?`, e il guardiano non può fermarlo: il budget non si applica a un costo che non si conosce.
- Il primo ping dopo un turno può riscrivere una volta parte della conversazione: da solo può costare quasi il quarto ammesso.
- Non contati: tariffe aziendali `modelPricing` e sovrapprezzo 1,1× per l'inferenza solo negli USA.

### 4.4 Revisione del codice (22 ottobre)

Corretto, ogni voce con il suo test:

| Dove | Cosa non andava | Ora |
| --- | --- | --- |
| Cache calda | la vita della cache contava dalla fine della risposta: dopo una risposta lunga il ping arrivava a cache già scaduta | conta dall'inizio della richiesta |
| Cache calda | un ping rifiutato dall'API (429, 529) contava come rinnovo | non conta; si riprova dopo 15 s finché la cache non sarebbe scaduta |
| Cache calda | un ping ancora in volo quando parte il turno successivo veniva contato due volte e spostava indietro la vita della cache | contato una volta, come spesa |
| Cache calda | due tick lenti potevano mandare due ping insieme | il ping è prenotato prima di ogni attesa |
| Cache calda | `auto` stimava il ping successivo come la media dei precedenti, che contiene la riscrittura una tantum del primo | lo stima come una lettura del contesto |
| Cache calda | dopo `/model` un ping riscriveva tutto sul nuovo modello, per niente | nessun ping dopo un cambio di famiglia |
| Sub-agenti | un sub-agente ripreso ripartiva da 0 $, con un budget nuovo | tiene spesa e consegna |
| Sub-agenti | da dove era stato spostato e l'effort basso si perdevano a un ricaricamento della mod (per esempio dopo `/plugin configure`) | stanno nella riga |
| Sub-agenti | il costo della sessione si aggiornava solo ai passi del thread principale | anche ai passi dei sub-agenti e ai ping |
| Sub-agenti | un modello che la pagina non elenca mostrava 0,00 $ | `?` |
| Sub-agenti | un Explore sotto Fable contava il risparmio rispetto a Fable, ma senza pennycrab girerebbe su Opus | rispetto a Opus |
| Sub-agenti | Mythos non veniva instradato; le righe dei teammate potevano sparire | Mythos come Fable; i teammate restano |
| Prezzi | una sessione partita senza rete restava senza prezzi (e senza guardiano) fino alla fine | riprova ogni 10 minuti |
| UI | `/pennycrab`, ondate parallele, schermo principale del terminale, perdite in verde, `?`, riga della cache bloccata, ×N, banda ridisegnata ogni secondo, spazi compattati, `esc()` senza test | vedi la fine della 2.5 |

Segnalazioni scartate dalla verifica (6): comportamenti voluti e documentati, o casi che richiedono tre coincidenze e non producono numeri sbagliati.
