// calendar.js — week / day / month calendar views

const Calendar = (() => {
  const H_S = 0, H_E = 24, H_PX = 96;
  const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const MONTHS_S = MONTHS.map(m => m.slice(0,3));
  const DOW = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];

  const PALETTE = ['var(--cat-1)','var(--cat-2)','var(--cat-3)','var(--cat-4)','var(--cat-5)','var(--cat-6)','var(--cat-7)','var(--cat-8)'];
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
  function isoDay(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function parseISO(s) { return s ? new Date(s) : null; }

  // state
  let currentView = 'day';
  let today = new Date(); today.setHours(0,0,0,0);
  let weekStart = getMon(today);
  let currentDay = new Date(today);
  let miniDate = new Date(today.getFullYear(), today.getMonth(), 1);
  let techFilter = 'all';
  let selectedItem = null;

  // Drag-to-create state
  let _drag = null;
  let _pendingCreate = null;

  // Drag-to-expand (resize) state
  let _resize = null;
  let _suppressClick = false; // swallow the click that follows a resize

  function _yToTime(relY, round = false) {
    const colH = (H_E - H_S) * H_PX;
    const slots = Math.max(0, Math.min(1, relY / colH)) * (H_E - H_S) * 60 / 15;
    const totalMin = (round ? Math.round(slots) : Math.floor(slots)) * 15;
    const absMin = H_S * 60 + totalMin;
    return [Math.min(Math.floor(absMin / 60), H_E - 1), absMin % 60];
  }

  function _onDragMove(e) {
    if (!_drag) return;
    const [eh, em] = _yToTime(e.clientY - _drag.rect.top, true);
    const startTot = (_drag.sh - H_S) * 60 + _drag.sm;
    const endTot   = (eh  - H_S) * 60 + em;
    const topPx = startTot * H_PX / 60;
    const htPx  = Math.max(H_PX / 4, (endTot - startTot) * H_PX / 60);
    if (endTot >= startTot) {
      _drag.ghost.style.top    = topPx + 'px';
      _drag.ghost.style.height = htPx  + 'px';
      _drag.curH = eh; _drag.curM = em;
    }
  }

  function _onDragUp(e) {
    if (!_drag) return;
    document.removeEventListener('mousemove', _onDragMove);
    document.removeEventListener('mouseup', _onDragUp);
    const { isoDate, sh, sm, curH, curM, ghost } = _drag;
    ghost.remove();
    _drag = null;
    const dragged = !(curH === sh && curM === sm);
    // Plain click on empty grid: if an event is selected, just deselect it
    // (don't assume the user wants to create). Only create when nothing is
    // selected, or when the user actually dragged out a time range.
    if (!dragged && selectedItem) {
      selectedItem = null;
      App.clearDetail();
      if (currentView === 'week') renderWeek();
      else if (currentView === 'day') renderDay();
      return;
    }
    let eh = curH, em = curM;
    if (eh === sh && em === sm) { eh = Math.min(sh + 1, H_E - 1); }
    _showCreateModal(isoDate, sh, sm, eh, em, e.clientX, e.clientY);
  }

  function _showCreateModal(isoDate, sh, sm, eh, em, cx, cy) {
    _dismissCreateModal();
    _pendingCreate = { isoDate, sh, sm, eh, em };
    const d = new Date(isoDate + 'T00:00:00');
    const dateStr = `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const timeStr = `${hm(sh, sm)} – ${hm(eh, em)}`;
    const info = $('cal-cm-info');
    if (info) info.innerHTML = `<div class="cal-cm-date">${dateStr}</div><div class="cal-cm-time">${timeStr}</div>`;
    const modal = $('cal-create-modal');
    if (!modal) return;
    modal.classList.remove('hidden', 'closing');
    const mw = 230, mh = 130;
    modal.style.left = Math.min(cx + 10, window.innerWidth  - mw - 8) + 'px';
    modal.style.top  = Math.max(8, Math.min(cy - mh / 2, window.innerHeight - mh - 8)) + 'px';
    setTimeout(() => document.addEventListener('mousedown', _onCreateOutsideDown, true), 0);
  }

  function _onCreateOutsideDown(e) {
    const modal = $('cal-create-modal');
    if (!modal || modal.classList.contains('hidden') || modal.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    _dismissCreateModal();
  }

  function _dismissCreateModal() {
    document.removeEventListener('mousedown', _onCreateOutsideDown, true);
    closeOverlay('cal-create-modal');
    _pendingCreate = null;
  }

  // ── Drag-to-expand (resize bottom edge → change duration) ─────────────

  function _onResizeMove(e) {
    if (!_resize) return;
    const [yh, ym] = _yToTime(e.clientY - _resize.rect.top, true); // snapped to 15 min
    const yTop = (yh - H_S) * 60 + ym;                              // minutes from grid top
    if (_resize.edge === 'bottom') {
      // End edge: keep start, clamp end to [start+15, end of grid].
      const maxEnd = (H_E - H_S) * 60;
      _resize.newEndTop = Math.min(maxEnd, Math.max(_resize.startTop + 15, yTop));
    } else {
      // Start edge: keep end, clamp start to [grid top, end-15].
      _resize.newStartTop = Math.max(0, Math.min(_resize.endTop - 15, yTop));
    }
    const sTop = _resize.edge === 'top' ? _resize.newStartTop : _resize.startTop;
    const eTop = _resize.edge === 'bottom' ? _resize.newEndTop : _resize.endTop;
    _resize.block.style.top = (sTop / 60) * H_PX + 2 + 'px';
    _resize.block.style.height = Math.max((eTop - sTop) / 60 * H_PX - 4, 18) + 'px';
    _updateResizeBubble(e, sTop, eTop);
  }

  // Small bubble near the cursor showing the dragged edge's time + duration.
  function _updateResizeBubble(e, sTop, eTop) {
    const b = _resize.bubble;
    if (!b) return;
    const edgeMin = H_S * 60 + (_resize.edge === 'bottom' ? eTop : sTop);
    b.textContent = `${hm(Math.floor(edgeMin / 60), edgeMin % 60)} · ${minHM(eTop - sTop)}`;
    let x = e.clientX + 14, y = e.clientY - 12;
    x = Math.min(x, window.innerWidth - b.offsetWidth - 6);
    y = Math.max(6, Math.min(y, window.innerHeight - b.offsetHeight - 6));
    b.style.left = x + 'px';
    b.style.top = y + 'px';
  }

  function _onResizeUp() {
    if (!_resize) return;
    document.removeEventListener('mousemove', _onResizeMove);
    document.removeEventListener('mouseup', _onResizeUp);
    document.body.classList.remove('cal-resizing');
    const r = _resize;
    if (r.bubble) r.bubble.remove();
    _resize = null;
    _suppressClick = true;
    setTimeout(() => { _suppressClick = false; }, 300); // self-heal if no click fires

    const changed = r.edge === 'bottom'
      ? r.newEndTop !== r.origEndTop
      : r.newStartTop !== r.origStartTop;
    if (!changed) {
      if (currentView === 'week') renderWeek(); else renderDay();
      return;
    }
    // Build grid-aligned dates from the day's H_S baseline.
    const dayBase = new Date(r.startD); dayBase.setHours(H_S, 0, 0, 0);
    const at = (topMin) => new Date(dayBase.getTime() + topMin * 60000);
    const newStart = r.edge === 'top' ? at(r.newStartTop) : r.startD;
    const newEnd   = r.edge === 'bottom' ? at(r.newEndTop) : r.endD;
    _saveResize(r.item, newStart, newEnd);
  }

  async function _saveResize(item, newStart, newEnd) {
    const primary = App.accounts && (App.accounts.find(a => a.is_primary) || App.accounts[0]);
    const email = primary?.email || '';
    const local = getItems().find(i => i.exchange_item_id === item.exchange_item_id);
    const prev = local ? { start: local.start_dt, end: local.end_dt } : null;
    // Optimistic: show the new geometry immediately.
    if (local) { local.start_dt = newStart.toISOString(); local.end_dt = newEnd.toISOString(); }
    if (currentView === 'week') renderWeek(); else renderDay();

    const data = {
      email, subject: item.subject,
      start: newStart.toISOString(), end: newEnd.toISOString(),
      body_html: item.body_html, luogo: item.luogo,
      nome_tecnico: item.nome_tecnico, ragione_sociale: item.ragione_sociale,
      descrizione: item.descrizione, altro: item.altro,
      tipo_tariffa: item.tipo_tariffa, tipo_fatturazione: item.tipo_fatturazione,
      trasferta: item.trasferta, durata: item.durata,
    };
    try {
      const updated = await invoke('update_intervention', {
        input: { email, item_id: item.exchange_item_id, change_key: item.change_key, data },
      });
      if (local && updated) {
        local.change_key = updated.change_key;
        local.start_dt = updated.start_dt;
        local.end_dt = updated.end_dt;
      }
      if (selectedItem?.exchange_item_id === item.exchange_item_id && local) {
        selectedItem = local;
        App.showDetail(local);
      }
      toast('Orario aggiornato', 'success');
    } catch (err) {
      if (local && prev) { local.start_dt = prev.start; local.end_dt = prev.end; } // revert
      toast('Errore aggiornamento: ' + err, 'error');
    }
    if (currentView === 'week') renderWeek(); else renderDay();
  }

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
      altro: item.altro || '',
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

  // ── Overlap layout ───────────────────────────────────────────────────

  function layoutItems(items) {
    // Sort: earlier start first, then longer duration first (priority to bigger)
    const sorted = [...items].sort((a, b) => {
      const aS = a.sh * 60 + a.sm, bS = b.sh * 60 + b.sm;
      return aS !== bS ? aS - bS : b.dur - a.dur;
    });

    const tracks = [];          // tracks[t] = events assigned to track t
    const evTrack = new Map();  // exchange_item_id -> track index

    for (const ev of sorted) {
      const evS = ev.sh * 60 + ev.sm, evE = evS + ev.dur;
      let placed = false;
      for (let t = 0; t < tracks.length; t++) {
        const clash = tracks[t].some(o => {
          const oS = o.sh * 60 + o.sm;
          return evS < oS + o.dur && evE > oS;
        });
        if (!clash) { tracks[t].push(ev); evTrack.set(ev.exchange_item_id, t); placed = true; break; }
      }
      if (!placed) { tracks.push([ev]); evTrack.set(ev.exchange_item_id, tracks.length - 1); }
    }

    return sorted.map(ev => {
      const evS = ev.sh * 60 + ev.sm, evE = evS + ev.dur;
      const col = evTrack.get(ev.exchange_item_id);
      let numCols = col + 1;
      for (let t = col + 1; t < tracks.length; t++) {
        if (tracks[t].some(o => { const oS = o.sh * 60 + o.sm; return evS < oS + o.dur && evE > oS; }))
          numCols = t + 1;
      }
      return { ...ev, _col: col, _numCols: numCols };
    });
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
    const el = $('cal-range-lbl');
    if (el) el.textContent = text;
  }

  function renderMini() {
    const y = miniDate.getFullYear(), mo = miniDate.getMonth();
    const titleEl = $('cal-mini-title');
    if (titleEl) titleEl.textContent = `${MONTHS_S[mo]} ${y}`;
    const grid = $('cal-mini-grid');
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
    const el = $('sidebar-accounts');
    if (!el) return;

    const allItems = getDisplayItems();

    // Collect unique siglas for tech filter
    const siglaMap = {};
    allItems.forEach(i => { siglaMap[i.sigla] = (siglaMap[i.sigla] || 0) + 1; });
    const siglas = Object.keys(siglaMap).sort();
    if (techFilter !== 'all' && !siglas.includes(techFilter)) techFilter = 'all';

    const items = getFilteredItems();
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
              <div class="tech-av" style="background:color-mix(in oklch, ${colorOf(s)} 20%, transparent);color:${colorOf(s)}">${s}</div>
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

  function syncViewButtons() {
    document.querySelectorAll('[data-cal-view]').forEach(b => {
      b.classList.toggle('on', b.dataset.calView === currentView);
    });
    if (typeof syncSeg === 'function') syncSeg(document.querySelector('#view-calendar .view-sw'));
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
    $('cal-wk-head').innerHTML = head;

    // Grid
    let lbls = '';
    for (let h = H_S; h < H_E; h++)
      lbls += `<div class="tg-lbl" style="height:${H_PX}px">${hm(h, 0)}</div>`;

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
      layoutItems(dayItems).forEach(iv => {
        const top = ((iv.sh - H_S) + iv.sm / 60) * H_PX + 2;
        const ht = Math.max((iv.dur / 60) * H_PX - 4, 20);
        const isSel = selectedItem?.exchange_item_id === iv.exchange_item_id;
        const endMin = iv.sh * 60 + iv.sm + iv.dur;
        const sig = iv.firmato ? '✓' : '·';
        const pct = 100 / iv._numCols;
        const lPct = iv._col * pct;
        const timeStr = `${hm(iv.sh, iv.sm)}–${hm(Math.floor(endMin/60), endMin%60)}`;
        const innerHtml = ht < 26
          ? `<div style="font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3"><span style="opacity:.75;font-variant-numeric:tabular-nums">${timeStr}</span> <span style="font-weight:700;color:var(--text-1)">${iv.client}</span></div>`
          : ht < 46
          ? `<div class="iv-t">${timeStr}</div><div class="iv-c" style="font-size:10px">${iv.client}${iv.altro ? `<span class="iv-tp" style="display:inline;margin-left:4px;font-weight:400"> · ${iv.altro}</span>` : ''}</div>`
          : `<div class="iv-t">${timeStr}</div><div class="iv-c">${iv.client}</div>${iv.altro ? `<div class="iv-tp" style="opacity:.85;font-weight:600">${iv.altro}</div>` : (ht > 60 && iv.tipo ? `<div class="iv-tp">${iv.tipo}</div>` : '')}<div class="iv-s">${sig}</div>`;
        const padStyle = ht < 26 ? 'padding:2px 4px' : ht < 46 ? 'padding:3px 5px' : '';
        blocks += `<div class="iv${isSel ? ' sel' : ''}" style="color:${iv.color};top:${top}px;height:${ht}px;left:${lPct.toFixed(1)}%;width:calc(${pct.toFixed(1)}% - 3px);${padStyle}"
          onclick="Calendar._select(${escHtml(JSON.stringify(iv._raw))})"
          oncontextmenu="App.openContextMenu(event,${escHtml(JSON.stringify(iv._raw))})">${innerHtml}${ht >= 44 ? `<div class="iv-resize top" onmousedown="Calendar._resizeDown(event,${escHtml(JSON.stringify(iv._raw))},'top')"></div>` : ''}<div class="iv-resize" onmousedown="Calendar._resizeDown(event,${escHtml(JSON.stringify(iv._raw))},'bottom')"></div></div>`;
      });

      let nowLine = '';
      if (sameD(date, today)) {
        const n = new Date(), h = n.getHours(), m = n.getMinutes();
        if (h >= H_S && h < H_E)
          nowLine = `<div class="now-line" style="top:${((h - H_S) + m / 60) * H_PX}px"></div>`;
      }

      days += `<div class="day-col" style="height:${tot}px" onmousedown="Calendar._colDown(event,this,'${isoDay(date)}')">${lines}${blocks}${nowLine}</div>`;
    }

    const inner = $('cal-tgrid-inner');
    inner.innerHTML = `<div class="tgrid-lbls">${lbls}</div><div class="tgrid-days">${days}</div>`;

    const wrap = $('cal-tgrid-wrap');
    if (wrap && !wrap.dataset.sc) { wrap.scrollTop = (8 - H_S) * H_PX; wrap.dataset.sc = '1'; }
  }

  // ── Day view ─────────────────────────────────────────────────────────

  function renderDay() {
    const nH = H_E - H_S, tot = nH * H_PX;
    const items = getFilteredItems().filter(i => sameD(i.startD, currentDay));

    const showTechHeader = techFilter !== 'all';
    const daySiglas = showTechHeader
      ? [...new Set(items.map(i => i.sigla))].sort()
      : ['all'];

    // Header
    const headEl = $('cal-day-head');
    if (headEl) {
      if (showTechHeader && daySiglas.length) {
        let head = '<div class="day-gutter"></div>';
        daySiglas.forEach(s => {
          head += `<div class="day-tech-col">
            <div class="dtc-sig" style="color:${colorOf(s)}">${s}</div>
            <div class="dtc-name">${s}</div>
          </div>`;
        });
        headEl.innerHTML = head;
        headEl.style.display = 'flex';
      } else {
        headEl.innerHTML = '';
        headEl.style.display = 'none';
      }
    }

    // Grid
    let lbls = '';
    for (let h = H_S; h < H_E; h++)
      lbls += `<div class="tg-lbl" style="height:${H_PX}px">${hm(h, 0)}</div>`;

    let cols = '';
    daySiglas.forEach(s => {
      const colItems = s === 'all' ? items : items.filter(i => i.sigla === s);
      let lines = '';
      for (let h = 0; h < nH; h++) {
        lines += `<div class="h-line" style="top:${h * H_PX}px"></div>
        <div class="hh-line" style="top:${h * H_PX + H_PX * .5}px"></div>`;
      }
      let blocks = '';
      layoutItems(colItems).forEach(iv => {
        const top = ((iv.sh - H_S) + iv.sm / 60) * H_PX + 2;
        const ht = Math.max((iv.dur / 60) * H_PX - 4, 24);
        const endMin = iv.sh * 60 + iv.sm + iv.dur;
        const isSel = selectedItem?.exchange_item_id === iv.exchange_item_id;
        const pct = 100 / iv._numCols;
        const lPct = iv._col * pct;
        const timeStr = `${hm(iv.sh, iv.sm)}–${hm(Math.floor(endMin/60), endMin%60)}`;
        const innerHtml = ht < 30
          ? `<div style="font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3"><span style="opacity:.75;font-variant-numeric:tabular-nums">${timeStr}</span> <span style="font-weight:800;color:var(--text-1)">${iv.client}</span></div>`
          : ht < 52
          ? `<div class="div-time">${timeStr}</div><div class="div-client" style="font-size:11px">${iv.client}${iv.altro ? `<span class="div-tipo" style="display:inline;margin-left:5px;font-weight:400"> · ${iv.altro}</span>` : ''}</div>`
          : `<div class="div-time">${timeStr}</div><div class="div-client">${iv.client}</div>${iv.altro ? `<div class="div-tipo" style="opacity:.85;font-weight:600">${iv.altro}</div>` : (ht > 68 && iv.tipo ? `<div class="div-tipo">${iv.tipo}</div>` : '')}`;
        const padStyle = ht < 30 ? 'padding:3px 6px' : ht < 52 ? 'padding:5px 8px' : '';
        blocks += `<div class="day-iv${isSel ? ' sel' : ''}" style="color:${iv.color};top:${top}px;height:${ht}px;left:${lPct.toFixed(1)}%;width:calc(${pct.toFixed(1)}% - 3px);${padStyle}"
          onclick="Calendar._select(${escHtml(JSON.stringify(iv._raw))})"
          oncontextmenu="App.openContextMenu(event,${escHtml(JSON.stringify(iv._raw))})">${innerHtml}${ht >= 44 ? `<div class="iv-resize top" onmousedown="Calendar._resizeDown(event,${escHtml(JSON.stringify(iv._raw))},'top')"></div>` : ''}<div class="iv-resize" onmousedown="Calendar._resizeDown(event,${escHtml(JSON.stringify(iv._raw))},'bottom')"></div></div>`;
      });
      let nowLine = '';
      const n = new Date(), h = n.getHours(), m = n.getMinutes();
      if (sameD(currentDay, today) && h >= H_S && h < H_E)
        nowLine = `<div class="now-line" style="top:${((h - H_S) + m / 60) * H_PX}px"></div>`;
      cols += `<div class="day-col" style="height:${tot}px" onmousedown="Calendar._colDown(event,this,'${isoDay(currentDay)}')">${lines}${blocks}${nowLine}</div>`;
    });

    const inner = $('cal-day-inner');
    inner.innerHTML = `<div class="tgrid-lbls">${lbls}</div><div class="tgrid-days">${cols}</div>`;

    const wrap = $('cal-day-wrap');
    if (wrap && !wrap.dataset.sc) { wrap.scrollTop = (8 - H_S) * H_PX; wrap.dataset.sc = '1'; }
  }

  // ── Month view ───────────────────────────────────────────────────────

  function renderMonth() {
    const y = miniDate.getFullYear(), mo = miniDate.getMonth();

    // Day-of-week header
    const dows = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
    $('cal-mth-head').innerHTML =
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
          onclick="event.stopPropagation();Calendar._select(${escHtml(JSON.stringify(iv._raw))})">
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
    $('cal-mth-grid').innerHTML = cells;
  }

  // ── Detail panel ─────────────────────────────────────────────────────

  function renderDetail(item) {
    const empty = $('detail-empty');
    const fill = $('detail-fill');
    if (!item) {
      if (empty) empty.style.display = 'flex';
      if (fill) { fill.style.display = 'none'; fill.innerHTML = ''; }
      return;
    }
    if (empty) empty.style.display = 'none';
    if (!fill) return;
    fill.style.cssText = 'display:flex;flex:1;overflow:hidden;flex-direction:column';
    fill.innerHTML = renderInterventionDetail(item, { trasferta: true, close: true });
  }

  // ── Month detail: day list ────────────────────────────────────────────

  function renderMonthDayDetail(date) {
    const items = getFilteredItems().filter(i => sameD(i.startD, date));
    const empty = $('detail-empty');
    const fill = $('detail-fill');
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
            return `<div class="day-list-item" style="color:${iv.color}"
              onclick="App.showDetail(${escHtml(JSON.stringify(iv._raw))})">
              <div class="dli-time">${hm(iv.sh, iv.sm)} – ${hm(Math.floor(endMin/60), endMin%60)} · ${iv.sigla}</div>
              <div class="dli-client">${iv.client}</div>
              <div class="dli-tipo">${iv.tipo || '—'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="detail-ftr">
        <button class="btn primary" style="width:100%;justify-content:center"
          onclick="App.navigate('new')">${GIIcon('plus', 13)}Nuovo intervento</button>
      </div>`;
  }

  // ── Public API ───────────────────────────────────────────────────────

  function renderAll() {
    syncViewButtons();
    renderRangeLabel();
    renderSidebar();
    const hint = $('cal-empty-hint');
    if (hint) {
      const empty = !getFilteredItems().length;
      hint.style.display = empty ? 'block' : 'none';
      if (empty) {
        const title = hint.querySelector('strong');
        const body = hint.querySelector('span');
        if (title) title.textContent = currentView === 'day' ? 'Nessun intervento in questa giornata.' : 'Nessun intervento nel periodo.';
        if (body) body.textContent = currentView === 'day'
          ? 'Trascina sulla griglia per scegliere subito orario e durata.'
          : 'Usa Nuovo intervento o trascina sulla griglia del calendario.';
      }
    }
    if (currentView === 'week') {
      $('cal-week-view').style.display = 'flex';
      $('cal-day-view').style.display = 'none';
      $('cal-month-view').style.display = 'none';
      renderWeek();
    } else if (currentView === 'day') {
      $('cal-week-view').style.display = 'none';
      $('cal-day-view').style.display = 'flex';
      $('cal-month-view').style.display = 'none';
      renderDay();
    } else {
      $('cal-week-view').style.display = 'none';
      $('cal-day-view').style.display = 'none';
      $('cal-month-view').style.display = 'flex';
      renderMonth();
    }
  }

  return {
    onNavigate() {
      // Sync active view button
      document.querySelectorAll('#view-calendar .vsbtn').forEach(b => b.classList.remove('on'));
      const vMap = { week: 'Sett.', day: 'Giorno', month: 'Mese' };
      document.querySelectorAll('#view-calendar .vsbtn').forEach(b => {
        if (b.textContent.trim() === vMap[currentView]) b.classList.add('on');
      });
      // Load interventions if needed then render
      const primary = App.accounts && (App.accounts.find(a => a.is_primary) || App.accounts[0]);
      if (primary) {
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
      App.clearDetail();
      renderAll();
    },

    goToday() {
      today = new Date(); today.setHours(0,0,0,0);
      weekStart = getMon(today);
      currentDay = new Date(today);
      miniDate = new Date(today.getFullYear(), today.getMonth(), 1);
      selectedItem = null;
      App.clearDetail();
      renderAll();
    },

    setView(view, btn) {
      const order = { month: 0, week: 1, day: 2 };
      const zoomIn = (order[view] ?? 0) >= (order[currentView] ?? 0);
      currentView = view;
      syncViewButtons();
      if (view === 'day' && !currentDay) currentDay = new Date(today);
      selectedItem = null;
      App.clearDetail();
      renderAll();
      const shown = $(`cal-${view}-view`);
      if (shown) {
        const cls = zoomIn ? 'cal-zoom-in' : 'cal-zoom-out';
        shown.classList.remove('cal-zoom-in', 'cal-zoom-out');
        void shown.offsetWidth;
        shown.classList.add(cls);
      }
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
      App.clearDetail();
      renderAll();
    },

    _dayClick(ts) {
      currentDay = new Date(ts); currentDay.setHours(0,0,0,0);
      currentView = 'day';
      syncViewButtons();
      selectedItem = null;
      App.clearDetail();
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

    _resizeDown(e, itemJson, edge) {
      e.preventDefault();
      e.stopPropagation(); // don't start a column drag-to-create
      const item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
      const block = e.target.closest('.iv, .day-iv');
      const col = e.target.closest('.day-col');
      if (!block || !col) return;
      const startD = new Date(item.start_dt);
      const endD = item.end_dt ? new Date(item.end_dt) : new Date(startD.getTime() + 3600000);
      const startTop = (startD.getHours() - H_S) * 60 + startD.getMinutes();
      const endTop = startTop + Math.max(15, Math.round((endD - startD) / 60000));
      const bubble = document.createElement('div');
      bubble.className = 'cal-resize-bubble';
      document.body.appendChild(bubble);
      _resize = {
        item, block, col, edge: edge || 'bottom', bubble,
        rect: col.getBoundingClientRect(),
        startD, endD, startTop, endTop,
        origStartTop: startTop, origEndTop: endTop,
        newStartTop: startTop, newEndTop: endTop,
      };
      document.body.classList.add('cal-resizing');
      _updateResizeBubble(e, startTop, endTop);
      document.addEventListener('mousemove', _onResizeMove);
      document.addEventListener('mouseup', _onResizeUp);
    },

    _select(itemJson) {
      if (_suppressClick) { _suppressClick = false; return; }
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

    _setTech(sigla) {
      techFilter = sigla;
      renderAll();
    },

    _colDown(e, col, isoDate) {
      if (e.target.closest('.iv, .day-iv')) return;
      e.preventDefault();
      const rect = col.getBoundingClientRect();
      const [sh, sm] = _yToTime(e.clientY - rect.top);
      const ghost = document.createElement('div');
      ghost.className = 'cal-ghost';
      ghost.style.top    = ((sh - H_S + sm / 60) * H_PX) + 'px';
      ghost.style.height = (H_PX / 2) + 'px';
      col.appendChild(ghost);
      _drag = { ghost, col, rect, isoDate, sh, sm, curH: sh, curM: sm };
      document.addEventListener('mousemove', _onDragMove);
      document.addEventListener('mouseup',   _onDragUp);
    },

    _confirmCreate() {
      if (!_pendingCreate) return;
      const { isoDate, sh, sm, eh, em } = _pendingCreate;
      _dismissCreateModal();
      App.openNewModal({ date: isoDate, startH: sh, startM: sm, endH: eh, endM: em });
    },

    _dismissCreate() {
      _dismissCreateModal();
    },

    refresh() { renderAll(); },
  };
})();
