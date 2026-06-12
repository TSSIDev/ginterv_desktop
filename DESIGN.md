# Design

Visual system for Gestore Interventi. Product register: design serves the task. One accent (indigo-violet), tinted neutrals, two themes that share one identity. Token source of truth: `src/style.css` (`:root` = dark, `body.theme-light` = light). Default theme is **light**.

## Theme

Scene: un tecnico apre l'app in ufficio di giorno (luce piena, tema chiaro) e la riapre la sera o in furgone in penombra (tema scuro). Nessuno dei due è un ripensamento.

- **Light**: off-white caldo-neutro, non bianco puro (evita "sparaflashante"). Superfici a luminosità ravvicinate, separate da bordi tenui più che da ombre forti.
- **Dark**: blu-notte profondo (non nero), neutri tintati verso il viola-indaco, accento più luminoso per staccare dal fondo.

## Color

Strategy: **Restrained**. Un solo accento indaco-violetto (azione primaria, selezione, "oggi", focus). Tutto il resto neutro tintato verso lo stesso hue (~270). Semantici (verde/ambra/rosso) solo per stato.

Formato: OKLCH. Mai `#000`/`#fff`. Hue accento 280, hue neutri 270.

### Accento
| Token | Dark | Light |
|---|---|---|
| `--accent` (testo/icone/bordi) | `oklch(72% 0.15 285)` | `oklch(52% 0.18 285)` |
| `--accent-solid` (fondo bottoni) | `oklch(57% 0.17 285)` | `oklch(54% 0.19 285)` |
| `--accent-text` (su accent-solid) | `oklch(99% 0.01 285)` | `oklch(99% 0.01 285)` |
| `--accent-dim` (riempimenti tenui) | `color-mix(--accent 15% / transparent)` | `color-mix(--accent 12% / transparent)` |

### Neutri (hue 270, bassa croma)
Dark: base `20% 0.016` → surface `23%` → elev `26%` → hover `30%` → sel `34% 0.045 282`.
Light: base `oklch(97.5% 0.006)` → surface `99% 0.004` → elev `98% 0.006` → hover `94% 0.01` → sel `93% 0.045 285`.

Testo dark: `--text-1 95%`, `--text-2 72%`, `--text-3 60%`. Light: `28%`, `46%`, `54%`.
(text-3 calibrato per AA 4.5:1 su bg-base; verifica con `node scripts/check-contrast.mjs`.)
Bordi dark: `--border 30%`, `--border-2 40%`. Light: `--border 90.5%`, `--border-2 84%`.

### Semantici
`--green` 155h, `--amber` 80h, `--red` 28h. Dark più chiari (L~74%), light più scuri (L~50-55%) per contrasto AA come testo su bg-base.

## Typography

- **Famiglia unica: Inter** (variable, bundled offline in `src/fonts/inter-latin-wght-normal.woff2`, `font-weight: 100 900`). Stack: `'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`.
- Features: `font-feature-settings: 'cv05' 1, 'cv11' 1` (l a coda, single-storey g), `font-variant-numeric: tabular-nums` su orari/km/contatori (`.tnum`).
- Mono solo per keycap/scorciatoie: `--font-mono` = `ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace`.
- Scala fissa (no fluid), ratio ~1.2. Base `13.5px` / line-height 1.5. Token: `--fs-xs 10.5`, `--fs-sm 12`, `--fs-base 13.5`, `--fs-md 15`, `--fs-lg 18`, `--fs-xl 22`.
- Gerarchia per peso+scala: titoli 700 con `letter-spacing: -0.01em`; micro-label uppercase 700 `letter-spacing .07em` come elementi ausiliari, non per informazione critica.

## Elevation & shape

- Radius scale: `--r-sm 6px`, `--r-md 9px`, `--r-lg 12px`, `--r-xl 16px`, full `999px` per pillole.
- Ombre morbide e basse: `--sh-1` (hover/sticky), `--sh-2` (popover/dropdown), `--sh-3` (modali). In light usano la hue neutra con alpha basso; in dark restano scure ma contenute. Separazione preferita via bordo, non via ombra pesante.
- Border width 1px standard. **Mai** border-left/right colorato come accento (bando).

## Motion

- 120–200ms, `ease-out` esponenziale (`--ease: cubic-bezier(0.22, 1, 0.36, 1)`). Niente bounce/elastic.
- Motion = stato (hover, selezione, apertura popover/modale, toast), mai decorazione.
- `@media (prefers-reduced-motion: reduce)`: transizioni ridotte a ~1ms.

## Components (shell — Pass 1)

- **Menubar / toolbar / statusbar**: superfici neutre a livelli vicini, separate da `--border`. Voce attiva e azione primaria portano l'accento.
- **Bottoni**: `.btn` neutro (bordo + elev), `.btn.primary` accent-solid pieno con `--accent-text`, `.btn.danger` rosso tenue. Stati: default/hover/focus/active/disabled. Focus = anello accento offset.
- **Input / select / textarea / fuzzy**: fondo elev, bordo `--border-2`, focus = bordo accento + alone `--accent-dim`.
- **Switch vista** (`.view-sw`): segmento; attivo = accent-solid + accent-text.
- **Modali**: overlay scurito leggero, card `--r-xl`, `--sh-3`, header/footer separati da bordo.
- **Onboarding wizard**: superficie surface, niente griglia decorativa pesante; step-dot usano accent/green per stato.

## Anti-patterns (ban)

Border-stripe colorati, testo in gradiente, glassmorphism decorativo di default, hero-metric template, griglie di card identiche, modale come prima scelta, em dash nei testi UI.
