use crate::db::cache;
use crate::exchange::client::EwsClient;
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
    let client =
        EwsClient::connect(&server, &email, domain.as_deref()).map_err(|e| e.to_string())?;

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

use crate::db::queue;
use crate::exchange::{parse, soap};
use crate::flush;

/// Manually drain the queue for an account (called on online/focus).
#[tauri::command]
pub async fn flush_queue(
    email: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<i64, String> {
    let acc = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        cache::list_accounts(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|a| a.email == email)
            .ok_or_else(|| format!("Account {} non trovato", email))?
    };
    let server = acc.server.unwrap_or_default();
    let client =
        EwsClient::connect(&server, &email, acc.domain.as_deref()).map_err(|e| e.to_string())?;
    let state_arc = Arc::new(AppState {
        db: crate::db::DbConn(std::sync::Mutex::new(
            crate::db::open().map_err(|e| e.to_string())?,
        )),
    });
    flush::flush_pending(&client, &email, &state_arc, Some(&app_handle))
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct ConflictView {
    pub op_id: i64,
    pub op_type: String,
    pub mine: Option<crate::exchange::parse::InterventionItem>,
    pub server: Option<crate::exchange::parse::InterventionItem>,
}

/// List conflicts with both versions so the UI can render a field diff.
#[tauri::command]
pub async fn list_conflicts(
    email: String,
    state: State<'_, AppState>,
) -> Result<Vec<ConflictView>, String> {
    let ops = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        queue::list_conflicts(&conn, &email).map_err(|e| e.to_string())?
    };
    let acc = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        cache::list_accounts(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|a| a.email == email)
    };
    let client = acc.as_ref().and_then(|a| {
        EwsClient::connect(
            &a.server.clone().unwrap_or_default(),
            &email,
            a.domain.as_deref(),
        )
        .ok()
    });

    let mut out = Vec::new();
    for op in ops {
        let item_id = op.exchange_item_id.clone().unwrap_or_default();
        let mine = {
            let conn = state.db.0.lock().map_err(|e| e.to_string())?;
            cache::get_by_item_id(&conn, &email, &item_id)
                .ok()
                .flatten()
                .map(Into::into)
        };
        let server = client.as_ref().and_then(|c| {
            let base = op.base_change_key.as_deref().unwrap_or("");
            c.call_action("GetItem", &soap::get_item(&item_id, base))
                .ok()
                .and_then(|xml| parse::parse_get_item(&xml).ok())
        });
        out.push(ConflictView {
            op_id: op.id,
            op_type: op.op_type,
            mine,
            server,
        });
    }
    Ok(out)
}

/// Resolve a conflict: choice = "mine" | "server".
#[tauri::command]
pub async fn resolve_conflict(
    op_id: i64,
    choice: String,
    email: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let op = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        queue::get(&conn, op_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Op non trovata".to_string())?
    };
    let item_id = op.exchange_item_id.clone().unwrap_or_default();
    let acc = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        cache::list_accounts(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|a| a.email == email)
            .ok_or_else(|| "Account non trovato".to_string())?
    };
    let client = EwsClient::connect(
        &acc.server.clone().unwrap_or_default(),
        &email,
        acc.domain.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    // Read the current server change_key to rebase on.
    let server_ck = client
        .call_action(
            "GetItem",
            &soap::get_item(&item_id, op.base_change_key.as_deref().unwrap_or("")),
        )
        .ok()
        .and_then(|xml| parse::parse_get_item(&xml).ok())
        .map(|i| i.change_key);

    if choice == "server" {
        // Discard local op; pull server version into cache (clearing pending).
        if let Ok(xml) = client.call_action(
            "GetItem",
            &soap::get_item(&item_id, server_ck.as_deref().unwrap_or("")),
        ) {
            if let Ok(item) = parse::parse_get_item(&xml) {
                if let Ok(conn) = state.db.0.lock() {
                    let mut cached = cache::CachedItem::from_item(&item, &email);
                    cached.pending_op = None;
                    cache::upsert_item(&conn, &cached).ok();
                }
            }
        }
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        queue::delete_op(&conn, op_id).map_err(|e| e.to_string())?;
    } else {
        // Keep mine: rebase the op on the fresh change_key and re-queue.
        let ck = server_ck.ok_or_else(|| "Impossibile leggere versione server".to_string())?;
        {
            let conn = state.db.0.lock().map_err(|e| e.to_string())?;
            queue::rebase_pending(&conn, op_id, &ck).map_err(|e| e.to_string())?;
        }
        let state_arc = Arc::new(AppState {
            db: crate::db::DbConn(std::sync::Mutex::new(
                crate::db::open().map_err(|e| e.to_string())?,
            )),
        });
        flush::flush_pending(&client, &email, &state_arc, Some(&app_handle))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
