// ── Shared DOM helper (available to all scripts; search.js loads first) ──────
window.$ = (id) => document.getElementById(id);

// ── Search & Filter view ─────────────────────────────────────────────────────

const Search = {
  _q: '',
  _clientQ: '',
  _tech: null,
  _tipo: null,
  _datePreset: null,
  _dateFrom: null,
  _dateTo: null,

  // Called by App.navigate('search')
  onNavigate() {
    const inp = $('global-search-input');
    if (inp) this._q = inp.value;
    this._populateFilters();
    this._render();
  },

  // Called by App.onSearchInput from toolbar
  query(q) {
    this._q = q;
    if (App.currentView === 'search') this._render();
  },

  setDatePreset(preset) {
    this._datePreset = this._datePreset === preset ? null : preset;
    document.querySelectorAll('.srch-date-pill').forEach(b =>
      b.classList.toggle('on', b.dataset.preset === this._datePreset)
    );
    const customPanel = $('srch-date-custom');
    if (customPanel) customPanel.style.display = this._datePreset === 'custom' ? 'flex' : 'none';
    if (this._datePreset !== 'custom') { this._dateFrom = null; this._dateTo = null; }
    this._render();
  },

  setCustomRange(from, to) {
    this._dateFrom = from || null;
    this._dateTo   = to   || null;
    this._render();
  },

  setTech(tech) {
    this._tech = this._tech === tech ? null : tech;
    document.querySelectorAll('.srch-tech-pill').forEach(b =>
      b.classList.toggle('on', b.dataset.v === this._tech)
    );
    this._render();
  },

  setTipo(tipo) {
    this._tipo = this._tipo === tipo ? null : tipo;
    document.querySelectorAll('.srch-tipo-pill').forEach(b =>
      b.classList.toggle('on', b.dataset.v === this._tipo)
    );
    this._render();
  },

  setClientQ(q) {
    this._clientQ = q;
    this._render();
  },

  // Esporta i risultati correnti (filtri inclusi) in iCalendar.
  exportIcs() {
    App.exportIcs(this._applyFilters(App.interventions || []), 'interventi.ics');
  },

  reset() {
    this._q = '';
    this._clientQ = '';
    this._tech = null;
    this._tipo = null;
    this._datePreset = null;
    this._dateFrom = null;
    this._dateTo = null;
    const globalInp = $('global-search-input');
    if (globalInp) globalInp.value = '';
    const clientInp = $('srch-client-input');
    if (clientInp) clientInp.value = '';
    const fromInp = $('srch-date-from');
    if (fromInp) fromInp.value = '';
    const toInp = $('srch-date-to');
    if (toInp) toInp.value = '';
    const customPanel = $('srch-date-custom');
    if (customPanel) customPanel.style.display = 'none';
    this._populateFilters();
    this._render();
  },

  _populateFilters() {
    const items = App.interventions || [];

    // Tech pills — union of dropdown sigla + unique tecnici in items
    const techEl = $('srch-tech-pills');
    if (techEl) {
      const fromDD = App._dropdownData?.sigla || [];
      const fromItems = [...new Set(items.map(i => i.nome_tecnico).filter(Boolean))];
      const all = [...new Set([...fromItems, ...fromDD])].sort();
      techEl.innerHTML = all.length
        ? all.map(t =>
            `<button class="srch-pill srch-tech-pill${this._tech === t ? ' on' : ''}"
              data-v="${t}" onclick="Search.setTech(${JSON.stringify(t)})">${t}</button>`
          ).join('')
        : '<span style="font-size:11px;color:var(--text-3)">—</span>';
    }

    // Tipo pills — unique descrizione from items (up to 10)
    const tipoEl = $('srch-tipo-pills');
    if (tipoEl) {
      const all = [...new Set(items.map(i => i.descrizione).filter(Boolean))].sort().slice(0, 10);
      tipoEl.innerHTML = all.length
        ? all.map(t =>
            `<button class="srch-pill srch-tipo-pill${this._tipo === t ? ' on' : ''}"
              data-v="${t}" onclick="Search.setTipo(${JSON.stringify(t)})"
              title="${t}">${t.length > 22 ? t.slice(0, 20) + '…' : t}</button>`
          ).join('')
        : '<span style="font-size:11px;color:var(--text-3)">—</span>';
    }

    // Date preset active state
    document.querySelectorAll('.srch-date-pill').forEach(b =>
      b.classList.toggle('on', b.dataset.preset === this._datePreset)
    );
  },

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

  _applyFilters(items) {
    const q = this._q.toLowerCase().trim();
    const cq = this._clientQ.toLowerCase().trim();

    return items.filter(item => {
      if (q) {
        const hay = [
          item.ragione_sociale, item.descrizione, item.altro,
          item.nome_tecnico, item.tipo_tariffa, item.tipo_fatturazione,
          item.subject,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (cq && !(item.ragione_sociale || '').toLowerCase().includes(cq)) return false;
      if (this._tech && item.nome_tecnico !== this._tech) return false;
      if (this._tipo && item.descrizione !== this._tipo) return false;
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
      list.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--text-3);font-size:12px">
        Nessun intervento trovato.<br>Prova a cambiare i filtri o la ricerca.
      </div>`;
      return;
    }

    const colors = ['var(--cat-1)','var(--cat-2)','var(--cat-3)','var(--cat-4)','var(--cat-5)','var(--cat-6)','var(--cat-7)','var(--cat-8)'];
    const colorOf = s => { let h = 0; for (const c of (s || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return colors[h % colors.length]; };

    list.innerHTML = items.map(item => {
      const color = colorOf(item.nome_tecnico);
      const cliente = this._hl(item.ragione_sociale || '—', q);
      const tipo    = this._hl(item.descrizione || '', q);
      const altro   = item.altro ? this._hl(item.altro, q) : '';
      const dt      = item.start_dt ? fmtDT(item.start_dt) : '—';
      return `<div class="iv-card" tabindex="0" role="button" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.showDetail(${escHtml(JSON.stringify(item))})}" onclick="App.showDetail(${escHtml(JSON.stringify(item))})">
        <div class="iv-bar" style="background:${color}"></div>
        <div class="iv-body">
          <div class="iv-top">
            <div class="iv-sigla" style="background:color-mix(in oklch, ${color} 18%, transparent);color:${color}">${item.nome_tecnico || '—'}</div>
            <div class="iv-cliente">${cliente}</div>
          </div>
          <div class="iv-meta">
            ${tipo ? `<span>${tipo}</span>` : ''}
            ${item.tipo_tariffa ? `<span style="color:var(--text-3)">${item.tipo_tariffa}</span>` : ''}
            ${altro ? `<span style="color:var(--text-3);font-style:italic">${altro}</span>` : ''}
          </div>
        </div>
        <div style="padding:10px 12px;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:4px">
          <div class="iv-time">${dt}</div>
          ${item.durata ? `<div style="font-size:10px;color:var(--text-3)">${item.durata}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  },
};
