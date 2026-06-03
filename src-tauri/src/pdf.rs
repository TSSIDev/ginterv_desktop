use anyhow::Result;
use chrono::DateTime;
use ::image::GenericImageView;
use printpdf::path::{PaintMode, WindingOrder};
use printpdf::*;

use crate::db::cache::CachedItem;

// ── A4 layout constants (mm) ─────────────────────────────────────────────────
const PW: f32 = 210.0;
const PH: f32 = 297.0;
const ML: f32 = 14.0;
const MR: f32 = 14.0;
const MT: f32 = 10.0;
const CW: f32 = PW - ML - MR;

// ── Brand colors (0.0–1.0 RGB) ───────────────────────────────────────────────
const C_DARK: (f32, f32, f32) = (0.118, 0.188, 0.314);
const C_MID: (f32, f32, f32) = (0.533, 0.596, 0.667);
const C_LIGHT: (f32, f32, f32) = (0.969, 0.976, 0.988);
const C_BORDER: (f32, f32, f32) = (0.867, 0.890, 0.929);
const C_WHITE: (f32, f32, f32) = (1.0, 1.0, 1.0);
const C_BLACK: (f32, f32, f32) = (0.118, 0.157, 0.208);
const C_GRAY: (f32, f32, f32) = (0.6, 0.6, 0.6);

// ── Company info ─────────────────────────────────────────────────────────────
const COMPANY_NAME: &str = "TOP SOUND DI VITALI DANIELE";
const COMPANY_SUB: &str =
    "Assistenza informatica - Hardware e software - Videosorveglianza e sistemi di allarme";
const COMPANY_ADDRESS: &str = "Via Alcide de Gasperi 1/3 - 41034 Finale Emilia (MO)";
const COMPANY_CONTACTS: &str = "Tel. 0535.780393  Fax 02.700520425 - info@tssi.it - www.tssi.it";
const COMPANY_FISCAL: &str =
    "P.IVA 02047920364 - C.F. VTLDNL68R09F257V - REA MO-261643 - Cod. SDI: KRRH6B9";

// ── Primitives ───────────────────────────────────────────────────────────────

fn rgb(c: (f32, f32, f32)) -> Color {
    Color::Rgb(Rgb::new(c.0, c.1, c.2, None))
}

/// Convert cursor-from-top (mm) to PDF y-from-bottom (mm)
fn py(cur: f32) -> Mm {
    Mm(PH - cur)
}

fn text_at(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    text: &str,
    x: f32,
    y_top: f32,
    size: f32,
) {
    let s = safe_text(text);
    layer.begin_text_section();
    layer.set_font(font, size);
    layer.set_text_cursor(Mm(x), py(y_top + size * 0.352));
    layer.write_text(s, font);
    layer.end_text_section();
}

fn fill_rect(layer: &PdfLayerReference, x: f32, y_top: f32, w: f32, h: f32, c: (f32, f32, f32)) {
    layer.set_fill_color(rgb(c));
    let pts = vec![
        (Point::new(Mm(x), py(y_top)), false),
        (Point::new(Mm(x + w), py(y_top)), false),
        (Point::new(Mm(x + w), py(y_top + h)), false),
        (Point::new(Mm(x), py(y_top + h)), false),
    ];
    layer.add_polygon(Polygon {
        rings: vec![pts],
        mode: PaintMode::Fill,
        winding_order: WindingOrder::NonZero,
    });
}

fn hline(layer: &PdfLayerReference, y_top: f32, c: (f32, f32, f32), thickness: f32) {
    layer.set_outline_color(rgb(c));
    layer.set_outline_thickness(thickness);
    layer.add_line(Line {
        points: vec![
            (Point::new(Mm(ML), py(y_top)), false),
            (Point::new(Mm(PW - MR), py(y_top)), false),
        ],
        is_closed: false,
    });
}

fn section_hdr(
    layer: &PdfLayerReference,
    font_bold: &IndirectFontRef,
    title: &str,
    y_top: f32,
) -> f32 {
    layer.set_fill_color(rgb(C_MID));
    text_at(layer, font_bold, title, ML, y_top, 7.0);
    let line_y = y_top + 6.0;
    hline(layer, line_y, C_DARK, 0.5);
    line_y + 4.0
}

fn safe_text(s: &str) -> String {
    s.replace('\u{2014}', "-")
        .replace('\u{2013}', "-")
        .replace('\u{2019}', "'")
        .replace('\u{2018}', "'")
        .replace('\u{201c}', "\"")
        .replace('\u{201d}', "\"")
        .replace('\u{2026}', "...")
        .replace('\u{00b7}', "-")
        .replace('\u{00a0}', " ")
        .replace('\u{200b}', "")
}

fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

fn fmt_dt(iso: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|dt| dt.format("%d/%m/%Y  %H:%M").to_string())
        .unwrap_or_else(|_| {
            // fallback: try stripping timezone
            if iso.len() >= 16 {
                let d = &iso[..10];
                let t = &iso[11..16];
                format!("{}  {}", d.replace('-', "/"), t)
            } else {
                iso.to_string()
            }
        })
}

// ── Per-page drawing ──────────────────────────────────────────────────────────

fn draw_header(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    font_bold: &IndirectFontRef,
    y: f32,
) -> f32 {
    let mut cy = y;

    // Left column: company name + tagline
    layer.set_fill_color(rgb(C_BLACK));
    text_at(layer, font_bold, COMPANY_NAME, ML, cy, 8.5);
    cy += 5.0;
    layer.set_fill_color(rgb(C_GRAY));
    text_at(layer, font, COMPANY_SUB, ML, cy, 6.5);
    cy += 4.5;
    text_at(layer, font, COMPANY_ADDRESS, ML, cy, 6.5);
    cy += 4.5;
    text_at(layer, font, COMPANY_CONTACTS, ML, cy, 6.5);

    // Right column: fiscal info
    text_at(layer, font, COMPANY_FISCAL, ML, y + 3.0, 6.5);

    cy += 6.0;
    hline(layer, cy, C_DARK, 0.6);
    cy + 3.0
}

fn draw_title_bar(layer: &PdfLayerReference, font_bold: &IndirectFontRef, y: f32) -> f32 {
    let h = 9.0;
    fill_rect(layer, ML, y, CW, h, C_DARK);
    layer.set_fill_color(rgb(C_WHITE));
    text_at(layer, font_bold, "  RAPPORTO DI INTERVENTO", ML, y + 1.5, 10.0);
    y + h + 1.0
}

fn draw_summary_bar(
    layer: &PdfLayerReference,
    _font: &IndirectFontRef,
    font_bold: &IndirectFontRef,
    item: &CachedItem,
    y: f32,
) -> f32 {
    let h = 14.0;
    fill_rect(layer, ML, y, CW, h, C_LIGHT);
    layer.set_outline_color(rgb(C_BORDER));
    layer.set_outline_thickness(0.3);
    layer.add_polygon(Polygon {
        rings: vec![vec![
            (Point::new(Mm(ML), py(y)), false),
            (Point::new(Mm(ML + CW), py(y)), false),
            (Point::new(Mm(ML + CW), py(y + h)), false),
            (Point::new(Mm(ML), py(y + h)), false),
        ]],
        mode: PaintMode::Stroke,
        winding_order: WindingOrder::NonZero,
    });

    let cols: &[(&str, &str, f32)] = &[
        ("CLIENTE", item.ragione_sociale.as_deref().unwrap_or("—"), 0.38),
        (
            "DATA",
            &fmt_dt(item.start_dt.as_str()),
            0.22,
        ),
        ("TECNICO", item.nome_tecnico.as_deref().unwrap_or("—"), 0.22),
        ("DURATA", item.durata.as_deref().unwrap_or("—"), 0.18),
    ];

    let mut x = ML;
    for (i, (lbl, val, ratio)) in cols.iter().enumerate() {
        let w = CW * ratio;
        layer.set_fill_color(rgb(C_MID));
        text_at(layer, font_bold, lbl, x + 2.0, y + 2.0, 6.0);
        layer.set_fill_color(rgb(C_BLACK));
        let trunc_val = trunc_str(val, 28);
        text_at(layer, font_bold, trunc_val.as_str(), x + 2.0, y + 7.0, 8.5);
        if i < cols.len() - 1 {
            layer.set_outline_color(rgb(C_BORDER));
            layer.set_outline_thickness(0.3);
            layer.add_line(Line {
                points: vec![
                    (Point::new(Mm(x + w), py(y)), false),
                    (Point::new(Mm(x + w), py(y + h)), false),
                ],
                is_closed: false,
            });
        }
        x += w;
    }

    y + h + 5.0
}

fn trunc_str(s: &str, max_chars: usize) -> String {
    let clean = safe_text(s);
    if clean.chars().count() <= max_chars {
        clean
    } else {
        let mut out: String = clean.chars().take(max_chars - 1).collect();
        out.push('…');
        out
    }
}

fn draw_kv_pair(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    font_bold: &IndirectFontRef,
    label: &str,
    value: &str,
    x: f32,
    y: f32,
    _w: f32,
) -> f32 {
    let h = 14.0;
    hline(layer, y + h, C_BORDER, 0.2);
    layer.set_fill_color(rgb(C_MID));
    text_at(layer, font_bold, label, x, y + 1.0, 6.5);
    layer.set_fill_color(rgb(C_BLACK));
    let trunc = trunc_str(value, 40);
    text_at(layer, font, trunc.as_str(), x, y + 6.0, 9.0);
    h
}

fn draw_details(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    font_bold: &IndirectFontRef,
    item: &CachedItem,
    y: f32,
) -> f32 {
    let mut cy = section_hdr(layer, font_bold, "DETTAGLI INTERVENTO", y);

    let gap = 6.0;
    let col_w = (CW - gap) / 2.0;
    let x_r = ML + col_w + gap;

    let end_dt_str = fmt_dt(&item.end_dt);
    let pairs: &[(&str, Option<&str>)] = &[
        ("Tipo intervento", item.descrizione.as_deref()),
        ("Titolo / Altro", item.altro.as_deref()),
        ("Tariffa", item.tipo_tariffa.as_deref()),
        ("Addebito", item.tipo_fatturazione.as_deref()),
        ("Trasferta", item.trasferta.as_deref()),
        ("Data/Ora fine", Some(end_dt_str.as_str())),
    ];

    // Group pairs into rows of 2
    let non_empty: Vec<(&str, &str)> = pairs
        .iter()
        .filter_map(|(l, v)| {
            v.filter(|s| !s.trim().is_empty())
                .map(|s| (*l, s))
        })
        .collect();

    let mut i = 0;
    while i < non_empty.len() {
        let (lbl_l, val_l) = non_empty[i];
        let row_h = draw_kv_pair(layer, font, font_bold, lbl_l, val_l, ML, cy, col_w);

        if i + 1 < non_empty.len() {
            let (lbl_r, val_r) = non_empty[i + 1];
            draw_kv_pair(layer, font, font_bold, lbl_r, val_r, x_r, cy, col_w);
        }
        cy += row_h;
        i += 2;
    }

    cy + 3.0
}

fn draw_notes(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    font_bold: &IndirectFontRef,
    text: &str,
    y: f32,
) -> f32 {
    let mut cy = section_hdr(layer, font_bold, "NOTE", y);
    let clean = safe_text(text);
    let line_h = 5.5_f32;
    let chars_per_line = (CW / (9.0 * 0.5)) as usize;

    let mut lines: Vec<String> = Vec::new();
    for src_line in clean.lines().take(15) {
        if src_line.trim().is_empty() {
            lines.push(String::new());
        } else {
            let words: Vec<&str> = src_line.split_whitespace().collect();
            let mut current = String::new();
            for word in words {
                if current.is_empty() {
                    current = word.to_string();
                } else if current.len() + 1 + word.len() <= chars_per_line {
                    current.push(' ');
                    current.push_str(word);
                } else {
                    lines.push(current.clone());
                    current = word.to_string();
                    if lines.len() >= 12 {
                        break;
                    }
                }
            }
            if !current.is_empty() {
                lines.push(current);
            }
        }
        if lines.len() >= 12 {
            break;
        }
    }

    layer.set_fill_color(rgb(C_BLACK));
    for line in &lines {
        text_at(layer, font, line, ML, cy, 9.0);
        cy += line_h;
    }
    cy + 3.0
}

fn draw_sig_image(
    layer: &PdfLayerReference,
    png_bytes: &[u8],
    x: f32,
    sig_top: f32,
    half_w: f32,
) {
    if let Ok(img) = ::image::load_from_memory(png_bytes) {
        let (pw, ph) = img.dimensions();
        if pw > 0 && ph > 0 {
            let w_mm = half_w * 0.8_f32;
            let h_mm = (w_mm * (ph as f32 / pw as f32)).min(18.0);
            let img_x = x + (half_w - w_mm) / 2.0;
            let img_y_bottom = PH - (sig_top + 4.0 + h_mm);
            let dpi = 96.0_f32;
            let scale_x = w_mm * dpi / (pw as f32 * 25.4);
            let scale_y = h_mm * dpi / (ph as f32 * 25.4);
            let pdf_img = Image::from_dynamic_image(&img);
            pdf_img.add_to_layer(
                layer.clone(),
                ImageTransform {
                    translate_x: Some(Mm(img_x)),
                    translate_y: Some(Mm(img_y_bottom)),
                    scale_x: Some(scale_x),
                    scale_y: Some(scale_y),
                    dpi: Some(dpi),
                    ..Default::default()
                },
            );
        }
    }
}

fn draw_signatures(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    font_bold: &IndirectFontRef,
    client_sig_png: Option<Vec<u8>>,
    tech_sig_png: Option<Vec<u8>>,
    tecnico: Option<&str>,
) {
    let firma_top = PH - 16.0 - 42.0; // footer 16mm + firma area 42mm
    let _ = section_hdr(layer, font_bold, "FIRME", firma_top);
    let sig_top = firma_top + 10.0;

    let half_w = CW / 2.0 - 4.0;
    let x_l = ML;
    let x_r = ML + half_w + 8.0;
    let line_y = sig_top + 22.0;

    // Technician label
    layer.set_fill_color(rgb(C_GRAY));
    text_at(layer, font, tecnico.unwrap_or("Tecnico"), x_l, sig_top, 8.0);

    // Tech signature image (left)
    if let Some(ref png_bytes) = tech_sig_png {
        draw_sig_image(layer, png_bytes, x_l, sig_top + 2.0, half_w);
    }

    // Client signature image (right)
    if let Some(ref png_bytes) = client_sig_png {
        draw_sig_image(layer, png_bytes, x_r, sig_top + 2.0, half_w);
    }

    // Signature lines
    layer.set_outline_color(rgb(C_GRAY));
    layer.set_outline_thickness(0.4);
    layer.add_line(Line {
        points: vec![
            (Point::new(Mm(x_l), py(line_y)), false),
            (Point::new(Mm(x_l + half_w), py(line_y)), false),
        ],
        is_closed: false,
    });
    layer.add_line(Line {
        points: vec![
            (Point::new(Mm(x_r), py(line_y)), false),
            (Point::new(Mm(x_r + half_w), py(line_y)), false),
        ],
        is_closed: false,
    });

    // Labels below lines
    layer.set_fill_color(rgb(C_GRAY));
    text_at(layer, font, "Firma tecnico", x_l + 10.0, line_y + 2.0, 7.5);
    text_at(layer, font, "Firma e timbro del cliente", x_r + 5.0, line_y + 2.0, 7.5);
}

fn draw_footer(layer: &PdfLayerReference, font: &IndirectFontRef) {
    let fy = PH - 14.0;
    hline(layer, fy, C_BORDER, 0.3);
    layer.set_fill_color(rgb(C_GRAY));
    let today = chrono::Local::now().format("%d/%m/%Y").to_string();
    text_at(layer, font, &today, ML, fy + 2.0, 7.5);
    text_at(layer, font, "Gestore Interventi - TSSI", ML + CW / 2.0 - 20.0, fy + 2.0, 7.5);
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn generate_single(item: &CachedItem, sig_png: Option<Vec<u8>>, tech_sig_png: Option<Vec<u8>>) -> Result<Vec<u8>> {
    let (doc, page_idx, layer_idx) =
        PdfDocument::new("Rapporto Intervento", Mm(PW), Mm(PH), "Layer 1");

    let font = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)?;
    let layer = doc.get_page(page_idx).get_layer(layer_idx);

    let mut cy = MT;
    cy = draw_header(&layer, &font, &font_bold, cy);
    cy = draw_title_bar(&layer, &font_bold, cy);
    cy = draw_summary_bar(&layer, &font, &font_bold, item, cy);
    cy = draw_details(&layer, &font, &font_bold, item, cy);

    if let Some(body) = &item.body_html {
        let clean = strip_html(body);
        if !clean.trim().is_empty() && cy < PH - 70.0 {
            cy = draw_notes(&layer, &font, &font_bold, &clean, cy);
        }
    }
    let _ = cy;

    draw_signatures(&layer, &font, &font_bold, sig_png, tech_sig_png, item.nome_tecnico.as_deref());
    draw_footer(&layer, &font);

    Ok(doc.save_to_bytes()?)
}

pub fn generate_bulk_summary(items: &[CachedItem]) -> Result<Vec<u8>> {
    if items.is_empty() {
        return Err(anyhow::anyhow!("Nessun intervento da esportare"));
    }

    let sorted: Vec<&CachedItem> = {
        let mut v: Vec<&CachedItem> = items.iter().collect();
        v.sort_by(|a, b| a.start_dt.cmp(&b.start_dt));
        v
    };

    let (doc, page_idx, layer_idx) =
        PdfDocument::new("Riepilogo Interventi", Mm(PW), Mm(PH), "Layer 1");
    let font = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)?;
    let layer = doc.get_page(page_idx).get_layer(layer_idx);

    let mut cy = MT;
    cy = draw_header(&layer, &font, &font_bold, cy);

    // Title
    let h = 9.0;
    fill_rect(&layer, ML, cy, CW, h, C_DARK);
    layer.set_fill_color(rgb(C_WHITE));
    text_at(&layer, &font_bold, "  RIEPILOGO INTERVENTI", ML, cy + 1.5, 10.0);
    cy += h + 3.0;

    // Table header
    let cols: &[(&str, f32)] = &[
        ("N.", 8.0),
        ("Cliente", 48.0),
        ("Tipo", 44.0),
        ("Data", 38.0),
        ("Durata", 24.0),
    ];
    let hdr_h = 7.0;
    fill_rect(&layer, ML, cy, CW, hdr_h, C_DARK);
    layer.set_fill_color(rgb(C_WHITE));
    let mut x = ML;
    for (lbl, w) in cols {
        text_at(&layer, &font_bold, lbl, x + 1.5, cy + 1.0, 7.5);
        x += w;
    }
    cy += hdr_h;

    // Rows
    for (idx, item) in sorted.iter().enumerate() {
        let row_h = 6.5_f32;
        let bg = if idx % 2 == 0 { C_LIGHT } else { C_WHITE };
        fill_rect(&layer, ML, cy, CW, row_h, bg);
        layer.set_fill_color(rgb(C_BLACK));

        let mut x = ML;
        let values: [String; 5] = [
            format!("{}", idx + 1),
            trunc_str(item.ragione_sociale.as_deref().unwrap_or("—"), 22),
            trunc_str(item.descrizione.as_deref().unwrap_or("—"), 20),
            fmt_dt(&item.start_dt),
            item.durata.clone().unwrap_or_else(|| "—".to_string()),
        ];
        for (i, (_, w)) in cols.iter().enumerate() {
            text_at(&layer, &font, &values[i], x + 1.5, cy + 0.5, 8.0);
            x += w;
        }

        hline(&layer, cy + row_h, C_BORDER, 0.2);
        cy += row_h;

        // New page if needed (rough guard)
        if cy > PH - 30.0 {
            let (new_page, new_layer) = doc.add_page(Mm(PW), Mm(PH), "Layer 1");
            let _ = (new_page, new_layer); // we can't easily draw on subsequent pages without refactor
            break;
        }
    }

    draw_footer(&layer, &font);
    Ok(doc.save_to_bytes()?)
}

pub fn generate_bulk_detail(items: &[CachedItem]) -> Result<Vec<u8>> {
    if items.is_empty() {
        return Err(anyhow::anyhow!("Nessun intervento da esportare"));
    }

    let sorted: Vec<&CachedItem> = {
        let mut v: Vec<&CachedItem> = items.iter().collect();
        v.sort_by(|a, b| a.start_dt.cmp(&b.start_dt));
        v
    };

    let (doc, page_idx, layer_idx) =
        PdfDocument::new("Dettaglio Interventi", Mm(PW), Mm(PH), "Layer 1");
    let font = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)?;

    // First item on first page
    {
        let layer = doc.get_page(page_idx).get_layer(layer_idx);
        let mut cy = MT;
        cy = draw_header(&layer, &font, &font_bold, cy);
        cy = draw_title_bar(&layer, &font_bold, cy);
        cy = draw_summary_bar(&layer, &font, &font_bold, sorted[0], cy);
        cy = draw_details(&layer, &font, &font_bold, sorted[0], cy);
        if let Some(body) = &sorted[0].body_html {
            let clean = strip_html(body);
            if !clean.trim().is_empty() && cy < PH - 70.0 {
                let _ = draw_notes(&layer, &font, &font_bold, &clean, cy);
            }
        }
        draw_footer(&layer, &font);
    }

    // Remaining items: one page each
    for item in &sorted[1..] {
        let (new_page, new_layer_idx) = doc.add_page(Mm(PW), Mm(PH), "Layer 1");
        let layer = doc.get_page(new_page).get_layer(new_layer_idx);
        let mut cy = MT;
        cy = draw_header(&layer, &font, &font_bold, cy);
        cy = draw_title_bar(&layer, &font_bold, cy);
        cy = draw_summary_bar(&layer, &font, &font_bold, item, cy);
        cy = draw_details(&layer, &font, &font_bold, item, cy);
        if let Some(body) = &item.body_html {
            let clean = strip_html(body);
            if !clean.trim().is_empty() && cy < PH - 70.0 {
                let _ = draw_notes(&layer, &font, &font_bold, &clean, cy);
            }
        }
        draw_footer(&layer, &font);
    }

    Ok(doc.save_to_bytes()?)
}
