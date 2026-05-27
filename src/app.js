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
  container.innerHTML = '';
  const input = document.createElement('input');
  input.className = 'fuzzy-input';
  input.placeholder = placeholder;
  input.value = value;
  const dd = document.createElement('div');
  dd.className = 'fuzzy-dropdown';
  dd.style.display = 'none';
  container.appendChild(input);
  container.appendChild(dd);

  function renderOpts(q) {
    const q2 = q.toLowerCase();
    const filtered = options.filter(o => o.toLowerCase().includes(q2));
    dd.innerHTML = '';
    filtered.slice(0, 20).forEach(o => {
      const d = document.createElement('div');
      d.className = 'fuzzy-opt';
      d.textContent = o;
      d.onmousedown = (e) => { e.preventDefault(); setValue(o); onSelect(o); };
      dd.appendChild(d);
    });
    dd.style.display = filtered.length ? 'block' : 'none';
  }

  function setValue(v) { value = v; input.value = v; dd.style.display = 'none'; }
  function getValue() { return input.value; }

  input.addEventListener('input', () => renderOpts(input.value));
  input.addEventListener('focus', () => renderOpts(input.value));
  input.addEventListener('blur', () => setTimeout(() => { dd.style.display = 'none'; }, 150));

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
          <div style="background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;padding:14px">
            <div style="font-size:20px;margin-bottom:6px">📅</div>
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">Calendario</div>
            <div style="font-size:11px;color:var(--text-3)">Vista settimana, giorno e mese</div>
          </div>
          <div style="background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;padding:14px">
            <div style="font-size:20px;margin-bottom:6px">📝</div>
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">Firma digitale</div>
            <div style="font-size:11px;color:var(--text-3)">Firma su schermo o tablet</div>
          </div>
          <div style="background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;padding:14px">
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
        <div style="background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px;font-size:12px">
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
          displayName: this.data.displayName || null,
          sigla: null,
          server: this.data.server || null,
          domain: this.data.domain || null,
          isPrimary: true,
        }
      });
    } catch(e) {
      toast('Errore salvataggio account: ' + e, 'error');
    }
    this.hide();
    App.enterApp();
  },

  hide() {
    document.getElementById('onboarding').style.display = 'none';
  },
};

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

  async init() {
    // Apply saved theme
    const theme = localStorage.getItem('gi-theme');
    if (theme === 'light') document.body.classList.add('theme-light');
    document.getElementById('theme-btn').textContent = theme === 'light' ? '☀' : '☾';

    // Keyboard shortcut Ctrl+K
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.navigate('search');
        document.getElementById('global-search-input')?.focus();
      }
    });

    // Listen for sync-complete event
    listenEvent('sync-complete', e => {
      const { account, count, last_sync } = e.payload || {};
      document.getElementById('sb-sync-text').textContent =
        `Sync: ${new Date(last_sync).toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'})} · ${count} aggiornati`;
      document.getElementById('sb-dot').className = 'sb-dot g';
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
    this.navigate('interventions');
    this.loadInterventions();
    // Set current account in statusbar
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (primary) document.getElementById('sb-account').textContent = primary.email;
  },

  renderSidebarAccounts() {
    const el = document.getElementById('sidebar-accounts');
    if (!this.accounts.length) { el.textContent = 'Nessun account'; return; }
    el.innerHTML = this.accounts.map(a =>
      `<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <div class="sb-dot g"></div>
        <div><div style="font-weight:600;font-size:12px">${a.sigla || '—'}</div>
        <div style="font-size:10px;color:var(--text-3)">${a.email}</div></div>
       </div>`
    ).join('');
  },

  navigate(view) {
    this.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add('active');
    document.getElementById('toolbar-new').style.display = view === 'new' ? 'none' : '';
    if (view === 'calendar') Calendar.onNavigate();
    else if (view === 'search') Search.onNavigate();
    else if (view === 'settings') Settings.onNavigate();
    else this.renderSidebarAccounts();
  },

  toggleTheme() {
    document.body.classList.toggle('theme-light');
    const light = document.body.classList.contains('theme-light');
    localStorage.setItem('gi-theme', light ? 'light' : 'dark');
    document.getElementById('theme-btn').textContent = light ? '☀' : '☾';
  },

  // ── Window controls (Tauri only) ──────────────────────────────────
  winMin() { if (window.__TAURI__) window.__TAURI__.window.getCurrentWindow().minimize(); },
  winMax() { if (window.__TAURI__) window.__TAURI__.window.getCurrentWindow().toggleMaximize(); },
  winClose() { if (window.__TAURI__) window.__TAURI__.window.getCurrentWindow().close(); },

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
    mkFuzzy('fuzzy-sigla-wrap',    dd.sigla || [],            'Es. ML', 'sigla');
    mkFuzzy('fuzzy-cliente-wrap',  dd.clienti || [],          'Cerca cliente…', 'cliente');
    mkFuzzy('fuzzy-tipo-wrap',     dd.tipo_intervento || [],  'Tipo intervento…', 'tipo');
    mkFuzzy('fuzzy-tariffa-wrap',  dd.tipo_tariffa || [],     'Tariffa…', 'tariffa');
    mkFuzzy('fuzzy-addebito-wrap', dd.tipo_addebito || [],    'Addebito…', 'addebito');
  },

  resetForm() {
    this.editingItem = null;
    document.getElementById('form-title').textContent = 'Nuovo intervento';
    document.getElementById('form-submit-text').textContent = 'Salva intervento';
    document.getElementById('form-sign-btn').style.display = 'none';
    // Set default datetime to now rounded to next 15 min
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    document.getElementById('f-start').value = now.toISOString().slice(0, 16);
    document.getElementById('f-durata').value = 60;
    this.updateDurata(60);
    document.getElementById('f-altro').value = '';
    document.getElementById('f-note').value = '';
    document.getElementById('f-trasferta').value = '';
    Object.values(this._fuzzy).forEach(f => f?.setValue(''));
    this.updateSubjectPreview();
  },

  fillForm(item) {
    this.editingItem = item;
    document.getElementById('form-title').textContent = 'Modifica intervento';
    document.getElementById('form-submit-text').textContent = 'Aggiorna intervento';
    document.getElementById('form-sign-btn').style.display = '';
    if (item.start_dt) {
      const d = new Date(item.start_dt);
      document.getElementById('f-start').value = d.toISOString().slice(0, 16);
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
    this._fuzzy.tariffa?.setValue(item.tipo_tariffa || '');
    this._fuzzy.addebito?.setValue(item.tipo_fatturazione || '');
    document.getElementById('f-altro').value = item.altro || '';
    document.getElementById('f-note').value = item.body_html?.replace(/<[^>]+>/g,'') || '';
    document.getElementById('f-trasferta').value = item.trasferta || '';
    this.updateSubjectPreview();
  },

  cancelForm() { this.navigate('interventions'); this.editingItem = null; },

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
      if (!data.email) { toast('Nessun account configurato', 'error'); return; }
      if (!document.getElementById('f-start').value) { toast('Data obbligatoria', 'error'); return; }
      if (this.editingItem) {
        await invoke('update_intervention', {
          input: { email: data.email, itemId: this.editingItem.exchange_item_id, changeKey: this.editingItem.change_key, data }
        });
        toast('Intervento aggiornato', 'success');
      } else {
        await invoke('create_intervention', { data });
        toast('Intervento creato', 'success');
      }
      this.navigate('interventions');
      this.editingItem = null;
      await this.loadInterventions();
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
      if (!data.email) { toast('Nessun account configurato', 'error'); return; }
      if (!document.getElementById('f-start').value) { toast('Data obbligatoria', 'error'); return; }
      let savedItem;
      if (this.editingItem) {
        savedItem = await invoke('update_intervention', {
          input: { email: data.email, itemId: this.editingItem.exchange_item_id, changeKey: this.editingItem.change_key, data }
        });
        toast('Intervento aggiornato', 'success');
      } else {
        savedItem = await invoke('create_intervention', { data });
        toast('Intervento creato', 'success');
      }
      this.editingItem = null;
      await this.loadInterventions();
      this.navigate('interventions');
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
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();
    try {
      const items = await invoke('list_interventions', { email: primary.email, start, end });
      this.interventions = items;
      this.renderList(items);
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
    const colors = ['#6da8ee','#72d895','#f0bd71','#a99af4','#e99b8b','#6ed7d1','#ef7d82','#f8c76a'];
    const colorOf = (sigla) => {
      let h = 0; for (const c of (sigla||'')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
      return colors[h % colors.length];
    };
    container.innerHTML = items.sort((a, b) => a.start_dt < b.start_dt ? 1 : -1).map(item => {
      const color = colorOf(item.nome_tecnico);
      return `<div class="iv-card" onclick="App.showDetail(${JSON.stringify(JSON.stringify(item))})">
        <div class="iv-bar" style="background:${color}"></div>
        <div class="iv-body">
          <div class="iv-top">
            <div class="iv-sigla" style="background:${color}22;color:${color}">${item.nome_tecnico || '—'}</div>
            <div class="iv-cliente">${item.ragione_sociale || '—'}</div>
          </div>
          <div class="iv-meta">
            <span>${item.descrizione || ''}</span>
            ${item.tipo_tariffa ? `<span style="color:var(--text-3)">${item.tipo_tariffa}</span>` : ''}
          </div>
        </div>
        <div style="padding:10px 12px;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:4px">
          <div class="iv-time">${fmtDT(item.start_dt)}</div>
          ${item.durata ? `<div style="font-size:10px;color:var(--text-3)">${item.durata}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  },

  showDetail(itemJson, hasSig) {
    const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
    this._currentItemId = { id: item.exchange_item_id, ck: item.change_key };
    const empty = document.getElementById('detail-empty');
    const fill = document.getElementById('detail-fill');
    if (empty) empty.style.display = 'none';
    if (!fill) return;
    fill.style.cssText = 'display:flex;flex:1;overflow:hidden;flex-direction:column';

    const colors = ['#6da8ee','#72d895','#f0bd71','#a99af4','#e99b8b','#6ed7d1','#ef7d82','#f8c76a'];
    const colorOf = s => { let h = 0; for (const c of (s||'')) h = (h*31+c.charCodeAt(0))&0xffff; return colors[h%colors.length]; };
    const color = colorOf(item.nome_tecnico);

    const start = item.start_dt ? new Date(item.start_dt) : null;
    const end = item.end_dt ? new Date(item.end_dt) : null;
    const dur = end && start ? Math.round((end - start) / 60000) : 0;
    const pad = n => String(n).padStart(2,'0');
    const hm = (d) => d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
    const minHM = m => { const h=Math.floor(m/60),mm=m%60; return h&&mm?`${h}h ${mm}m`:h?`${h}h`:`${mm}m`; };
    const DOW = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
    const MON = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    const dateStr = start ? `${DOW[start.getDay()]} ${start.getDate()} ${MON[start.getMonth()]} ${start.getFullYear()}` : '—';
    const iS = JSON.stringify(JSON.stringify(item));

    const sigHtml = hasSig
      ? `<div class="sig-dot" style="background:var(--green);box-shadow:0 0 6px var(--green)"></div>
         <div class="sig-txt">Firmato dal cliente</div>
         <button class="sig-act" onclick="App.openFirmaModal(${iS})">Visualizza</button>`
      : `<div class="sig-dot" style="background:var(--text-3)"></div>
         <div class="sig-txt">Firma cliente assente</div>
         <button class="sig-act" onclick="App.openFirmaModal(${iS})">Firma ora</button>`;

    fill.innerHTML = `
      <div class="detail-head">
        <div class="dh-eye">Intervento</div>
        <div class="dh-client">${item.ragione_sociale || '—'}</div>
        <div class="badge-row">
          ${item.descrizione ? `<span class="badge b-gray">${item.descrizione}</span>` : ''}
          ${item.tipo_tariffa ? `<span class="badge b-purple">${item.tipo_tariffa}</span>` : ''}
          ${dur ? `<span class="badge b-gray">${minHM(dur)}</span>` : ''}
        </div>
      </div>
      <div class="detail-body fade-up">
        ${item.nome_tecnico ? `<div class="df">
          <div class="df-lbl">Tecnico</div>
          <div class="df-val"><div class="tech-pill"><div class="pill-av" style="background:${color};color:#111">${item.nome_tecnico}</div>${item.nome_tecnico}</div></div>
        </div>` : ''}
        <div class="df"><div class="df-lbl">Data</div><div class="df-val">${dateStr}</div></div>
        ${dur ? `<div class="df"><div class="df-lbl">Orario</div><div class="df-val mono">${hm(start)} → ${hm(end)} (${minHM(dur)})</div></div>` : ''}
        ${item.tipo_fatturazione ? `<div class="df"><div class="df-lbl">Addebito</div><div class="df-val">${item.tipo_fatturazione}</div></div>` : ''}
        ${item.trasferta ? `<div class="df"><div class="df-lbl">Trasferta</div><div class="df-val">${item.trasferta}</div></div>` : ''}
        ${item.body_html ? `<div class="df"><div class="df-lbl">Note</div><div class="note-box">${item.body_html}</div></div>` : ''}
      </div>
      <div class="detail-ftr">
        <div class="sig-bar" id="detail-sig-bar">${sigHtml}</div>
        <div class="act-row">
          <button class="abtn prime" onclick="App.editItem(${iS})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Modifica
          </button>
          <button class="abtn" onclick="App.openPdfModal(${iS})">PDF</button>
          <button class="abtn" onclick="App.openEmailModal(${iS})">Email</button>
        </div>
        <div class="act-row">
          <button class="abtn danger" onclick="App.confirmDelete(${iS})">Elimina</button>
        </div>
      </div>`;

    // Async signature check if not already known
    if (hasSig === undefined && item.exchange_item_id) {
      invoke('get_signature', { exchangeItemId: item.exchange_item_id }).then(sig => {
        const bar = document.getElementById('detail-sig-bar');
        if (!bar) return;
        if (sig) {
          bar.innerHTML = `<div class="sig-dot" style="background:var(--green);box-shadow:0 0 6px var(--green)"></div>
            <div class="sig-txt">Firmato dal cliente</div>
            <button class="sig-act" onclick="App.openFirmaModal(${iS})">Visualizza</button>`;
        }
      }).catch(() => {});
    }
  },

  clearDetail() {
    const empty = document.getElementById('detail-empty');
    const fill = document.getElementById('detail-fill');
    if (empty) empty.style.display = 'flex';
    if (fill) { fill.style.display = 'none'; fill.innerHTML = ''; }
    this._currentItemId = null;
  },

  editItem(itemJson) {
    const item = JSON.parse(itemJson);
    this.navigate('new');
    this.fillForm(item);
  },

  async confirmDelete(itemJson) {
    const item = JSON.parse(itemJson);
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
  async triggerSync() {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (!primary) { toast('Nessun account', 'warning'); return; }
    const btn = document.getElementById('sync-btn');
    btn.style.opacity = '0.5';
    document.getElementById('sb-sync-text').textContent = 'Sincronizzazione…';
    try {
      await invoke('trigger_sync', { email: primary.email });
      toast('Sync completato', 'success');
    } catch(e) {
      toast('Sync error: ' + e, 'error');
      document.getElementById('sb-sync-text').textContent = 'Errore sync';
    } finally { btn.style.opacity = ''; }
  },

  onSearchInput(val) {
    if (val.trim().length > 0) this.navigate('search');
    Search.query(val);
  },

  // ── Modals ────────────────────────────────────────────────────────
  closeModal(name) {
    document.getElementById(`modal-${name}`).classList.add('hidden');
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

    document.getElementById('modal-firma').classList.remove('hidden');

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
    document.getElementById('modal-email').classList.remove('hidden');
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
    document.getElementById('modal-pdf').classList.remove('hidden');
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
