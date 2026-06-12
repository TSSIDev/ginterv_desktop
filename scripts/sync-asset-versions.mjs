// Riscrive i ?v= di index.html con un hash del contenuto di ogni asset.
// Idempotente: stesso contenuto → stesso hash → nessuna modifica.
// Uso: node scripts/sync-asset-versions.mjs  (alias: npm run bump)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'src', 'index.html');
const html = readFileSync(indexPath, 'utf8');

const out = html.replace(
  /((?:href|src)=")([^"?]+)\?v=[^"]*(")/g,
  (m, pre, asset, post) => {
    let body;
    try { body = readFileSync(join(root, 'src', asset)); }
    catch { return m; } // asset non trovato: lascia com'è
    const h = createHash('md5').update(body).digest('hex').slice(0, 8);
    return `${pre}${asset}?v=${h}${post}`;
  }
);

if (out !== html) {
  writeFileSync(indexPath, out);
  console.log('asset versions aggiornate in src/index.html');
} else {
  console.log('asset versions già allineate');
}
