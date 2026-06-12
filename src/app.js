// Tauri invoke bridge — falls back to mock in browser preview
const invoke = (typeof window.__TAURI__ !== 'undefined')
  ? window.__TAURI__.core.invoke
  : async (cmd, args) => {
      console.log('[mock invoke]', cmd, args);
      if (cmd === 'list_accounts_cmd') return [];
      if (cmd === 'get_dropdown_data') return { sigla:['ML','PT','RT'], clienti:['ACME Srl','Beta SpA'], luoghi:[], tipo_intervento:['Assistenza','Configurazione','Formazione'], tipo_tariffa:['TB','Orario','Forfait'], tipo_addebito:['Fatturato','Addebito Reale','Non Fatturato'], durata:[] };
      if (cmd === 'test_connection') return { ok: true, error: null };
      if (cmd === 'save_account') return null;
      if (cmd === 'list_interventions') return [];
      return null;
    };

// Maps each fuzzy-dropdown key to its InterventionItem field (fill/save share this).
const FUZZY_FIELD_MAP = {
  sigla: 'nome_tecnico',
  cliente: 'ragione_sociale',
  tipo: 'descrizione',
  luogo: 'luogo',
  tariffa: 'tipo_tariffa',
  addebito: 'tipo_fatturazione',
};

// ── Listen for Tauri events (no-op in browser) ───────────────────────
const listenEvent = (typeof window.__TAURI__ !== 'undefined' && window.__TAURI__.event)
  ? (ev, cb) => window.__TAURI__.event.listen(ev, cb)
  : () => {};

// ── Custom window controls (decorations:false borderless window) ──────
const WinControls = {
  _win() {
    return (typeof window.__TAURI__ !== 'undefined' && window.__TAURI__.window)
      ? window.__TAURI__.window.getCurrentWindow() : null;
  },
  minimize() { this._win()?.minimize(); },
  toggleMaximize() { this._win()?.toggleMaximize(); },
  close() { this._win()?.close(); },
  startResize(dir, e) {
    if (e) e.preventDefault();
    this._win()?.startResizeDragging(dir);
  },
  async _refreshMaxIcon() {
    const w = this._win(); if (!w) return;
    let max = false;
    try { max = await w.isMaximized(); } catch { /* noop */ }
    const icon = $('win-max-icon');
    const btn = $('win-max');
    if (!icon) return;
    // Maximized → "restore" (two offset squares); else single square
    icon.innerHTML = max
      ? '<rect x="3.4" y="1.6" width="6.4" height="6.4" rx="1"/><rect x="1.6" y="3.4" width="6.4" height="6.4" rx="1" fill="var(--chrome-bg)"/>'
      : '<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1"/>';
    if (btn) btn.title = max ? 'Ripristina' : 'Ingrandisci';
  },
  init() {
    const w = this._win(); if (!w) return;
    this._refreshMaxIcon();
    w.onResized(() => this._refreshMaxIcon());
  },
};
if (typeof window.__TAURI__ !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => WinControls.init());
}

// escHtml / pendingBadge / buildSubject / fmtDT / durMinToStr vivono in shared.js
// (caricato prima): helper puri, testati in tests/shared.test.js.

function GIIcon(name, size = 12) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths = {
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h1a5 5 0 0 0 5-5V8"/><path d="M6 16v-1a5 5 0 0 1 5-5h1"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    sign: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  };
  return `<svg ${attrs}>${paths[name] || ''}</svg>`;
}

// ── Toast ────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const c = $('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── Fuzzy dropdown helper ────────────────────────────────────────────
function createFuzzyDropdown(container, options, placeholder, onSelect, initialValue = '') {
  let value = initialValue;
  let filteredOptions = [];
  let activeIndex = -1;
  container.innerHTML = '';
  const input = document.createElement('input');
  input.className = 'fuzzy-input';
  input.placeholder = placeholder;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.value = value;
  const dd = document.createElement('div');
  dd.className = 'fuzzy-dropdown';
  dd.setAttribute('role', 'listbox');
  dd.style.display = 'none';
  container.appendChild(input);
  container.appendChild(dd);

  function syncActive() {
    Array.from(dd.children).forEach((el, i) => {
      el.classList.toggle('sel', i === activeIndex);
      if (i === activeIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function closeDropdown() {
    dd.style.display = 'none';
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
  }

  function renderOpts(q) {
    const q2 = q.toLowerCase();
    filteredOptions = options.filter(o => o.toLowerCase().includes(q2));
    dd.innerHTML = '';
    filteredOptions.slice(0, 20).forEach((o, i) => {
      const d = document.createElement('div');
      d.className = 'fuzzy-opt';
      d.setAttribute('role', 'option');
      d.textContent = o;
      d.onmousedown = (e) => { e.preventDefault(); setValue(o); onSelect(o); };
      dd.appendChild(d);
    });
    filteredOptions = filteredOptions.slice(0, 20);
    activeIndex = filteredOptions.length ? 0 : -1;
    dd.style.display = filteredOptions.length ? 'block' : 'none';
    input.setAttribute('aria-expanded', filteredOptions.length ? 'true' : 'false');
    syncActive();
  }

  function setValue(v) { value = v; input.value = v; closeDropdown(); }
  function getValue() { return input.value; }

  input.addEventListener('input', () => renderOpts(input.value));
  input.addEventListener('focus', () => renderOpts(input.value));
  input.addEventListener('keydown', (e) => {
    const open = dd.style.display !== 'none';
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) renderOpts(input.value);
      if (!filteredOptions.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + step + filteredOptions.length) % filteredOptions.length;
      syncActive();
    } else if (e.key === 'Enter' && open && activeIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      const selected = filteredOptions[activeIndex];
      setValue(selected);
      onSelect(selected);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      closeDropdown();
    }
  });
  input.addEventListener('blur', () => setTimeout(closeDropdown, 150));

  if (initialValue) setValue(initialValue);
  return { setValue, getValue, destroy: () => { container.innerHTML = ''; } };
}

// Graceful overlay/popup dismiss: play exit animation, then hide.
function closeOverlay(el) {
  if (typeof el === 'string') el = $(el);
  if (!el || el.classList.contains('hidden')) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { el.classList.remove('closing'); el.classList.add('hidden'); return; }
  el.classList.add('closing');
  let done = false;
  const finish = () => {
    if (done || !el.classList.contains('closing')) return;
    done = true;
    el.classList.remove('closing');
    el.classList.add('hidden');
  };
  el.addEventListener('animationend', function h(ev) {
    if (ev.target !== el) return;
    el.removeEventListener('animationend', h);
    finish();
  });
  setTimeout(finish, 240);
}

// Styled replacement for native confirm(). Returns a Promise<boolean>.
function confirmDialog({ title = 'Conferma', message = '', confirmText = 'Conferma', cancelText = 'Annulla', danger = false } = {}) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `
      <div class="modal" style="width:400px">
        <div class="modal-head">
          <div class="modal-title">${escHtml(title)}</div>
          <button class="modal-close" data-act="cancel" aria-label="Chiudi">&times;</button>
        </div>
        <div style="padding:2px 22px 18px;font-size:var(--fs-base);color:var(--text-2);line-height:1.5">${escHtml(message)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:0 22px 18px">
          <button class="btn" data-act="cancel">${escHtml(cancelText)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${escHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    let settled = false;
    const done = (val) => {
      if (settled) return; settled = true;
      document.removeEventListener('keydown', onKey);
      ov.classList.add('closing');
      ov.addEventListener('animationend', e => { if (e.target === ov) ov.remove(); }, { once: true });
      setTimeout(() => ov.remove(), 240);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
    ov.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') done(true);
      else if (act === 'cancel' || e.target === ov) done(false);
    });
    document.addEventListener('keydown', onKey);
    setTimeout(() => ov.querySelector('[data-act="ok"]').focus(), 60);
  });
}

// Position the sliding indicator under the active button of a segmented toggle.
function syncSeg(container) {
  if (!container) return;
  let thumb = container.querySelector(':scope > .seg-thumb');
  if (!thumb) {
    thumb = document.createElement('span');
    thumb.className = 'seg-thumb';
    container.prepend(thumb);
  }
  const active = container.querySelector('.on, .active');
  if (!active || !active.offsetWidth) { thumb.classList.remove('ready'); return; }
  // Use fractional rects, not rounded offsetWidth/offsetLeft, so the thumb lands
  // exactly on the button (integer offsets drift ~1px with sub-pixel button widths).
  const cRect = container.getBoundingClientRect();
  const aRect = active.getBoundingClientRect();
  const targetX = aRect.left - cRect.left - (container.clientLeft || 0);
  // FLIP: la larghezza cambia di scatto, lo scarto si recupera con scaleX che
  // anima verso 1 — solo transform, niente transizione di layout su width.
  const prev = thumb.getBoundingClientRect();
  thumb.style.width = aRect.width + 'px';
  if (thumb.classList.contains('ready') && prev.width && aRect.width) {
    const startX = prev.left - cRect.left - (container.clientLeft || 0);
    thumb.style.transition = 'none';
    thumb.style.transform = `translateX(${startX}px) scaleX(${prev.width / aRect.width})`;
    void thumb.offsetWidth;
    thumb.style.transition = '';
  }
  thumb.style.transform = `translateX(${targetX}px) scaleX(1)`;
  requestAnimationFrame(() => thumb.classList.add('ready'));
}
window.addEventListener('resize', () => {
  document.querySelectorAll('.nav-seg, #view-calendar .view-sw').forEach(syncSeg);
});

// ═══════════════════════════════════════════════════ ONBOARDING WIZARD
const Wizard = {
  step: 0,
  data: { email:'', password:'', server:'', domain:'', sigla:'', displayName:'' },
  steps: ['Benvenuto', 'Account Exchange', 'Test connessione', 'Pronto!'],
  tested: false,

  init() {
    this.renderSteps();
    this.renderBody();
    $('wiz-next').onclick = () => this.next();
    $('wiz-back').onclick = () => this.back();
    $('wiz-skip').onclick = () => this.skip();
  },

  renderSteps() {
    const el = $('wiz-steps');
    el.innerHTML = this.steps.map((s, i) => {
      const state = i < this.step ? 'done' : i === this.step ? 'active' : 'pending';
      const dot = state === 'done' ? '✓' : i + 1;
      const line = i < this.steps.length - 1
        ? `<div class="step-line ${i < this.step ? 'done' : ''}"></div>` : '';
      return `
        <div class="step">
          <div class="step-dot ${state}">${dot}</div>
          <div class="step-lbl ${state}">${s}</div>
        </div>${line}`;
    }).join('');
  },

  renderBody() {
    const el = $('wiz-body');
    const back = $('wiz-back');
    const next = $('wiz-next');
    back.style.display = this.step > 0 ? '' : 'none';

    if (this.step === 0) {
      next.textContent = 'Inizia →';
      el.innerHTML = `
        <div class="step-title">Benvenuto in Gestore Interventi</div>
        <div class="step-desc">L'app che sincronizza i tuoi interventi tecnici con Exchange Server. Nessun server intermedio: tutto gira localmente sul tuo PC.</div>
        <div class="wiz-cards">
          <div class="wiz-card">
            <div class="wiz-card-ico">${GIIcon('cal', 18)}</div>
            <div class="wiz-card-t">Calendario</div>
            <div class="wiz-card-d">Vista settimana, giorno e mese</div>
          </div>
          <div class="wiz-card">
            <div class="wiz-card-ico">${GIIcon('sign', 18)}</div>
            <div class="wiz-card-t">Firma digitale</div>
            <div class="wiz-card-d">Firma su schermo o tablet</div>
          </div>
          <div class="wiz-card">
            <div class="wiz-card-ico">${GIIcon('file', 18)}</div>
            <div class="wiz-card-t">PDF ed Email</div>
            <div class="wiz-card-d">Export e invio automatico</div>
          </div>
        </div>`;
    } else if (this.step === 1) {
      next.textContent = 'Continua →';
      el.innerHTML = `
        <div class="step-title">Configura il tuo account Exchange</div>
        <div class="step-desc">Inserisci le credenziali Exchange. La password viene salvata nel keychain di sistema (Windows Credential Manager / KWallet).</div>
        <div class="fg">
          <label class="fg-lbl">Email account Exchange *</label>
          <input class="fg-in" type="email" id="wiz-email" placeholder="nome.cognome@azienda.it" value="${this.data.email}">
        </div>
        <div class="fg">
          <label class="fg-lbl">Password *</label>
          <input class="fg-in" type="password" id="wiz-password" value="${this.data.password}" placeholder="••••••••••">
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
          <div class="fg">
            <label class="fg-lbl">Server Exchange</label>
            <input class="fg-in" id="wiz-server" placeholder="mail.azienda.it" value="${this.data.server}">
            <div class="fg-hint">Es: mail.tssi.it</div>
          </div>
          <div class="fg">
            <label class="fg-lbl">Dominio NTLM</label>
            <input class="fg-in" id="wiz-domain" placeholder="TSSI" value="${this.data.domain}">
            <div class="fg-hint">Solo NTLM</div>
          </div>
        </div>
        <div class="fg">
          <label class="fg-lbl">Nome visualizzato</label>
          <input class="fg-in" id="wiz-displayname" placeholder="Mario Rossi" value="${this.data.displayName}">
        </div>`;
    } else if (this.step === 2) {
      next.textContent = 'Continua →';
      next.disabled = !this.tested;
      el.innerHTML = `
        <div class="step-title">Test connessione</div>
        <div class="step-desc">Verifica che le credenziali siano corrette e che Exchange risponda.</div>
        <div class="wiz-account">
          <div class="wiz-account-lbl">Account</div>
          <div class="wiz-account-mail">${escHtml(this.data.email)}</div>
          <div class="wiz-account-srv">${escHtml(this.data.server) || 'Autodiscovery'}</div>
        </div>
        <button class="test-btn" id="wiz-test-btn" onclick="Wizard.runTest()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Testa connessione Exchange
        </button>
        <div id="wiz-test-result" style="margin-top:8px"></div>`;
    } else if (this.step === 3) {
      next.textContent = 'Avvia app →';
      next.disabled = false;
      el.innerHTML = `
        <div class="step-title">Tutto pronto! 🎉</div>
        <div class="step-desc">Account Exchange configurato e connessione verificata. L'app sincronizzerà automaticamente ogni 15 minuti.</div>
        <div class="test-result ok">
          <div class="test-dot ok"></div>
          <div class="test-msg ok">Connesso a Exchange · ${this.data.email}</div>
        </div>`;
    }
  },

  collectStep1() {
    this.data.email = $('wiz-email')?.value.trim() || '';
    this.data.password = $('wiz-password')?.value || '';
    this.data.server = $('wiz-server')?.value.trim() || '';
    this.data.domain = $('wiz-domain')?.value.trim() || '';
    this.data.displayName = $('wiz-displayname')?.value.trim() || '';
  },

  async runTest() {
    const btn = $('wiz-test-btn');
    const res = $('wiz-test-result');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Test in corso…';
    res.innerHTML = '';
    try {
      const result = await invoke('test_connection', {
        email: this.data.email,
        password: this.data.password,
        server: this.data.server,
        domain: this.data.domain || null,
      });
      if (result.ok) {
        res.innerHTML = `<div class="test-result ok"><div class="test-dot ok"></div><div class="test-msg ok">Connessione riuscita · Exchange raggiunto</div></div>`;
        this.tested = true;
        $('wiz-next').disabled = false;
      } else {
        res.innerHTML = `<div class="test-result err"><div class="test-dot err"></div><div class="test-msg err">${result.error || 'Connessione fallita'}</div></div>`;
      }
    } catch(e) {
      res.innerHTML = `<div class="test-result err"><div class="test-dot err"></div><div class="test-msg err">${e}</div></div>`;
    }
    btn.disabled = false;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Riprova connessione';
  },

  async next() {
    if (this.step === 1) this.collectStep1();
    if (this.step === 1 && (!this.data.email || !this.data.password)) {
      toast('Email e password obbligatorie', 'error'); return;
    }
    if (this.step === 3) {
      await this.finish(); return;
    }
    this.step++;
    this.renderSteps();
    this.renderBody();
  },

  back() {
    if (this.step > 0) { this.step--; this.renderSteps(); this.renderBody(); }
  },

  skip() {
    this.hide();
    App.enterApp();
  },

  async finish() {
    const btn = $('wiz-next');
    btn.disabled = true;
    btn.textContent = 'Salvataggio…';
    try {
      await invoke('save_account', {
        input: {
          email: this.data.email,
          password: this.data.password,
          display_name: this.data.displayName || null,
          sigla: null,
          server: this.data.server || null,
          domain: this.data.domain || null,
          is_primary: true,
        }
      });
    } catch(e) {
      toast('Errore salvataggio account: ' + e, 'error');
    }
    try { App.accounts = await invoke('list_accounts_cmd'); } catch(e) {}
    this.hide();
    App.enterApp();
  },

  hide() {
    $('onboarding').style.display = 'none';
  },
};

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

// Plain-text extraction from body HTML for previews/exports. A naive regex tag
// strip leaks the text inside <style>/<xml> blocks that Outlook/Word embed in
// note bodies ("Style Definitions table.MsoNormalTable…"); parsing with
// DOMParser drops comments (incl. <!--[if mso]> blocks) and lets us remove
// style/script nodes before reading textContent.
function htmlToText(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('style, script, xml, head, title').forEach(n => n.remove());
  return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
}

// Shared intervention-detail markup. Used by App.showDetail (list/search) and
// Calendar.renderDetail (calendar) so the panel stays identical from every entry point.
// opts.trasferta → add "Trasferta" action; opts.close → add "Chiudi" action.
function renderInterventionDetail(item, opts = {}) {
  const PALETTE = ['var(--cat-1)','var(--cat-2)','var(--cat-3)','var(--cat-4)','var(--cat-5)','var(--cat-6)','var(--cat-7)','var(--cat-8)'];
  const colorOf = s => { let h = 0; for (const c of (s||'')) h = (h*31+c.charCodeAt(0))&0xffff; return PALETTE[h%PALETTE.length]; };
  const color = colorOf(item.nome_tecnico);
  const pad = n => String(n).padStart(2,'0');
  const start = item.start_dt ? new Date(item.start_dt) : null;
  const end = item.end_dt ? new Date(item.end_dt) : null;
  const dur = end && start ? Math.round((end - start) / 60000) : 0;
  const hm = d => d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
  const minHM = m => { const h=Math.floor(m/60),mm=m%60; return h&&mm?`${h}h ${mm}m`:h?`${h}h`:`${mm}m`; };
  const DOW = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  const MON = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const dateStr = start ? `${DOW[start.getDay()]} ${start.getDate()} ${MON[start.getMonth()]} ${start.getFullYear()}` : '—';
  const iS = escHtml(JSON.stringify(item));
  const chip = (v, cls = '') => v ? `<span class="iv-chip ${cls}">${escHtml(v)}</span>` : '';
  const metaHtml = [
    chip(item.tipo_tariffa),
    chip(item.tipo_fatturazione),
    chip(item.trasferta, 'travel')
  ].filter(Boolean).join('');
  const noteHtml = sanitizeNote(item.body_html);

  const menuItems = [
    `<button class="dmenu-it" onclick="App.openPdfModal(${iS})">${GIIcon('file')}Scarica PDF</button>`,
    `<button class="dmenu-it" onclick="App.exportIcsItem(${iS})">${GIIcon('cal')}Esporta iCal</button>`,
    opts.trasferta ? `<button class="dmenu-it" onclick="App.openTrasfertaForDetail(${iS})">${GIIcon('route')}Trasferta</button>` : '',
    `<div class="dmenu-sep"></div>`,
    `<button class="dmenu-it danger" onclick="App.confirmDelete(${iS})">${GIIcon('trash')}Elimina</button>`,
  ].filter(Boolean).join('');

  return `
    <div class="detail-hero" style="--hero:${color}">
      ${opts.close ? `<button class="dhx-close" onclick="Calendar._deselect()" title="Chiudi" aria-label="Chiudi dettaglio">${GIIcon('close', 12)}</button>` : ''}
      <div class="dhx-eye">${dateStr}${pendingBadge(item)}</div>
      <div class="dhx-client">${escHtml(item.ragione_sociale || '—')}</div>
      ${item.descrizione ? `<div class="dhx-type">${escHtml(item.descrizione)}</div>` : ''}
      ${item.altro ? `<div class="dhx-altro">${escHtml(item.altro)}</div>` : ''}
      <div class="dhx-actions">
        <button class="dhx-btn" onclick="App.editItem(${iS})" title="Modifica">${GIIcon('edit', 13)}<span>Modifica</span></button>
        <button class="dhx-btn" onclick="App.duplicateItem(${iS})" title="Duplica" aria-label="Duplica intervento">${GIIcon('copy', 13)}</button>
        <button class="dhx-btn" onclick="App.openEmailModal(${iS})" title="Invia email" aria-label="Invia email">${GIIcon('mail', 13)}</button>
        <button class="dhx-btn dhx-more" onclick="toggleDetailMenu(this)" title="Altre azioni" aria-label="Altre azioni" aria-haspopup="menu" aria-expanded="false">${GIIcon('more', 13)}</button>
        <div class="dmenu" role="menu">${menuItems}</div>
      </div>
    </div>
    <div class="detail-body fade-up">
      <div class="dtl">
        <div class="dtl-rail" style="background:color-mix(in oklch, ${color} 65%, transparent)"></div>
        <div class="dtl-rows">
          ${dur ? `<div class="dtl-time tnum">${hm(start)} → ${hm(end)} · ${minHM(dur)}</div>` : ''}
          ${item.luogo ? `<div class="dtl-row"><span class="dtl-lbl">Luogo</span><span class="dtl-val">${escHtml(item.luogo)}</span></div>` : ''}
          ${item.nome_tecnico ? `<div class="dtl-row"><span class="dtl-lbl">Tecnico</span><span class="dtl-val"><span class="tech-pill"><span class="pill-av" style="background:color-mix(in oklch, ${color} 20%, transparent);color:${color}">${escHtml(item.nome_tecnico)}</span>${escHtml(item.nome_tecnico)}</span></span></div>` : ''}
        </div>
      </div>
      ${metaHtml ? `<div class="detail-meta">${metaHtml}</div>` : ''}
      <div class="detail-note">
        <div class="df-lbl">Note</div>
        ${noteHtml ? `<div class="note-box">${noteHtml}</div>` : `<div class="detail-note-empty">Nessuna nota</div>`}
      </div>
    </div>`;
}

// Kebab menu del dettaglio: uno per pannello, chiuso da click esterni, Escape o su una voce.
function closeDetailMenus() {
  document.querySelectorAll('.dmenu.open').forEach(m => {
    m.classList.remove('open');
    m.parentElement?.querySelector('.dhx-more')?.setAttribute('aria-expanded', 'false');
  });
}
function toggleDetailMenu(btn) {
  const menu = btn.parentElement.querySelector('.dmenu');
  if (!menu) return;
  const willOpen = !menu.classList.contains('open');
  closeDetailMenus();
  if (willOpen) { menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
}
document.addEventListener('mousedown', (e) => {
  if (e.target.closest?.('.dhx-more') || e.target.closest?.('.dmenu')) return;
  closeDetailMenus();
});
document.addEventListener('click', (e) => {
  if (e.target.closest?.('.dmenu-it')) closeDetailMenus();
});

// ═══════════════════════════════════════════════════════════ MAIN APP
const App = {
  currentView: 'interventions',
  accounts: [],
  interventions: [],
  _interventionsSnapshot: '',
  editingItem: null,
  _fuzzy: {},
  _dropdownData: null,
  _currentItemId: null,
  _currentFirmaItem: null,
  _currentEmailItem: null,
  _firmaCtx: null,
  _firmaDrawing: false,
  _firmaLastX: 0,
  _firmaLastY: 0,
  _firmaPenWidth: 2,
  _firmaHasDraw: false,
  _syncFeedbackTimer: null,
  _syncOkTimer: null,
  _lastSyncAt: 0,
  _lastSyncCount: null,
  _syncing: false,
  _freshTimer: null,

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
      const win = WinControls._win();
      if (!win) return;
      if (enabled) {
        await win.setEffects({ effects: ['acrylic'], state: 'active' });
      } else {
        await win.clearEffects();
      }
    } catch (_) { /* API finestra non disponibile: la classe CSS resta la verità visiva */ }
  },

  // Tema: 'light' | 'dark' | 'auto' (segue il sistema). Default storico: light.
  themePref() { return localStorage.getItem('gi-theme') || 'light'; },

  applyThemePref() {
    const pref = this.themePref();
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isLight = pref === 'auto' ? !sysDark : pref !== 'dark';
    document.body.classList.toggle('theme-light', isLight);
  },

  async init() {
    // Apply saved theme (e segui il sistema quando il pref è 'auto')
    this.applyThemePref();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.themePref() === 'auto') this.applyThemePref();
    });

    // Apply saved accent hue (set on :root so both themes resolve it)
    const accentHue = localStorage.getItem('gi-accent-hue');
    if (accentHue) document.documentElement.style.setProperty('--accent-hue', accentHue);

    // Applica preferenza trasparenze (default per piattaforma)
    this._applyTransparency();

    // Keyboard shortcut Ctrl+K
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      const target = e.target;
      const isEditable = target?.matches?.('input, textarea, select, [contenteditable="true"]');
      const newModalOpen = !$('modal-new')?.classList.contains('hidden');
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.openCmdk();
      }
      if (e.key === 'F1') {
        e.preventDefault();
        this.openGuideModal();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && newModalOpen) {
        e.preventDefault();
        this.submitForm();
      }
      if (e.key === 'Escape') {
        if (!$('modal-new')?.classList.contains('hidden')) this.closeNewModal();
        else document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeOverlay(m));
        this.dismissCalendarCreate();
        closeOverlay('ctx-menu');
        closeDetailMenus();
        if (typeof Search !== 'undefined') Search._closePop();
      }
      const cmdkOpen = !$('cmdk')?.classList.contains('hidden');
      if (!isEditable && !newModalOpen && !cmdkOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 't') { e.preventDefault(); this.navigate('calendar'); Calendar.goToday(); }
        if (k === 'n') { e.preventDefault(); this.openNewModal(); }
        if (this.currentView === 'calendar') {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            Calendar.nav(e.key === 'ArrowRight' ? 1 : -1);
          }
          if (e.key === '1') Calendar.setView('month');
          if (e.key === '2') Calendar.setView('week');
          if (e.key === '3') Calendar.setView('day');
        }
      }
    });

    // Listen for sync-complete event
    listenEvent('sync-complete', e => {
      const { account, count, last_sync } = e.payload || {};
      this._lastSyncAt = Date.parse(last_sync) || Date.now();
      this._lastSyncCount = count ?? 0;
      $('sb-dot').className = 'sb-dot g';
      this._renderFreshness();
      this.showSyncFeedback(`${count || 0} aggiornati`);
      this.loadInterventions();
    });

    listenEvent('flush-complete', () => this.loadInterventions());
    listenEvent('write-conflict', () => this.checkConflicts());

    // Seamless freshness: keep the relative "Sincronizzato N fa" label live,
    // and resync when the user returns to the app or the network comes back —
    // so reopening the window shows fresh data without hitting the sync button.
    this._freshTimer = setInterval(() => this._renderFreshness(), 30000);
    window.addEventListener('focus', () => this.maybeSyncOnFocus());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.maybeSyncOnFocus();
    });
    window.addEventListener('online', () => this.maybeSyncOnFocus(true));

    // Check if accounts exist
    let accounts = [];
    try { accounts = await invoke('list_accounts_cmd'); } catch(e) {}
    this.accounts = accounts;

    if (accounts.length === 0) {
      Wizard.init();
    } else {
      $('onboarding').style.display = 'none';
      this.enterApp();
    }
  },

  enterApp() {
    $('main-app').style.display = 'grid';
    this.renderSidebarAccounts();
    this.loadDropdowns().then(() => this.initForm());
    this.navigate('calendar');
    this.clearDetail();
    // loadInterventions già innescato da navigate('calendar') → Calendar.onNavigate
    this.checkConflicts();
    // Cold-boot sync: the backend loop sleeps a full interval before its first
    // pass, and the window may already be focused when the focus listener
    // attaches — kick one sync explicitly.
    this.maybeSyncOnFocus();
    // Set current account in statusbar
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (primary) $('sb-account').textContent = primary.email;
  },

  renderSidebarAccounts() {
    const el = $('sidebar-accounts');
    if (!this.accounts.length) { el.textContent = 'Nessun account'; return; }
    el.innerHTML = this.accounts.map(a =>
      `<div style="padding:5px 0;display:flex;align-items:center;gap:8px">
        <div class="sb-dot g"></div>
        <div><div style="font-weight:600;font-size:var(--fs-sm)">${escHtml(a.sigla || '—')}</div>
        <div style="font-size:var(--fs-xs);color:var(--text-3)">${escHtml(a.email)}</div></div>
       </div>`
    ).join('');
  },

  navigate(view) {
    this.dismissCalendarCreate();
    if (view === 'new') { this.openNewModal(); return; }
    if (view === 'settings') { this.openSettingsModal(); return; }
    this.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = $(`view-${view}`);
    if (target) target.classList.add('active');
    // Highlight the matching sidebar nav segment (calendar / interventions)
    document.querySelectorAll('.nav-seg-btn').forEach(b => b.classList.toggle('on', b.dataset.nav === view));
    syncSeg(document.querySelector('.nav-seg'));
    $('toolbar-new').style.display = '';
    if (view !== 'calendar') this.clearDetail();
    if (view === 'calendar') Calendar.onNavigate();
    else if (view === 'search') Search.onNavigate();
    else this.renderSidebarAccounts();
  },

  dismissCalendarCreate() {
    if (window.Calendar?._dismissCreate) Calendar._dismissCreate();
    else $('cal-create-modal')?.classList.add('hidden');
  },

  openSettingsModal() {
    $('modal-settings')?.classList.remove('hidden', 'closing');
    Settings.onNavigate();
  },

  openGuideModal() {
    const m = $('modal-guide');
    if (!m) return;
    m.classList.remove('hidden', 'closing');
    m.querySelector('.guide-body').scrollTop = 0;
  },

  openNewModal(prefill) {
    $('modal-new')?.classList.remove('hidden', 'closing');
    this.resetForm();
    if (prefill) {
      const pad = n => String(n).padStart(2, '0');
      $('f-start').value = `${prefill.date}T${pad(prefill.startH)}:${pad(prefill.startM)}`;
      const durMin = (prefill.endH * 60 + prefill.endM) - (prefill.startH * 60 + prefill.startM);
      if (durMin > 0) {
        const clamped = Math.min(480, Math.max(15, Math.round(durMin / 15) * 15));
        $('f-durata').value = clamped;
        this.updateDurata(clamped);
      }
      this.updateSubjectPreview();
    }
    setTimeout(() => $('f-start')?.focus(), 60);
  },

  closeNewModal() {
    closeOverlay('modal-new');
    this.editingItem = null;
    // Il ghost del drag-create resta visibile sotto il modale: congedalo qui,
    // a salvataggio o annullamento avvenuto.
    window.Calendar?.clearCreateGhost?.();
  },

  toggleTheme() {
    // Toggle rapido: forza il tema opposto a quello visibile (esce da 'auto').
    const light = !document.body.classList.contains('theme-light');
    localStorage.setItem('gi-theme', light ? 'light' : 'dark');
    this.applyThemePref();
  },

  // ── Dropdown data ─────────────────────────────────────────────────
  async loadDropdowns() {
    try { this._dropdownData = await invoke('get_dropdown_data'); }
    catch(e) { this._dropdownData = { sigla:[], clienti:[], luoghi:[], tipo_intervento:[], tipo_tariffa:[], tipo_addebito:[], durata:[] }; }
  },

  // ── Form ──────────────────────────────────────────────────────────
  initForm() {
    const dd = this._dropdownData || {};
    const wrap = id => $(id);
    const mkFuzzy = (id, opts, ph, field) => {
      const w = wrap(id);
      if (!w) return;
      this._fuzzy[field] = createFuzzyDropdown(w, opts, ph, () => this.updateSubjectPreview());
    };
    mkFuzzy('fuzzy-cliente-wrap',  dd.clienti || [],          'Cerca cliente…', 'cliente');
    mkFuzzy('fuzzy-tipo-wrap',     dd.tipo_intervento || [],  'Tipo intervento…', 'tipo');
    mkFuzzy('fuzzy-luogo-wrap',    dd.luoghi || [],           'Luogo…', 'luogo');
    mkFuzzy('fuzzy-sigla-wrap',    dd.sigla || [],            'Es. ML', 'sigla');
    mkFuzzy('fuzzy-tariffa-wrap',  dd.tipo_tariffa || [],     'Tariffa…', 'tariffa');
    mkFuzzy('fuzzy-addebito-wrap', dd.tipo_addebito || [],    'Addebito…', 'addebito');
    this.initNoteEditor();
  },

  initNoteEditor() {
    const ed = $('f-note');
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
    const ed = $('f-note');
    if (!ed) return '';
    // An "empty" contenteditable can still hold <br>/<div>; treat no text +
    // no structural content as empty.
    if (!ed.textContent.trim() && !/<(table|ul|ol|li)/i.test(ed.innerHTML)) return '';
    return ed.innerHTML.trim();
  },

  setNoteHtml(html) {
    const ed = $('f-note');
    if (ed) ed.innerHTML = html || '';
  },

  resetForm() {
    this.editingItem = null;
    this.clearFormErrors();
    $('form-title').textContent = 'Nuovo intervento';
    $('form-submit-text').textContent = 'Salva intervento';
    $('form-sign-btn').style.display = 'none';
    // Set default datetime to now rounded to next 15 min (local time)
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('f-start').value = localISO;
    $('f-durata').value = 60;
    this.updateDurata(60);
    $('f-altro').value = '';
    this.setNoteHtml('');
    $('f-trasferta').value = '';
    Object.values(this._fuzzy).forEach(f => f?.setValue(''));
    // Auto-fill sigla from last used or primary account
    const lastSigla = localStorage.getItem('gi_last_sigla');
    const accountSigla = (this.accounts?.find(a => a.is_primary) || this.accounts?.[0])?.sigla || '';
    this._fuzzy.sigla?.setValue(lastSigla || accountSigla);
    this.updateSubjectPreview();
  },

  fillForm(item) {
    this.editingItem = item;
    $('form-title').textContent = 'Modifica intervento';
    $('form-submit-text').textContent = 'Aggiorna intervento';
    $('form-sign-btn').style.display = '';
    if (item.start_dt) {
      const d = new Date(item.start_dt);
      const localISO = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      $('f-start').value = localISO;
    }
    // Duration from start/end
    if (item.start_dt && item.end_dt) {
      const dur = Math.round((new Date(item.end_dt) - new Date(item.start_dt)) / 60000);
      const snapped = Math.max(15, Math.min(480, Math.round(dur / 15) * 15));
      $('f-durata').value = snapped;
      this.updateDurata(snapped);
    }
    for (const [k, field] of Object.entries(FUZZY_FIELD_MAP)) {
      this._fuzzy[k]?.setValue(item[field] || '');
    }
    $('f-altro').value = item.altro || '';
    this.setNoteHtml(sanitizeNote(item.body_html));
    $('f-trasferta').value = item.trasferta || '';
    this.updateSubjectPreview();
  },

  cancelForm() { this.closeNewModal(); },

  updateSubjectPreview() {
    const get = id => $(id)?.value || '';
    const s = buildSubject(
      this._fuzzy.sigla?.getValue() || '',
      this._fuzzy.cliente?.getValue() || '',
      this._fuzzy.tipo?.getValue() || '',
      get('f-altro'),
      this._fuzzy.tariffa?.getValue() || '',
      this._fuzzy.addebito?.getValue() || '',
    );
    const el = $('subject-preview');
    if (el) el.textContent = s || '—';
  },

  clearFormErrors() {
    document.querySelectorAll('#intervention-form .fg.has-error').forEach(el => el.classList.remove('has-error'));
    document.querySelectorAll('#intervention-form .fg-error').forEach(el => { el.textContent = ''; });
  },

  setFormError(fieldId, msg) {
    const field = $(fieldId);
    const group = field?.closest('.fg') || $(fieldId)?.parentElement?.closest('.fg');
    if (!group) return;
    group.classList.add('has-error');
    const err = group.querySelector('.fg-error');
    if (err) err.textContent = msg;
  },

  validateInterventionForm(data) {
    this.clearFormErrors();
    let ok = true;
    const startVal = $('f-start')?.value;
    const cliente = this._fuzzy.cliente?.getValue()?.trim();
    if (!data.email) {
      toast('Configura un account Exchange prima di creare interventi', 'warning');
      ok = false;
    }
    if (!startVal) {
      this.setFormError('f-start', 'Inserisci data e ora di inizio.');
      ok = false;
    }
    if (!cliente) {
      this.setFormError('fuzzy-cliente-wrap', 'Seleziona o scrivi il cliente.');
      ok = false;
    }
    if (!ok) {
      const first = document.querySelector('#intervention-form .fg.has-error input, #intervention-form .fg.has-error textarea');
      first?.focus();
    }
    return ok;
  },

  updateDurata(val) {
    const el = $('f-durata');
    const min = parseInt(el.min), max = parseInt(el.max);
    const pct = ((parseInt(val) - min) / (max - min) * 100).toFixed(1);
    el.style.setProperty('--fill', pct + '%');
    $('f-durata-val').textContent = durMinToStr(parseInt(val));
  },

  _getFormData() {
    const startVal = $('f-start').value;
    const dur = parseInt($('f-durata').value);
    const start = new Date(startVal);
    const end = new Date(start.getTime() + dur * 60000);
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    const data = {
      email: primary?.email || '',
      start: start.toISOString(),
      end: end.toISOString(),
      trasferta: $('f-trasferta').value || null,
      altro: $('f-altro').value || null,
      body_html: sanitizeNote(this.getNoteHtml()) || null,
    };
    for (const [k, field] of Object.entries(FUZZY_FIELD_MAP)) {
      data[field] = this._fuzzy[k]?.getValue() || null;
    }
    return data;
  },

  async submitForm() {
    const btn = $('form-submit-btn');
    const spinner = $('form-submit-spinner');
    const text = $('form-submit-text');
    btn.disabled = true; spinner.style.display = '';
    try {
      const data = this._getFormData();
      if (!this.validateInterventionForm(data)) return;
      if (this.editingItem) {
        await invoke('update_intervention', {
          input: { email: data.email, item_id: this.editingItem.exchange_item_id, change_key: this.editingItem.change_key, data }
        });
        toast('Intervento aggiornato', 'success');
      } else {
        await invoke('create_intervention', { data });
        toast('Intervento creato', 'success');
      }
      const sigla = this._fuzzy.sigla?.getValue();
      if (sigla) localStorage.setItem('gi_last_sigla', sigla);
      this.closeNewModal();
      await this.loadInterventions();
      if (this.currentView === 'calendar') Calendar.refresh();
    } catch(e) {
      toast('Errore: ' + e, 'error');
    } finally {
      btn.disabled = false; spinner.style.display = 'none';
    }
  },

  async submitAndSign() {
    const btn = $('form-submit-btn');
    const spinner = $('form-submit-spinner');
    btn.disabled = true; spinner.style.display = '';
    try {
      const data = this._getFormData();
      if (!this.validateInterventionForm(data)) return;
      let savedItem;
      if (this.editingItem) {
        savedItem = await invoke('update_intervention', {
          input: { email: data.email, item_id: this.editingItem.exchange_item_id, change_key: this.editingItem.change_key, data }
        });
        toast('Intervento aggiornato', 'success');
      } else {
        savedItem = await invoke('create_intervention', { data });
        toast('Intervento creato', 'success');
      }
      const sigla = this._fuzzy.sigla?.getValue();
      if (sigla) localStorage.setItem('gi_last_sigla', sigla);
      this.closeNewModal();
      await this.loadInterventions();
      if (this.currentView === 'calendar') Calendar.refresh();
      if (savedItem) this.openFirmaModal(savedItem);
    } catch(e) {
      toast('Errore: ' + e, 'error');
    } finally {
      btn.disabled = false; spinner.style.display = 'none';
    }
  },

  // ── Interventions list ────────────────────────────────────────────
  _interventionsSignature(items) {
    return JSON.stringify((items || []).map(i => [
      i.exchange_item_id,
      i.change_key,
      i.start_dt,
      i.end_dt,
      i.subject,
      i.nome_tecnico,
      i.ragione_sociale,
      i.descrizione,
      i.altro,
      i.tipo_tariffa,
      i.tipo_fatturazione,
      i.trasferta,
      i.durata,
      i.body_html,
      i.luogo,
      i.pending_op,
    ]));
  },

  async loadInterventions() {
    this.refreshQueueBadge(); // fire-and-forget: badge coda offline in statusbar
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (!primary) { this.renderList([]); return; }
    const now = new Date();
    const MS_90D = 90 * 24 * 60 * 60 * 1000;
    const start = new Date(now.getTime() - MS_90D).toISOString();
    const end   = new Date(now.getTime() + MS_90D).toISOString();
    try {
      const items = await invoke('list_interventions', { email: primary.email, start, end });
      const signature = this._interventionsSignature(items);
      if (signature === this._interventionsSnapshot) return false;
      this._interventionsSnapshot = signature;
      this.interventions = items;
      this.renderList(items);
      if (this.currentView === 'calendar') Calendar.refresh();
      return true;
    } catch(e) { console.error(e); }
  },

  renderList(items) {
    const container = $('list-container');
    const count = $('list-count');
    if (!items.length) {
      // Cache vuota ma sync in corso → skeleton, non "vuoto": i dati stanno arrivando.
      if (this._syncing && !this._lastSyncAt) {
        count.textContent = 'Sincronizzazione…';
        container.innerHTML = Array.from({ length: 6 }, () => '<div class="skel-card"></div>').join('');
        return;
      }
      count.textContent = 'Nessun intervento';
      container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-3);font-size:var(--fs-sm)">Nessun intervento nel periodo selezionato</div>';
      return;
    }
    count.textContent = `${items.length} interventi`;
    const colors = ['var(--cat-1)','var(--cat-2)','var(--cat-3)','var(--cat-4)','var(--cat-5)','var(--cat-6)','var(--cat-7)','var(--cat-8)'];
    const colorOf = (sigla) => {
      let h = 0; for (const c of (sigla||'')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
      return colors[h % colors.length];
    };
    const cleanText = (value) => htmlToText(value);
    const chip = (label, tone = '') => label ? `<span class="iv-chip ${tone}">${escHtml(label)}</span>` : '';
    const dateBits = (value) => {
      const d = value ? new Date(value) : null;
      if (!d || Number.isNaN(d.getTime())) return { date: '—', time: '—' };
      const pad = n => String(n).padStart(2, '0');
      return {
        date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
      };
    };
    const durationText = (item) => {
      const start = item.start_dt ? new Date(item.start_dt) : null;
      const end = item.end_dt ? new Date(item.end_dt) : null;
      if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        const mins = Math.max(0, Math.round((end - start) / 60000));
        const h = Math.floor(mins / 60), m = mins % 60;
        return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
      }
      return item.durata || '';
    };
    container.innerHTML = items.sort((a, b) => a.start_dt < b.start_dt ? 1 : -1).map(item => {
      const color = colorOf(item.nome_tecnico);
      const when = dateBits(item.start_dt);
      const duration = durationText(item);
      const noteText = cleanText(item.body_html);
      const detail = item.altro || noteText;
      const metaHtml = [
        chip(item.descrizione),
        chip(item.luogo, 'place'),
        chip(item.tipo_tariffa),
        chip(item.tipo_fatturazione),
        chip(item.trasferta, 'travel'),
        chip(noteText ? 'Con note' : 'Senza note', noteText ? 'note' : 'warn')
      ].filter(Boolean).join('');
      return `<div class="iv-card" tabindex="0" role="button" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.showDetail(${escHtml(JSON.stringify(item))})}" onclick="App.showDetail(${escHtml(JSON.stringify(item))})">
        <div class="iv-bar" style="background:${color}"></div>
        <div class="iv-body">
          <div class="iv-top">
            <div class="iv-sigla" style="background:color-mix(in oklch, ${color} 18%, transparent);color:${color}">${escHtml(item.nome_tecnico || '—')}</div>
            <div class="iv-cliente">${escHtml(item.ragione_sociale || '—')}${pendingBadge(item)}</div>
          </div>
          ${detail ? `<div class="iv-desc">${escHtml(detail)}</div>` : ''}
          <div class="iv-meta">${metaHtml}</div>
        </div>
        <div class="iv-side">
          <div class="iv-date">${when.date}</div>
          <div class="iv-time">${when.time}</div>
          ${duration ? `<div class="iv-duration">${escHtml(duration)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  },

  showDetail(itemJson, hasSig) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    const ws = $('workspace');
    this._currentItemId = { id: item.exchange_item_id, ck: item.change_key };
    const empty = $('detail-empty');
    const fill = $('detail-fill');
    if (empty) empty.style.display = 'none';
    if (!fill) return;
    fill.style.cssText = 'display:flex;flex:1;overflow:hidden;flex-direction:column';
    fill.innerHTML = renderInterventionDetail(item);
    fill.classList.remove('detail-enter');
    void fill.offsetWidth;
    const open = () => { ws?.classList.remove('collapse-right'); fill.classList.add('detail-enter'); };
    // Opening from a collapsed panel: let the freshly-set content paint (still
    // clipped at width 0) for one frame, then start the width-wipe → no blank flash.
    if (ws?.classList.contains('collapse-right')) requestAnimationFrame(open);
    else open();
  },

  clearDetail() {
    this._currentItemId = null;
    // Collapse the grid track → panel wipes closed (width transition). Content is
    // left in place (clipped at 0 width) and replaced on the next showDetail.
    $('workspace')?.classList.add('collapse-right');
  },

  // ── Command palette (Ctrl+K) ──────────────────────────────────────
  _cmdkSel: 0,
  _cmdkItems: [],
  _cmdkActions() {
    return [
      { lbl: 'Vai a oggi', kbd: 'T', run: () => { this.navigate('calendar'); Calendar.goToday(); } },
      { lbl: 'Nuovo intervento', kbd: 'N', run: () => this.openNewModal() },
      { lbl: 'Vista mese', kbd: '1', run: () => { this.navigate('calendar'); Calendar.setView('month'); } },
      { lbl: 'Vista settimana', kbd: '2', run: () => { this.navigate('calendar'); Calendar.setView('week'); } },
      { lbl: 'Vista giorno', kbd: '3', run: () => { this.navigate('calendar'); Calendar.setView('day'); } },
      { lbl: 'Ricerca avanzata', run: () => { this.navigate('search'); $('global-search-input')?.focus(); } },
      { lbl: 'Sincronizza ora', run: () => this.triggerSync() },
      { lbl: 'Cambia tema', run: () => this.toggleTheme() },
      { lbl: 'Impostazioni', run: () => this.openSettingsModal() },
      { lbl: 'Guida rapida', kbd: 'F1', run: () => this.openGuideModal() },
    ];
  },

  openCmdk() {
    const ov = $('cmdk');
    if (!ov) return;
    ov.classList.remove('hidden', 'closing');
    const inp = $('cmdk-input');
    inp.value = '';
    this._cmdkFilter('');
    inp.focus();
  },

  closeCmdk() { closeOverlay('cmdk'); },

  _cmdkFilter(q) {
    const query = q.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    const items = this._cmdkActions().filter(a =>
      words.every(w => a.lbl.toLowerCase().includes(w))
    );
    if (query) {
      items.push({
        lbl: `Cerca «${q.trim()}» negli interventi`, kbd: '↵',
        run: () => {
          this.navigate('search');
          const gi = $('global-search-input');
          if (gi) gi.value = q.trim();
          Search.query(q.trim());
        },
      });
    }
    this._cmdkItems = items;
    this._cmdkSel = 0;
    this._cmdkRender();
  },

  _cmdkRender() {
    const list = $('cmdk-list');
    if (!this._cmdkItems.length) {
      list.innerHTML = '<div class="cmdk-empty">Nessun comando</div>';
      return;
    }
    list.innerHTML = this._cmdkItems.map((a, i) =>
      `<div class="cmdk-item${i === this._cmdkSel ? ' sel' : ''}" role="option" aria-selected="${i === this._cmdkSel}"
         onclick="App._cmdkRun(${i})" onmousemove="App._cmdkHover(${i})">
         <span>${escHtml(a.lbl)}</span>${a.kbd ? `<span class="cmdk-kbd">${a.kbd}</span>` : ''}
       </div>`).join('');
    list.querySelector('.cmdk-item.sel')?.scrollIntoView({ block: 'nearest' });
  },

  _cmdkHover(i) {
    if (this._cmdkSel === i) return;
    this._cmdkSel = i;
    this._cmdkRender();
  },

  _cmdkKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._cmdkSel = Math.min(this._cmdkSel + 1, this._cmdkItems.length - 1);
      this._cmdkRender();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._cmdkSel = Math.max(this._cmdkSel - 1, 0);
      this._cmdkRender();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._cmdkRun(this._cmdkSel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.closeCmdk();
    }
  },

  _cmdkRun(i) {
    const a = this._cmdkItems[i];
    if (!a) return;
    this.closeCmdk();
    a.run();
  },

  // ── Coda offline: badge in statusbar + popover ────────────────────
  _queueOps: [],

  async refreshQueueBadge() {
    const badge = $('sb-queue');
    if (!badge) return;
    const primary = this.accounts?.find(a => a.is_primary) || this.accounts?.[0];
    if (!primary) { badge.classList.add('hidden'); return; }
    let ops = [];
    try { ops = await invoke('list_pending_ops', { email: primary.email }); } catch (e) {}
    this._queueOps = ops;
    if (!ops.length) {
      badge.classList.add('hidden');
      $('queue-pop')?.classList.add('hidden');
      return;
    }
    badge.classList.remove('hidden');
    badge.classList.toggle('warn', ops.some(o => o.status !== 'pending'));
    $('sb-queue-text').textContent = ops.length === 1 ? '1 in attesa' : `${ops.length} in attesa`;
  },

  toggleQueuePopover() {
    const pop = $('queue-pop');
    if (!pop) return;
    if (!pop.classList.contains('hidden')) { pop.classList.add('hidden'); return; }
    const labels = { create: 'Creazione', update: 'Modifica', delete: 'Eliminazione' };
    const stat = { pending: 'in attesa', error: 'errore', conflict: 'conflitto' };
    pop.innerHTML = `
      <div class="qp-head">Operazioni da sincronizzare</div>
      ${this._queueOps.map(o => `
        <div class="qp-row">
          <span class="qp-type">${labels[o.op_type] || escHtml(o.op_type)}</span>
          <span class="qp-status ${escHtml(o.status)}">${stat[o.status] || escHtml(o.status)}</span>
          <span class="qp-time tnum">${fmtDT(o.created_at)}</span>
        </div>`).join('')}
      <button class="btn qp-flush" onclick="App.flushQueueNow()">Sincronizza ora</button>`;
    pop.classList.remove('hidden');
    const close = (e) => {
      if (e.target.closest('#queue-pop, #sb-queue')) return;
      pop.classList.add('hidden');
      document.removeEventListener('mousedown', close, true);
    };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  },

  async flushQueueNow() {
    $('queue-pop')?.classList.add('hidden');
    const primary = this.accounts?.find(a => a.is_primary) || this.accounts?.[0];
    if (!primary) return;
    try {
      await invoke('flush_queue', { email: primary.email });
      await this.loadInterventions();
    } catch (e) { toast('Errore: ' + e, 'error'); }
    this.refreshQueueBadge();
  },

  // ── Export iCal (.ics) ────────────────────────────────────────────
  _icsDate(iso) {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  },

  _icsEsc(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  },

  exportIcs(items, filename = 'interventi.ics') {
    const arr = (Array.isArray(items) ? items : [items]).filter(i => i.start_dt && i.end_dt);
    if (!arr.length) { toast('Nessun intervento da esportare', 'warning'); return; }
    const stamp = this._icsDate(new Date().toISOString());
    const events = arr.map(it => [
      'BEGIN:VEVENT',
      `UID:${this._icsEsc(it.exchange_item_id || `${it.start_dt}-${Math.random().toString(36).slice(2)}`)}@gestoreinterventi`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${this._icsDate(it.start_dt)}`,
      `DTEND:${this._icsDate(it.end_dt)}`,
      `SUMMARY:${this._icsEsc(it.subject || [it.ragione_sociale, it.descrizione].filter(Boolean).join(' — '))}`,
      it.luogo ? `LOCATION:${this._icsEsc(it.luogo)}` : null,
      `DESCRIPTION:${this._icsEsc(htmlToText(it.body_html))}`,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n'));
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
      'PRODID:-//TSSI//Gestore Interventi//IT', 'CALSCALE:GREGORIAN',
      ...events, 'END:VCALENDAR'].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(arr.length === 1 ? 'Intervento esportato in iCal' : `${arr.length} interventi esportati in iCal`, 'success');
  },

  exportIcsItem(itemJson) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    const slug = (item.ragione_sociale || 'export').replace(/[^\w-]+/g, '_').slice(0, 30);
    this.exportIcs(item, `intervento-${slug}.ics`);
  },

  // ── Anteprima PDF nel modale email ────────────────────────────────
  _emailPdfUrl: null,

  _revokeEmailPdf() {
    if (this._emailPdfUrl) { URL.revokeObjectURL(this._emailPdfUrl); this._emailPdfUrl = null; }
  },

  async emailPreviewPdf() {
    const item = this._currentEmailItem;
    const box = $('email-pdf-preview');
    const btn = $('email-preview-btn');
    if (!box || !item) return;
    if (!box.classList.contains('hidden')) {
      box.classList.add('hidden'); box.innerHTML = '';
      this._revokeEmailPdf();
      return;
    }
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (btn) btn.disabled = true;
    try {
      const b64 = await invoke('export_pdf', {
        email: primary?.email, itemId: item.exchange_item_id, changeKey: item.change_key,
      });
      this._revokeEmailPdf();
      const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'application/pdf' });
      this._emailPdfUrl = URL.createObjectURL(blob);
      box.innerHTML = `<iframe class="email-pdf-frame" src="${this._emailPdfUrl}#toolbar=0&navpanes=0" title="Anteprima PDF"></iframe>`;
      box.classList.remove('hidden');
    } catch (e) {
      toast('Anteprima non disponibile: ' + e, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  editItem(itemJson) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    this.openNewModal();
    this.fillForm(item);
  },

  duplicateItem(itemJson) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    this.openNewModal();
    this.fillForm(item);
    this.editingItem = null;
    $('form-title').textContent = 'Duplica intervento';
    $('form-submit-text').textContent = 'Crea intervento';
    $('form-sign-btn').style.display = 'none';
  },

  async confirmDelete(itemJson) {
    closeOverlay('ctx-menu');
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    const ok = await confirmDialog({
      title: 'Elimina intervento',
      message: `Eliminare l'intervento di ${item.ragione_sociale || '—'}? L'operazione non è reversibile.`,
      confirmText: 'Elimina', danger: true,
    });
    if (!ok) return;
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    try {
      // Fade the block out before the data refresh removes it (coherent exit).
      if (this.currentView === 'calendar') await Calendar.animateOut(item.exchange_item_id);
      await invoke('delete_intervention', { email: primary.email, itemId: item.exchange_item_id, changeKey: item.change_key });
      toast('Intervento eliminato', 'success');
      this.clearDetail();
      await this.loadInterventions();
    } catch(e) { toast('Errore eliminazione: ' + e, 'error'); }
  },

  // ── Sync ──────────────────────────────────────────────────────────
  showSyncFeedback(message, type = 'success') {
    const el = $('sync-feedback');
    if (!el) return;
    clearTimeout(this._syncFeedbackTimer);
    el.textContent = message;
    el.classList.toggle('error', type === 'error');
    el.classList.add('show');
    this._syncFeedbackTimer = setTimeout(() => el.classList.remove('show'), 2200);
  },

  // Only resync on focus/wake when the data is older than this, to avoid a
  // burst of syncs from rapid focus changes.
  _SYNC_FOCUS_STALE_MS: 60000,

  // Resync when the window regains focus / the PC wakes / the network returns.
  // `force` (network back online) always syncs; otherwise only when stale.
  maybeSyncOnFocus(force = false) {
    if (!this.accounts?.length) return;
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (primary) invoke('flush_queue', { email: primary.email }).catch(() => {});
    if (this._syncing) return;
    if (!force && this._lastSyncAt && Date.now() - this._lastSyncAt < this._SYNC_FOCUS_STALE_MS) return;
    this.triggerSync();
  },

  // Ambient freshness label: "Sincronizzato N fa", kept live by a ticker.
  _renderFreshness() {
    const el = $('sb-sync-text');
    if (!el || this._syncing || !this._lastSyncAt) return;
    const sec = Math.max(0, Math.round((Date.now() - this._lastSyncAt) / 1000));
    let rel;
    if (sec < 5) rel = 'adesso';
    else if (sec < 60) rel = `${sec}s fa`;
    else if (sec < 3600) rel = `${Math.floor(sec / 60)} min fa`;
    else rel = `${Math.floor(sec / 3600)} h fa`;
    const cnt = this._lastSyncCount;
    el.textContent = `Sincronizzato ${rel}` + (cnt != null ? ` · ${cnt} aggiornati` : '');
  },

  async triggerSync() {
    if (this._syncing) return;
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (!primary) { toast('Nessun account', 'warning'); return; }
    this._syncing = true;
    // Cache vuota → mostra subito gli skeleton al posto di "Nessun intervento".
    if (!this.interventions?.length) this.renderList([]);
    const btn = $('sync-btn');
    btn?.classList.add('syncing');
    $('sb-sync-text').textContent = 'Sincronizzazione…';
    try {
      await invoke('trigger_sync', { email: primary.email });
      this._lastSyncAt = Date.now();
      // Success microinteraction: spinner → green check pop → back to normal.
      btn?.classList.remove('syncing');
      btn?.classList.add('ok');
      clearTimeout(this._syncOkTimer);
      this._syncOkTimer = setTimeout(() => btn?.classList.remove('ok'), 1200);
    } catch(e) {
      this.showSyncFeedback('Errore sync', 'error');
      $('sb-sync-text').textContent = 'Errore sync';
      toast('Sync error: ' + e, 'error');
    } finally {
      this._syncing = false;
      btn?.classList.remove('syncing');
      this._renderFreshness();
    }
  },

  // ── Conflicts ─────────────────────────────────────────────────────
  async checkConflicts() {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (!primary) return;
    let conflicts = [];
    try { conflicts = await invoke('list_conflicts', { email: primary.email }); } catch(e) { return; }
    if (!conflicts.length) { $('modal-conflict')?.classList.add('hidden'); return; }
    this._renderConflicts(conflicts);
    $('modal-conflict')?.classList.remove('hidden', 'closing');
  },

  _renderConflicts(conflicts) {
    const FIELDS = [
      ['subject', 'Oggetto'], ['start_dt', 'Inizio'], ['end_dt', 'Fine'],
      ['luogo', 'Luogo'], ['ragione_sociale', 'Cliente'], ['descrizione', 'Descrizione'],
      ['durata', 'Durata'], ['body_html', 'Note'],
    ];
    const blocks = conflicts.map(c => {
      const mine = c.mine || {}, srv = c.server || {};
      const rows = FIELDS.filter(([k]) => (mine[k] || '') !== (srv[k] || '')).map(([k, label]) =>
        `<tr><td class="cf-k">${label}</td>
             <td class="cf-mine">${escHtml(mine[k] || '—')}</td>
             <td class="cf-srv">${escHtml(srv[k] || '—')}</td></tr>`
      ).join('');
      const diff = rows
        ? `<table class="cf-diff"><thead><tr><th></th><th>Le mie modifiche</th><th>Versione server</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="cf-nodiff">Differenze non mostrabili (item eliminato sul server).</p>`;
      return `<div class="cf-item">
        <div class="cf-title">${escHtml((c.mine?.subject) || c.op_type)}</div>
        ${diff}
        <div class="cf-actions">
          <button class="btn" onclick="App.resolveConflict(${c.op_id}, 'mine')">Tieni le mie modifiche</button>
          <button class="btn ghost" onclick="App.resolveConflict(${c.op_id}, 'server')">Tieni versione server</button>
        </div>
      </div>`;
    }).join('');
    $('conflict-body').innerHTML = blocks;
  },

  async resolveConflict(opId, choice) {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    try {
      await invoke('resolve_conflict', { opId, choice, email: primary.email });
      toast('Conflitto risolto', 'success');
    } catch(e) {
      toast('Errore risoluzione: ' + e, 'error');
    }
    this.loadInterventions();
    this.checkConflicts();
  },

  onSearchInput(val) {
    if (val.trim().length > 0) this.navigate('search');
    Search.query(val);
  },

  // ── Recent searches (internal history; webview autocomplete disabled) ──
  _searchHistory: null,
  _loadSearchHistory() {
    if (!this._searchHistory) {
      try { this._searchHistory = JSON.parse(localStorage.getItem('gi_search_history') || '[]'); }
      catch { this._searchHistory = []; }
    }
    return this._searchHistory;
  },
  saveSearch(q) {
    q = (q || '').trim();
    if (q.length < 2) return;
    const h = this._loadSearchHistory();
    const i = h.findIndex(x => x.toLowerCase() === q.toLowerCase());
    if (i !== -1) h.splice(i, 1);
    h.unshift(q);
    this._searchHistory = h.slice(0, 8);
    localStorage.setItem('gi_search_history', JSON.stringify(this._searchHistory));
  },
  clearSearchHistory() {
    this._searchHistory = [];
    localStorage.setItem('gi_search_history', '[]');
    this.renderSearchHistory();
    $('global-search-input')?.focus();
  },
  renderSearchHistory() {
    const box = $('search-history');
    if (!box) return;
    const h = this._loadSearchHistory();
    if (!h.length) { box.innerHTML = '<div class="sh-empty">Nessuna ricerca recente</div>'; return; }
    const clock = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>';
    box.innerHTML =
      '<div class="sh-head"><span>Ricerche recenti</span>' +
      '<button class="sh-clear" onmousedown="event.preventDefault()" onclick="App.clearSearchHistory()">Pulisci</button></div>' +
      h.map(q => `<button class="sh-item" onmousedown="event.preventDefault()" onclick="App.useSearchHistory(${escHtml(JSON.stringify(q))})">${clock}<span>${escHtml(q)}</span></button>`).join('');
  },
  useSearchHistory(q) {
    const input = $('global-search-input');
    if (input) input.value = q;
    this.hideSearchHistory();
    this.saveSearch(q);
    this.onSearchInput(q);
  },
  showSearchHistory() {
    this.renderSearchHistory();
    const box = $('search-history');
    if (box && this._loadSearchHistory().length) box.classList.remove('hidden');
  },
  hideSearchHistory() {
    setTimeout(() => $('search-history')?.classList.add('hidden'), 120);
  },

  // ── Modals ────────────────────────────────────────────────────────
  closeModal(name) {
    closeOverlay(`modal-${name}`);
  },

  // ── Firma modal ───────────────────────────────────────────────────
  openFirmaModal(itemJson) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    this._currentFirmaItem = item;
    this._firmaPenWidth = 2;
    this._firmaHasDraw = false;

    // Populate info bar
    const clientEl = $('sig-info-client');
    const metaEl = $('sig-info-meta');
    if (clientEl) clientEl.textContent = item.ragione_sociale || '—';
    if (metaEl) {
      const dt = item.start_dt ? fmtDT(item.start_dt) : '—';
      const parts = [dt, item.nome_tecnico, item.descrizione_intervento].filter(Boolean);
      metaEl.textContent = parts.join(' · ');
    }
    const legal = $('sig-legal');
    if (legal) legal.textContent = `Il cliente conferma il lavoro svolto con ${item.ragione_sociale || 'il cliente'}. Dopo la conferma, firma e timestamp vengono collegati al rapporto.`;

    // Reset checklist
    const chk = $('sig-check-firma');
    if (chk) { chk.textContent = 'in attesa'; chk.style.color = 'var(--amber)'; }

    // Reset pen size buttons
    document.querySelectorAll('.sig-pen-size').forEach((b, i) => b.classList.toggle('on', i === 0));

    $('modal-firma').classList.remove('hidden', 'closing');

    // Init canvas after modal is visible
    requestAnimationFrame(() => {
      const wrap = $('sig-canvas-wrap');
      const canvas = $('firma-canvas');
      if (!wrap || !canvas) return;
      canvas.width = wrap.offsetWidth;
      canvas.height = wrap.offsetHeight;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = this._firmaPenWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this._firmaCtx = ctx;
      this._firmaDrawing = false;

      const ph = $('sig-canvas-placeholder');
      if (ph) ph.style.display = '';

      const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return [(src.clientX - r.left) * (canvas.width / r.width), (src.clientY - r.top) * (canvas.height / r.height)];
      };
      canvas.onmousedown = canvas.ontouchstart = (e) => {
        e.preventDefault();
        this._firmaDrawing = true;
        [this._firmaLastX, this._firmaLastY] = getPos(e);
      };
      canvas.onmousemove = canvas.ontouchmove = (e) => {
        if (!this._firmaDrawing) return;
        e.preventDefault();
        const [x, y] = getPos(e);
        ctx.beginPath(); ctx.moveTo(this._firmaLastX, this._firmaLastY);
        ctx.lineTo(x, y); ctx.stroke();
        [this._firmaLastX, this._firmaLastY] = [x, y];
        if (!this._firmaHasDraw) {
          this._firmaHasDraw = true;
          if (ph) ph.style.display = 'none';
          const ck = $('sig-check-firma');
          if (ck) { ck.textContent = 'OK'; ck.style.color = 'var(--green)'; }
        }
      };
      canvas.onmouseup = canvas.ontouchend = canvas.onmouseleave = () => { this._firmaDrawing = false; };
    });
  },

  firmaClear() {
    const canvas = $('firma-canvas');
    if (this._firmaCtx) this._firmaCtx.clearRect(0, 0, canvas.width, canvas.height);
    this._firmaHasDraw = false;
    const ph = $('sig-canvas-placeholder');
    if (ph) ph.style.display = '';
    const chk = $('sig-check-firma');
    if (chk) { chk.textContent = 'in attesa'; chk.style.color = 'var(--amber)'; }
  },

  firmaPenSize(btn, size) {
    this._firmaPenWidth = size;
    if (this._firmaCtx) this._firmaCtx.lineWidth = size;
    document.querySelectorAll('.sig-pen-size').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  },

  async firmaConfirm() {
    if (!this._firmaHasDraw) { toast('Aggiungi la firma prima di confermare', 'warning'); return; }
    const canvas = $('firma-canvas');
    const base64 = canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
    try {
      await invoke('save_signature', { exchangeItemId: this._currentFirmaItem.exchange_item_id, pngBase64: base64 });
      toast('Firma salvata', 'success');
      this.closeModal('firma');
      this.showDetail(this._currentFirmaItem, true);
    } catch(e) { toast('Errore firma: ' + e, 'error'); }
  },

  // ── Email modal ───────────────────────────────────────────────────
  async openEmailModal(itemJson) {
    this._currentEmailItem = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    const item = this._currentEmailItem;
    if (item.exchange_item_id?.startsWith('tmp-')) {
      toast('Intervento non ancora sincronizzato', 'warning');
      return;
    }
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    let toVal = '', ccVal = primary?.email || '';
    try {
      const mem = await invoke('get_client_email', { ragioneSociale: item.ragione_sociale });
      if (mem) { toVal = mem.to || ''; ccVal = mem.cc || ccVal; }
    } catch(e) {}
    $('modal-email-body').innerHTML = `
      <div class="fg"><label class="fg-lbl">A</label><input class="fg-in" id="email-to" value="${toVal}" placeholder="destinatario@azienda.it"></div>
      <div class="fg"><label class="fg-lbl">CC</label><input class="fg-in" id="email-cc" value="${ccVal}"></div>
      <div class="fg"><label class="fg-lbl">Oggetto</label><input class="fg-in" id="email-subject" value="Report intervento: ${item.ragione_sociale || ''}"></div>
      <div class="fg"><label class="fg-lbl">Messaggio</label><textarea class="fg-ta" id="email-body" rows="4">Gentili,\n\nIn allegato il report dell'intervento del ${fmtDT(item.start_dt)}.\n\nCordiali saluti</textarea></div>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn" type="button" id="email-preview-btn" onclick="App.emailPreviewPdf()">${GIIcon('file')} Anteprima PDF</button>
        <span style="font-size:var(--fs-xs);color:var(--text-3)">Il PDF verrà allegato automaticamente.</span>
      </div>
      <div id="email-pdf-preview" class="email-pdf-preview hidden"></div>`;
    this._revokeEmailPdf();
    $('modal-email').classList.remove('hidden', 'closing');
  },

  async emailSend() {
    const to = $('email-to')?.value.trim();
    const cc = $('email-cc')?.value.trim();
    const subject = $('email-subject')?.value;
    const body = $('email-body')?.value;
    if (!to) { toast('Destinatario obbligatorio', 'error'); return; }
    $('email-send-spinner').style.display = '';
    $('email-send-text').textContent = 'Invio…';
    try {
      const item = this._currentEmailItem;
      const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
      // Get PDF bytes
      let attachment = null;
      try {
        attachment = await invoke('export_pdf', { email: primary?.email, itemId: item.exchange_item_id, changeKey: item.change_key });
      } catch(e) {}
      await invoke('send_email', { to, cc: cc || null, subject, body, attachmentBase64: attachment });
      // Save email memory
      try { await invoke('set_client_email', { ragioneSociale: item.ragione_sociale, data: { to, cc } }); } catch(e) {}
      toast('Email inviata', 'success');
      this.closeModal('email');
    } catch(e) {
      toast('Errore invio: ' + e, 'error');
    } finally {
      $('email-send-spinner').style.display = 'none';
      $('email-send-text').textContent = 'Invia';
    }
  },

  // ── PDF modal ─────────────────────────────────────────────────────
  openPdfModal(itemJson) {
    this._currentPdfItem = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    $('modal-pdf-body').innerHTML = `
      <p style="color:var(--text-2);font-size:var(--fs-sm);margin-bottom:14px">Esporta il report PDF per: <strong>${this._currentPdfItem.ragione_sociale}</strong></p>
      <div class="fg">
        <label class="fg-lbl">Formato</label>
        <select class="fg-sel" id="pdf-format">
          <option value="detail">Dettaglio completo</option>
          <option value="summary">Riepilogo</option>
        </select>
      </div>`;
    $('modal-pdf').classList.remove('hidden', 'closing');
  },

  // ── Trasferta context menu ────────────────────────────────────────
  openContextMenu(e, itemJson) {
    e.preventDefault();
    this._ctxItem = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    const menu = $('ctx-menu');
    menu.classList.remove('hidden', 'closing');
    const mw = 220, mh = 230;
    menu.style.left = Math.min(e.clientX + 2, window.innerWidth  - mw - 8) + 'px';
    menu.style.top  = Math.min(e.clientY + 2, window.innerHeight - mh - 8) + 'px';
    const close = () => {
      closeOverlay(menu);
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
    setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('contextmenu', close);
    }, 0);
  },

  // Copy an appointment's content (everything except signature/ids/times) into a
  // JS clipboard for later "Incolla qui" on an empty calendar slot.
  copyItem(itemJson) {
    closeOverlay('ctx-menu');
    const it = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    let durataMin = 60;
    if (it.start_dt && it.end_dt) {
      const d = (new Date(it.end_dt) - new Date(it.start_dt)) / 60000;
      if (d > 0) durataMin = Math.round(d);
    }
    this._clipboard = {
      nome_tecnico: it.nome_tecnico || null,
      ragione_sociale: it.ragione_sociale || null,
      descrizione: it.descrizione || null,
      altro: it.altro || null,
      luogo: it.luogo || null,
      tipo_tariffa: it.tipo_tariffa || null,
      tipo_fatturazione: it.tipo_fatturazione || null,
      trasferta: it.trasferta || null,
      durata: it.durata || null,
      body_html: it.body_html || null,
      durataMin,
    };
    toast('Intervento copiato', 'success');
  },

  // Show the single-item "Incolla qui" menu at the clicked empty slot.
  openSlotMenu(e, isoDate, sh, sm) {
    if (!this._clipboard) return;
    this._pasteSlot = { isoDate, sh, sm };
    const menu = $('ctx-slot-menu');
    if (!menu) return;
    menu.classList.remove('hidden', 'closing');
    const mw = 200, mh = 56;
    menu.style.left = Math.min(e.clientX + 2, window.innerWidth  - mw - 8) + 'px';
    menu.style.top  = Math.min(e.clientY + 2, window.innerHeight - mh - 8) + 'px';
    const close = () => {
      closeOverlay(menu);
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
    setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('contextmenu', close);
    }, 0);
  },

  // Create a copy of the clipboard at the chosen slot. Duration is preserved; if
  // it crosses midnight the event is saved as-is (Exchange accepts it).
  async pasteAt() {
    closeOverlay('ctx-slot-menu');
    const c = this._clipboard, slot = this._pasteSlot;
    if (!c || !slot) return;
    const primary = this.accounts?.find(a => a.is_primary) || this.accounts?.[0];
    if (!primary?.email) { toast('Nessun account Exchange', 'error'); return; }
    const pad = n => String(n).padStart(2, '0');
    const start = new Date(`${slot.isoDate}T${pad(slot.sh)}:${pad(slot.sm)}:00`);
    const end = new Date(start.getTime() + c.durataMin * 60000);
    const crossDay = start.toDateString() !== end.toDateString();
    const data = {
      email: primary.email,
      start: start.toISOString(),
      end: end.toISOString(),
      nome_tecnico: c.nome_tecnico,
      ragione_sociale: c.ragione_sociale,
      descrizione: c.descrizione,
      altro: c.altro,
      luogo: c.luogo,
      tipo_tariffa: c.tipo_tariffa,
      tipo_fatturazione: c.tipo_fatturazione,
      trasferta: c.trasferta,
      durata: c.durata,
      body_html: c.body_html,
    };
    try {
      const created = await invoke('create_intervention', { data });
      if (crossDay) toast('Incollato a cavallo di due giorni: prosegue il giorno dopo', 'warning');
      else toast('Intervento incollato', 'success');
      await this.loadInterventions(); // refreshes the calendar silently
      if (this.currentView === 'calendar') Calendar.popItem(created?.exchange_item_id);
    } catch(e) {
      toast('Errore: ' + e, 'error');
    }
  },

  _trasfertaFromCtx(mode) {
    closeOverlay('ctx-menu');
    this._trasfertaMode = mode;
    const item = this._ctxItem;
    if (!item) return;
    $('trasferta-title').textContent =
      mode === 'before' ? 'Trasferta prima' : 'Trasferta dopo';
    const ref = $('trasferta-ref');
    if (ref) {
      const dt = item.start_dt ? fmtDT(item.start_dt) : '—';
      const endDt = item.end_dt ? fmtDT(item.end_dt) : '';
      const when = mode === 'before'
        ? `Fine: <strong>${dt}</strong>`
        : `Inizio: <strong>${endDt || dt}</strong>`;
      ref.innerHTML = `<strong>${item.ragione_sociale || '—'}</strong> · ${when}`;
    }
    const dl = $('trasferta-luogo-list');
    if (dl) {
      const luoghi = this._dropdownData?.luoghi || [];
      dl.innerHTML = luoghi.map(l => `<option value="${escHtml(l)}">`).join('');
    }
    $('trasferta-luogo').value = '';
    $('trasferta-durata').value = 30;
    this._updateTrasfertaDurata(30);
    // Ripristina l'ultima scelta della spunta "Conserva dettaglio breve".
    const keep = $('trasferta-keep-altro');
    if (keep) keep.checked = localStorage.getItem('gi_trasferta_keep_altro') === 'true';
    $('modal-trasferta').classList.remove('hidden', 'closing');
    setTimeout(() => $('trasferta-luogo').focus(), 80);
  },

  openTrasfertaForDetail(itemJson) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    this._ctxItem = item;
    this._trasfertaFromCtx('after');
  },

  _updateTrasfertaDurata(val) {
    const el = $('trasferta-durata');
    const min = parseInt(el.min), max = parseInt(el.max);
    const pct = ((parseInt(val) - min) / (max - min) * 100).toFixed(1);
    el.style.setProperty('--fill', pct + '%');
    $('trasferta-durata-val').textContent = durMinToStr(parseInt(val));
  },

  async _confirmTrasferta() {
    const item = this._ctxItem;
    const mode = this._trasfertaMode;
    if (!item || !mode) return;
    const luogo = $('trasferta-luogo').value.trim();
    const dur = parseInt($('trasferta-durata').value);
    const refStart = new Date(item.start_dt);
    const refEnd = item.end_dt ? new Date(item.end_dt) : new Date(refStart.getTime() + 3600000);
    let start, end;
    if (mode === 'before') {
      end = new Date(refStart); start = new Date(refStart.getTime() - dur * 60000);
    } else {
      start = new Date(refEnd); end = new Date(refEnd.getTime() + dur * 60000);
    }
    const lastSigla = localStorage.getItem('gi_last_sigla');
    const accountSigla = (this.accounts?.find(a => a.is_primary) || this.accounts?.[0])?.sigla || '';
    const sigla = lastSigla || accountSigla || item.nome_tecnico || null;
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    const data = {
      email: primary?.email || '',
      start: start.toISOString(),
      end: end.toISOString(),
      nome_tecnico: sigla,
      ragione_sociale: item.ragione_sociale || null,
      descrizione: 'Trasferta',
      luogo: luogo || null,
      tipo_tariffa: null,
      tipo_fatturazione: null,
      trasferta: null,
      altro: ($('trasferta-keep-altro')?.checked && item.altro) ? item.altro : null,
      body_html: null,
    };
    const btn = $('trasferta-confirm-btn');
    if (btn) btn.disabled = true;
    try {
      await invoke('create_intervention', { data });
      toast('Trasferta creata', 'success');
      closeOverlay('modal-trasferta');
      await this.loadInterventions();
      if (this.currentView === 'calendar') Calendar.refresh();
    } catch(e) {
      toast('Errore: ' + e, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async pdfExport() {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    const item = this._currentPdfItem;
    if (item.exchange_item_id?.startsWith('tmp-')) {
      toast('Intervento non ancora sincronizzato', 'warning');
      return;
    }
    try {
      const bytes = await invoke('export_pdf', { email: primary?.email, itemId: item.exchange_item_id, changeKey: item.change_key });
      // Trigger download
      const blob = new Blob([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `intervento_${item.ragione_sociale}_${item.start_dt?.slice(0,10)}.pdf`;
      a.click(); URL.revokeObjectURL(url);
      this.closeModal('pdf');
    } catch(e) { toast('Errore PDF: ' + e, 'error'); }
  },
};

// ── Boot ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
document.addEventListener('contextmenu', e => e.preventDefault());
