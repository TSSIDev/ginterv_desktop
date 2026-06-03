use crate::db::cache::{self, CachedItem};
use crate::exchange::client::EwsClient;
use crate::exchange::{parse, soap};
use crate::exchange::parse::InterventionItem;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

fn get_client(state: &State<'_, AppState>, email: &str) -> Result<EwsClient, String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    let accounts = cache::list_accounts(&conn).map_err(|e| e.to_string())?;
    let acc = accounts
        .iter()
        .find(|a| a.email == email)
        .ok_or_else(|| format!("Account {} non trovato", email))?;
    let server = acc.server.clone().unwrap_or_default();
    let domain = acc.domain.clone();
    drop(conn);
    EwsClient::connect(&server, email, domain.as_deref()).map_err(|e| e.to_string())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn cache_upserted(state: &State<'_, AppState>, item: &InterventionItem, email: &str) {
    if let Ok(conn) = state.db.0.lock() {
        cache::upsert_item(&conn, &CachedItem::from_item(item, email)).ok();
    }
}

#[tauri::command]
pub async fn list_interventions(
    email: String,
    start: String,
    end: String,
    state: State<'_, AppState>,
) -> Result<Vec<InterventionItem>, String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    let cached = cache::get_range(&conn, &email, &start, &end).map_err(|e| e.to_string())?;
    Ok(cached.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn get_intervention(
    email: String,
    item_id: String,
    change_key: String,
    state: State<'_, AppState>,
) -> Result<InterventionItem, String> {
    let client = get_client(&state, &email)?;
    let soap_body = soap::get_item(&item_id, &change_key);
    let resp = client.call_action("GetItem", &soap_body).map_err(|e| e.to_string())?;
    let item = parse::parse_get_item(&resp).map_err(|e| e.to_string())?;

    cache_upserted(&state, &item, &email);
    Ok(item)
}

#[derive(Debug, Deserialize)]
pub struct InterventionData {
    pub email: String,
    pub subject: Option<String>,
    pub start: String,
    pub end: String,
    pub body_html: Option<String>,
    pub luogo: Option<String>,
    pub nome_tecnico: Option<String>,
    pub ragione_sociale: Option<String>,
    pub descrizione: Option<String>,
    pub altro: Option<String>,
    pub tipo_tariffa: Option<String>,
    pub tipo_fatturazione: Option<String>,
    pub trasferta: Option<String>,
    pub durata: Option<String>,
}

fn build_soap_data<'a>(email: &'a str, d: &'a InterventionData, subject: &'a str) -> soap::CreateItemData<'a> {
    soap::CreateItemData {
        email,
        subject,
        start: &d.start,
        end: &d.end,
        body_html: d.body_html.as_deref().unwrap_or(""),
        location: d.luogo.as_deref().unwrap_or(""),
        nome_tecnico: d.nome_tecnico.as_deref().unwrap_or(""),
        ragione_sociale: d.ragione_sociale.as_deref().unwrap_or(""),
        descrizione: d.descrizione.as_deref().unwrap_or(""),
        altro: d.altro.as_deref().unwrap_or(""),
        tipo_tariffa: d.tipo_tariffa.as_deref().unwrap_or(""),
        tipo_fatturazione: d.tipo_fatturazione.as_deref().unwrap_or(""),
        trasferta: d.trasferta.as_deref().unwrap_or(""),
        durata: d.durata.as_deref().unwrap_or(""),
    }
}

/// Use the explicit subject if provided, else build one from the structured fields.
fn resolve_subject(d: &InterventionData) -> String {
    d.subject.clone().unwrap_or_else(|| {
        crate::exchange::subject::build_subject(
            d.nome_tecnico.as_deref().unwrap_or(""),
            d.ragione_sociale.as_deref().unwrap_or(""),
            d.descrizione.as_deref().unwrap_or(""),
            d.altro.as_deref().unwrap_or(""),
            d.tipo_tariffa.as_deref().unwrap_or(""),
            d.tipo_fatturazione.as_deref().unwrap_or(""),
        )
    })
}

/// Assemble the returned `InterventionItem` from request data plus Exchange ids.
fn item_from_data(item_id: String, change_key: String, d: &InterventionData, subject: String) -> InterventionItem {
    InterventionItem {
        exchange_item_id: item_id,
        change_key,
        start_dt: d.start.clone(),
        end_dt: d.end.clone(),
        subject,
        nome_tecnico: d.nome_tecnico.clone().unwrap_or_default(),
        ragione_sociale: d.ragione_sociale.clone().unwrap_or_default(),
        descrizione: d.descrizione.clone().unwrap_or_default(),
        altro: d.altro.clone().unwrap_or_default(),
        tipo_tariffa: d.tipo_tariffa.clone().unwrap_or_default(),
        tipo_fatturazione: d.tipo_fatturazione.clone().unwrap_or_default(),
        trasferta: d.trasferta.clone().unwrap_or_default(),
        durata: d.durata.clone().unwrap_or_default(),
        body_html: d.body_html.clone().unwrap_or_default(),
        luogo: d.luogo.clone().unwrap_or_default(),
        pending_op: String::new(),
    }
}

#[tauri::command]
pub async fn create_intervention(
    data: InterventionData,
    state: State<'_, AppState>,
) -> Result<InterventionItem, String> {
    let client = get_client(&state, &data.email)?;

    let subject = resolve_subject(&data);
    let soap_data = build_soap_data(&data.email, &data, &subject);
    let soap_body = soap::create_item(&soap_data);
    let resp = client.call_action("CreateItem", &soap_body).map_err(|e| e.to_string())?;
    let (item_id, change_key) = parse::parse_create_item(&resp).map_err(|e| e.to_string())?;

    let item = item_from_data(item_id, change_key, &data, subject);
    cache_upserted(&state, &item, &data.email);
    Ok(item)
}

#[derive(Debug, Deserialize)]
pub struct UpdateInterventionInput {
    pub email: String,
    pub item_id: String,
    pub change_key: String,
    pub data: InterventionData,
}

#[tauri::command]
pub async fn update_intervention(
    input: UpdateInterventionInput,
    state: State<'_, AppState>,
) -> Result<InterventionItem, String> {
    let client = get_client(&state, &input.email)?;

    let subject = resolve_subject(&input.data);
    let soap_data = build_soap_data(&input.email, &input.data, &subject);
    let soap_body = soap::update_item(&input.item_id, &input.change_key, &soap_data);
    let resp = client.call_action("UpdateItem", &soap_body).map_err(|e| e.to_string())?;
    let new_ck = parse::parse_update_item(&resp).map_err(|e| e.to_string())?;

    let change_key = if new_ck.is_empty() { input.change_key } else { new_ck };
    let item = item_from_data(input.item_id.clone(), change_key, &input.data, subject);
    cache_upserted(&state, &item, &input.email);
    Ok(item)
}

#[tauri::command]
pub async fn delete_intervention(
    email: String,
    item_id: String,
    change_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let client = get_client(&state, &email)?;
    let soap_body = soap::delete_item(&item_id, &change_key);
    let resp = client.call_action("DeleteItem", &soap_body).map_err(|e| e.to_string())?;
    parse::parse_delete_item(&resp).map_err(|e| e.to_string())?;

    if let Ok(conn) = state.db.0.lock() {
        cache::delete_item(&conn, &email, &item_id).ok();
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct SignatureResult {
    pub found: bool,
    pub png_base64: Option<String>,
}

#[tauri::command]
pub async fn save_signature(
    exchange_item_id: String,
    png_base64: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    let now = now_iso();
    conn.execute(
        "INSERT INTO signatures (exchange_item_id, png_base64, created_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(exchange_item_id) DO UPDATE SET png_base64 = excluded.png_base64, created_at = excluded.created_at",
        rusqlite::params![exchange_item_id, png_base64, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_signature(
    exchange_item_id: String,
    state: State<'_, AppState>,
) -> Result<SignatureResult, String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT png_base64 FROM signatures WHERE exchange_item_id = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(rusqlite::params![exchange_item_id]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let png: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(SignatureResult { found: true, png_base64: Some(png) })
    } else {
        Ok(SignatureResult { found: false, png_base64: None })
    }
}

#[tauri::command]
pub async fn get_client_email(
    ragione_sociale: String,
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    let key = format!("client_email_{}", ragione_sociale);
    cache::get_config(&conn, &key)
        .map(|v| v.map(|s| serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s))))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_client_email(
    ragione_sociale: String,
    data: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    let key = format!("client_email_{}", ragione_sociale);
    let value = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    cache::set_config(&conn, &key, &value).map_err(|e| e.to_string())
}
