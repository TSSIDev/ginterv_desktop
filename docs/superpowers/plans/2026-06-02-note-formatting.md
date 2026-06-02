# Note Formatting (B/I/U) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bold/italic/underline authoring and safe formatted rendering to the intervention note/body in the Tauri desktop client.

**Architecture:** Pure frontend change. The Rust backend already sends/receives the body as Exchange HTML. We replace the plain `<textarea>` with a native `contenteditable` editor (B/I/U toolbar), and route all untrusted HTML (display, editor load, paste, save) through DOMPurify. Existing richer Outlook formatting is preserved on round-trip.

**Tech Stack:** Vanilla JS, native `contenteditable` + `document.execCommand`, DOMPurify (vendored offline). No build step (Tauri serves `src/` statically). No JS test runner — verification is manual in the running app.

---

## Notes for the implementer

- **No bundler / no dev server.** `src-tauri/tauri.conf.json` sets `frontendDist: "../src"`; edits to `src/` are served directly. Cache busting is manual via `?v=` query strings in `index.html`.
- **No JS test framework exists.** Do not add one (out of scope). Each task's verification is a concrete manual check in the running app. Launch the app from the project root with `cargo tauri dev` (or the user's usual run method); reload the window after edits.
- **Asset versions before this plan:** `style.css?v=34`, `calendar.js?v=20`, `app.js?v=23`. Each task below bumps the versions it touches; final state: `vendor/purify.min.js?v=1`, `style.css?v=35`, `app.js?v=27`, `calendar.js?v=20` (unchanged).
- `calendar.js` is intentionally NOT modified: it renders the detail panel through the shared `renderInterventionDetail` in `app.js`.

## File structure

- **Create:** `src/vendor/purify.min.js` — vendored DOMPurify library (first third-party JS in this client).
- **Modify:** `src/index.html` — load DOMPurify; replace note `<textarea>` with editor markup; bump `?v=`.
- **Modify:** `src/app.js` — add `sanitizeNote`; add editor helpers (`initNoteEditor`/`getNoteHtml`/`setNoteHtml`); sanitize the detail render; rewire `fillForm`/`submitForm`/`resetForm`.
- **Modify:** `src/style.css` — editor, toolbar, and `.note-box` content styles.

---

### Task 1: Vendor DOMPurify and add the `sanitizeNote` wrapper

**Files:**
- Create: `src/vendor/purify.min.js`
- Modify: `src/index.html` (script tags near `:535-538`)
- Modify: `src/app.js` (new global function above `renderInterventionDetail`)

- [ ] **Step 1: Download DOMPurify (pinned 3.x) into the vendor folder**

Run (PowerShell, from project root):
```powershell
New-Item -ItemType Directory -Force src/vendor | Out-Null
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js" -OutFile "src/vendor/purify.min.js"
```
Expected: `src/vendor/purify.min.js` exists, non-empty (~20KB), starts with a minified UMD header containing `DOMPurify`.

- [ ] **Step 2: Verify the file looks like DOMPurify**

Run:
```powershell
(Get-Item src/vendor/purify.min.js).Length
Select-String -Path src/vendor/purify.min.js -Pattern "DOMPurify" -SimpleMatch | Select-Object -First 1
```
Expected: size > 10000 and at least one `DOMPurify` match.

- [ ] **Step 3: Load DOMPurify before the app scripts**

In `src/index.html`, find:
```html
<script src="search.js?v=7"></script>
<script src="settings.js?v=7"></script>
<script src="calendar.js?v=20"></script>
<script src="app.js?v=23"></script>
```
Replace with (adds vendor script first, bumps app.js):
```html
<script src="vendor/purify.min.js?v=1"></script>
<script src="search.js?v=7"></script>
<script src="settings.js?v=7"></script>
<script src="calendar.js?v=20"></script>
<script src="app.js?v=24"></script>
```

- [ ] **Step 4: Add the `sanitizeNote` wrapper in `app.js`**

In `src/app.js`, locate the comment line that begins the shared detail renderer:
```js
// Shared intervention-detail markup. Used by App.showDetail (list/search) and
```
Immediately ABOVE that comment, insert:
```js
// Sanitize untrusted note/body HTML (from Exchange/Outlook or pasted) before it
// touches the live DOM. DOMPurify defaults preserve rich formatting (lists,
// tables, inline styles) and strip script/handlers/js: URLs. We additionally
// drop media: cid: images never resolve and external URLs are tracking/privacy.
function sanitizeNote(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['img', 'video', 'audio'],
    FORBID_ATTR: ['srcset']
  });
}

```

- [ ] **Step 5: Manual verification**

Launch the app, open the developer console (the Tauri webview devtools), and run:
```js
sanitizeNote('<b>ciao</b><script>alert(1)</script><img src=x onerror=alert(2)>')
```
Expected: returns `"<b>ciao</b>"` (no `<script>`, no `<img>`, no `onerror`). Also `sanitizeNote('')` returns `''`.

- [ ] **Step 6: Commit**

```bash
git add src/vendor/purify.min.js src/index.html src/app.js
git commit -m "feat: vendor DOMPurify and add sanitizeNote wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Sanitize the note in the detail panel (read path)

**Files:**
- Modify: `src/app.js` (inside `renderInterventionDetail`, the `.note-box` markup)

- [ ] **Step 1: Compute a sanitized note string before the template**

In `src/app.js`, inside `renderInterventionDetail`, find the line that builds the meta chips:
```js
  const metaHtml = [
    chip(item.tipo_tariffa),
    chip(item.tipo_fatturazione),
    chip(item.trasferta, 'travel')
  ].filter(Boolean).join('');
```
Immediately AFTER that block, add:
```js
  const noteHtml = sanitizeNote(item.body_html);
```

- [ ] **Step 2: Use the sanitized string in the note markup**

In the same function, find:
```js
        ${item.body_html ? `<div class="note-box">${item.body_html}</div>` : `<div class="detail-note-empty">Nessuna nota</div>`}
```
Replace with:
```js
        ${noteHtml ? `<div class="note-box">${noteHtml}</div>` : `<div class="detail-note-empty">Nessuna nota</div>`}
```

- [ ] **Step 3: Bump app.js cache version**

In `src/index.html` change `app.js?v=24` to `app.js?v=25`.

- [ ] **Step 4: Manual verification**

Launch/reload the app. Select an intervention that has notes:
- A note with formatting (e.g. created in Outlook with bold/list) renders formatted in the detail panel.
- A note that is empty shows "Nessuna nota".
- (XSS) If you can craft/select an appointment whose body contains `<script>` or `<img onerror>`, confirm nothing executes and the dangerous markup is gone.

- [ ] **Step 5: Commit**

```bash
git add src/app.js src/index.html
git commit -m "feat: sanitize note HTML in the detail panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Replace the note textarea with editor markup + styles

**Files:**
- Modify: `src/index.html` (note field block, currently `:415-422`)
- Modify: `src/style.css` (new editor/toolbar rules; `.note-box` content rules)

- [ ] **Step 1: Replace the note `<textarea>` with the editor markup**

In `src/index.html`, find:
```html
        <div class="form-section">
          <div class="form-section-title">Note Outlook</div>
          <div class="fg">
            <label class="fg-lbl">Note intervento (corpo Outlook)</label>
            <textarea class="fg-ta note-main" id="f-note" rows="4" placeholder="Descrizione dell'attività, dettagli tecnici, esito, materiale usato…"></textarea>
            <div class="fg-hint">Queste note finiscono nel corpo dell'appuntamento Outlook, non nel soggetto.</div>
          </div>
        </div>
```
Replace with:
```html
        <div class="form-section">
          <div class="form-section-title">Note Outlook</div>
          <div class="fg">
            <label class="fg-lbl">Note intervento (corpo Outlook)</label>
            <div class="note-editor">
              <div class="note-toolbar" role="toolbar" aria-label="Formattazione note">
                <button type="button" class="note-tool" data-cmd="bold" title="Grassetto (Ctrl+B)" aria-label="Grassetto"><b>B</b></button>
                <button type="button" class="note-tool" data-cmd="italic" title="Corsivo (Ctrl+I)" aria-label="Corsivo"><i>I</i></button>
                <button type="button" class="note-tool" data-cmd="underline" title="Sottolineato (Ctrl+U)" aria-label="Sottolineato"><u>U</u></button>
              </div>
              <div class="fg-ta note-main" id="f-note" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Descrizione dell'attività, dettagli tecnici, esito, materiale usato…"></div>
            </div>
            <div class="fg-hint">Queste note finiscono nel corpo dell'appuntamento Outlook, non nel soggetto.</div>
          </div>
        </div>
```

- [ ] **Step 2: Add editor and note-content styles**

In `src/style.css`, find the existing rule:
```css
.note-box { background: var(--bg-elev); border-radius: var(--r-md); padding: 10px 11px; font-size: 11.5px; color: var(--text-2); line-height: 1.65; }
```
Immediately AFTER it, add:
```css
/* Note editor (contenteditable + B/I/U toolbar) */
.note-toolbar { display: flex; gap: 4px; margin-bottom: 6px; }
.note-tool {
  width: 30px; height: 28px; border-radius: var(--r-sm);
  border: 1px solid var(--border-2); background: var(--bg-elev);
  color: var(--text-2); cursor: pointer; font-size: 13px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s var(--ease), color .15s var(--ease), border-color .15s var(--ease);
}
.note-tool:hover { background: var(--bg-hover); color: var(--text-1); }
.note-tool.on { background: var(--accent-dim); border-color: color-mix(in oklch, var(--accent) 32%, transparent); color: var(--accent); }
#f-note[contenteditable] { min-height: 92px; max-height: 240px; overflow-y: auto; cursor: text; line-height: 1.5; }
#f-note[contenteditable]:empty:before { content: attr(data-placeholder); color: var(--text-3); pointer-events: none; }
#f-note[contenteditable] b, #f-note[contenteditable] strong { font-weight: 700; }
/* Rendered note formatting (detail panel) */
.note-box b, .note-box strong { font-weight: 700; }
.note-box i, .note-box em { font-style: italic; }
.note-box ul, .note-box ol { margin: 4px 0 4px 18px; }
.note-box p { margin: 0 0 6px; }
.note-box table { border-collapse: collapse; }
.note-box td, .note-box th { padding: 2px 6px; }
```

- [ ] **Step 3: Bump style.css cache version**

In `src/index.html` change `style.css?v=34` to `style.css?v=35`.

- [ ] **Step 4: Manual verification**

Launch/reload, open "Nuovo intervento":
- The note field now shows a 3-button toolbar (B / I / U) above an editable box.
- The placeholder text shows when the box is empty and disappears when typing.
- Clicking into the box shows the accent focus ring (inherited from `.fg-ta:focus`).
- Buttons B/I/U are visible and styled in the design system. (Functionality wired in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/style.css
git commit -m "feat: note editor markup and toolbar styles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Editor behavior (toolbar, active state, paste, init)

**Files:**
- Modify: `src/app.js` (add `initNoteEditor`/`getNoteHtml`/`setNoteHtml` methods on `App`; call `initNoteEditor` from `initForm`)

- [ ] **Step 1: Add the editor methods to the `App` object**

In `src/app.js`, find the end of `initForm()`:
```js
    mkFuzzy('fuzzy-tariffa-wrap',  dd.tipo_tariffa || [],     'Tariffa…', 'tariffa');
    mkFuzzy('fuzzy-addebito-wrap', dd.tipo_addebito || [],    'Addebito…', 'addebito');
  },
```
Replace with (adds the init call plus the three methods right after):
```js
    mkFuzzy('fuzzy-tariffa-wrap',  dd.tipo_tariffa || [],     'Tariffa…', 'tariffa');
    mkFuzzy('fuzzy-addebito-wrap', dd.tipo_addebito || [],    'Addebito…', 'addebito');
    this.initNoteEditor();
  },

  initNoteEditor() {
    const ed = document.getElementById('f-note');
    if (!ed || ed._wired) return;
    ed._wired = true;
    const toolbar = ed.closest('.note-editor')?.querySelector('.note-toolbar');
    const buttons = toolbar ? Array.from(toolbar.querySelectorAll('.note-tool')) : [];
    const refresh = () => buttons.forEach(b => {
      let active = false;
      try { active = document.queryCommandState(b.dataset.cmd); } catch {}
      b.classList.toggle('on', active);
    });
    buttons.forEach(b => {
      // Keep the editor selection when pressing a toolbar button.
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => {
        ed.focus();
        try { document.execCommand(b.dataset.cmd, false, null); } catch {}
        refresh();
      });
    });
    ed.addEventListener('keyup', refresh);
    ed.addEventListener('mouseup', refresh);
    ed.addEventListener('focus', refresh);
    // Sanitize pasted content before it enters the live editor.
    ed.addEventListener('paste', e => {
      e.preventDefault();
      const cd = e.clipboardData;
      const html = cd?.getData('text/html');
      if (html) {
        document.execCommand('insertHTML', false, sanitizeNote(html));
      } else {
        document.execCommand('insertText', false, cd?.getData('text/plain') || '');
      }
    });
  },

  getNoteHtml() {
    const ed = document.getElementById('f-note');
    if (!ed) return '';
    // An "empty" contenteditable can still hold <br>/<div>; treat no text +
    // no structural content as empty.
    if (!ed.textContent.trim() && !/<(table|ul|ol|li)/i.test(ed.innerHTML)) return '';
    return ed.innerHTML.trim();
  },

  setNoteHtml(html) {
    const ed = document.getElementById('f-note');
    if (ed) ed.innerHTML = html || '';
  },
```

- [ ] **Step 2: Bump app.js cache version**

In `src/index.html` change `app.js?v=25` to `app.js?v=26`.

- [ ] **Step 3: Manual verification**

Launch/reload, open "Nuovo intervento":
- Type text, select part of it, click **B**: it becomes bold; the B button shows the active (`.on`) state while the cursor is in bold text. Same for I and U.
- Ctrl+B / Ctrl+I / Ctrl+U toggle formatting natively.
- In devtools console run `App.getNoteHtml()` after typing "ciao" and bolding it: expect a string containing `<b>` or `<strong>`. With the box empty, `App.getNoteHtml()` returns `''`.
- Paste rich text copied from a browser/Word: formatting comes in but any script/image is stripped (paste a snippet containing an image to confirm the image does not appear).

- [ ] **Step 4: Commit**

```bash
git add src/app.js src/index.html
git commit -m "feat: contenteditable note editor behavior (B/I/U, paste sanitize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire the editor into the form data flow

**Files:**
- Modify: `src/app.js` (`resetForm` `:699`, `fillForm` `:733`, `submitForm` `:818` — line numbers pre-plan)

- [ ] **Step 1: Clear the editor in `resetForm`**

In `src/app.js`, find (in `resetForm`):
```js
    document.getElementById('f-note').value = '';
```
Replace with:
```js
    this.setNoteHtml('');
```

- [ ] **Step 2: Load sanitized HTML in `fillForm`**

In `src/app.js`, find (in `fillForm`):
```js
    document.getElementById('f-note').value = item.body_html?.replace(/<[^>]+>/g,'') || '';
```
Replace with:
```js
    this.setNoteHtml(sanitizeNote(item.body_html));
```

- [ ] **Step 3: Send sanitized editor HTML in `submitForm`**

In `src/app.js`, find (in `submitForm`):
```js
      body_html: document.getElementById('f-note').value || null,
```
Replace with:
```js
      body_html: sanitizeNote(this.getNoteHtml()) || null,
```

- [ ] **Step 4: Bump app.js cache version**

In `src/index.html` change `app.js?v=26` to `app.js?v=27`.

- [ ] **Step 5: Manual verification (full round-trip)**

Launch/reload:
1. Create a new intervention, write a note with **bold** and *italic*, save.
2. Reload the list, open its detail: the formatting shows.
3. Open the same intervention in edit: the editor shows the formatting (not stripped tags).
4. Make a small change, save again: no errors, formatting intact.
5. Open the same appointment in Outlook: the bold/italic render there too.
6. Open an intervention that already had rich Outlook formatting (list/table), edit and save: the list/table is preserved (not normalized away).
7. Create an intervention leaving the note empty: it saves with an empty/`null` body (detail shows "Nessuna nota").

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/index.html
git commit -m "feat: route note editor through form load/save/reset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes (author)

- Spec coverage: backend untouched (confirmed); DOMPurify vendored + wrapper (T1); read-path sanitize (T2); contenteditable editor + toolbar styles (T3); behavior incl. paste sanitize + active state (T4); fillForm/submitForm/resetForm rewire incl. empty→null and preserve-on-round-trip (T5). All spec sections mapped.
- Method names are consistent across tasks: `sanitizeNote`, `initNoteEditor`, `getNoteHtml`, `setNoteHtml`.
- No automated tests by design (no runner in project; spec specifies manual verification).
