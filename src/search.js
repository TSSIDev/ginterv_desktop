// ── Shared DOM helper (available to all scripts; search.js loads first) ──────
window.$ = (id) => document.getElementById(id);

// ── Search & Filter view — omnibar con filtri a token ────────────────────────

const Search = {
  _q: '',
  _tech: null,
  _tipo: null,
  _cliente: null,
  _datePreset: null,
  _dateFrom: null,
  _dateTo: null,
  _openPop: null, // 'cliente' | 'tech' | 'tipo' | 'periodo' | null

  _PRESETS: [
    ['oggi', 'Oggi'], ['settimana', 'Questa settimana'],
    ['mese', 'Questo mese'], ['3mesi', 'Ultimi 3 mesi'],
  ],

  // Called by App.navigate('search')
  onNavigate() {
    const g = $('global-search-input');
    if (g) this._q = g.value;
    const inp = $('srch-input');
    if (inp && inp.value !== this._q) inp.value = this._q;
    this._renderControls();
    this._render();
  },

  // Called by App.onSearchInput from toolbar / palette
  query(q) {
    this._q = q;
    const inp = $('srch-input');
    if (inp && inp.value !== q) inp.value = q;
    if (App.currentView === 'search') this._render();
  },

  // Typing in the in-view omnibar (kept in sync with the toolbar field)
  setQ(q) {
    this._q = q;
    const g = $('global-search-input');
    if (g && g.value !== q) g.value = q;
    this._render();
  },

  // Backspace su campo vuoto rimuove l'ultimo token attivo; Escape chiude il popover.
  onKeydown(e) {
    if (e.key === 'Escape') { this._closePop(); return; }
    if (e.key !== 'Backspace' || e.target.value !== '') return;
    if (this._cliente) this._cliente = null;
    else if (this._tipo) this._tipo = null;
    else if (this._tech) this._tech = null;
    else if (this._datePreset) { this._datePreset = null; this._dateFrom = null; this._dateTo = null; }
    else return;
    this._renderControls();
    this._render();
  },

  setTech(v)    { this._tech    = this._tech    === v ? null : v; this._afterFilterChange(); },
  setTipo(v)    { this._tipo    = this._tipo    === v ? null : v; this._afterFilterChange(); },
  setCliente(v) { this._cliente = this._cliente === v ? null : v; this._afterFilterChange(); },

  setDatePreset(preset) {
    this._datePreset = this._datePreset === preset ? null : preset;
    this._dateFrom = null; this._dateTo = null;
    this._afterFilterChange();
  },

  setCustomRange(from, to) {
    this._dateFrom = from || null;
    this._dateTo   = to   || null;
    this._datePreset = (from || to) ? 'custom' : null;
    this._renderControls(true); // mantieni il popover aperto durante la digitazione
    this._render();
  },

  _afterFilterChange() {
    this._closePop();
    this._renderControls();
    this._render();
  },

  removeToken(kind) {
    if (kind === 'tech') this._tech = null;
    else if (kind === 'tipo') this._tipo = null;
    else if (kind === 'cliente') this._cliente = null;
    else if (kind === 'periodo') { this._datePreset = null; this._dateFrom = null; this._dateTo = null; }
    this._renderControls();
    this._render();
  },

  // Esporta i risultati correnti (filtri inclusi) in iCalendar.
  exportIcs() {
    App.exportIcs(this._applyFilters(App.interventions || []), 'interventi.ics');
  },

  reset() {
    this._q = '';
    this._tech = null; this._tipo = null; this._cliente = null;
    this._datePreset = null; this._dateFrom = null; this._dateTo = null;
    const g = $('global-search-input'); if (g) g.value = '';
    const inp = $('srch-input'); if (inp) inp.value = '';
    this._closePop();
    this._renderControls();
    this._render();
  },

  // ── Popover filtri ─────────────────────────────────────────────────────────

  togglePop(kind, btn) {
    if (this._openPop === kind) { this._closePop(); return; }
    this._openPop = kind;
    const pop = $('srch-pop');
    if (!pop) return;
    pop.innerHTML = this._popContent(kind);
    pop.classList.remove('hidden');
    // Ancorato sotto il chip che l'ha aperto, entro i bordi della testata.
    const head = $('srch-head');
    const hr = head.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const left = Math.min(br.left - hr.left, hr.width - 248);
    pop.style.left = Math.max(10, left) + 'px';
  },

  _closePop() {
    this._openPop = null;
    $('srch-pop')?.classList.add('hidden');
  },

  _popContent(kind) {
    const items = App.interventions || [];
    const opt = (label, on, onclick, count) =>
      `<button class="spop-it${on ? ' on' : ''}" onclick="${onclick}">
        <span class="spop-txt">${escHtml(label)}</span>${count != null ? `<span class="spop-n tnum">${count}</span>` : ''}
      </button>`;

    if (kind === 'tech') {
      const fromDD = App._dropdownData?.sigla || [];
      const fromItems = items.map(i => i.nome_tecnico).filter(Boolean);
      const counts = {};
      fromItems.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
      const all = [...new Set([...fromItems, ...fromDD])].sort();
      return all.length
        ? all.map(t => opt(t, this._tech === t, `Search.setTech(${escHtml(JSON.stringify(t))})`, counts[t] || 0)).join('')
        : '<div class="spop-empty">Nessun tecnico</div>';
    }
    if (kind === 'tipo') {
      const counts = {};
      items.forEach(i => { if (i.descrizione) counts[i.descrizione] = (counts[i.descrizione] || 0) + 1; });
      const all = Object.keys(counts).sort().slice(0, 12);
      return all.length
        ? all.map(t => opt(t, this._tipo === t, `Search.setTipo(${escHtml(JSON.stringify(t))})`, counts[t])).join('')
        : '<div class="spop-empty">Nessun tipo</div>';
    }
    if (kind === 'cliente') {
      const counts = {};
      items.forEach(i => { if (i.ragione_sociale) counts[i.ragione_sociale] = (counts[i.ragione_sociale] || 0) + 1; });
      const all = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'it'));
      return all.length
        ? all.map(t => opt(t, this._cliente === t, `Search.setCliente(${escHtml(JSON.stringify(t))})`, counts[t])).join('')
        : '<div class="spop-empty">Nessun cliente</div>';
    }
    // periodo
    return this._PRESETS.map(([k, label]) =>
      opt(label, this._datePreset === k, `Search.setDatePreset('${k}')`)
    ).join('') + `
      <div class="spop-sep"></div>
      <div class="spop-range">
        <label>Dal <input class="fg-in" type="date" value="${this._dateFrom || ''}"
          oninput="Search.setCustomRange(this.value, this.closest('.spop-range').querySelector('[data-to]').value)"></label>
        <label>Al <input class="fg-in" type="date" data-to value="${this._dateTo || ''}"
          oninput="Search.setCustomRange(this.closest('.spop-range').querySelector('input').value, this.value)"></label>
      </div>`;
  },

  // ── Token + chips ──────────────────────────────────────────────────────────

  _periodLabel() {
    if (this._datePreset === 'custom') {
      const f = v => v ? v.split('-').reverse().slice(0, 2).join('/') : '…';
      return `${f(this._dateFrom)} – ${f(this._dateTo)}`;
    }
    return (this._PRESETS.find(([k]) => k === this._datePreset) || [])[1] || '';
  },

  _renderControls(keepPop = false) {
    const tok = $('srch-tokens');
    const chips = $('srch-chiprow');
    if (!tok || !chips) return;

    const token = (kind, label) =>
      `<button class="srch-token" onclick="Search.removeToken('${kind}')" title="Rimuovi filtro">
        ${escHtml(label)}<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>`;
    tok.innerHTML = [
      this._tech    ? token('tech', this._tech) : '',
      this._tipo    ? token('tipo', this._tipo.length > 24 ? this._tipo.slice(0, 22) + '…' : this._tipo) : '',
      this._datePreset ? token('periodo', this._periodLabel()) : '',
      this._cliente ? token('cliente', this._cliente.length > 28 ? this._cliente.slice(0, 26) + '…' : this._cliente) : '',
    ].join('');

    const chip = (kind, label, active) =>
      `<button class="srch-addchip${active ? ' on' : ''}" onclick="Search.togglePop('${kind}', this)">+ ${label}</button>`;
    chips.innerHTML = [
      chip('cliente', 'Cliente', !!this._cliente),
      chip('tech', 'Tecnico', !!this._tech),
      chip('tipo', 'Tipo', !!this._tipo),
      chip('periodo', 'Periodo', !!this._datePreset),
    ].join('');

    const clear = $('srch-clear');
    if (clear) clear.classList.toggle('hidden',
      !(this._q || this._tech || this._tipo || this._cliente || this._datePreset));

    if (!keepPop) this._closePop();
    else if (this._openPop) { const pop = $('srch-pop'); if (pop) pop.innerHTML = this._popContent(this._openPop); }
  },

  // ── Filtri ─────────────────────────────────────────────────────────────────

  _matchesDate(item) {
    if (!this._datePreset) return true;
    const start = new Date(item.start_dt);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (this._datePreset) {
      case 'oggi':
        return start >= today && start < new Date(today.getTime() + 86400000);
      case 'settimana': {
        const dow = today.getDay() || 7;
        const mon = new Date(today.getTime() - (dow - 1) * 86400000);
        const sun = new Date(mon.getTime() + 7 * 86400000);
        return start >= mon && start < sun;
      }
      case 'mese':
        return start.getMonth() === now.getMonth() && start.getFullYear() === now.getFullYear();
      case '3mesi':
        return start >= new Date(now.getFullYear(), now.getMonth() - 3, 1);
      case 'custom': {
        if (!this._dateFrom && !this._dateTo) return true;
        if (this._dateFrom && start < new Date(this._dateFrom)) return false;
        if (this._dateTo) {
          const toEnd = new Date(this._dateTo);
          toEnd.setDate(toEnd.getDate() + 1);
          if (start >= toEnd) return false;
        }
        return true;
      }
      default:
        return true;
    }
  },

  // Testo nota cacheato sull'item (DOMParser è costoso da ripetere a ogni render).
  _noteText(item) {
    if (item.__noteText === undefined) item.__noteText = htmlToText(item.body_html).toLowerCase();
    return item.__noteText;
  },

  _applyFilters(items) {
    const q = this._q.toLowerCase().trim();
    return items.filter(item => {
      if (q) {
        const hay = [
          item.ragione_sociale, item.descrizione, item.altro,
          item.nome_tecnico, item.tipo_tariffa, item.tipo_fatturazione,
          item.subject,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q) && !this._noteText(item).includes(q)) return false;
      }
      if (this._tech && item.nome_tecnico !== this._tech) return false;
      if (this._tipo && item.descrizione !== this._tipo) return false;
      if (this._cliente && item.ragione_sociale !== this._cliente) return false;
      if (!this._matchesDate(item)) return false;
      return true;
    });
  },

  _hl(text, q) {
    if (!text) return '';
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!q || q.length < 2) return safe;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return safe.replace(re, m => `<mark class="srch-hl">${m}</mark>`);
  },

  // ── Risultati raggruppati per giorno ───────────────────────────────────────

  _dayLabel(iso) {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today - that) / 86400000);
    const DOW = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const MON = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    const base = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
    if (diff === 0) return `Oggi · ${base}`;
    if (diff === 1) return `Ieri · ${base}`;
    if (diff === -1) return `Domani · ${base}`;
    return base;
  },

  _render() {
    const list = $('srch-list');
    const count = $('srch-count');
    if (!list) return;

    const q = this._q.toLowerCase().trim();
    const items = this._applyFilters(App.interventions || [])
      .sort((a, b) => (b.start_dt || '').localeCompare(a.start_dt || ''));

    if (count) {
      const n = items.length;
      count.textContent = n ? `${n} risultat${n === 1 ? 'o' : 'i'}` : 'Nessun risultato';
    }

    if (!items.length) {
      const hasFilters = !!(q || this._tech || this._tipo || this._cliente || this._datePreset);
      list.innerHTML = `<div class="srch-empty">
        ${hasFilters
          ? `Nessun intervento trovato con questi criteri.<br>
             <button class="empty-action" onclick="Search.reset()">Azzera ricerca e filtri</button>`
          : `Cerca per cliente, tipo o note,<br>oppure aggiungi un filtro qui sopra.`}
      </div>`;
      return;
    }

    const colors = ['var(--cat-1)','var(--cat-2)','var(--cat-3)','var(--cat-4)','var(--cat-5)','var(--cat-6)','var(--cat-7)','var(--cat-8)'];
    const colorOf = s => { let h = 0; for (const c of (s || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return colors[h % colors.length]; };
    const pad = n => String(n).padStart(2, '0');

    let html = '';
    let lastDay = null;
    for (const item of items) {
      const day = (item.start_dt || '').slice(0, 10);
      if (day !== lastDay) {
        html += `<div class="srch-day">${item.start_dt ? this._dayLabel(item.start_dt) : 'Senza data'}</div>`;
        lastDay = day;
      }
      const color = colorOf(item.nome_tecnico);
      const d = item.start_dt ? new Date(item.start_dt) : null;
      const time = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
      // Snippet nota solo se la query matcha la nota (contesto attorno alla prima occorrenza).
      let noteSnip = '';
      if (q && q.length >= 2) {
        const nt = this._noteText(item);
        const at = nt.indexOf(q);
        if (at >= 0) {
          const from = Math.max(0, at - 30);
          const raw = (from > 0 ? '…' : '') + htmlToText(item.body_html).slice(from, at + q.length + 50) + '…';
          noteSnip = `<div class="srres-note">${this._hl(raw, q)}</div>`;
        }
      }
      const iS = escHtml(JSON.stringify(item));
      html += `<div class="srres" tabindex="0" role="button"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.showDetail(${iS})}"
        onclick="App.showDetail(${iS})">
        <div class="srres-sig" style="background:color-mix(in oklch, ${color} 18%, transparent);color:${color}">${escHtml(item.nome_tecnico || '—')}</div>
        <div class="srres-main">
          <div class="srres-client">${this._hl(item.ragione_sociale || '—', q)}${pendingBadge(item)}</div>
          <div class="srres-sub">
            ${item.descrizione ? `<span>${this._hl(item.descrizione, q)}</span>` : ''}
            ${item.tipo_tariffa ? `<span class="dim">${escHtml(item.tipo_tariffa)}</span>` : ''}
            ${item.altro ? `<span class="dim it">${this._hl(item.altro, q)}</span>` : ''}
          </div>
          ${noteSnip}
        </div>
        <div class="srres-right">
          <div class="srres-time tnum">${time}</div>
          ${item.durata ? `<div class="srres-dur">${escHtml(item.durata)}</div>` : ''}
        </div>
      </div>`;
    }
    list.innerHTML = html;
  },
};

// Chiudi il popover filtri cliccando fuori (capture: vale anche dentro la view).
document.addEventListener('mousedown', (e) => {
  if (e.target.closest?.('#srch-pop') || e.target.closest?.('.srch-addchip')) return;
  Search._closePop();
}, true);
