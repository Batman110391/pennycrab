# pennycrab: stato e piano

Aggiornato il 23 ottobre 2026 · versione 0.4.0 · Claude Code 2.1.302 · branch `main`.

Questo file è scritto per chi riprende il lavoro su pennycrab. La logica della mod è finita, misurata dal vivo, rivista da una revisione completa del codice e coperta da test. **La UI della 0.4.0 è stata rifatta e approvata da Simone in Desktop** (sezione 2). Restano pochi punti aperti (2.5). Le sezioni 3 e 4 servono come contesto.

## 1. Dove siamo

| Parte | Cosa fa | Stato |
| --- | --- | --- |
| Router (`hooks/router.ts`) | `auto`: Explore su Haiku con effort basso da qualsiasi modello superiore; general-purpose su Sonnet da Opus o Fable. `explore`: solo Explore su Haiku, general-purpose resta sul modello della sessione. `prudent`: entrambi su Sonnet. `off` | finito, misurato |
| Guardiano (`hooks/guard.ts`) | oltre il budget (2 $ di default) rifiuta gli strumenti del sub-agente con l'istruzione di consegnare; se insiste, dopo 2 richieste risponde la mod e il turno si chiude | finito, misurato |
| Cache calda (`hooks/cache.ts`) | `auto`: un ping 45 s prima che la cache scada, finché i ping di un'assenza costano al massimo un quarto della riscrittura che evitano, fino a 8 ore. Si adatta da sola: un ping all'ora con l'abbonamento (cache da 1 ora), pochi ping a consumo (cache da 5 minuti). Un ping rifiutato dall'API si riprova dopo 15 s. `promptCacheTtl` si legge dall'oggetto intero delle impostazioni, perché una lettura `{ key }` può rispondere con l'oggetto | finito, misurato con entrambe le cache |
| Prezzi (`hooks/prices.ts`) | letti una volta al giorno dalla pagina ufficiale di Anthropic (ogni 10 minuti finché non la raggiunge), salvati tra le sessioni; nessun prezzo nel codice | finito, verificato dal vivo |
| Configurazione automatica (`hooks/setup.ts`) | al primo turno un toast dice cosa ha rilevato (abbonamento o consumo, cache, router, budget); si ripete solo se cambia | finito, testato |
| Telemetria (`hooks/telemetry.ts`) | costo, contesto, tempo, strumento in uso per ogni sub-agente; da dove è stato spostato e con che effort, nella sua riga (sopravvive a un ricaricamento); un sub-agente ripreso tiene la sua spesa | finito |
| **UI** (`hooks/ui.tsx`) | pannello con il risparmio in grande e l'anello della cache, righe a card con chip, banda su una riga, riga di stato, i 6 Clawd vestiti | **rifatta nella 0.4.0, approvata in Desktop** |

Verifiche: `claude plugin test .` (91 test) e `claude plugin validate .` (questa versione del motore non ha più `--profile`). I test lunghi della cache e dei prezzi simulano ore di attesa e hanno un tempo massimo di 30 s invece di 5. Ogni regola importante ha un test che fallisce se la si rompe; ogni pulsante ha un test che lo preme.

## 2. La UI

### 2.1 Obiettivo

Chi apre il pannello deve capire **in due secondi** tre cose: quanto ha risparmiato, chi sta lavorando adesso (e su quale modello), se la cache è calda. Il resto (costo per riga, contesto, tempo) è lì quando lo cerca. A giudicare è Simone, guardando il pannello vero in Desktop.

### 2.2 Come lavorare

1. Carica la mod dalla cartella: `CLAUDE_CODE_PLUGIN_DIRS=/home/simone/progetti/pennycrab` e `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` nel blocco `env` di `~/.claude/settings.json`, poi riavvia Desktop. Ogni salvataggio ricarica la mod a fine turno. A lavoro finito togli le due variabili e installa dal marketplace.
2. Per gli stati costosi (guardiano, cache scaduta) monta il pannello in un test e fanne un'anteprima: in una copia della mod con il solo test di anteprima, `console.log` dei sorgenti `Svg`, poi una pagina HTML con ogni `Svg` come `<img>` (così gli stili di uno non toccano gli altri), una volta con le regole scure e una senza.
3. Tocca solo `hooks/ui.tsx` e i suoi test; un dato nuovo va nello stato (`types/index.d.ts`), senza cambiare la logica.
4. Prima di ogni commit: `claude plugin test .` e `claude plugin validate .` verdi. Prima di cambiare il disegno, una bozza mostrata a Simone; dopo, la prova dal vivo.

### 2.3 Cosa c'è oggi (0.4.0)

| Superficie | Cosa disegna | Dove nel codice |
| --- | --- | --- |
| Pannello, Desktop | in alto una card con «SAVED THIS SESSION» in grande, sotto «spent ≈$X · would have been $Y» e la barra del contesto principale; a destra l'anello della cache (calda: si svuota con i minuti al centro; in uso: tratteggiato, «Xm after turn»; scaduta: «—»). Sotto, una nota per i ping e una per l'abbonamento. Poi Collapse, le sezioni WORKING · STOPPING · GUARD · FINISHED con una linea, e una card SVG da 70 px per sub-agente: granchio, titolo, chip (modello colorato, «⚑ over budget», «low», «↓ from X», «▶ strumento», «✓ done»), costo e cifre a destra, barra del contesto | `renderPane`, `heroSvg`, `ringOf`, `noteSvg`, `sectionSvg`, `rowSvg`, `chip` |
| Pannello vuoto, Desktop | il granchio con la moneta e tre righe su cosa fa la mod | `emptySvg` |
| Pannello compatto, Desktop | una fila di granchi e i totali | `shelfSvg` |
| Pannello, terminale | lo stesso in testo, con barre `█░` e la riga della cache | `renderPane`, ramo terminale, `cacheLine` |
| Banda, Desktop | una card su una riga: fino a 5 granchi, «N working · M stopped by the guard», «spent ≈$X», «saved $Y»; sotto, un solo pulsante «Pennycrab ›» che apre o chiude il pannello | `renderBand`, `bandSvg` |
| Banda, terminale | «N running · M handover», barra del contesto principale, «saved $X», pulsanti ×N e ✕ | `renderBand`, ramo terminale |
| Riga di stato | `🦀S 21% 1m59s` per al massimo due sub-agenti, poi «🦀 saved $X» | `statusLine`, `tick` |
| Granchi | i 6 Clawd vestiti approvati: Haiku fattorino, Sonnet esploratore, Opus banchiere, Fable re, Pennycrab con la moneta (modello sconosciuto), Guardiano (fermato) | `COSTUMES`, `crab` |

Un sub-agente fermato dal guardiano sta in STOPPING · GUARD finché lavora; quando finisce passa in FINISHED, con il casco e il chip «⚑ over budget».

### 2.4 Cosa sappiamo di Desktop

Queste cose sono costate tentativi: non rifarli.

- **Niente contenuto posato in `position="absolute"` sopra un altro `Svg`**: Desktop disegna il pannello tutto bianco, senza errori nei log. Per questo lo sfondo a puntini della 0.3 non c'è più: lo spazio tra le parti lo danno le card e le sezioni.
- **Desktop mette gli elementi fratelli su righe separate**: per un layout orizzontale serve un solo `Svg` per riga, e un pulsante va sempre su una riga sua (per questo la banda ne ha uno solo).
- **Su Desktop `$.ui.invalidate` non arriva alla banda**: si ridisegna scrivendo un valore di stato che il disegno legge (l'atomo `now`, aggiornato ogni secondo mentre lavorano sub-agenti, ogni 15 s mentre la cache conta).
- **La banda vuota del motore** (`{ type: 'engine' }`) non va messa dentro la nostra: Desktop scarta tutta la banda.
- **Un `Svg` alto più di 4096 px** non viene accettato.
- **Il terminale elenca `Svg` ma non lo disegna**: si controlla sempre `e.surface`.
- **Ogni `Svg` è un'immagine**: quando il suo sorgente cambia, le animazioni CSS ripartono da zero. Per questo tutti i periodi sono di 1 s o 0,5 s.
- **La banda non deve leggere `now` né `cache`** (c'è un test): la cache sta solo nel pannello.
- **Un pannello aperto senza che la persona lo chieda** va aperto solo dove si aggancia di lato (`e.viewport.isFullscreen`). Sotto i 144 colonne resta in attesa (`isPlaced: false`).
- **La riga di stato di pennycrab compare sopra quella di Claude**: è voluto.
- **Colori**: verde solo per i risparmi, ambra solo per il guardiano, l'anello della cache è grigio. `good`, `bad`, `warn`, `ring` e `chip` sono classi in `STYLE` con la loro variante scura.
- Le indicazioni di Simone: nessuna dipendenza da altre mod, il codice è nostro; i granchi restano Clawd chiaramente vestiti.

### 2.5 Punti aperti

Risolti nella 0.4.0: contrasto nel tema scuro, animazioni che scattavano, test che premono i pulsanti, guardiano finito in Finished, nota per l'abbonamento, «Cache in use» che ingannava (ora dice quanto dura dopo il turno), pannello vuoto e tutto attaccato, banda con la barra vuota e la parola «handover».

Restano:

1. **Icona.** Fatta: `.claude-plugin/icon.png`, 1024 px, il granchio di pennycrab sotto una pioggia di monete (scelta da Simone, G1). È un Clawd vestito: se il catalogo la rifiuta per il marchio, va vestito di più o ridisegnata.
2. **Nota sull'abbonamento quando la cache è impostata a mano.** La nota si mostra quando `ttlSource` è `plan` o `plan-over`; se una variabile o `promptCacheTtl` sceglie la durata, l'account non si vede e la nota manca (scorciatoia segnata nel codice). Se serve, un campo nuovo nello stato.
3. **Il `?` di un costo sconosciuto** non ha ancora la spiegazione al passaggio del mouse.
4. **Parole dell'anello diverse per abbonamento e consumo** («ping orari, fino a 8 h»): oggi sono le stesse.
5. **Terminale stretto** (40 colonne): non riguardato in questo giro.

### 2.6 Criteri di accettazione (0.4.0)

- [x] Pannello vuoto: dice cosa farà la mod.
- [x] Un sub-agente al lavoro: granchio che cammina, modello, strumento in uso, tempo che scorre.
- [x] Tre sub-agenti, uno fermato dal guardiano: sezioni chiare, il Guardiano con «⚑ over budget» (visto da un'anteprima montata in un test).
- [x] Cache: calda con il tempo residuo, in uso, scaduta, con ping.
- [ ] Cache: parole diverse per abbonamento e consumo (2.5, punto 4).
- [ ] `?` spiegato (2.5, punto 3).
- [x] Tema scuro: verde e rosso con la loro variante chiara.
- [x] Animazioni con periodi di 1 s o 0,5 s.
- [x] Ogni pulsante coperto da un test che lo preme.
- [x] Banda: una riga, granchi riconoscibili, un pulsante.
- [x] Riga di stato: lettera del modello corretta, `?` per i modelli sconosciuti.
- [x] Tema chiaro e scuro su Desktop.
- [ ] Terminale stretto (2.5, punto 5).
- [x] Movimento ridotto rispettato.
- [x] Test e validazione verdi; Simone ha visto e approvato pannello, righe, banda e Finished.

## 3. Altri passi, non UI

1. Installazione pulita dal marketplace: `/plugin install pennycrab --marketplace Batman110391/pennycrab` (in Desktop: **+** → Plugins → Add marketplace → Add plugin), dopo aver tolto `CLAUDE_CODE_PLUGIN_DIRS`.
2. Un controllo automatico su GitHub che a ogni push lanci test e validazione.
3. L'icona per il catalogo: fatta, vedi il punto 1 della 2.5.
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
| UI | `/pennycrab`, ondate parallele, schermo principale del terminale, perdite in verde, `?`, riga della cache bloccata, ×N, banda ridisegnata ogni secondo, spazi compattati, `esc()` senza test | test in `ui.test.tsx`, `cache.test.ts`, `prices.test.ts` |

Segnalazioni scartate dalla verifica (6): comportamenti voluti e documentati, o casi che richiedono tre coincidenze e non producono numeri sbagliati.
