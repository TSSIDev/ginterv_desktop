# Product

## Register

product

## Users

Tecnici di assistenza e amministrativi di una piccola azienda di servizi IT/impiantistica. Usano l'app ogni giorno, da desktop (Tauri), spesso di corsa: per pianificare interventi, consultare il calendario, registrare il lavoro svolto, far firmare il cliente e generare il rapporto PDF. Conoscono Outlook/Exchange perché i dati vivono lì, ma non sono utenti "tecnici di software". Lavorano in ufficio e in mobilità, con luce ambientale variabile, quindi servono sia un tema chiaro che uno scuro credibili.

## Product Purpose

Gestire gli interventi tecnici sincronizzati con Exchange (EWS): calendario, lista, ricerca, creazione/modifica appuntamento, firma cliente, export PDF ed email. L'app sostituisce l'uso diretto di Outlook con un client dedicato, più veloce e più leggibile per questo specifico flusso di lavoro. Successo = l'utente capisce al volo cosa fare, completa "crea intervento → firma → invia rapporto" senza attrito, e l'app sembra uno strumento moderno e curato, non una maschera gestionale anni 2000.

## Brand Personality

Preciso, sicuro, calmo. Tre parole: **nitido, professionale, fluido**. Voce in italiano, diretta e concreta, senza gergo software. L'interfaccia deve trasmettere affidabilità (sono dati di lavoro reali, appuntamenti veri) e leggerezza d'uso (i "guizzi" da client calendario moderno: micro-interazioni, gerarchia chiara, un'identità cromatica riconoscibile).

## Anti-references

- **Outlook desktop classico**: barre grigie, micro-pulsanti, densità ostile, ribbon, look "legacy aziendale". Da evitare assolutamente.
- **Light "sparaflashante"**: bianco puro accecante, neutri freddi clinici, contrasto sparato.
- **Dark "cupo"**: nero assoluto, grigi spenti, accento spento. Il dark deve essere un blu-notte profondo con accento luminoso.
- Slop AI generico: blu Bootstrap/SaaS, card identiche ripetute, bordi laterali colorati, testo in gradiente.

## Design Principles

1. **Gerarchia leggibile al volo** — la struttura (cosa è azione, cosa è selezionato, cos'è oggi) si capisce in mezzo secondo, prima di leggere.
2. **Identità senza rumore** — un solo accento indaco-violetto porta carattere; tutto il resto sono neutri tintati. Niente arcobaleni.
3. **Familiarità da client calendario** — pattern attesi (toolbar, switch vista, oggi, pillole), non affordance reinventate. Lo strumento sparisce nel compito.
4. **Densità che respira** — compatto perché è uno strumento da lavoro quotidiano, ma con ritmo e aria, mai claustrofobico come Outlook.
5. **Due temi, una sola anima** — light e dark non sono varianti opposte ma la stessa identità a due luminosità; entrambi credibili, nessuno dei due un ripensamento.

## Accessibility & Inclusion

- Contrasto testo/sfondo target WCAG AA (≥4.5:1 corpo, ≥3:1 UI grande) in entrambi i temi.
- Focus-visible sempre evidente (anello accento con offset).
- Lo stato non veicolato dal solo colore (firma "in attesa"/"ok" anche con etichetta/icona).
- Rispettare `prefers-reduced-motion`: le micro-interazioni si riducono a transizioni minime.
- Tipografia mai sotto soglie leggibili per testo informativo; le micro-label uppercase restano ausiliarie, non portano informazione critica da sole.
