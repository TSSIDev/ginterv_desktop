use crate::db::cache;
use crate::pdf;
use crate::AppState;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use tauri::State;

#[tauri::command]
pub async fn export_pdf(
    email: String,
    item_id: String,
    change_key: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (item, sig_png) = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;

        let item = cache::get_by_item_id(&conn, &email, &item_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Intervento {} non trovato in cache", item_id))?;

        let sig_b64 = cache::get_signature_b64(&conn, &item_id).map_err(|e| e.to_string())?;
        let sig_png = sig_b64.and_then(|b| STANDARD.decode(&b).ok());

        (item, sig_png)
    };

    // change_key is accepted but we use cache data; passed for future live-fetch
    let _ = change_key;

    let bytes = pdf::generate_single(&item, sig_png).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
pub async fn export_pdf_bulk(
    email: String,
    start: String,
    end: String,
    tech_filter: Option<String>,
    format: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let items = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        cache::get_range(&conn, &email, &start, &end).map_err(|e| e.to_string())?
    };

    let filtered: Vec<_> = if let Some(tech) = &tech_filter {
        items
            .into_iter()
            .filter(|i| i.nome_tecnico.as_deref().unwrap_or("") == tech.as_str())
            .collect()
    } else {
        items
    };

    if filtered.is_empty() {
        return Err("Nessun intervento nel periodo selezionato".into());
    }

    let bytes = match format.as_str() {
        "summary" => pdf::generate_bulk_summary(&filtered).map_err(|e| e.to_string())?,
        _ => pdf::generate_bulk_detail(&filtered).map_err(|e| e.to_string())?,
    };

    Ok(STANDARD.encode(&bytes))
}
