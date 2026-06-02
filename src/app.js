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
    const icon = document.getElementById('win-max-icon');
    const btn = document.getElementById('win-max');
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

// ── HTML escape ─────────────────────────────────────────────────────
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function GIIcon(name, size = 12) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths = {
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h1a5 5 0 0 0 5-5V8"/><path d="M6 16v-1a5 5 0 0 1 5-5h1"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    sign: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  };
  return `<svg ${attrs}>${paths[name] || ''}</svg>`;
}

// ── Toast ────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const c = document.getElementById('toast-container');
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
  return { setValue, getValue, destroy: () => container.innerHTML = '' };
}

// ── Subject preview builder (mirrors Rust build_subject) ─────────────
function buildSubject(nomeTecnico, ragioneSociale, descrizione, altro, tipoTariffa, tipoFatturazione) {
  const parts = [nomeTecnico, ragioneSociale, descrizione, altro].map(s => (s || '').trim());
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  const tariff = `${(tipoTariffa||'').trim()} ${(tipoFatturazione||'').trim()}`.trim();
  if (tariff) parts.push(tariff);
  return parts.filter(Boolean).join(' - ');
}

// ── Format helpers ───────────────────────────────────────────────────
function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit' }) +
    ' ' + d.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
}

function durMinToStr(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

// Graceful overlay/popup dismiss: play exit animation, then hide.
function closeOverlay(el) {
  if (typeof el === 'string') el = document.getElementById(el);
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
  thumb.style.width = active.offsetWidth + 'px';
  thumb.style.transform = `translateX(${active.offsetLeft - (container.clientLeft || 0)}px)`;
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
    document.getElementById('wiz-next').onclick = () => this.next();
    document.getElementById('wiz-back').onclick = () => this.back();
    document.getElementById('wiz-skip').onclick = () => this.skip();
  },

  renderSteps() {
    const el = document.getElementById('wiz-steps');
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
    const el = document.getElementById('wiz-body');
    const back = document.getElementById('wiz-back');
    const next = document.getElementById('wiz-next');
    back.style.display = this.step > 0 ? '' : 'none';

    if (this.step === 0) {
      next.textContent = 'Inizia →';
      el.innerHTML = `
        <div class="step-title">Benvenuto in Gestore Interventi</div>
        <div class="step-desc">L'app che sincronizza i tuoi interventi tecnici con Exchange Server. Nessun server intermedio — tutto gira localmente sul tuo PC.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:8px">
          <div style="background:var(--bg-elev);box-shadow:var(--sh-1);border-radius:10px;padding:14px">
            <div style="font-size:20px;margin-bottom:6px">📅</div>
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">Calendario</div>
            <div style="font-size:11px;color:var(--text-3)">Vista settimana, giorno e mese</div>
          </div>
          <div style="background:var(--bg-elev);box-shadow:var(--sh-1);border-radius:10px;padding:14px">
            <div style="font-size:20px;margin-bottom:6px">📝</div>
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">Firma digitale</div>
            <div style="font-size:11px;color:var(--text-3)">Firma su schermo o tablet</div>
          </div>
          <div style="background:var(--bg-elev);box-shadow:var(--sh-1);border-radius:10px;padding:14px">
            <div style="font-size:20px;margin-bottom:6px">📄</div>
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">PDF ed Email</div>
            <div style="font-size:11px;color:var(--text-3)">Export e invio automatico</div>
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
        <div style="background:var(--bg-elev);box-shadow:var(--sh-1);border-radius:10px;padding:14px;margin-bottom:16px;font-size:12px">
          <div style="color:var(--text-2);margin-bottom:2px">Account</div>
          <div style="font-weight:700">${this.data.email}</div>
          <div style="color:var(--text-3);font-size:11px;margin-top:4px">${this.data.server || 'Autodiscovery'}</div>
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
    this.data.email = document.getElementById('wiz-email')?.value.trim() || '';
    this.data.password = document.getElementById('wiz-password')?.value || '';
    this.data.server = document.getElementById('wiz-server')?.value.trim() || '';
    this.data.domain = document.getElementById('wiz-domain')?.value.trim() || '';
    this.data.displayName = document.getElementById('wiz-displayname')?.value.trim() || '';
  },

  async runTest() {
    const btn = document.getElementById('wiz-test-btn');
    const res = document.getElementById('wiz-test-result');
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
        document.getElementById('wiz-next').disabled = false;
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
    const btn = document.getElementById('wiz-next');
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
    document.getElementById('onboarding').style.display = 'none';
  },
};

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

  return `
    <div class="detail-head">
      <div class="dh-eye">Intervento · ${dateStr}</div>
      <div class="dh-client">${escHtml(item.ragione_sociale || '—')}</div>
      ${item.descrizione ? `<div class="dh-type">${escHtml(item.descrizione)}</div>` : ''}
      ${item.altro ? `<div class="dh-altro">${escHtml(item.altro)}</div>` : ''}
    </div>
    <div class="detail-body fade-up">
      <div class="detail-facts">
        ${dur ? `<div class="fact"><span class="fact-lbl">Orario</span><span class="fact-val tnum">${hm(start)} → ${hm(end)} · ${minHM(dur)}</span></div>` : ''}
        ${item.luogo ? `<div class="fact"><span class="fact-lbl">Luogo</span><span class="fact-val">${escHtml(item.luogo)}</span></div>` : ''}
        ${item.nome_tecnico ? `<div class="fact"><span class="fact-lbl">Tecnico</span><span class="fact-val"><span class="tech-pill"><span class="pill-av" style="background:color-mix(in oklch, ${color} 20%, transparent);color:${color}">${escHtml(item.nome_tecnico)}</span>${escHtml(item.nome_tecnico)}</span></span></div>` : ''}
      </div>
      ${metaHtml ? `<div class="detail-meta">${metaHtml}</div>` : ''}
      <div class="detail-note">
        <div class="df-lbl">Note</div>
        ${item.body_html ? `<div class="note-box">${item.body_html}</div>` : `<div class="detail-note-empty">Nessuna nota</div>`}
      </div>
    </div>
    <div class="detail-ftr">
      <div class="detail-actions">
        <div class="act-row">
          <button class="abtn prime" onclick="App.editItem(${iS})">${GIIcon('edit')}Modifica</button>
          <button class="abtn" onclick="App.duplicateItem(${iS})">${GIIcon('copy')}Duplica</button>
        </div>
        <div class="act-row secondary">
          ${opts.trasferta ? `<button class="abtn" onclick="App.openTrasfertaForDetail(${iS})">${GIIcon('route')}Trasferta</button>` : ''}
          <button class="abtn" onclick="App.openPdfModal(${iS})">${GIIcon('file')}PDF</button>
          <button class="abtn" onclick="App.openEmailModal(${iS})">${GIIcon('mail')}Email</button>
        </div>
        <div class="act-row danger-row">
          <button class="abtn danger" onclick="App.confirmDelete(${iS})">${GIIcon('trash')}Elimina</button>
          ${opts.close ? `<button class="abtn" onclick="Calendar._deselect()">${GIIcon('close')}Chiudi</button>` : ''}
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════ MAIN APP
const App = {
  currentView: 'interventions',
  accounts: [],
  interventions: [],
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

  async init() {
    // Apply saved theme
    const theme = localStorage.getItem('gi-theme');
    const lightTheme = theme !== 'dark';
    document.body.classList.toggle('theme-light', lightTheme);

    // Keyboard shortcut Ctrl+K
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      const target = e.target;
      const isEditable = target?.matches?.('input, textarea, select, [contenteditable="true"]');
      const newModalOpen = !document.getElementById('modal-new')?.classList.contains('hidden');
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.navigate('search');
        document.getElementById('global-search-input')?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && newModalOpen) {
        e.preventDefault();
        this.submitForm();
      }
      if (e.key === 'Escape') {
        if (!document.getElementById('modal-new')?.classList.contains('hidden')) this.closeNewModal();
        else document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeOverlay(m));
        this.dismissCalendarCreate();
        closeOverlay('ctx-menu');
      }
      if (!isEditable && this.currentView === 'calendar' && !newModalOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          Calendar.nav(e.key === 'ArrowRight' ? 1 : -1);
        }
      }
    });

    // Listen for sync-complete event
    listenEvent('sync-complete', e => {
      const { account, count, last_sync } = e.payload || {};
      document.getElementById('sb-sync-text').textContent =
        `Sync: ${new Date(last_sync).toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'})} · ${count} aggiornati`;
      document.getElementById('sb-dot').className = 'sb-dot g';
      this.showSyncFeedback(`${count || 0} aggiornati`);
      this.loadInterventions();
    });

    // Check if accounts exist
    let accounts = [];
    try { accounts = await invoke('list_accounts_cmd'); } catch(e) {}
    this.accounts = accounts;

    if (accounts.length === 0) {
      Wizard.init();
    } else {
      document.getElementById('onboarding').style.display = 'none';
      this.enterApp();
    }
  },

  enterApp() {
    document.getElementById('main-app').style.display = 'grid';
    this.renderSidebarAccounts();
    this.loadDropdowns().then(() => this.initForm());
    this.navigate('calendar');
    this.clearDetail();
    this.loadInterventions();
    // Set current account in statusbar
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (primary) document.getElementById('sb-account').textContent = primary.email;
  },

  renderSidebarAccounts() {
    const el = document.getElementById('sidebar-accounts');
    if (!this.accounts.length) { el.textContent = 'Nessun account'; return; }
    el.innerHTML = this.accounts.map(a =>
      `<div style="padding:5px 0;display:flex;align-items:center;gap:8px">
        <div class="sb-dot g"></div>
        <div><div style="font-weight:600;font-size:12px">${a.sigla || '—'}</div>
        <div style="font-size:10px;color:var(--text-3)">${a.email}</div></div>
       </div>`
    ).join('');
  },

  navigate(view) {
    this.dismissCalendarCreate();
    if (view === 'new') { this.openNewModal(); return; }
    if (view === 'settings') { this.openSettingsModal(); return; }
    this.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add('active');
    // Highlight the matching sidebar nav segment (calendar / interventions)
    document.querySelectorAll('.nav-seg-btn').forEach(b => b.classList.toggle('on', b.dataset.nav === view));
    syncSeg(document.querySelector('.nav-seg'));
    document.getElementById('toolbar-new').style.display = '';
    if (view !== 'calendar') this.clearDetail();
    if (view === 'calendar') Calendar.onNavigate();
    else if (view === 'search') Search.onNavigate();
    else this.renderSidebarAccounts();
  },

  dismissCalendarCreate() {
    if (window.Calendar?._dismissCreate) Calendar._dismissCreate();
    else document.getElementById('cal-create-modal')?.classList.add('hidden');
  },

  openSettingsModal() {
    document.getElementById('modal-settings')?.classList.remove('hidden', 'closing');
    Settings.onNavigate();
  },

  openNewModal(prefill) {
    document.getElementById('modal-new')?.classList.remove('hidden', 'closing');
    this.resetForm();
    if (prefill) {
      const pad = n => String(n).padStart(2, '0');
      document.getElementById('f-start').value = `${prefill.date}T${pad(prefill.startH)}:${pad(prefill.startM)}`;
      const durMin = (prefill.endH * 60 + prefill.endM) - (prefill.startH * 60 + prefill.startM);
      if (durMin > 0) {
        const clamped = Math.min(480, Math.max(15, Math.round(durMin / 15) * 15));
        document.getElementById('f-durata').value = clamped;
        this.updateDurata(clamped);
      }
      this.updateSubjectPreview();
    }
    setTimeout(() => document.getElementById('f-start')?.focus(), 60);
  },

  closeNewModal() {
    closeOverlay('modal-new');
    this.editingItem = null;
  },

  toggleTheme() {
    document.body.classList.toggle('theme-light');
    const light = document.body.classList.contains('theme-light');
    localStorage.setItem('gi-theme', light ? 'light' : 'dark');
  },

  // ── Dropdown data ─────────────────────────────────────────────────
  async loadDropdowns() {
    try { this._dropdownData = await invoke('get_dropdown_data'); }
    catch(e) { this._dropdownData = { sigla:[], clienti:[], luoghi:[], tipo_intervento:[], tipo_tariffa:[], tipo_addebito:[], durata:[] }; }
  },

  // ── Form ──────────────────────────────────────────────────────────
  initForm() {
    const dd = this._dropdownData || {};
    const wrap = id => document.getElementById(id);
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
  },

  resetForm() {
    this.editingItem = null;
    this.clearFormErrors();
    document.getElementById('form-title').textContent = 'Nuovo intervento';
    document.getElementById('form-submit-text').textContent = 'Salva intervento';
    document.getElementById('form-sign-btn').style.display = 'none';
    // Set default datetime to now rounded to next 15 min (local time)
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('f-start').value = localISO;
    document.getElementById('f-durata').value = 60;
    this.updateDurata(60);
    document.getElementById('f-altro').value = '';
    document.getElementById('f-note').value = '';
    document.getElementById('f-trasferta').value = '';
    Object.values(this._fuzzy).forEach(f => f?.setValue(''));
    // Auto-fill sigla from last used or primary account
    const lastSigla = localStorage.getItem('gi_last_sigla');
    const accountSigla = (this.accounts?.find(a => a.is_primary) || this.accounts?.[0])?.sigla || '';
    this._fuzzy.sigla?.setValue(lastSigla || accountSigla);
    this.updateSubjectPreview();
  },

  fillForm(item) {
    this.editingItem = item;
    document.getElementById('form-title').textContent = 'Modifica intervento';
    document.getElementById('form-submit-text').textContent = 'Aggiorna intervento';
    document.getElementById('form-sign-btn').style.display = '';
    if (item.start_dt) {
      const d = new Date(item.start_dt);
      const localISO = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById('f-start').value = localISO;
    }
    // Duration from start/end
    if (item.start_dt && item.end_dt) {
      const dur = Math.round((new Date(item.end_dt) - new Date(item.start_dt)) / 60000);
      const snapped = Math.max(15, Math.min(480, Math.round(dur / 15) * 15));
      document.getElementById('f-durata').value = snapped;
      this.updateDurata(snapped);
    }
    this._fuzzy.sigla?.setValue(item.nome_tecnico || '');
    this._fuzzy.cliente?.setValue(item.ragione_sociale || '');
    this._fuzzy.tipo?.setValue(item.descrizione || '');
    this._fuzzy.luogo?.setValue(item.luogo || '');
    this._fuzzy.tariffa?.setValue(item.tipo_tariffa || '');
    this._fuzzy.addebito?.setValue(item.tipo_fatturazione || '');
    document.getElementById('f-altro').value = item.altro || '';
    document.getElementById('f-note').value = item.body_html?.replace(/<[^>]+>/g,'') || '';
    document.getElementById('f-trasferta').value = item.trasferta || '';
    this.updateSubjectPreview();
  },

  cancelForm() { this.closeNewModal(); },

  updateSubjectPreview() {
    const get = id => document.getElementById(id)?.value || '';
    const s = buildSubject(
      this._fuzzy.sigla?.getValue() || '',
      this._fuzzy.cliente?.getValue() || '',
      this._fuzzy.tipo?.getValue() || '',
      get('f-altro'),
      this._fuzzy.tariffa?.getValue() || '',
      this._fuzzy.addebito?.getValue() || '',
    );
    const el = document.getElementById('subject-preview');
    if (el) el.textContent = s || '—';
  },

  clearFormErrors() {
    document.querySelectorAll('#intervention-form .fg.has-error').forEach(el => el.classList.remove('has-error'));
    document.querySelectorAll('#intervention-form .fg-error').forEach(el => { el.textContent = ''; });
  },

  setFormError(fieldId, msg) {
    const field = document.getElementById(fieldId);
    const group = field?.closest('.fg') || document.getElementById(fieldId)?.parentElement?.closest('.fg');
    if (!group) return;
    group.classList.add('has-error');
    const err = group.querySelector('.fg-error');
    if (err) err.textContent = msg;
  },

  validateInterventionForm(data) {
    this.clearFormErrors();
    let ok = true;
    const startVal = document.getElementById('f-start')?.value;
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
    const el = document.getElementById('f-durata');
    const min = parseInt(el.min), max = parseInt(el.max);
    const pct = ((parseInt(val) - min) / (max - min) * 100).toFixed(1);
    el.style.setProperty('--fill', pct + '%');
    document.getElementById('f-durata-val').textContent = durMinToStr(parseInt(val));
  },

  _getFormData() {
    const startVal = document.getElementById('f-start').value;
    const dur = parseInt(document.getElementById('f-durata').value);
    const start = new Date(startVal);
    const end = new Date(start.getTime() + dur * 60000);
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    return {
      email: primary?.email || '',
      start: start.toISOString(),
      end: end.toISOString(),
      nome_tecnico: this._fuzzy.sigla?.getValue() || null,
      ragione_sociale: this._fuzzy.cliente?.getValue() || null,
      descrizione: this._fuzzy.tipo?.getValue() || null,
      luogo: this._fuzzy.luogo?.getValue() || null,
      tipo_tariffa: this._fuzzy.tariffa?.getValue() || null,
      tipo_fatturazione: this._fuzzy.addebito?.getValue() || null,
      trasferta: document.getElementById('f-trasferta').value || null,
      altro: document.getElementById('f-altro').value || null,
      body_html: document.getElementById('f-note').value || null,
    };
  },

  async submitForm() {
    const btn = document.getElementById('form-submit-btn');
    const spinner = document.getElementById('form-submit-spinner');
    const text = document.getElementById('form-submit-text');
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
    const btn = document.getElementById('form-submit-btn');
    const spinner = document.getElementById('form-submit-spinner');
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
  async loadInterventions() {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (!primary) { this.renderList([]); return; }
    const now = new Date();
    const MS_90D = 90 * 24 * 60 * 60 * 1000;
    const start = new Date(now.getTime() - MS_90D).toISOString();
    const end   = new Date(now.getTime() + MS_90D).toISOString();
    try {
      const items = await invoke('list_interventions', { email: primary.email, start, end });
      this.interventions = items;
      this.renderList(items);
      if (this.currentView === 'calendar') Calendar.refresh();
    } catch(e) { console.error(e); }
  },

  renderList(items) {
    const container = document.getElementById('list-container');
    const count = document.getElementById('list-count');
    if (!items.length) {
      count.textContent = 'Nessun intervento';
      container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-3);font-size:12px">Nessun intervento nel periodo selezionato</div>';
      return;
    }
    count.textContent = `${items.length} interventi`;
    const colors = ['var(--cat-1)','var(--cat-2)','var(--cat-3)','var(--cat-4)','var(--cat-5)','var(--cat-6)','var(--cat-7)','var(--cat-8)'];
    const colorOf = (sigla) => {
      let h = 0; for (const c of (sigla||'')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
      return colors[h % colors.length];
    };
    const cleanText = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
            <div class="iv-cliente">${escHtml(item.ragione_sociale || '—')}</div>
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
    document.getElementById('workspace')?.classList.remove('collapse-right');
    this._currentItemId = { id: item.exchange_item_id, ck: item.change_key };
    const empty = document.getElementById('detail-empty');
    const fill = document.getElementById('detail-fill');
    if (empty) empty.style.display = 'none';
    if (!fill) return;
    fill.style.cssText = 'display:flex;flex:1;overflow:hidden;flex-direction:column';
    fill.innerHTML = renderInterventionDetail(item);
  },

  clearDetail() {
    const empty = document.getElementById('detail-empty');
    const fill = document.getElementById('detail-fill');
    if (empty) empty.style.display = 'flex';
    if (fill) { fill.style.display = 'none'; fill.innerHTML = ''; }
    document.getElementById('workspace')?.classList.add('collapse-right');
    this._currentItemId = null;
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
    document.getElementById('form-title').textContent = 'Duplica intervento';
    document.getElementById('form-submit-text').textContent = 'Crea intervento';
    document.getElementById('form-sign-btn').style.display = 'none';
  },

  async confirmDelete(itemJson) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    if (!confirm(`Eliminare l'intervento di ${item.ragione_sociale}?`)) return;
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    try {
      await invoke('delete_intervention', { email: primary.email, itemId: item.exchange_item_id, changeKey: item.change_key });
      toast('Intervento eliminato', 'success');
      this.clearDetail();
      await this.loadInterventions();
    } catch(e) { toast('Errore eliminazione: ' + e, 'error'); }
  },

  // ── Sync ──────────────────────────────────────────────────────────
  showSyncFeedback(message, type = 'success') {
    const el = document.getElementById('sync-feedback');
    if (!el) return;
    clearTimeout(this._syncFeedbackTimer);
    el.textContent = message;
    el.classList.toggle('error', type === 'error');
    el.classList.add('show');
    this._syncFeedbackTimer = setTimeout(() => el.classList.remove('show'), 2200);
  },

  async triggerSync() {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (!primary) { toast('Nessun account', 'warning'); return; }
    const btn = document.getElementById('sync-btn');
    btn?.classList.add('syncing');
    document.getElementById('sb-sync-text').textContent = 'Sincronizzazione…';
    try {
      await invoke('trigger_sync', { email: primary.email });
      this.showSyncFeedback('Aggiornato');
    } catch(e) {
      this.showSyncFeedback('Errore sync', 'error');
      document.getElementById('sb-sync-text').textContent = 'Errore sync';
      toast('Sync error: ' + e, 'error');
    } finally { btn?.classList.remove('syncing'); }
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
    document.getElementById('global-search-input')?.focus();
  },
  renderSearchHistory() {
    const box = document.getElementById('search-history');
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
    const input = document.getElementById('global-search-input');
    if (input) input.value = q;
    this.hideSearchHistory();
    this.saveSearch(q);
    this.onSearchInput(q);
  },
  showSearchHistory() {
    this.renderSearchHistory();
    const box = document.getElementById('search-history');
    if (box && this._loadSearchHistory().length) box.classList.remove('hidden');
  },
  hideSearchHistory() {
    setTimeout(() => document.getElementById('search-history')?.classList.add('hidden'), 120);
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
    const clientEl = document.getElementById('sig-info-client');
    const metaEl = document.getElementById('sig-info-meta');
    if (clientEl) clientEl.textContent = item.ragione_sociale || '—';
    if (metaEl) {
      const dt = item.start_dt ? fmtDT(item.start_dt) : '—';
      const parts = [dt, item.nome_tecnico, item.descrizione_intervento].filter(Boolean);
      metaEl.textContent = parts.join(' · ');
    }
    const legal = document.getElementById('sig-legal');
    if (legal) legal.textContent = `Il cliente conferma il lavoro svolto con ${item.ragione_sociale || 'il cliente'}. Dopo la conferma, firma e timestamp vengono collegati al rapporto.`;

    // Reset checklist
    const chk = document.getElementById('sig-check-firma');
    if (chk) { chk.textContent = 'in attesa'; chk.style.color = 'var(--amber)'; }

    // Reset pen size buttons
    document.querySelectorAll('.sig-pen-size').forEach((b, i) => b.classList.toggle('on', i === 0));

    document.getElementById('modal-firma').classList.remove('hidden', 'closing');

    // Init canvas after modal is visible
    requestAnimationFrame(() => {
      const wrap = document.getElementById('sig-canvas-wrap');
      const canvas = document.getElementById('firma-canvas');
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

      const ph = document.getElementById('sig-canvas-placeholder');
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
          const ck = document.getElementById('sig-check-firma');
          if (ck) { ck.textContent = 'OK'; ck.style.color = 'var(--green)'; }
        }
      };
      canvas.onmouseup = canvas.ontouchend = canvas.onmouseleave = () => { this._firmaDrawing = false; };
    });
  },

  firmaClear() {
    const canvas = document.getElementById('firma-canvas');
    if (this._firmaCtx) this._firmaCtx.clearRect(0, 0, canvas.width, canvas.height);
    this._firmaHasDraw = false;
    const ph = document.getElementById('sig-canvas-placeholder');
    if (ph) ph.style.display = '';
    const chk = document.getElementById('sig-check-firma');
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
    const canvas = document.getElementById('firma-canvas');
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
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    let toVal = '', ccVal = primary?.email || '';
    try {
      const mem = await invoke('get_client_email', { ragioneSociale: item.ragione_sociale });
      if (mem) { toVal = mem.to || ''; ccVal = mem.cc || ccVal; }
    } catch(e) {}
    document.getElementById('modal-email-body').innerHTML = `
      <div class="fg"><label class="fg-lbl">A</label><input class="fg-in" id="email-to" value="${toVal}" placeholder="destinatario@azienda.it"></div>
      <div class="fg"><label class="fg-lbl">CC</label><input class="fg-in" id="email-cc" value="${ccVal}"></div>
      <div class="fg"><label class="fg-lbl">Oggetto</label><input class="fg-in" id="email-subject" value="Report intervento — ${item.ragione_sociale || ''}"></div>
      <div class="fg"><label class="fg-lbl">Messaggio</label><textarea class="fg-ta" id="email-body" rows="4">Gentili,\n\nIn allegato il report dell'intervento del ${fmtDT(item.start_dt)}.\n\nCordiali saluti</textarea></div>
      <div style="font-size:11px;color:var(--text-3)">Il PDF dell'intervento verrà allegato automaticamente.</div>`;
    document.getElementById('modal-email').classList.remove('hidden', 'closing');
  },

  async emailSend() {
    const to = document.getElementById('email-to')?.value.trim();
    const cc = document.getElementById('email-cc')?.value.trim();
    const subject = document.getElementById('email-subject')?.value;
    const body = document.getElementById('email-body')?.value;
    if (!to) { toast('Destinatario obbligatorio', 'error'); return; }
    document.getElementById('email-send-spinner').style.display = '';
    document.getElementById('email-send-text').textContent = 'Invio…';
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
      document.getElementById('email-send-spinner').style.display = 'none';
      document.getElementById('email-send-text').textContent = 'Invia';
    }
  },

  // ── PDF modal ─────────────────────────────────────────────────────
  openPdfModal(itemJson) {
    this._currentPdfItem = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    document.getElementById('modal-pdf-body').innerHTML = `
      <p style="color:var(--text-2);font-size:12px;margin-bottom:14px">Esporta il report PDF per: <strong>${this._currentPdfItem.ragione_sociale}</strong></p>
      <div class="fg">
        <label class="fg-lbl">Formato</label>
        <select class="fg-sel" id="pdf-format">
          <option value="detail">Dettaglio completo</option>
          <option value="summary">Riepilogo</option>
        </select>
      </div>`;
    document.getElementById('modal-pdf').classList.remove('hidden', 'closing');
  },

  // ── Trasferta context menu ────────────────────────────────────────
  openContextMenu(e, itemJson) {
    e.preventDefault();
    this._ctxItem = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    const menu = document.getElementById('ctx-menu');
    menu.classList.remove('hidden', 'closing');
    const mw = 220, mh = 80;
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

  _trasfertaFromCtx(mode) {
    closeOverlay('ctx-menu');
    this._trasfertaMode = mode;
    const item = this._ctxItem;
    if (!item) return;
    document.getElementById('trasferta-title').textContent =
      mode === 'before' ? 'Trasferta prima' : 'Trasferta dopo';
    const ref = document.getElementById('trasferta-ref');
    if (ref) {
      const dt = item.start_dt ? fmtDT(item.start_dt) : '—';
      const endDt = item.end_dt ? fmtDT(item.end_dt) : '';
      const when = mode === 'before'
        ? `Fine: <strong>${dt}</strong>`
        : `Inizio: <strong>${endDt || dt}</strong>`;
      ref.innerHTML = `<strong>${item.ragione_sociale || '—'}</strong> · ${when}`;
    }
    const dl = document.getElementById('trasferta-luogo-list');
    if (dl) {
      const luoghi = this._dropdownData?.luoghi || [];
      dl.innerHTML = luoghi.map(l => `<option value="${escHtml(l)}">`).join('');
    }
    document.getElementById('trasferta-luogo').value = '';
    document.getElementById('trasferta-durata').value = 30;
    this._updateTrasfertaDurata(30);
    document.getElementById('modal-trasferta').classList.remove('hidden', 'closing');
    setTimeout(() => document.getElementById('trasferta-luogo').focus(), 80);
  },

  openTrasfertaForDetail(itemJson) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    this._ctxItem = item;
    this._trasfertaFromCtx('after');
  },

  _updateTrasfertaDurata(val) {
    const el = document.getElementById('trasferta-durata');
    const min = parseInt(el.min), max = parseInt(el.max);
    const pct = ((parseInt(val) - min) / (max - min) * 100).toFixed(1);
    el.style.setProperty('--fill', pct + '%');
    document.getElementById('trasferta-durata-val').textContent = durMinToStr(parseInt(val));
  },

  async _confirmTrasferta() {
    const item = this._ctxItem;
    const mode = this._trasfertaMode;
    if (!item || !mode) return;
    const luogo = document.getElementById('trasferta-luogo').value.trim();
    const dur = parseInt(document.getElementById('trasferta-durata').value);
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
      altro: null,
      body_html: null,
    };
    const btn = document.getElementById('trasferta-confirm-btn');
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
