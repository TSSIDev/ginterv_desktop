use crate::db::cache;
use crate::exchange::client::EwsClient;
use crate::keychain;
use crate::sync::{self, SyncStatus, SyncStatusMap};
use crate::AppState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn trigger_sync(
    email: String,
    state: State<'_, AppState>,
    sync_status: State<'_, SyncStatusMap>,
    app_handle: tauri::AppHandle,
) -> Result<SyncStatus, String> {
    let acc = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        cache::list_accounts(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|a| a.email == email)
            .ok_or_else(|| format!("Account {} non trovato", email))?
    };

    let server = acc.server.unwrap_or_default();
    let domain = acc.domain;
    let pw = keychain::load_password(&email).map_err(|e| e.to_string())?;
    let client = EwsClient::new(&server, &email, &pw, domain.as_deref()).map_err(|e| e.to_string())?;

    {
        let mut map = sync_status.lock().map_err(|e| e.to_string())?;
        let entry = map.entry(email.clone()).or_default();
        entry.is_syncing = true;
    }

    let state_arc = Arc::new(AppState {
        db: crate::db::DbConn(std::sync::Mutex::new(
            crate::db::open().map_err(|e| e.to_string())?,
        )),
    });

    match sync::sync_account(&client, &email, &state_arc, Some(&app_handle)).await {
        Ok(count) => {
            let mut map = sync_status.lock().map_err(|e| e.to_string())?;
            let entry = map.entry(email.clone()).or_default();
            entry.is_syncing = false;
            entry.last_sync = Some(chrono::Utc::now().to_rfc3339());
            entry.last_count = count;
            entry.last_error = None;
            Ok(entry.clone())
        }
        Err(e) => {
            let mut map = sync_status.lock().map_err(|e| e.to_string())?;
            let entry = map.entry(email.clone()).or_default();
            entry.is_syncing = false;
            entry.last_error = Some(e.to_string());
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn sync_status_cmd(
    email: String,
    sync_status: State<'_, SyncStatusMap>,
) -> Result<SyncStatus, String> {
    let map = sync_status.lock().map_err(|e| e.to_string())?;
    Ok(map.get(&email).cloned().unwrap_or_default())
}
