// shared.js — helper puri condivisi tra le viste. Caricato per primo in index.html.
// Niente DOM qui: queste funzioni sono testate in Node (tests/shared.test.js).

// ── HTML escape ─────────────────────────────────────────────────────
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Badge shown on items with an unsynced local change (optimistic write).
function pendingBadge(item) {
  if (!item || !item.pending_op) return '';
  const label = item.pending_op === 'delete' ? 'eliminazione…'
    : item.pending_op === 'create' ? 'in invio…' : 'modifica…';
  return `<span class="pending-badge">${label}</span>`;
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

// Export per i test Node; no-op nella webview.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escHtml, pendingBadge, buildSubject, fmtDT, durMinToStr };
}
