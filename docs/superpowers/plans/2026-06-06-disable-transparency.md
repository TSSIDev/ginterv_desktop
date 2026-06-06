# Disabilitazione trasparenze (acrilico) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere di disattivare le trasparenze acriliche, automaticamente fuori da Windows e manualmente via Impostazioni → Aspetto.

**Architecture:** Stato a tre valori in `localStorage` (`gi-transparency`: `on`/`off`/assente=auto). Valore effettivo = esplicito se presente, altrimenti `navigator.userAgent.includes('Windows')`. Una classe `body.opaque` in CSS rende chrome/sfondi opachi e azzera i `backdrop-filter`. Un helper JS applica la classe al boot e sincronizza l'effetto nativo della finestra Tauri. Un toggle in Impostazioni persiste la scelta e riapplica dal vivo.

**Tech Stack:** Tauri 2, vanilla JS, CSS custom properties (OKLCH). Nessun framework di test JS nel progetto → verifica manuale eseguendo l'app.

**Spec di riferimento:** `docs/superpowers/specs/2026-06-06-disable-transparency-design.md`

**Nota su verifica:** il progetto non ha test runner JS. Ogni task usa verifica manuale: avviare `npm run tauri dev` (o ricaricare la webview se già attiva) e osservare. Eseguire l'app su Windows per il caso "trasparente"; il caso "opaco" si può forzare anche su Windows col toggle.

---

### Task 1: Classe CSS `body.opaque`

**Files:**
- Modify: `src/style.css` (dopo il blocco `html, body`, ~riga 83)

- [ ] **Step 1: Aggiungere il blocco CSS `opaque`**

Inserire dopo la regola `html, body { ... }` (che termina ~riga 83), prima di `.tnum`:

```css
/* ── Modalità opaca (no acrilico) — auto fuori da Windows, o scelta utente ── */
body.opaque {
  --chrome-bg: var(--bg-panel);
  --chrome-border: var(--border);
}
body.opaque,
body.opaque html { background: var(--bg-base); }
/* il blur acrilico è la parte rotta/costosa su KDE/Wayland: spegnilo */
body.opaque .topbar,
body.opaque [class*="overlay"],
body.opaque .modal,
body.opaque .modal-card,
body.opaque .srch-panel,
body.opaque .cal-topbar {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
```

> Nota: `--bg-base`, `--bg-panel`, `--border` sono già definiti sia in `:root` (dark) sia in `body.theme-light`, quindi `body.opaque` funziona in entrambi i temi senza varianti separate. I selettori dei `backdrop-filter` coprono gli elementi con blur trovati nello spec; verificare al passo 2 che non resti blur visibile e, in caso, aggiungere il selettore mancante.

- [ ] **Step 2: Verifica manuale**

Temporaneamente, nella console DevTools della webview, eseguire:
```js
document.body.classList.add('opaque')
```
Atteso: chrome (toolbar, sidebar, main-content) diventa opaco, nessuna sfocatura dietro modali/overlay, leggibilità invariata in tema sia scuro che chiaro. Poi:
```js
document.body.classList.remove('opaque')
```
Atteso: ritorna l'aspetto translucido attuale.

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat(ui): body.opaque CSS mode for disabling acrylic transparency"
```

---

### Task 2: Helper `_applyTransparency()` e applicazione al boot

**Files:**
- Modify: `src/app.js` (oggetto `App`: nuovo metodo + chiamata in `init()` ~riga 604-612)

- [ ] **Step 1: Aggiungere il metodo `_applyTransparency()` all'oggetto `App`**

Inserire come metodo dell'oggetto `App`, subito prima di `async init() {` (~riga 604):

```js
  // Trasparenze acriliche: ON di default solo su Windows; override utente in localStorage.
  _transparencyEnabled() {
    const explicit = localStorage.getItem('gi-transparency'); // 'on' | 'off' | null
    if (explicit === 'on') return true;
    if (explicit === 'off') return false;
    return navigator.userAgent.includes('Windows');
  },

  async _applyTransparency() {
    const enabled = this._transparencyEnabled();
    document.body.classList.toggle('opaque', !enabled);
    // Sincronizza l'effetto nativo della finestra Tauri (difensivo: può non esistere).
    try {
      const win = window.__TAURI__?.window?.getCurrentWindow?.();
      if (!win) return;
      if (enabled) {
        await win.setEffects({ effects: ['acrylic'], state: 'active' });
      } else {
        await win.clearEffects();
      }
    } catch (_) { /* API finestra non disponibile: la classe CSS resta la verità visiva */ }
  },
```

> Nota: l'app usa `withGlobalTauri: true`, quindi `window.__TAURI__.window.getCurrentWindow()` è disponibile senza import. Se altrove in `app.js` la window Tauri è già acceduta con un alias diverso (es. `getCurrentWindow` importato), usare lo stesso pattern già presente nel file invece di `window.__TAURI__`.

- [ ] **Step 2: Chiamare l'helper in `init()`**

In `App.init()`, subito dopo il blocco che applica l'accento (~riga 612, dopo `if (accentHue) document.documentElement.style.setProperty('--accent-hue', accentHue);`), aggiungere:

```js
    // Applica preferenza trasparenze (default per piattaforma)
    this._applyTransparency();
```

- [ ] **Step 3: Verifica manuale (Windows)**

Avviare l'app su Windows senza pref impostata (eventualmente `localStorage.removeItem('gi-transparency')` da console e ricaricare).
Atteso: trasparenze attive, acrilico visibile, nessuna classe `opaque` sul body.
Poi in console:
```js
localStorage.setItem('gi-transparency','off'); App._applyTransparency()
```
Atteso: chrome diventa opaco dal vivo, acrilico sparisce. Pulire: `localStorage.removeItem('gi-transparency'); App._applyTransparency()`.

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "feat: apply transparency preference at boot (auto-off outside Windows)"
```

---

### Task 3: Toggle "Trasparenze" in Impostazioni → Aspetto

**Files:**
- Modify: `src/settings.js` (`_renderAspetto`, ~riga 473-506; nuovo handler dopo `_setTheme`)

- [ ] **Step 1: Aggiungere la riga toggle in `_renderAspetto`**

In `_renderAspetto`, dentro `<div class="st-setting-list">`, dopo la riga "Colore accento" (la `</div>` che chiude l'ultima `.st-setting-row`, ~riga 504) e prima della `</div>` che chiude `.st-setting-list`, inserire:

```js
        <div class="st-setting-row">
          <div>
            <div class="st-setting-label">Trasparenze</div>
            <div class="st-setting-desc">Sfocature acriliche dietro le superfici. Consigliato solo su Windows.</div>
          </div>
          <button class="st-theme-switch${App._transparencyEnabled() ? ' light' : ''}" type="button" role="switch"
            aria-checked="${App._transparencyEnabled() ? 'true' : 'false'}" aria-label="Trasparenze"
            onclick="Settings._toggleTransparency()">
            <span class="st-theme-thumb"></span>
            <span class="st-theme-option st-theme-dark">Off</span>
            <span class="st-theme-option st-theme-light">On</span>
          </button>
        </div>
```

> Nota: riuso del componente `.st-theme-switch`. Lì la classe `light` rappresenta lo stato "destro/attivo"; qui mappa a trasparenze ON. Verificare al passo 3 che la posizione del pollice corrisponda (ON = destra). Se le etichette Off/Sx e On/Dx risultassero invertite rispetto al pollice, scambiare le due `<span class="st-theme-option ...">`.

- [ ] **Step 2: Aggiungere l'handler `_toggleTransparency`**

Nell'oggetto `Settings`, subito dopo il metodo `_setTheme(t) { ... }` (~riga 534), aggiungere:

```js
  _toggleTransparency() {
    const next = App._transparencyEnabled() ? 'off' : 'on';
    localStorage.setItem('gi-transparency', next);
    App._applyTransparency();
    const sw = document.querySelectorAll('.st-theme-switch')[1] // [0]=tema, [1]=trasparenze
            || document.querySelector('.st-setting-row:last-child .st-theme-switch');
    const on = next === 'on';
    if (sw) {
      sw.classList.toggle('light', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  },
```

> Nota: lo switch trasparenze è il secondo `.st-theme-switch` nella sezione (il primo è il tema). Il fallback `:last-child` lo seleziona se è l'ultima riga. Se in futuro si aggiungono righe dopo, ancorare con un id dedicato.

- [ ] **Step 3: Verifica manuale**

Avviare l'app, andare in Impostazioni → Aspetto.
Atteso: nuova riga "Trasparenze"; lo switch riflette lo stato effettivo (ON su Windows senza pref). Cliccando:
- Off → chrome opaco dal vivo, switch a sinistra/Off, persiste dopo riavvio.
- On → torna translucido, switch a destra/On.
Verificare che lo switch del Tema continui a funzionare e non sia toccato.

- [ ] **Step 4: Commit**

```bash
git add src/settings.js
git commit -m "feat(settings): Aspetto toggle to enable/disable transparency"
```

---

### Task 4: Cache busting

**Files:**
- Modify: `src/index.html` (righe 7, 576, 578)

- [ ] **Step 1: Bump dei parametri `?v=`**

Modificare:
- riga 7: `style.css?v=58` → `style.css?v=59`
- riga 576: `settings.js?v=13` → `settings.js?v=14`
- riga 578: `app.js?v=40` → `app.js?v=41`

(`search.js` e `calendar.js` non sono toccati: lasciarli invariati.)

- [ ] **Step 2: Verifica manuale**

Ricaricare l'app a freddo. Atteso: nessun asset servito da cache vecchia; il toggle e l'aspetto opaco funzionano al primo avvio senza svuotare manualmente la cache.

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "chore: bump asset versions for transparency toggle"
```

---

## Self-Review

**Spec coverage:**
- Stato a tre valori `gi-transparency` → Task 2 (`_transparencyEnabled`). ✓
- `isWindows` via `navigator.userAgent` → Task 2. ✓
- CSS `body.opaque` (chrome opaco, sfondo solido, no blur, dark+light) → Task 1. ✓
- Bootstrap in `App.init()` + clearEffects/setEffects difensivo → Task 2. ✓
- Toggle in "Aspetto", live, persistente → Task 3. ✓
- `transparent:true` invariato (fuori scope) → rispettato, nessun task lo tocca. ✓
- Cache busting → Task 4. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice o comando concreto. ✓

**Type/naming consistency:** `_transparencyEnabled()` e `_applyTransparency()` definiti in Task 2 e usati con gli stessi nomi in Task 3. `gi-transparency`, classe `opaque`, valori `on`/`off` coerenti ovunque. ✓
