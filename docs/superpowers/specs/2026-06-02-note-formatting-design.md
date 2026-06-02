# Formattazione base nelle note (B/I/U) — Design

Data: 2026-06-02
Progetto: gestoreinterventi-desktop (client Tauri)

## Obiettivo

Permettere di **scrivere e leggere** note dell'intervento con formattazione di
base — **grassetto, corsivo, sottolineato** — preservando la formattazione più
ricca che può arrivare da Outlook. L'intervento riguarda **solo la sezione
note/corpo** dell'appuntamento.

## Scope

In scope:
- Editor WYSIWYG per le note con B/I/U (più a capo).
- Visualizzazione formattata della nota nel pannello dettaglio.
- Round-trip che **preserva** la formattazione esistente (liste, colori,
  tabelle, ecc.) creata in Outlook: i pulsanti B/I/U si aggiungono sopra, non
  normalizzano né distruggono il resto.
- Sanitizzazione dell'HTML non fidato (sicurezza XSS).

Fuori scope (non-goals):
- Authoring di liste, link, titoli, colori, tabelle, immagini o altri media.
- Allegati / media integrati (`cid:`).
- Qualsiasi modifica al backend Rust o allo schema cache.

## Stato attuale (riferimenti)

- Scrittura: il corpo viene già inviato a Exchange come HTML —
  `src-tauri/src/exchange/soap.rs:138` e `:166`
  (`<t:Body BodyType="HTML">{body_html}</t:Body>`, con `xml_escape`).
- Lettura: il parser restituisce già l'HTML del corpo —
  `src-tauri/src/exchange/parse.rs:294` (`body_html`).
- Frontend scrittura: `f-note` è una `<textarea>` di testo semplice, inviata
  grezza come `body_html` — `src/app.js:818`.
- Frontend modifica: `fillForm` **spoglia** l'HTML con
  `replace(/<[^>]+>/g,'')` — `src/app.js:733`.
- Frontend lettura: il dettaglio inserisce `item.body_html` via `innerHTML`
  in `.note-box` **senza sanitizzazione** — `src/app.js` dentro
  `renderInterventionDetail` (markup `note-box`). Questo è un **rischio XSS
  latente già presente**.
- Il client **non carica alcuna libreria di terze parti**: calendario, fuzzy
  search e firma sono tutti custom. DOMPurify sarà la prima libreria
  vendorizzata.

Conclusione: la feature è **puramente frontend**. Il backend non cambia.

## Architettura

### 2.1 Sanitizzazione — DOMPurify

- Vendorizzare `purify.min.js` (DOMPurify) in `src/vendor/purify.min.js`,
  offline. Aggiungere `<script src="vendor/purify.min.js?v=1">` in
  `index.html` **prima** di `app.js`.
- Wrapper unico in `app.js`, basato sui **default sicuri** di DOMPurify (che
  già preservano la formattazione ricca e rimuovono il pericoloso). Niente
  allowlist artigianale ristretta: ridurre i tag distruggerebbe la
  formattazione di Outlook (decisione "preserva tutto").
  ```js
  function sanitizeNote(html) {
    if (!html) return '';
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      // niente media: cid: non si risolve e gli URL esterni sono tracking/privacy
      FORBID_TAGS: ['img', 'video', 'audio'],
      FORBID_ATTR: ['srcset']
    });
  }
  ```
  - I default preservano: `b/strong, i/em, u, p, div, span, ul/ol/li, table…`,
    **`h1-h6`, `blockquote`, `font`, `hr`, e gli attributi `style` inline**
    (colori/font di Outlook), perché DOMPurify sanitizza il CSS.
  - DOMPurify rimuove sempre `script`, `iframe`, `object`, gestori `on*`, URL
    `javascript:`/`data:` pericolosi.
- Razionale: non scrivere a mano un sanitizer (error-prone), e in Tauri un XSS
  nella webview può raggiungere i comandi nativi (`invoke`).

### 2.2 Editor di scrittura — contenteditable nativo

- Sostituire `<textarea id="f-note">` con:
  - una mini-toolbar con 3 pulsanti **B** / *I* / U (stile design system,
    riuso classi tipo `.tbtn`/icone);
  - un `<div id="f-note" contenteditable="true">` stilizzato come `.fg-ta`.
- Comandi: `document.execCommand('bold'|'italic'|'underline')` (supportati dal
  webview Chromium/WebView2). Scorciatoie Ctrl+B/I/U gestite nativamente da
  contenteditable.
- Stato attivo dei pulsanti aggiornato via `document.queryCommandState` su
  `selectionchange`/`keyup`/`mouseup`.
- **Paste sanificato**: intercettare l'evento `paste`, leggere
  `clipboardData` (`text/html` o fallback `text/plain`), passarlo per
  `sanitizeNote` e inserirlo. Evita che un `<img onerror>` incollato scatti
  nella webview live.
- API interne:
  - `initNoteEditor()` — wiring toolbar, paste, stato pulsanti.
  - `getNoteHtml()` — ritorna `innerHTML` dell'editor (poi sanificato dal
    chiamante in fase di salvataggio).
  - `setNoteHtml(html)` — imposta `innerHTML` (chiamato con HTML già
    sanificato).

### 2.3 Flusso dati (tutto in `app.js`)

- `fillForm` (`:733`): da strip-tag → `setNoteHtml(sanitizeNote(item.body_html))`.
- `submitForm` (`:818`): `body_html = sanitizeNote(getNoteHtml()) || null`.
- `resetForm` (`:699`): svuota l'editor (`setNoteHtml('')`).
- Dettaglio (`renderInterventionDetail`, già condiviso lista+calendario):
  `note-box` riceve `sanitizeNote(item.body_html)` via `innerHTML`. Un solo
  punto grazie all'unificazione precedente del renderer.
- Card di lista: invariata — `cleanText(item.body_html)` continua a produrre
  l'anteprima in testo semplice.

### 2.4 Stile (`style.css`)

- `.note-editor` wrapper; `.note-toolbar` con `.note-tool` (pulsanti B/I/U,
  stato `.on`); `#f-note[contenteditable]` con look di `.fg-ta`, focus ring
  coerente (`--accent` + `--accent-dim`), placeholder via `:empty:before`.
- Il rendering in dettaglio (`.note-box`) eredita già il tema; eventuale CSS
  per `b/i/u/ul/ol/li/table` dentro `.note-box` per resa pulita.

## Edge case

- Nota vuota o solo spazi → inviare `null`.
- Note esistenti senza tag (testo semplice) → funzionano identiche.
- Corpi "documento completo" da Outlook (`<html><head>…`) → DOMPurify estrae il
  contenuto sicuro renderizzabile.
- `prefers-reduced-motion`: non rilevante (nessuna animazione introdotta).
- Nessun impatto su cache/sync/backend.

## Sicurezza

- Il corpo è HTML **non fidato** (Outlook, colleghi). Sanitizzazione
  obbligatoria in: rendering dettaglio, load editor, paste, save.
- DOMPurify chiude anche l'XSS latente attuale del `innerHTML` non filtrato.
- Contesto Tauri: XSS nella webview = rischio elevato (possibile accesso a
  `invoke`), quindi sanitizer vetted e non artigianale.

## Testing / Verifica

Il progetto non ha un test runner JS: verifica **manuale**.
1. Crea una nota con grassetto/corsivo/sottolineato → salva.
2. Ricarica la lista → apri dettaglio: la formattazione si vede.
3. Riapri in modifica: la formattazione è presente nell'editor; salva di nuovo.
4. Round-trip: apri lo stesso appuntamento in Outlook → la formattazione c'è.
5. Apri/modifica una nota già formattata in Outlook (lista/tabella) → in
   modifica resta, e dopo il salvataggio non viene persa.
6. XSS: imposta (via Outlook/test) un corpo con `<script>` e
   `<img src=x onerror=...>` → verifica che in lettura e in modifica venga
   neutralizzato.
- Opzionale: micro self-test in console del wrapper `sanitizeNote` su input
  malevoli noti.

## Cache busting / file toccati

- `index.html`: nuovo `<script vendor/purify.min.js>`, nuovo markup editor,
  bump `?v=` di `app.js`, `style.css` (e tag vendor).
- `app.js`: `sanitizeNote`, editor (`initNoteEditor`/`getNoteHtml`/
  `setNoteHtml`), modifiche a `fillForm`/`submitForm`/`resetForm`/render nota.
- `style.css`: editor + toolbar + resa `.note-box`.
- nuovo: `src/vendor/purify.min.js`.
- `calendar.js`: **non** si tocca (usa il renderer condiviso).
