# CLAUDE.md — Gestore Interventi (desktop)

> Questa è l'app REALE in sviluppo: **Tauri 2 (Rust) + vanilla JS SPA + SQLite + Exchange EWS**.
> Il `CLAUDE.md` nella cartella padre documenta la vecchia app FastAPI/Python: ignorarlo per il lavoro qui.
> Design system e prodotto: vedere `DESIGN.md` e `PRODUCT.md` in questa cartella.

## Architettura

```
src/            frontend vanilla JS, servito diretto (frontendDist = ../src, NESSUN bundler)
src-tauri/      backend Rust (Tauri 2): EWS, SQLite cache, coda offline, PDF, email
```

- Avvio dev: `cargo tauri dev` (da `src-tauri/`) oppure `npx @tauri-apps/cli dev`
- Test backend: `cargo test` da `src-tauri/`
- Test frontend: `npm test` (node:test su `tests/`, zero dipendenze)
- Lint frontend: `npm run lint` (Biome, config in `biome.json`; formatter spento di proposito)
- Dati: appuntamenti vivono su Exchange (EWS/SOAP); SQLite è cache + coda operazioni offline
- Password: keychain di sistema (`keychain.rs`), mai su disco in chiaro

## Frontend (`src/`)

| File | Contenuto |
|------|-----------|
| `index.html` | Unica pagina; `?v=` = hash contenuto, riscritto da `npm run bump` (anche nel pre-commit hook, `core.hooksPath .githooks`) — niente più bump manuale |
| `shared.js` | Helper puri (`escHtml`, `buildSubject`, `fmtDT`, `durMinToStr`, `pendingBadge`), caricato per primo; testato in `tests/shared.test.js` |
| `app.js` | Helpers DOM globali (`invoke`, `toast`, `confirmDialog`, `sanitizeNote`, `htmlToText`, `GIIcon`, `createFuzzyDropdown`, `closeOverlay`, `syncSeg`) + `Wizard` onboarding + `App` (navigazione, lista, detail, form, modali) |
| `calendar.js` | `Calendar` (IIFE): viste settimana/giorno/mese, drag/resize, peek popover |
| `search.js` | `Search`: omnibar Ctrl+K |
| `settings.js` | `Settings`: account, tema, trasparenza, dropdown data |
| `style.css` | Token design (`:root` = dark, `body.theme-light` = light), OKLCH, hue 270/285 |
| `vendor/purify.min.js` | DOMPurify, unica dipendenza JS |

### Convenzioni frontend (vincolanti)

- **Versioni asset**: `npm run bump` riscrive i `?v=` con hash del contenuto; il pre-commit hook lo fa da solo. Se la webview mostra roba vecchia in dev senza commit, lanciarlo a mano.
- Note intervento sono **HTML rich-text**: ogni body non fidato passa da `sanitizeNote()` (DOMPurify).
- Nei template `onclick` usare `JSON.stringify(val)` per stringhe, mai `'${escHtml(val)}'` (si rompe con apostrofi).
- **Trappola flash re-render**: il full re-render del calendario/lista rigioca le animazioni di entrata. Preferire toggle di classi, refresh silenzioso, `popItem`/animateOut.
- Niente separatori hairline 1px (eccezione: righe griglia calendario); separare con tono/spazio/radius.
- I blocchi evento del calendario sono stilizzati inline da `calendar.js`: il CSS da solo non li ritematizza.
- Motion: 120–250ms, `--ease*` esponenziali, `prefers-reduced-motion` già gestito globalmente.
- Tema: default light; `body.theme-light`, `body.opaque` (no acrilico, auto fuori Windows).
- Titlebar custom borderless + acrilico Win11 (`WinControls` in app.js).

## Backend (`src-tauri/src/`)

| Modulo | Contenuto |
|--------|-----------|
| `lib.rs` | `AppState { db }`, avvio sync loop, registro comandi |
| `commands/auth.rs` | `test_connection`, `save_account`, `list_accounts_cmd`, `delete_account_cmd` |
| `commands/interventions.rs` | CRUD interventi + firma + memoria email cliente |
| `commands/email.rs` | `send_email` (SMTP, allegato PDF) |
| `commands/pdf.rs` | `export_pdf`, `export_pdf_bulk` |
| `commands/config.rs` | dropdown data, config key-value, `clear_cache` |
| `commands/sync.rs` | `trigger_sync`, `sync_status_cmd`, `flush_queue`, `list_pending_ops`, `list_conflicts`, `resolve_conflict` |
| `exchange/client.rs` | `EwsClient`: pool di `reqwest::blocking::Client` (NTLM), SOAP |
| `exchange/soap.rs` | Costruzione envelope SOAP EWS |
| `exchange/parse.rs` | Parsing risposte XML |
| `exchange/subject.rs` | Build/parse soggetto Outlook (formato form IC050815) |
| `db/cache.rs` | Cache interventi; `CACHE_SCHEMA_VERSION` da incrementare se cambia struttura |
| `db/queue.rs` | Coda operazioni offline (pending/conflict/error) |
| `db/migrations.rs` | Migrazioni SQLite |
| `sync.rs` | Loop sync in background (tauri::async_runtime); delta via EWS `SyncFolderItems` (token `sync_state_{email}` in app_config), reconcile FindItem 1×/24h, fallback su token invalido |
| `flush.rs` | Flush coda pending verso Exchange |
| `ntlm.rs` | Handshake NTLM |
| `keychain.rs` | Password nel keychain di sistema |
| `pdf.rs` | Generazione PDF rapporto |

### Convenzioni backend

- Comandi Tauri ritornano `Result<T, String>` (per ora; errori tipizzati in roadmap).
- EWS è bloccante: chiamare dentro `spawn_blocking` o usare i metodi marcati safe per worker Tokio (vedi doc in `client.rs`).
- Test unitari in fondo ai moduli (`queue`, `cache`, `parse`, `ntlm`): mantenerli verdi con `cargo test`.
- Nuove colonne cache → incrementare `CACHE_SCHEMA_VERSION` + migrazione in `db/migrations.rs`.

## Aggiornare questo file

Dopo modifiche strutturali (nuovo comando, nuovo modulo, convenzione nuova) aggiornare la tabella relativa. Niente numeri di riga: marciscono.
