use crate::commands::interventions::InterventionData;
use crate::db::{cache, queue};
use crate::exchange::client::EwsClient;
use crate::exchange::{parse, soap};
use crate::AppState;
use std::sync::Arc;
use tauri::Emitter;

/// A conflict exists when the server's current change_key differs from the one
/// the queued edit/delete was based on. An empty/absent base means "no baseline"
/// (treat as no conflict — e.g. a create has no base).
pub fn is_conflict(base_change_key: Option<&str>, server_change_key: &str) -> bool {
    match base_change_key {
        Some(b) if !b.is_empty() => b != server_change_key,
        _ => false,
    }
}

/// Read the live server change_key for an item (None if it no longer exists).
fn server_change_key(client: &EwsClient, item_id: &str, base_ck: &str) -> Option<String> {
    let xml = client
        .call_action("GetItem", &soap::get_item(item_id, base_ck))
        .ok()?;
    parse::parse_get_item(&xml).ok().map(|i| i.change_key)
}

fn data_from_payload(payload: &Option<String>) -> Option<InterventionData> {
    serde_json::from_str(payload.as_deref()?).ok()
}

enum FlushOutcome {
    Done,
    Conflict,
    Retry(String),
}

/// Drain the pending queue for one account, FIFO. Serialized by the caller.
/// Returns the number of ops successfully flushed.
pub async fn flush_pending(
    client: &EwsClient,
    email: &str,
    state: &Arc<AppState>,
    window: Option<&tauri::AppHandle>,
) -> anyhow::Result<i64> {
    let ops = {
        let conn = state
            .db
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("DB lock poisoned"))?;
        queue::list_pending(&conn, email)?
    };

    let mut flushed = 0i64;
    let mut had_conflict = false;

    for op in ops {
        match flush_one(client, email, state, &op) {
            FlushOutcome::Done => {
                if let Ok(conn) = state.db.0.lock() {
                    queue::delete_op(&conn, op.id).ok();
                }
                flushed += 1;
            }
            FlushOutcome::Conflict => {
                if let Ok(conn) = state.db.0.lock() {
                    queue::mark_conflict(&conn, op.id).ok();
                }
                had_conflict = true;
            }
            FlushOutcome::Retry(err) => {
                if let Ok(conn) = state.db.0.lock() {
                    queue::mark_error(&conn, op.id, &err).ok();
                }
                // Network/transient: stop draining; retry on the next trigger.
                break;
            }
        }
    }

    if let Some(handle) = window {
        if had_conflict {
            let _ = handle.emit("write-conflict", serde_json::json!({ "account": email }));
        }
        if flushed > 0 {
            let _ = handle.emit(
                "flush-complete",
                serde_json::json!({ "account": email, "flushed": flushed }),
            );
        }
    }
    Ok(flushed)
}

fn flush_one(
    client: &EwsClient,
    email: &str,
    state: &Arc<AppState>,
    op: &queue::PendingOp,
) -> FlushOutcome {
    match op.op_type.as_str() {
        "create" => {
            let Some(data) = data_from_payload(&op.payload) else {
                return FlushOutcome::Retry("invalid create payload".into());
            };
            let subject = crate::commands::interventions::resolve_subject(&data);
            let soap_data = crate::commands::interventions::build_soap_data(email, &data, &subject);
            match client.call_action("CreateItem", &soap::create_item(&soap_data)) {
                Ok(xml) => match parse::parse_create_item(&xml) {
                    Ok((real_id, ck)) => {
                        if let Ok(conn) = state.db.0.lock() {
                            cache::reconcile_create(&conn, email, &op.local_id, &real_id, &ck).ok();
                        }
                        FlushOutcome::Done
                    }
                    Err(e) => FlushOutcome::Retry(e.to_string()),
                },
                Err(e) => FlushOutcome::Retry(e.to_string()),
            }
        }
        "update" => {
            let item_id = op.exchange_item_id.clone().unwrap_or_default();
            let base = op.base_change_key.as_deref().unwrap_or("");
            let Some(server_ck) = server_change_key(client, &item_id, base) else {
                return FlushOutcome::Retry("GetItem failed".into());
            };
            if is_conflict(op.base_change_key.as_deref(), &server_ck) {
                return FlushOutcome::Conflict;
            }
            let Some(data) = data_from_payload(&op.payload) else {
                return FlushOutcome::Retry("invalid update payload".into());
            };
            let subject = crate::commands::interventions::resolve_subject(&data);
            let soap_data = crate::commands::interventions::build_soap_data(email, &data, &subject);
            match client.call_action(
                "UpdateItem",
                &soap::update_item(&item_id, &server_ck, &soap_data),
            ) {
                Ok(xml) => match parse::parse_update_item(&xml) {
                    Ok(new_ck) => {
                        let ck = if new_ck.is_empty() { server_ck } else { new_ck };
                        if let Ok(conn) = state.db.0.lock() {
                            cache::reconcile_update(&conn, email, &item_id, &ck).ok();
                        }
                        FlushOutcome::Done
                    }
                    Err(e) => FlushOutcome::Retry(e.to_string()),
                },
                Err(e) => FlushOutcome::Retry(e.to_string()),
            }
        }
        "delete" => {
            let item_id = op.exchange_item_id.clone().unwrap_or_default();
            let base = op.base_change_key.as_deref().unwrap_or("");
            let server_ck = match server_change_key(client, &item_id, base) {
                Some(ck) => ck,
                // Already gone server-side: treat as done, drop the tombstone.
                None => {
                    if let Ok(conn) = state.db.0.lock() {
                        cache::delete_item(&conn, email, &item_id).ok();
                    }
                    return FlushOutcome::Done;
                }
            };
            if is_conflict(op.base_change_key.as_deref(), &server_ck) {
                return FlushOutcome::Conflict;
            }
            match client.call_action("DeleteItem", &soap::delete_item(&item_id, &server_ck)) {
                Ok(xml) => match parse::parse_delete_item(&xml) {
                    Ok(()) => {
                        if let Ok(conn) = state.db.0.lock() {
                            cache::delete_item(&conn, email, &item_id).ok();
                        }
                        FlushOutcome::Done
                    }
                    Err(e) => FlushOutcome::Retry(e.to_string()),
                },
                Err(e) => FlushOutcome::Retry(e.to_string()),
            }
        }
        _ => FlushOutcome::Retry("unknown op_type".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_conflict() {
        assert!(!is_conflict(None, "CK"));
        assert!(!is_conflict(Some(""), "CK"));
        assert!(!is_conflict(Some("CK"), "CK"));
        assert!(is_conflict(Some("OLD"), "NEW"));
    }
}
