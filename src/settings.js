// ── Settings view ─────────────────────────────────────────────────────

const Settings = {
  _section: 'account',
  _accounts: [],
  _addMode: false,
  _addData: { email: '', password: '', server: '', domain: '', displayName: '', sigla: '' },
  _addTested: false,
  _sigCtx: null,
  _sigCanvas: null,
  _sigHasDrawn: false,
  // Cached data loaded upfront
  _dropdownData: {},
  _techSigB64: null,
  _syncInterval: 15,

  async onNavigate() {
    this._section = 'account';
    this._addMode = false;
    this._accounts = await invoke('list_accounts_cmd').catch(() => []);
    const email = (this._accounts[0] || {}).email || '';

    // Load all async data at once — navigation is then fully synchronous
    const [dd, sig, interval] = await Promise.all([
      invoke('get_dropdown_data').catch(() => ({})),
      email ? invoke('get_config_value', { key: 'tech_signature_' + email }).catch(() => null) : Promise.resolve(null),
      invoke('get_config_value', { key: 'sync_interval_minutes' }).catch(() => null),
    ]);
    this._dropdownData = dd || {};
    this._techSigB64   = sig || null;
    this._syncInterval = interval ? parseInt(interval) : 15;

    this._render();
  },

  // ── Nav ─────────────────────────────────────────────────────────────

  _render() {
    this._renderNav();
    this._renderBody();
  },

  _renderNav() {
    const nav = $('st-nav');
    if (!nav) return;
    const sections = [
      { id: 'account',  label: 'Account Exchange' },
      { id: 'firma',    label: 'Firma tecnico' },
      { id: 'sync',     label: 'Sync & cache' },
      { id: 'aspetto',  label: 'Aspetto' },
      { id: 'dropdown', label: 'Dati dropdown' },
      { id: 'info',     label: 'Informazioni' },
    ];
    nav.innerHTML = sections.map(s =>
      `<button class="st-nav-btn${this._section === s.id ? ' on' : ''}" data-s="${s.id}"
        onclick="Settings.switchSection('${s.id}')">${s.label}</button>`
    ).join('');
  },

  switchSection(s) {
    this._section = s;
    this._addMode = false;
    document.querySelectorAll('.st-nav-btn').forEach(b =>
      b.classList.toggle('on', b.dataset.s === s)
    );
    this._renderBody();
  },

  _renderBody() {
    const body = $('st-body');
    if (!body) return;
    switch (this._section) {
      case 'account':  this._renderAccount(body);  break;
      case 'firma':    this._renderFirma(body);    break;
      case 'sync':     this._renderSync(body);     break;
      case 'aspetto':  this._renderAspetto(body);  break;
      case 'dropdown': this._renderDropdown(body); break;
      case 'info':     this._renderInfo(body);     break;
    }
  },

  // ── Account Exchange ─────────────────────────────────────────────────

  _renderAccount(body) {
    if (this._addMode) {
      body.innerHTML = this._addFormHTML();
      return;
    }
    const rows = this._accounts.map(a => `
      <div class="st-acc-row">
        <div class="st-acc-badge">${escHtml((a.sigla || a.email[0] || '?').toUpperCase())}</div>
        <div class="st-acc-info">
          <div class="st-acc-email">${escHtml(a.email)}</div>
          <div class="st-acc-meta">
            ${a.display_name ? escHtml(a.display_name) + ' · ' : ''}
            ${a.server ? escHtml(a.server) : 'Autodiscovery'}
            ${a.is_primary ? ' · <span style="color:var(--accent);font-weight:600">Primario</span>' : ''}
          </div>
        </div>
        <button class="btn" style="color:var(--red);border-color:var(--red)"
          onclick="Settings._deleteAccount(${escHtml(JSON.stringify(a.email))})">Elimina</button>
      </div>
    `).join('');

    body.innerHTML = `
      <div class="st-section-hdr">Account Exchange</div>
      <div class="st-section-desc">Account configurati per la sincronizzazione Exchange. La password è salvata nel keychain di sistema.</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin:14px 0">
        ${rows || '<div style="font-size:12px;color:var(--text-3);padding:10px 0">Nessun account configurato.</div>'}
      </div>
      <button class="btn primary" onclick="Settings._startAdd()">+ Aggiungi account</button>
    `;
  },

  _addFormHTML() {
    const d = this._addData;
    return `
      <div class="st-section-hdr">Aggiungi account Exchange</div>
      <div class="fg">
        <label class="fg-lbl">Email account Exchange *</label>
        <input class="fg-in" type="email" id="st-add-email" placeholder="nome.cognome@azienda.it" value="${escHtml(d.email)}">
      </div>
      <div class="fg">
        <label class="fg-lbl">Password *</label>
        <input class="fg-in" type="password" id="st-add-password" placeholder="••••••••••">
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
        <div class="fg">
          <label class="fg-lbl">Server Exchange</label>
          <input class="fg-in" id="st-add-server" placeholder="mail.azienda.it" value="${escHtml(d.server)}">
          <div class="fg-hint">Es: mail.tssi.it</div>
        </div>
        <div class="fg">
          <label class="fg-lbl">Dominio NTLM</label>
          <input class="fg-in" id="st-add-domain" placeholder="TSSI" value="${escHtml(d.domain)}">
          <div class="fg-hint">Solo NTLM</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg">
          <label class="fg-lbl">Nome visualizzato</label>
          <input class="fg-in" id="st-add-displayname" placeholder="Mario Rossi" value="${escHtml(d.displayName)}">
        </div>
        <div class="fg">
          <label class="fg-lbl">Sigla</label>
          <input class="fg-in" id="st-add-sigla" placeholder="MR" value="${escHtml(d.sigla)}">
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px;align-items:center">
        <button class="btn" onclick="Settings._testAdd()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Testa connessione
        </button>
        <button class="btn primary" id="st-add-save-btn" onclick="Settings._saveAdd()"${this._addTested ? '' : ' disabled'}>Salva</button>
        <button class="btn" onclick="Settings._cancelAdd()">Annulla</button>
      </div>
      <div id="st-add-test-result" style="margin-top:8px"></div>
    `;
  },

  _startAdd() {
    this._addMode = true;
    this._addData = { email: '', password: '', server: '', domain: '', displayName: '', sigla: '' };
    this._addTested = false;
    const body = $('st-body');
    if (body) body.innerHTML = this._addFormHTML();
  },

  _collectAdd() {
    this._addData.email       = $('st-add-email')?.value.trim() || '';
    this._addData.password    = $('st-add-password')?.value || '';
    this._addData.server      = $('st-add-server')?.value.trim() || '';
    this._addData.domain      = $('st-add-domain')?.value.trim() || '';
    this._addData.displayName = $('st-add-displayname')?.value.trim() || '';
    this._addData.sigla       = $('st-add-sigla')?.value.trim() || '';
  },

  async _testAdd() {
    this._collectAdd();
    if (!this._addData.email || !this._addData.password) { toast('Email e password obbligatorie', 'error'); return; }
    const res = $('st-add-test-result');
    res.innerHTML = '<span class="spinner"></span> Test in corso…';
    try {
      const result = await invoke('test_connection', {
        email: this._addData.email,
        password: this._addData.password,
        server: this._addData.server,
        domain: this._addData.domain || null,
      });
      if (result.ok) {
        res.innerHTML = `<div class="test-result ok"><div class="test-dot ok"></div><div class="test-msg ok">Connessione riuscita</div></div>`;
        this._addTested = true;
        const btn = $('st-add-save-btn');
        if (btn) btn.disabled = false;
      } else {
        res.innerHTML = `<div class="test-result err"><div class="test-dot err"></div><div class="test-msg err">${result.error || 'Connessione fallita'}</div></div>`;
      }
    } catch(e) {
      res.innerHTML = `<div class="test-result err"><div class="test-dot err"></div><div class="test-msg err">${e}</div></div>`;
    }
  },

  async _saveAdd() {
    this._collectAdd();
    if (!this._addData.email || !this._addData.password) { toast('Email e password obbligatorie', 'error'); return; }
    const btn = $('st-add-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
    try {
      await invoke('save_account', { input: {
        email:        this._addData.email,
        password:     this._addData.password,
        server:       this._addData.server || null,
        domain:       this._addData.domain || null,
        display_name: this._addData.displayName || null,
        sigla:        this._addData.sigla || null,
        is_primary:   this._accounts.length === 0,
      }});
      this._accounts = await invoke('list_accounts_cmd').catch(() => []);
      App.accounts = this._accounts;
      App.renderSidebarAccounts();
      this._addMode = false;
      toast('Account salvato', 'success');
      this._renderBody();
    } catch(e) {
      toast('Errore: ' + e, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
    }
  },

  _cancelAdd() {
    this._addMode = false;
    this._renderBody();
  },

  async _deleteAccount(email) {
    if (!confirm('Eliminare l\'account ' + email + '?')) return;
    try {
      await invoke('delete_account_cmd', { email });
      this._accounts = await invoke('list_accounts_cmd').catch(() => []);
      App.accounts = this._accounts;
      App.renderSidebarAccounts();
      this._renderBody();
      toast('Account eliminato', 'success');
    } catch(e) {
      toast('Errore: ' + e, 'error');
    }
  },

  // ── Firma tecnico ─────────────────────────────────────────────────────

  _renderFirma(body) {
    body.innerHTML = `
      <div class="st-section-hdr">Firma tecnico</div>
      <div class="st-section-desc">La firma viene incorporata nei PDF degli interventi.</div>
      ${this._techSigB64 ? `
        <div style="margin:14px 0 10px">
          <div class="fg-lbl" style="margin-bottom:6px">Firma attuale</div>
          <div style="background:var(--bg-elev);box-shadow:var(--sh-1);border-radius:8px;padding:10px;display:inline-block">
            <img src="data:image/png;base64,${this._techSigB64}" style="max-width:320px;max-height:80px;display:block" alt="firma">
          </div>
        </div>
      ` : ''}
      <div class="fg-lbl" style="margin-bottom:6px">${this._techSigB64 ? 'Aggiorna firma' : 'Disegna la tua firma'}</div>
      <div class="sig-canvas-wrap" id="st-sig-wrap" style="height:160px;cursor:crosshair">
        <div class="sig-canvas-placeholder" id="st-sig-placeholder">
          <div class="sig-cp-line"></div>
          <div class="sig-cp-txt">Firma qui</div>
        </div>
        <canvas id="st-sig-canvas"></canvas>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        <button class="sig-clear" onclick="Settings.clearFirma()">Cancella</button>
        <div style="flex:1"></div>
        <button class="btn primary" onclick="Settings._saveFirma()">Salva firma</button>
      </div>
    `;
    this._initSigCanvas();
  },

  _initSigCanvas() {
    const canvas = $('st-sig-canvas');
    const wrap   = $('st-sig-wrap');
    if (!canvas || !wrap) return;

    canvas.width  = wrap.clientWidth  || 400;
    canvas.height = wrap.clientHeight || 160;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = document.body.classList.contains('theme-light') ? '#1e2d4a' : '#e8edf5';
    ctx.lineWidth = 2;
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    this._sigCanvas  = canvas;
    this._sigCtx     = ctx;
    this._sigHasDrawn = false;

    let drawing = false, lastX = 0, lastY = 0;

    const getPos = e => {
      const r = canvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return [src.clientX - r.left, src.clientY - r.top];
    };

    canvas.onmousedown = e => { drawing = true; [lastX, lastY] = getPos(e); };
    canvas.onmousemove = e => {
      if (!drawing) return;
      const [x, y] = getPos(e);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke();
      [lastX, lastY] = [x, y];
      if (!this._sigHasDrawn) {
        this._sigHasDrawn = true;
        const ph = $('st-sig-placeholder');
        if (ph) ph.style.display = 'none';
      }
    };
    canvas.onmouseup = canvas.onmouseleave = () => { drawing = false; };
    canvas.ontouchstart = e => {
      e.preventDefault(); drawing = true; [lastX, lastY] = getPos(e);
    };
    canvas.ontouchmove = e => {
      if (!drawing) return;
      e.preventDefault();
      const [x, y] = getPos(e);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke();
      [lastX, lastY] = [x, y];
      this._sigHasDrawn = true;
      const ph = $('st-sig-placeholder');
      if (ph) ph.style.display = 'none';
    };
    canvas.ontouchend = () => { drawing = false; };
  },

  clearFirma() {
    if (!this._sigCtx || !this._sigCanvas) return;
    this._sigCtx.clearRect(0, 0, this._sigCanvas.width, this._sigCanvas.height);
    this._sigHasDrawn = false;
    const ph = $('st-sig-placeholder');
    if (ph) ph.style.display = '';
  },

  async _saveFirma() {
    if (!this._sigCanvas || !this._sigHasDrawn) { toast('Disegna prima la firma', 'warning'); return; }
    const b64 = this._sigCanvas.toDataURL('image/png').replace('data:image/png;base64,', '');
    const email = (this._accounts[0] || {}).email || '';
    if (!email) { toast('Nessun account configurato', 'error'); return; }
    try {
      await invoke('set_config_value', { key: 'tech_signature_' + email, value: b64 });
      this._techSigB64 = b64;
      toast('Firma salvata', 'success');
      this._renderBody();
    } catch(e) {
      toast('Errore: ' + e, 'error');
    }
  },

  // ── Sync & cache ──────────────────────────────────────────────────────

  _renderSync(body) {
    const interval = this._syncInterval;
    body.innerHTML = `
      <div class="st-section-hdr">Intervallo sincronizzazione</div>
      <div class="fg" style="max-width:280px;margin-top:4px">
        <label class="fg-lbl">Frequenza sync automatica</label>
        <select class="fg-in" id="st-sync-interval" onchange="Settings._saveInterval()">
          ${[5, 10, 15, 30, 60].map(m =>
            `<option value="${m}"${interval === m ? ' selected' : ''}>${m} minuti</option>`
          ).join('')}
        </select>
      </div>
      <div class="st-section-hdr" style="margin-top:24px">Svuota cache</div>
      <div class="st-section-desc">Rimuove gli interventi in cache. Al prossimo sync verranno riscaricati da Exchange.</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
        ${this._accounts.map(a => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg-elev);box-shadow:var(--sh-1);border-radius:8px">
            <div style="flex:1;font-size:12px;color:var(--text-2)">${escHtml(a.email)}</div>
            <button class="btn" onclick="Settings._clearCache(${escHtml(JSON.stringify(a.email))})">Svuota cache</button>
          </div>
        `).join('') || '<div style="font-size:12px;color:var(--text-3)">Nessun account configurato.</div>'}
      </div>
    `;
  },

  async _saveInterval() {
    const sel = $('st-sync-interval');
    if (!sel) return;
    const val = sel.value;
    try {
      await invoke('set_config_value', { key: 'sync_interval_minutes', value: val });
      this._syncInterval = parseInt(val);
      toast('Intervallo salvato', 'success');
    } catch(e) {
      toast('Errore: ' + e, 'error');
    }
  },

  async _clearCache(email) {
    if (!confirm('Svuotare la cache di ' + email + '?')) return;
    try {
      await invoke('clear_cache', { email });
      toast('Cache svuotata', 'success');
    } catch(e) {
      toast('Errore: ' + e, 'error');
    }
  },

  // ── Aspetto ───────────────────────────────────────────────────────────

  _renderAspetto(body) {
    const isLight = document.body.classList.contains('theme-light');
    body.innerHTML = `
      <div class="st-section-hdr">Aspetto</div>
      <div class="st-setting-list">
        <div class="st-setting-row">
          <div>
            <div class="st-setting-label">Tema</div>
            <div class="st-setting-desc">Usa il tema ${isLight ? 'chiaro' : 'scuro'} per l'interfaccia.</div>
          </div>
          <button class="st-theme-switch${isLight ? ' light' : ''}" type="button" role="switch"
            aria-checked="${isLight ? 'true' : 'false'}" aria-label="Tema chiaro"
            onclick="Settings._toggleTheme()">
            <span class="st-theme-thumb"></span>
            <span class="st-theme-option st-theme-dark">☾ Scuro</span>
            <span class="st-theme-option st-theme-light">☀ Chiaro</span>
          </button>
        </div>
      </div>
    `;
  },

  _toggleTheme() {
    const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
    this._setTheme(next);
  },

  _setTheme(t) {
    const isLight = t === 'light';
    document.body.classList.toggle('theme-light', isLight);
    localStorage.setItem('gi-theme', t);
    const themeBtn = $('theme-btn');
    if (themeBtn) themeBtn.textContent = isLight ? '☀' : '☾';
    const sw = document.querySelector('.st-theme-switch');
    if (sw) {
      sw.classList.toggle('light', isLight);
      sw.setAttribute('aria-checked', isLight ? 'true' : 'false');
    }
    const desc = document.querySelector('.st-setting-desc');
    if (desc) desc.textContent = `Usa il tema ${isLight ? 'chiaro' : 'scuro'} per l'interfaccia.`;
  },

  // ── Dropdown data ─────────────────────────────────────────────────────

  _renderDropdown(body) {
    const dd = this._dropdownData;
    const lists = [
      { key: 'sigla',            label: 'Sigle tecnici' },
      { key: 'clienti',         label: 'Clienti' },
      { key: 'luoghi',          label: 'Luoghi' },
      { key: 'tipo_intervento', label: 'Tipo intervento' },
      { key: 'tipo_tariffa',    label: 'Tariffa' },
      { key: 'tipo_addebito',   label: 'Addebito' },
      { key: 'durata',          label: 'Durata' },
    ];

    body.innerHTML = `
      <div class="st-section-hdr">Dati dropdown</div>
      <div class="st-section-desc">Un elemento per riga. Clicca Salva per aggiornare la lista.</div>
      <div class="st-dd-grid">
        ${lists.map(l => `
          <div class="st-dd-item">
            <div class="st-dd-lbl">${l.label}</div>
            <textarea class="fg-in st-dd-ta" id="st-dd-${l.key}" rows="6" spellcheck="false">${(dd[l.key] || []).join('\n')}</textarea>
            <button class="btn" style="margin-top:6px;width:100%;font-size:11px"
              onclick="Settings._saveDd('${l.key}')">Salva</button>
          </div>
        `).join('')}
      </div>
    `;
  },

  async _saveDd(key) {
    const ta = $('st-dd-' + key);
    if (!ta) return;
    const items = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
    try {
      await invoke('set_dropdown_list', { listName: key, items });
      if (!this._dropdownData) this._dropdownData = {};
      this._dropdownData[key] = items;
      toast('Lista salvata', 'success');
      await App.loadDropdowns();
      App.initForm();
    } catch(e) {
      toast('Errore: ' + e, 'error');
    }
  },

  // ── Informazioni ──────────────────────────────────────────────────────

  _renderInfo(body) {
    body.innerHTML = `
      <div class="st-section-hdr">Informazioni</div>
      <div class="st-kv" style="margin-top:8px">
        <div class="st-kv-row"><span class="st-kv-lbl">Applicazione</span><span>Gestore Interventi Desktop</span></div>
        <div class="st-kv-row"><span class="st-kv-lbl">Versione</span><span>0.1.0</span></div>
        <div class="st-kv-row"><span class="st-kv-lbl">Backend</span><span>Tauri 2 · Rust</span></div>
        <div class="st-kv-row"><span class="st-kv-lbl">Database locale</span><span>SQLite</span></div>
        <div class="st-kv-row"><span class="st-kv-lbl">Sincronizzazione</span><span>EWS (Exchange Web Services)</span></div>
      </div>
    `;
  },
};
