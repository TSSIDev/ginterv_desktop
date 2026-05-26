use crate::db::cache::{self, CachedItem, CACHE_SCHEMA_VERSION};
use crate::exchange::client::EwsClient;
use crate::exchange::{parse, soap};
use crate::keychain;
use crate::AppState;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

const SYNC_INTERVAL_SECS: u64 = 900; // 15 min
const SYNC_WINDOW_DAYS: i64 = 90;

#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncStatus {
    pub last_sync: Option<String>,
    pub is_syncing: bool,
    pub last_count: i64,
    pub last_error: Option<String>,
}

impl Default for SyncStatus {
    fn default() -> Self {
        Self { last_sync: None, is_syncing: false, last_count: 0, last_error: None }
    }
}

pub type SyncStatusMap = Arc<Mutex<HashMap<String, SyncStatus>>>;

pub async fn sync_account(
    client: &EwsClient,
    email: &str,
    state: &Arc<AppState>,
    window: Option<&tauri::AppHandle>,
) -> anyhow::Result<i64> {
    let now = chrono::Utc::now();
    let start = (now - chrono::Duration::days(SYNC_WINDOW_DAYS))
        .format("%Y-%m-%dT00:00:00Z")
        .to_string();
    let end = (now + chrono::Duration::days(SYNC_WINDOW_DAYS))
        .format("%Y-%m-%dT23:59:59Z")
        .to_string();

    let soap_body = soap::find_items(email, &start, &end);
    let resp = tokio::task::block_in_place(|| {
        client.call(
            "http://schemas.microsoft.com/exchange/services/2006/messages/FindItem",
            &soap_body,
        )
    })?;

    let remote_items = parse::parse_find_items(&resp)?;

    // Build map of remote change_keys
    let remote_map: HashMap<String, String> = remote_items
        .iter()
        .map(|i| (i.exchange_item_id.clone(), i.change_key.clone()))
        .collect();

    // Get cached change_keys for this user
    let cached: Vec<CachedItem> = {
        let conn = state.db.0.lock().unwrap();
        cache::get_range(&conn, email, &start, &end).unwrap_or_default()
    };
    let cached_map: HashMap<String, String> = cached
        .iter()
        .map(|c| (c.exchange_item_id.clone(), c.change_key.clone()))
        .collect();

    // Find items that need a full GetItem fetch (new or changed change_key)
    let to_fetch: Vec<(String, String)> = remote_items
        .iter()
        .filter(|i| {
            cached_map
                .get(&i.exchange_item_id)
                .map(|ck| ck != &i.change_key)
                .unwrap_or(true)
        })
        .map(|i| (i.exchange_item_id.clone(), i.change_key.clone()))
        .collect();

    let mut count = 0i64;
    for (item_id, change_key) in &to_fetch {
        let get_soap = soap::get_item(item_id, change_key);
        let get_resp = tokio::task::block_in_place(|| {
            client.call(
                "http://schemas.microsoft.com/exchange/services/2006/messages/GetItem",
                &get_soap,
            )
        });
        if let Ok(xml) = get_resp {
            if let Ok(item) = parse::parse_get_item(&xml) {
                let cached_item = CachedItem {
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
                    synced_at: chrono::Utc::now().to_rfc3339(),
                };
                if let Ok(conn) = state.db.0.lock() {
                    cache::upsert_item(&conn, &cached_item).ok();
                }
                count += 1;
            }
        }
    }

    // Remove cached items that no longer exist on Exchange
    for cached_id in cached_map.keys() {
        if !remote_map.contains_key(cached_id) {
            if let Ok(conn) = state.db.0.lock() {
                cache::delete_item(&conn, email, cached_id).ok();
            }
        }
    }

    // Emit sync-complete event
    if let Some(handle) = window {
        let _ = handle.emit(
            "sync-complete",
            serde_json::json!({
                "account": email,
                "count": count,
                "last_sync": chrono::Utc::now().to_rfc3339(),
            }),
        );
    }

    Ok(count)
}

pub async fn start_sync_loop(state: Arc<AppState>, sync_status: SyncStatusMap, handle: tauri::AppHandle) {
    loop {
        tokio::time::sleep(Duration::from_secs(SYNC_INTERVAL_SECS)).await;

        let accounts = {
            if let Ok(conn) = state.db.0.lock() {
                cache::list_accounts(&conn).unwrap_or_default()
            } else {
                continue;
            }
        };

        for acc in accounts {
            let email = acc.email.clone();
            let server = acc.server.clone().unwrap_or_default();
            let domain = acc.domain.clone();

            // Mark as syncing
            {
                let mut map = sync_status.lock().unwrap();
                let entry = map.entry(email.clone()).or_default();
                entry.is_syncing = true;
            }

            let pw = match keychain::load_password(&email) {
                Ok(p) => p,
                Err(_) => {
                    let mut map = sync_status.lock().unwrap();
                    let entry = map.entry(email.clone()).or_default();
                    entry.is_syncing = false;
                    entry.last_error = Some("Password non trovata nel keychain".into());
                    continue;
                }
            };

            let client = match EwsClient::new(&server, &email, &pw, domain.as_deref()) {
                Ok(c) => c,
                Err(e) => {
                    let mut map = sync_status.lock().unwrap();
                    let entry = map.entry(email.clone()).or_default();
                    entry.is_syncing = false;
                    entry.last_error = Some(e.to_string());
                    continue;
                }
            };

            match sync_account(&client, &email, &state, Some(&handle)).await {
                Ok(count) => {
                    let mut map = sync_status.lock().unwrap();
                    let entry = map.entry(email.clone()).or_default();
                    entry.is_syncing = false;
                    entry.last_sync = Some(chrono::Utc::now().to_rfc3339());
                    entry.last_count = count;
                    entry.last_error = None;
                }
                Err(e) => {
                    let mut map = sync_status.lock().unwrap();
                    let entry = map.entry(email.clone()).or_default();
                    entry.is_syncing = false;
                    entry.last_error = Some(e.to_string());
                }
            }
        }
    }
}
