// Audit contrasto WCAG dei token OKLCH di style.css (coppie hardcoded qui sotto).
// Uso: node scripts/check-contrast.mjs
function oklchToLinearSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(v => Math.min(1, Math.max(0, v)));
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (fg, bg) => {
  const [y1, y2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (y1 + 0.05) / (y2 + 0.05);
};
// mix(fg, bg, p) ≈ color-mix in spazio lineare semplificato (interp. componenti)
const mix = (c1, c2, p) => c1.map((v, i) => v * p + c2[i] * (1 - p));

const T = {
  // light
  'L bg-base':    oklchToLinearSrgb(0.975, 0.006, 270),
  'L bg-surface': oklchToLinearSrgb(0.996, 0.003, 270),
  'L bg-elev':    oklchToLinearSrgb(0.986, 0.005, 270),
  'L text-1':     oklchToLinearSrgb(0.28, 0.020, 270),
  'L text-2':     oklchToLinearSrgb(0.46, 0.025, 270),
  'L text-3':     oklchToLinearSrgb(0.54, 0.025, 270),
  'L accent':     oklchToLinearSrgb(0.52, 0.180, 285),
  'L accent-solid': oklchToLinearSrgb(0.54, 0.190, 285),
  'L accent-text': oklchToLinearSrgb(0.99, 0.010, 285),
  'L green':      oklchToLinearSrgb(0.52, 0.150, 155),
  'L amber':      oklchToLinearSrgb(0.55, 0.140, 70),
  'L red':        oklchToLinearSrgb(0.54, 0.190, 28),
  // dark
  'D bg-base':    oklchToLinearSrgb(0.20, 0.016, 270),
  'D bg-surface': oklchToLinearSrgb(0.24, 0.017, 270),
  'D text-1':     oklchToLinearSrgb(0.95, 0.010, 270),
  'D text-2':     oklchToLinearSrgb(0.72, 0.020, 270),
  'D text-3':     oklchToLinearSrgb(0.60, 0.022, 270),
  'D accent':     oklchToLinearSrgb(0.72, 0.150, 285),
  'D accent-solid': oklchToLinearSrgb(0.57, 0.170, 285),
  'D accent-text': oklchToLinearSrgb(0.99, 0.010, 285),
  'D green':      oklchToLinearSrgb(0.76, 0.150, 155),
  'D amber':      oklchToLinearSrgb(0.82, 0.130, 80),
  'D red':        oklchToLinearSrgb(0.70, 0.170, 28),
};

const pairs = [
  // [fg, bg, soglia, nota]
  ['L text-1', 'L bg-base', 4.5, 'corpo'],
  ['L text-2', 'L bg-base', 4.5, 'secondario'],
  ['L text-3', 'L bg-base', 4.5, 'hint/micro-label'],
  ['L accent', 'L bg-base', 4.5, 'link/azioni testuali'],
  ['L accent-text', 'L accent-solid', 4.5, 'bottoni primary'],
  ['L green', 'L bg-base', 4.5, 'stato OK testo'],
  ['L amber', 'L bg-base', 4.5, 'stato attesa testo'],
  ['L red', 'L bg-base', 4.5, 'stato errore testo'],
  ['D text-1', 'D bg-base', 4.5, 'corpo'],
  ['D text-2', 'D bg-base', 4.5, 'secondario'],
  ['D text-3', 'D bg-base', 4.5, 'hint/micro-label'],
  ['D accent', 'D bg-base', 4.5, 'link/azioni testuali'],
  ['D accent-text', 'D accent-solid', 4.5, 'bottoni primary'],
  ['D green', 'D bg-base', 4.5, 'stato OK testo'],
  ['D amber', 'D bg-base', 4.5, 'stato attesa testo'],
  ['D red', 'D bg-base', 4.5, 'stato errore testo'],
];
// Stato su fondo tinto al 10% (test-result: testo green su green/10 + surface)
pairs.push(['L green', 'tint', 4.5, 'green su green-10% (test-result light)']);
T['tint'] = mix(T['L green'], T['L bg-surface'], 0.10);

for (const [fg, bg, min, nota] of pairs) {
  const c = contrast(T[fg], T[bg]);
  const ok = c >= min ? 'PASS' : 'FAIL';
  console.log(`${ok}  ${c.toFixed(2).padStart(5)}  ${fg} su ${bg}  (${nota})`);
}
