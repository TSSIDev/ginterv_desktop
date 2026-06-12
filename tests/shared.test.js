// Test degli helper puri di src/shared.js — eseguiti con `npm test` (node --test).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escHtml, pendingBadge, buildSubject, fmtDT, durMinToStr } = require('../src/shared.js');

test('escHtml escapa entità e virgolette', () => {
  assert.equal(escHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
  assert.equal(escHtml("L'Aquila"), "L'Aquila"); // apostrofo non toccato
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(''), '');
  assert.equal(escHtml(0), ''); // falsy → stringa vuota (comportamento storico)
});

test('pendingBadge mappa op → label', () => {
  assert.match(pendingBadge({ pending_op: 'delete' }), /eliminazione…/);
  assert.match(pendingBadge({ pending_op: 'create' }), /in invio…/);
  assert.match(pendingBadge({ pending_op: 'update' }), /modifica…/);
  assert.equal(pendingBadge({}), '');
  assert.equal(pendingBadge(null), '');
});

test('buildSubject: composizione completa (mirror del Rust build_subject)', () => {
  assert.equal(
    buildSubject('ML', 'ACME Srl', 'Assistenza', 'UPS', 'TB', 'Fatturato'),
    'ML - ACME Srl - Assistenza - UPS - TB Fatturato'
  );
});

test('buildSubject: campi vuoti in coda eliminati, interni preservati', () => {
  assert.equal(buildSubject('ML', '', 'Assistenza', '', '', ''), 'ML - Assistenza');
  assert.equal(buildSubject('', 'ACME', '', '', 'TB', ''), 'ACME - TB');
  assert.equal(buildSubject('', '', '', '', '', ''), '');
});

test('buildSubject: trim degli spazi', () => {
  assert.equal(buildSubject(' ML ', ' ACME ', '', '', ' TB ', ''), 'ML - ACME - TB');
});

test('fmtDT formatta data e ora it-IT', () => {
  // Senza timezone → ora locale, stabile su qualunque macchina.
  assert.equal(fmtDT('2026-06-12T09:30:00'), '12/06 09:30');
  assert.equal(fmtDT(null), '—');
  assert.equal(fmtDT(''), '—');
});

test('durMinToStr', () => {
  assert.equal(durMinToStr(60), '1h');
  assert.equal(durMinToStr(90), '1h 30m');
  assert.equal(durMinToStr(45), '45m');
  assert.equal(durMinToStr(480), '8h');
  assert.equal(durMinToStr(0), '0m');
});
