use crate::db::cache::{self, CachedItem, CACHE_SCHEMA_VERSION};
use crate::exchange::client::EwsClient;
use crate::exchange::{parse, soap};
use crate::exchange::parse::InterventionItem;
use crate::keychain;
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
    let password = keychain::load_password(email).map_err(|e| e.to_string())?;
    EwsClient::new(&server, email, &password, domain.as_deref()).map_err(|e| e.to_string())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn item_to_cached(item: &InterventionItem, email: &str) -> CachedItem {
    CachedItem {
        id: 0,
        user_email: email.to_string(),
        exchange_item_id: item.exchange_item_id.clone(),
        change_key: item.change_key.clone(),
        start_dt: item.start_dt.clone(),
        end_dt: item.end_dt.clone(),
        subject: Some(item.subject.clone()),
        nome_tecnico: Some(item.nome_tecnico.clone()),
        ragione_sociale: Some(item.ragione_sociale.clone()),
        descrizione: Some(item.descrizione.clone()),
        altro: Some(item.altro.clone()),
        tipo_tariffa: Some(item.tipo_tariffa.clone()),
        tipo_fatturazione: Some(item.tipo_fatturazione.clone()),
        trasferta: Some(item.trasferta.clone()),
        durata: Some(item.durata.clone()),
        body_html: Some(item.body_html.clone()),
        schema_version: CACHE_SCHEMA_VERSION,
        synced_at: now_iso(),
    }
}

fn cached_to_item(c: CachedItem) -> InterventionItem {
    InterventionItem {
        exchange_item_id: c.exchange_item_id,
        change_key: c.change_key,
        start_dt: c.start_dt,
        end_dt: c.end_dt,
        subject: c.subject.unwrap_or_default(),
        nome_tecnico: c.nome_tecnico.unwrap_or_default(),
        ragione_sociale: c.ragione_sociale.unwrap_or_default(),
        descrizione: c.descrizione.unwrap_or_default(),
        altro: c.altro.unwrap_or_default(),
        tipo_tariffa: c.tipo_tariffa.unwrap_or_default(),
        tipo_fatturazione: c.tipo_fatturazione.unwrap_or_default(),
        trasferta: c.trasferta.unwrap_or_default(),
        durata: c.durata.unwrap_or_default(),
        body_html: c.body_html.unwrap_or_default(),
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
    Ok(cached.into_iter().map(cached_to_item).collect())
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
    let resp = client
        .call(
            "http://schemas.microsoft.com/exchange/services/2006/messages/GetItem",
            &soap_body,
        )
        .map_err(|e| e.to_string())?;
    let item = parse::parse_get_item(&resp).map_err(|e| e.to_string())?;

    // upsert into cache
    let cached = item_to_cached(&item, &email);
    if let Ok(conn) = state.db.0.lock() {
        cache::upsert_item(&conn, &cached).ok();
    }
    Ok(item)
}

#[derive(Debug, Deserialize)]
pub struct InterventionData {
    pub email: String,
    pub subject: Option<String>,
    pub start: String,
    pub end: String,
    pub body_html: Option<String>,
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

#[tauri::command]
pub async fn create_intervention(
    data: InterventionData,
    state: State<'_, AppState>,
) -> Result<InterventionItem, String> {
    let client = get_client(&state, &data.email)?;

    let subject = data.subject.clone().unwrap_or_else(|| {
        crate::exchange::subject::build_subject(
            data.nome_tecnico.as_deref().unwrap_or(""),
            data.ragione_sociale.as_deref().unwrap_or(""),
            data.descrizione.as_deref().unwrap_or(""),
            data.altro.as_deref().unwrap_or(""),
            data.tipo_tariffa.as_deref().unwrap_or(""),
            data.tipo_fatturazione.as_deref().unwrap_or(""),
        )
    });

    let soap_data = build_soap_data(&data.email, &data, &subject);
    let soap_body = soap::create_item(&soap_data);
    let resp = client
        .call(
            "http://schemas.microsoft.com/exchange/services/2006/messages/CreateItem",
            &soap_body,
        )
        .map_err(|e| e.to_string())?;
    let (item_id, change_key) = parse::parse_create_item(&resp).map_err(|e| e.to_string())?;

    let item = InterventionItem {
        exchange_item_id: item_id,
        change_key,
        start_dt: data.start.clone(),
        end_dt: data.end.clone(),
        subject,
        nome_tecnico: data.nome_tecnico.clone().unwrap_or_default(),
        ragione_sociale: data.ragione_sociale.clone().unwrap_or_default(),
        descrizione: data.descrizione.clone().unwrap_or_default(),
        altro: data.altro.clone().unwrap_or_default(),
        tipo_tariffa: data.tipo_tariffa.clone().unwrap_or_default(),
        tipo_fatturazione: data.tipo_fatturazione.clone().unwrap_or_default(),
        trasferta: data.trasferta.clone().unwrap_or_default(),
        durata: data.durata.clone().unwrap_or_default(),
        body_html: data.body_html.clone().unwrap_or_default(),
    };

    let cached = item_to_cached(&item, &data.email);
    if let Ok(conn) = state.db.0.lock() {
        cache::upsert_item(&conn, &cached).ok();
    }
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

    let subject = input.data.subject.clone().unwrap_or_else(|| {
        crate::exchange::subject::build_subject(
            input.data.nome_tecnico.as_deref().unwrap_or(""),
            input.data.ragione_sociale.as_deref().unwrap_or(""),
            input.data.descrizione.as_deref().unwrap_or(""),
            input.data.altro.as_deref().unwrap_or(""),
            input.data.tipo_tariffa.as_deref().unwrap_or(""),
            input.data.tipo_fatturazione.as_deref().unwrap_or(""),
        )
    });

    let soap_data = build_soap_data(&input.email, &input.data, &subject);
    let soap_body = soap::update_item(&input.item_id, &input.change_key, &soap_data);
    let resp = client
        .call(
            "http://schemas.microsoft.com/exchange/services/2006/messages/UpdateItem",
            &soap_body,
        )
        .map_err(|e| e.to_string())?;
    let new_ck = parse::parse_update_item(&resp).map_err(|e| e.to_string())?;

    let item = InterventionItem {
        exchange_item_id: input.item_id.clone(),
        change_key: if new_ck.is_empty() { input.change_key } else { new_ck },
        start_dt: input.data.start.clone(),
        end_dt: input.data.end.clone(),
        subject,
        nome_tecnico: input.data.nome_tecnico.clone().unwrap_or_default(),
        ragione_sociale: input.data.ragione_sociale.clone().unwrap_or_default(),
        descrizione: input.data.descrizione.clone().unwrap_or_default(),
        altro: input.data.altro.clone().unwrap_or_default(),
        tipo_tariffa: input.data.tipo_tariffa.clone().unwrap_or_default(),
        tipo_fatturazione: input.data.tipo_fatturazione.clone().unwrap_or_default(),
        trasferta: input.data.trasferta.clone().unwrap_or_default(),
        durata: input.data.durata.clone().unwrap_or_default(),
        body_html: input.data.body_html.clone().unwrap_or_default(),
    };

    let cached = item_to_cached(&item, &input.email);
    if let Ok(conn) = state.db.0.lock() {
        cache::upsert_item(&conn, &cached).ok();
    }
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
    let resp = client
        .call(
            "http://schemas.microsoft.com/exchange/services/2006/messages/DeleteItem",
            &soap_body,
        )
        .map_err(|e| e.to_string())?;
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
