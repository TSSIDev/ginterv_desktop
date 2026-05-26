// calendar.js — week / day / month calendar views

const Calendar = (() => {
  const H_S = 7, H_E = 20, H_PX = 64;
  const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const MONTHS_S = MONTHS.map(m => m.slice(0,3));
  const DOW = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];

  const PALETTE = ['#5b9cf6','#7ee8a2','#ffc77a','#bb9af7','#e99b8b','#6ed7d1','#ef7d82','#f8c76a'];
  function colorOf(sigla) {
    let h = 0;
    for (const c of (sigla || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return PALETTE[h % PALETTE.length];
  }

  const pad = n => String(n).padStart(2,'0');
  function hm(h, m) { return `${pad(h)}:${pad(m)}`; }
  function minHM(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
  }
  function getMon(d) {
    const r = new Date(d); r.setHours(0,0,0,0);
    const day = r.getDay(), diff = day === 0 ? -6 : 1 - day;
    r.setDate(r.getDate() + diff); return r;
  }
  function addD(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function sameD(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }
  function isoDay(d) { return d.toISOString().slice(0,10); }
  function parseISO(s) { return s ? new Date(s) : null; }

  // state
  let currentView = 'week';
  let today = new Date(); today.setHours(0,0,0,0);
  let weekStart = getMon(today);
  let currentDay = new Date(today);
  let miniDate = new Date(today.getFullYear(), today.getMonth(), 1);
  let techFilter = 'all';
  let selectedItem = null;

  function getItems() { return (typeof App !== 'undefined' && App.interventions) || []; }

  // Convert InterventionItem to display object
  function itemToDisplay(item) {
    const start = parseISO(item.start_dt);
    const end = parseISO(item.end_dt);
    if (!start) return null;
    const dur = end ? Math.round((end - start) / 60000) : 60;
    return {
      _raw: item,
      sigla: item.nome_tecnico || '?',
      client: item.ragione_sociale || '—',
      tipo: item.descrizione || '',
      color: colorOf(item.nome_tecnico),
      startD: start,
      sh: start.getHours(),
      sm: start.getMinutes(),
      dur,
      firmato: false,
      exchange_item_id: item.exchange_item_id,
      change_key: item.change_key,
    };
  }

  function getDisplayItems() {
    return getItems().map(itemToDisplay).filter(Boolean);
  }

  function getFilteredItems() {
    const all = getDisplayItems();
    return techFilter === 'all' ? all : all.filter(i => i.sigla === techFilter);
  }

  // ── Render helpers ───────────────────────────────────────────────────

  function renderRangeLabel() {
    let text = '';
    if (currentView === 'week') {
      const e = addD(weekStart, 6);
      const sm = weekStart.getMonth(), em = e.getMonth();
      text = sm === em
        ? `${weekStart.getDate()}–${e.getDate()} ${MONTHS[em]} ${e.getFullYear()}`
        : `${weekStart.getDate()} ${MONTHS_S[sm]} – ${e.getDate()} ${MONTHS_S[em]} ${e.getFullYear()}`;
    } else if (currentView === 'day') {
      text = `${DOW[currentDay.getDay()]} ${currentDay.getDate()} ${MONTHS[currentDay.getMonth()]} ${currentDay.getFullYear()}`;
    } else {
      text = `${MONTHS[miniDate.getMonth()]} ${miniDate.getFullYear()}`;
    }
    const el = document.getElementById('cal-range-lbl');
    if (el) el.textContent = text;
  }

  function renderMini() {
    const y = miniDate.getFullYear(), mo = miniDate.getMonth();
    const titleEl = document.getElementById('cal-mini-title');
    if (titleEl) titleEl.textContent = `${MONTHS_S[mo]} ${y}`;
    const grid = document.getElementById('cal-mini-grid');
    if (!grid) return;
    const fd = (new Date(y, mo, 1).getDay() + 6) % 7;
    const dm = new Date(y, mo + 1, 0).getDate();
    const pd = new Date(y, mo, 0).getDate();
    const dows = ['L','M','M','G','V','S','D'];
    let h = dows.map(d => `<div class="mc-dow">${d}</div>`).join('');
    for (let i = 0; i < fd; i++) h += `<div class="mc-day dim">${pd - fd + 1 + i}</div>`;
    for (let d = 1; d <= dm; d++) {
      const dt = new Date(y, mo, d);
      const isT = sameD(dt, today);
      let inW = false, ws = false, we = false, isSel = false;
      if (currentView === 'week') {
        const wEnd = addD(weekStart, 6);
        inW = dt >= weekStart && dt <= wEnd;
        ws = sameD(dt, weekStart);
        we = sameD(dt, wEnd);
      } else if (currentView === 'day') {
        isSel = sameD(dt, currentDay);
      }
      let cls = 'mc-day';
      if (isT && inW) cls += ' today in-week';
      else if (isT)   cls += ' today';
      else if (inW)   cls += ' in-week';
      if (ws && !isT) cls += ' ws';
      if (we && !isT) cls += ' we';
      if (isSel && !isT) cls += ' sel-day';
      h += `<div class="${cls}" onclick="Calendar._miniClick(${dt.getTime()})">${d}</div>`;
    }
    const rem = 7 * Math.ceil((fd + dm) / 7) - (fd + dm);
    for (let i = 1; i <= rem; i++) h += `<div class="mc-day dim">${i}</div>`;
    grid.innerHTML = h;
  }

  function renderSidebar() {
    const el = document.getElementById('sidebar-accounts');
    if (!el) return;

    const items = getFilteredItems();
    const allItems = getDisplayItems();

    // Collect unique siglas for tech filter
    const siglaMap = {};
    allItems.forEach(i => { siglaMap[i.sigla] = (siglaMap[i.sigla] || 0) + 1; });
    const siglas = Object.keys(siglaMap).sort();

    const totalVisible = items.length;
    const allOnscreen = allItems.length;

    // Stats for current period
    let periodLabel = '', statsItems = [];
    if (currentView === 'week') {
      const ws2 = weekStart, we2 = addD(weekStart, 6);
      we2.setHours(23,59,59);
      statsItems = allItems.filter(i => i.startD >= ws2 && i.startD <= we2);
      periodLabel = 'Questa settimana';
    } else if (currentView === 'day') {
      statsItems = allItems.filter(i => sameD(i.startD, currentDay));
      periodLabel = 'Oggi';
    } else {
      const y = miniDate.getFullYear(), mo = miniDate.getMonth();
      statsItems = allItems.filter(i => i.startD.getFullYear() === y && i.startD.getMonth() === mo);
      periodLabel = `${MONTHS_S[mo]} ${y}`;
    }
    const totalHrs = statsItems.reduce((s, i) => s + i.dur, 0);

    el.innerHTML = `
      <div class="sb-section" style="padding:10px 13px 8px">
        <div class="mc-head">
          <button class="mc-nav" onclick="Calendar._miniNav(-1)">‹</button>
          <div class="mc-title" id="cal-mini-title"></div>
          <button class="mc-nav" onclick="Calendar._miniNav(1)">›</button>
        </div>
        <div class="mc-grid" id="cal-mini-grid"></div>
      </div>
      <div class="sb-section" style="padding:10px 13px 8px">
        <div class="sb-lbl">Tecnici</div>
        <div class="tech-list">
          <div class="tech-row ${techFilter === 'all' ? 'on' : ''}" onclick="Calendar._setTech('all',this)">
            <div class="tech-av" style="background:var(--bg-elev);color:var(--text-2)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div class="tech-name">Tutti i tecnici</div>
            <div class="tech-cnt">${allOnscreen}</div>
          </div>
          ${siglas.map(s => `
            <div class="tech-row ${techFilter === s ? 'on' : ''}" onclick="Calendar._setTech(${JSON.stringify(s)},this)">
              <div class="tech-av" style="background:${colorOf(s)};color:#111">${s}</div>
              <div class="tech-name">${s}</div>
              <div class="tech-cnt">${siglaMap[s]}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="sb-section" style="padding:10px 13px 8px">
        <div class="sb-lbl">${periodLabel}</div>
        <div class="stat-row"><div class="stat-lbl">Interventi</div><div class="stat-val b">${statsItems.length}</div></div>
        <div class="stat-row"><div class="stat-lbl">Ore totali</div><div class="stat-val b">${minHM(totalHrs)}</div></div>
      </div>`;
    renderMini();
  }

  // ── Week view ────────────────────────────────────────────────────────

  function renderWeek() {
    const nH = H_E - H_S, tot = nH * H_PX;
    const items = getFilteredItems();

    // Header
    let head = '<div class="wk-gutter"></div>';
    for (let i = 0; i < 7; i++) {
      const d = addD(weekStart, i), isT = sameD(d, today);
      head += `<div class="wk-dh${isT ? ' today' : ''}" onclick="Calendar._dayClick(${d.getTime()})">
        <div class="wkh-dow">${DOW[d.getDay()]}</div>
        <div class="wkh-num">${d.getDate()}</div>
      </div>`;
    }
    document.getElementById('cal-wk-head').innerHTML = head;

    // Grid
    let lbls = '';
    for (let h = H_S; h <= H_E; h++)
      lbls += `<div class="tg-lbl" style="height:${H_PX}px">${h < H_E ? hm(h, 0) : ''}</div>`;

    let days = '';
    for (let d = 0; d < 7; d++) {
      const date = addD(weekStart, d);
      const dayItems = items.filter(i => sameD(i.startD, date));

      let lines = '';
      for (let h = 0; h < nH; h++) {
        lines += `<div class="h-line" style="top:${h * H_PX}px"></div>
        <div class="q-line" style="top:${h * H_PX + H_PX * .25}px"></div>
        <div class="hh-line" style="top:${h * H_PX + H_PX * .5}px"></div>
        <div class="q-line" style="top:${h * H_PX + H_PX * .75}px"></div>`;
      }

      let blocks = '';
      dayItems.forEach(iv => {
        const top = ((iv.sh - H_S) + iv.sm / 60) * H_PX + 2;
        const ht = Math.max((iv.dur / 60) * H_PX - 4, 20);
        const isSel = selectedItem?.exchange_item_id === iv.exchange_item_id;
        const endMin = iv.sh * 60 + iv.sm + iv.dur;
        const sig = iv.firmato ? '✓' : '·';
        blocks += `<div class="iv${isSel ? ' sel' : ''}" style="color:${iv.color};border-color:${iv.color};top:${top}px;height:${ht}px"
          onclick="Calendar._select(${JSON.stringify(JSON.stringify(iv._raw))})">
          <div class="iv-t">${hm(iv.sh, iv.sm)} – ${hm(Math.floor(endMin/60), endMin%60)}</div>
          <div class="iv-c">${iv.client}</div>
          ${ht > 44 ? `<div class="iv-tp">${iv.tipo}</div>` : ''}
          <div class="iv-s">${sig}</div>
        </div>`;
      });

      let nowLine = '';
      if (sameD(date, today)) {
        const n = new Date(), h = n.getHours(), m = n.getMinutes();
        if (h >= H_S && h < H_E)
          nowLine = `<div class="now-line" style="top:${((h - H_S) + m / 60) * H_PX}px"></div>`;
      }

      days += `<div class="day-col" style="height:${tot}px">${lines}${blocks}${nowLine}</div>`;
    }

    const inner = document.getElementById('cal-tgrid-inner');
    inner.innerHTML = `<div class="tgrid-lbls">${lbls}</div><div class="tgrid-days">${days}</div>`;

    const wrap = document.getElementById('cal-tgrid-wrap');
    if (wrap && !wrap.dataset.sc) { wrap.scrollTop = (8 - H_S) * H_PX; wrap.dataset.sc = '1'; }
  }

  // ── Day view ─────────────────────────────────────────────────────────

  function renderDay() {
    const nH = H_E - H_S, tot = nH * H_PX;
    const items = getFilteredItems().filter(i => sameD(i.startD, currentDay));

    // Collect unique siglas for this day
    const daySiglas = [...new Set(items.map(i => i.sigla))].sort();
    if (!daySiglas.length) daySiglas.push('—');

    // Header
    let head = '<div class="day-gutter"></div>';
    daySiglas.forEach(s => {
      head += `<div class="day-tech-col">
        <div class="dtc-sig" style="color:${colorOf(s)}">${s}</div>
        <div class="dtc-name">${s}</div>
      </div>`;
    });
    document.getElementById('cal-day-head').innerHTML = head;

    // Grid
    let lbls = '';
    for (let h = H_S; h <= H_E; h++)
      lbls += `<div class="tg-lbl" style="height:${H_PX}px">${h < H_E ? hm(h, 0) : ''}</div>`;

    let cols = '';
    daySiglas.forEach(s => {
      const colItems = items.filter(i => i.sigla === s);
      let lines = '';
      for (let h = 0; h < nH; h++) {
        lines += `<div class="h-line" style="top:${h * H_PX}px"></div>
        <div class="hh-line" style="top:${h * H_PX + H_PX * .5}px"></div>`;
      }
      let blocks = '';
      colItems.forEach(iv => {
        const top = ((iv.sh - H_S) + iv.sm / 60) * H_PX + 2;
        const ht = Math.max((iv.dur / 60) * H_PX - 4, 24);
        const endMin = iv.sh * 60 + iv.sm + iv.dur;
        const isSel = selectedItem?.exchange_item_id === iv.exchange_item_id;
        blocks += `<div class="day-iv${isSel ? ' sel' : ''}" style="color:${iv.color};border-color:${iv.color};top:${top}px;height:${ht}px"
          onclick="Calendar._select(${JSON.stringify(JSON.stringify(iv._raw))})">
          <div class="div-time">${hm(iv.sh, iv.sm)} – ${hm(Math.floor(endMin/60), endMin%60)}</div>
          <div class="div-client">${iv.client}</div>
          ${ht > 50 ? `<div class="div-tipo">${iv.tipo}</div>` : ''}
        </div>`;
      });
      let nowLine = '';
      const n = new Date(), h = n.getHours(), m = n.getMinutes();
      if (sameD(currentDay, today) && h >= H_S && h < H_E)
        nowLine = `<div class="now-line" style="top:${((h - H_S) + m / 60) * H_PX}px"></div>`;
      cols += `<div class="day-col" style="height:${tot}px">${lines}${blocks}${nowLine}</div>`;
    });

    const inner = document.getElementById('cal-day-inner');
    inner.innerHTML = `<div class="tgrid-lbls">${lbls}</div><div class="tgrid-days">${cols}</div>`;

    const wrap = document.getElementById('cal-day-wrap');
    if (wrap && !wrap.dataset.sc) { wrap.scrollTop = (8 - H_S) * H_PX; wrap.dataset.sc = '1'; }
  }

  // ── Month view ───────────────────────────────────────────────────────

  function renderMonth() {
    const y = miniDate.getFullYear(), mo = miniDate.getMonth();

    // Day-of-week header
    const dows = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
    document.getElementById('cal-mth-head').innerHTML =
      dows.map(d => `<div class="mth-dow-hdr">${d}</div>`).join('');

    const fd = (new Date(y, mo, 1).getDay() + 6) % 7;
    const dm = new Date(y, mo + 1, 0).getDate();
    const pd = new Date(y, mo, 0).getDate();
    const items = getFilteredItems();

    const cellCount = 7 * Math.ceil((fd + dm) / 7);
    let cells = '';

    for (let ci = 0; ci < cellCount; ci++) {
      let d, isDim = false;
      if (ci < fd) { d = new Date(y, mo - 1, pd - fd + 1 + ci); isDim = true; }
      else if (ci >= fd + dm) { d = new Date(y, mo + 1, ci - fd - dm + 1); isDim = true; }
      else { d = new Date(y, mo, ci - fd + 1); }

      const isT = sameD(d, today);
      const dayItems = items.filter(i => sameD(i.startD, d));
      const MAX_PILLS = 3;

      let pills = '';
      dayItems.slice(0, MAX_PILLS).forEach(iv => {
        pills += `<div class="mth-pill" style="color:${iv.color}"
          onclick="event.stopPropagation();Calendar._select(${JSON.stringify(JSON.stringify(iv._raw))})">
          <div class="mth-pill-txt">${iv.client}</div>
        </div>`;
      });
      if (dayItems.length > MAX_PILLS)
        pills += `<div class="mth-more">+${dayItems.length - MAX_PILLS} altri</div>`;

      let cls = 'mth-cell';
      if (isDim) cls += ' dim';
      else if (isT) cls += ' today';

      cells += `<div class="${cls}" onclick="Calendar._monthDayClick(${d.getTime()})">
        <div class="mth-dnum">${d.getDate()}</div>${pills}
      </div>`;
    }
    document.getElementById('cal-mth-grid').innerHTML = cells;
  }

  // ── Detail panel ─────────────────────────────────────────────────────

  function renderDetail(item) {
    const empty = document.getElementById('detail-empty');
    const fill = document.getElementById('detail-fill');
    if (!item) {
      if (empty) empty.style.display = 'flex';
      if (fill) { fill.style.display = 'none'; fill.innerHTML = ''; }
      return;
    }
    if (empty) empty.style.display = 'none';
    if (!fill) return;
    fill.style.cssText = 'display:flex;flex:1;overflow:hidden;flex-direction:column';

    const start = parseISO(item.start_dt);
    const end = parseISO(item.end_dt);
    const dur = end && start ? Math.round((end - start) / 60000) : 0;
    const color = colorOf(item.nome_tecnico);
    const startStr = start ? `${hm(start.getHours(), start.getMinutes())}` : '—';
    const endStr = end ? `${hm(end.getHours(), end.getMinutes())}` : '';
    const dateStr = start ? `${DOW[start.getDay()]} ${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}` : '—';

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
        ${dur ? `<div class="df"><div class="df-lbl">Orario</div><div class="df-val mono">${startStr}${endStr ? ' → ' + endStr : ''} (${minHM(dur)})</div></div>` : ''}
        ${item.tipo_fatturazione ? `<div class="df"><div class="df-lbl">Addebito</div><div class="df-val">${item.tipo_fatturazione}</div></div>` : ''}
        ${item.trasferta ? `<div class="df"><div class="df-lbl">Trasferta</div><div class="df-val">${item.trasferta}</div></div>` : ''}
        ${item.body_html ? `<div class="df"><div class="df-lbl">Note</div><div class="note-box">${item.body_html}</div></div>` : ''}
      </div>
      <div class="detail-ftr">
        <div class="act-row">
          <button class="abtn prime" onclick="App.editItem(${JSON.stringify(JSON.stringify(item))})">Modifica</button>
          <button class="abtn" onclick="App.openPdfModal(${JSON.stringify(JSON.stringify(item))})">PDF</button>
        </div>
        <div class="act-row">
          <button class="abtn" onclick="App.openEmailModal(${JSON.stringify(JSON.stringify(item))})">Email</button>
          <button class="abtn" onclick="App.openFirmaModal(${JSON.stringify(JSON.stringify(item))})">Firma</button>
        </div>
        <div class="act-row">
          <button class="abtn danger" onclick="App.confirmDelete(${JSON.stringify(JSON.stringify(item))})">Elimina</button>
          <button class="abtn" onclick="Calendar._deselect()">Chiudi</button>
        </div>
      </div>`;
  }

  // ── Month detail: day list ────────────────────────────────────────────

  function renderMonthDayDetail(date) {
    const items = getFilteredItems().filter(i => sameD(i.startD, date));
    const empty = document.getElementById('detail-empty');
    const fill = document.getElementById('detail-fill');
    if (empty) empty.style.display = 'none';
    if (!fill) return;
    fill.style.cssText = 'display:flex;flex:1;overflow:hidden;flex-direction:column';

    const dateStr = `${DOW[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
    fill.innerHTML = `
      <div class="detail-head">
        <div class="dh-eye">${dateStr}</div>
        <div class="dh-client" style="font-size:13px;font-weight:700">${items.length} interventi</div>
      </div>
      <div class="detail-body fade-up">
        <div class="day-list">
          ${items.map(iv => {
            const endMin = iv.sh * 60 + iv.sm + iv.dur;
            return `<div class="day-list-item" style="color:${iv.color};border-color:${iv.color}"
              onclick="App.showDetail(${JSON.stringify(JSON.stringify(iv._raw))})">
              <div class="dli-time">${hm(iv.sh, iv.sm)} – ${hm(Math.floor(endMin/60), endMin%60)} · ${iv.sigla}</div>
              <div class="dli-client">${iv.client}</div>
              <div class="dli-tipo">${iv.tipo || '—'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="detail-ftr">
        <button class="btn primary" style="width:100%;justify-content:center"
          onclick="App.navigate('new')">+ Nuovo intervento</button>
      </div>`;
  }

  // ── Public API ───────────────────────────────────────────────────────

  function renderAll() {
    renderRangeLabel();
    renderSidebar();
    if (currentView === 'week') {
      document.getElementById('cal-week-view').style.display = 'flex';
      document.getElementById('cal-day-view').style.display = 'none';
      document.getElementById('cal-month-view').style.display = 'none';
      renderWeek();
    } else if (currentView === 'day') {
      document.getElementById('cal-week-view').style.display = 'none';
      document.getElementById('cal-day-view').style.display = 'flex';
      document.getElementById('cal-month-view').style.display = 'none';
      renderDay();
    } else {
      document.getElementById('cal-week-view').style.display = 'none';
      document.getElementById('cal-day-view').style.display = 'none';
      document.getElementById('cal-month-view').style.display = 'flex';
      renderMonth();
    }
  }

  return {
    onNavigate() {
      // Load interventions if needed then render
      const primary = App.accounts && (App.accounts.find(a => a.is_primary) || App.accounts[0]);
      if (primary && (!App.interventions || !App.interventions.length)) {
        App.loadInterventions().then(() => renderAll());
      } else {
        renderAll();
      }
    },

    nav(delta) {
      if (currentView === 'week') {
        weekStart = addD(weekStart, delta * 7);
        miniDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
      } else if (currentView === 'day') {
        currentDay = addD(currentDay, delta);
        miniDate = new Date(currentDay.getFullYear(), currentDay.getMonth(), 1);
      } else {
        miniDate = new Date(miniDate.getFullYear(), miniDate.getMonth() + delta, 1);
      }
      selectedItem = null;
      renderDetail(null);
      renderAll();
    },

    goToday() {
      today = new Date(); today.setHours(0,0,0,0);
      weekStart = getMon(today);
      currentDay = new Date(today);
      miniDate = new Date(today.getFullYear(), today.getMonth(), 1);
      selectedItem = null;
      renderDetail(null);
      renderAll();
    },

    setView(view, btn) {
      currentView = view;
      document.querySelectorAll('#view-calendar .vsbtn').forEach(b => b.classList.remove('on'));
      if (btn) btn.classList.add('on');
      if (view === 'day' && !currentDay) currentDay = new Date(today);
      selectedItem = null;
      renderDetail(null);
      renderAll();
    },

    _miniNav(delta) {
      miniDate = new Date(miniDate.getFullYear(), miniDate.getMonth() + delta, 1);
      renderMini();
    },

    _miniClick(ts) {
      const d = new Date(ts); d.setHours(0,0,0,0);
      if (currentView === 'week') {
        weekStart = getMon(d);
      } else if (currentView === 'day') {
        currentDay = d;
      } else {
        miniDate = new Date(d.getFullYear(), d.getMonth(), 1);
      }
      selectedItem = null;
      renderDetail(null);
      renderAll();
    },

    _dayClick(ts) {
      currentDay = new Date(ts); currentDay.setHours(0,0,0,0);
      currentView = 'day';
      document.querySelectorAll('#view-calendar .vsbtn').forEach((b, i) => b.classList.toggle('on', i === 1));
      selectedItem = null;
      renderDetail(null);
      renderAll();
    },

    _monthDayClick(ts) {
      const d = new Date(ts); d.setHours(0,0,0,0);
      const dayItems = getFilteredItems().filter(i => sameD(i.startD, d));
      if (dayItems.length === 1) {
        App.showDetail(dayItems[0]._raw);
      } else {
        renderMonthDayDetail(d);
      }
    },

    _select(itemJson) {
      const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
      selectedItem = item;
      App.showDetail(item);
      // Re-render to update selected state
      if (currentView === 'week') renderWeek();
      else if (currentView === 'day') renderDay();
    },

    _deselect() {
      selectedItem = null;
      App.clearDetail();
      if (currentView === 'week') renderWeek();
      else if (currentView === 'day') renderDay();
    },

    _setTech(sigla, row) {
      techFilter = sigla;
      renderAll();
    },

    refresh() { renderAll(); },
  };
})();
