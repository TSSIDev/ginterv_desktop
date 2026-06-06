# Disabilitazione trasparenze (acrilico) — Design

Data: 2026-06-06

## Problema

L'app è una finestra borderless Win11 con backdrop acrilico nativo
(`transparent:true` + `windowEffects.effects:["acrylic"]` in `tauri.conf.json`).
La trasparenza visiva nasce dall'acrilico nativo che traspare sotto le regioni
chrome translucide (`--chrome-bg` / `--chrome-border`) e dai `backdrop-filter: blur()`
su topbar, modali e overlay.

Su Linux KDE/Wayland (build CachyOS) l'acrilico non funziona correttamente.
Serve poter disattivare le trasparenze, automaticamente fuori da Windows e
manualmente da impostazioni.

## Decisione

**Auto + override sempre disponibile.** Default: trasparenze ON su Windows,
OFF su ogni altra piattaforma. Il toggle in Impostazioni → Aspetto resta sempre
visibile e può forzare l'opposto (es. riattivarle su un compositor Linux che le
regge).

## Stato persistito

`localStorage` chiave `gi-transparency`, tre valori:

| Valore        | Significato                          |
|---------------|--------------------------------------|
| `'on'`        | Trasparenze forzate attive           |
| `'off'`       | Trasparenze forzate disattive        |
| assente       | Auto: `isWindows ? on : off`         |

Rilevamento piattaforma: `navigator.userAgent.includes('Windows')`
(WebView2 su Windows vs WebKitGTK su Linux — affidabile, nessuna dipendenza).

Valore effettivo:
```
explicit = localStorage.getItem('gi-transparency')   // 'on' | 'off' | null
transparent = explicit ? explicit === 'on'
                       : navigator.userAgent.includes('Windows')
```

## Componenti

### 1. CSS — classe `body.opaque` (`src/style.css`)

Quando la classe `opaque` è presente sul `body`:

- `--chrome-bg` → opaco (riuso `--bg-panel`), `--chrome-border` → `--border`.
- `html, body { background: var(--bg-base) }` (solido invece di `transparent`).
- Neutralizza i `backdrop-filter` blur su topbar / modali / overlay
  (`backdrop-filter: none; -webkit-backdrop-filter: none;`) — su KDE/Wayland il
  blur è la parte rotta/costosa.

Varianti separate per dark (default `:root`) e light (`body.theme-light`),
perché entrambi i temi definiscono `--chrome-bg` / `--chrome-border` translucidi.
La classe `opaque` convive con `theme-light`: i selettori sono
`body.opaque { ... }` e `body.opaque.theme-light { ... }`.

### 2. Bootstrap — `App.init()` (`src/app.js`)

Helper `_applyTransparency()`:
- Calcola il valore effettivo (vedi sopra).
- `document.body.classList.toggle('opaque', !transparent)`.
- Su Tauri sincronizza l'effetto nativo della finestra:
  - opaco → `getCurrentWindow().clearEffects()`
  - trasparente → `getCurrentWindow().setEffects({ effects: ['acrylic'], state: 'active' })`
  - chiamata difensiva con `.catch()` — l'API può fallire/non esistere su alcune
    piattaforme e non deve rompere il boot.

Chiamato presto in `init()`, accanto all'applicazione di tema e accento, prima
del primo paint utile.

`transparent:true` in `tauri.conf.json` resta invariato: con background opaco la
finestra trasparente non è comunque visibile, e cambiarlo richiederebbe
ricompilazione Rust. `clearEffects()` è sufficiente a smettere di richiedere
l'acrilico rotto.

### 3. Impostazioni — sezione "Aspetto" (`src/settings.js`, `_renderAspetto`)

- Nuova riga "Trasparenze" con switch (riuso stile `.st-theme-switch` o toggle
  esistente), dopo Tema / Colore accento.
- Stato dello switch = valore effettivo corrente.
- Descrizione: accenna "Sfocature acriliche dietro le superfici — consigliato
  solo su Windows".
- Handler `_toggleTransparency()`: salva `'on'`/`'off'` in `localStorage` e
  richiama `App._applyTransparency()` per applicare dal vivo (nessun riavvio).

### 4. Cache busting (`src/index.html`)

Bump del parametro `?v=` sui tag di `style.css` e degli script JS toccati, come
da convenzione esistente.

## Flusso

```
boot → App.init()
        ├─ applica tema/accento
        └─ _applyTransparency()
             ├─ effettivo = explicit ?? isWindows
             ├─ body.classList.toggle('opaque', !effettivo)
             └─ Tauri: clearEffects() | setEffects(acrylic)

Impostazioni → switch Trasparenze
        └─ _toggleTransparency()
             ├─ localStorage['gi-transparency'] = 'on'|'off'
             └─ App._applyTransparency()   // live, no restart
```

## Gestione errori

- API finestra Tauri (`clearEffects`/`setEffects`) avvolte in `.catch()` —
  fallimento silenzioso, la classe CSS resta la fonte di verità visiva.
- `localStorage` assente/illeggibile → fallback al default per piattaforma.

## Test (manuali)

- Windows, nessuna pref: trasparenze attive (acrilico visibile), switch ON.
- Linux, nessuna pref: opaco, switch OFF, nessun artefatto/blur.
- Toggle OFF su Windows: chrome diventa opaco dal vivo, acrilico sparisce.
- Toggle ON su Linux: classe rimossa dal vivo (acrilico può restare assente se
  il compositor non lo supporta, ma nessun crash).
- Persistenza: la scelta sopravvive al riavvio.
- Convivenza con tema chiaro/scuro: opaco corretto in entrambi.

## Fuori scope

- Modifica di `transparent`/`decorations` in `tauri.conf.json` (richiede
  ricompilazione, non necessaria).
- Effetti nativi alternativi per Linux (es. blur del compositor).
