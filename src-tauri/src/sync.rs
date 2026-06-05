use crate::db::cache::{self, CachedItem};
use crate::exchange::client::EwsClient;
use crate::exchange::{parse, soap};
use crate::AppState;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

const SYNC_INTERVAL_SECS: u64 = 900; // 15 min
const SYNC_WINDOW_DAYS: i64 = 90; // default half-window (each side of today)
const SYNC_WINDOW_DAYS_MAX: i64 = 3650; // "Tutto" = ±10 years, EWS practical bound
const FETCH_CONCURRENCY: usize = 6; // default parallel GetItem round-trips per sync
const FETCH_CONCURRENCY_MAX: usize = 32; // clamp to avoid hammering Exchange
const GETITEM_BATCH_SIZE: usize = 25; // default ItemIds bundled per GetItem call
const GETITEM_BATCH_SIZE_MAX: usize = 50; // EWS handles more, but keep responses bounded
const FINDITEM_CHUNK_DAYS: i64 = 90; // keep CalendarView ranges under Exchange's practical limits

/// Read the configured sync half-window in days, clamped to 1..=SYNC_WINDOW_DAYS_MAX.
fn sync_window_days(state: &Arc<AppState>) -> i64 {
    let configured = state
        .db
        .0
        .lock()
        .ok()
        .and_then(|conn| cache::get_config(&conn, "sync_window_days").ok().flatten())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(SYNC_WINDOW_DAYS);
    configured.clamp(1, SYNC_WINDOW_DAYS_MAX)
}

/// Read the configured GetItem concurrency, clamped to 1..=FETCH_CONCURRENCY_MAX.
fn fetch_concurrency(state: &Arc<AppState>) -> usize {
    let configured = state
        .db
        .0
        .lock()
        .ok()
        .and_then(|conn| cache::get_config(&conn, "sync_fetch_concurrency").ok().flatten())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(FETCH_CONCURRENCY);
    configured.clamp(1, FETCH_CONCURRENCY_MAX)
}

/// Read the configured GetItem batch size, clamped to 1..=GETITEM_BATCH_SIZE_MAX.
fn getitem_batch_size(state: &Arc<AppState>) -> usize {
    let configured = state
        .db
        .0
        .lock()
        .ok()
        .and_then(|conn| cache::get_config(&conn, "sync_getitem_batch_size").ok().flatten())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(GETITEM_BATCH_SIZE);
    configured.clamp(1, GETITEM_BATCH_SIZE_MAX)
}

fn find_item_windows(now: chrono::DateTime<chrono::Utc>, window_days: i64) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut cursor = now - chrono::Duration::days(window_days);
    let end = now + chrono::Duration::days(window_days);

    while cursor < end {
        let next = (cursor + chrono::Duration::days(FINDITEM_CHUNK_DAYS)).min(end);
        out.push((
            cursor.format("%Y-%m-%dT00:00:00Z").to_string(),
            next.format("%Y-%m-%dT23:59:59Z").to_string(),
        ));
        cursor = next + chrono::Duration::days(1);
    }

    out
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SyncStatus {
    pub last_sync: Option<String>,
    pub is_syncing: bool,
    pub last_count: i64,
    pub last_error: Option<String>,
}

pub type SyncStatusMap = Arc<Mutex<HashMap<String, SyncStatus>>>;

/// Mutate the status entry for an account under a single short lock.
fn set_status(map: &SyncStatusMap, email: &str, f: impl FnOnce(&mut SyncStatus)) {
    if let Ok(mut m) = map.lock() {
        f(m.entry(email.to_string()).or_default());
    }
}

pub async fn sync_account(
    client: &EwsClient,
    email: &str,
    state: &Arc<AppState>,
    window: Option<&tauri::AppHandle>,
) -> anyhow::Result<i64> {
    let now = chrono::Utc::now();
    let window_days = sync_window_days(state);
    let start = (now - chrono::Duration::days(window_days))
        .format("%Y-%m-%dT00:00:00Z")
        .to_string();
    let end = (now + chrono::Duration::days(window_days))
        .format("%Y-%m-%dT23:59:59Z")
        .to_string();

    let mut remote_items = Vec::new();
    for (chunk_start, chunk_end) in find_item_windows(now, window_days) {
        let soap_body = soap::find_items(email, &chunk_start, &chunk_end);
        let resp = client.call_action("FindItem", &soap_body)?;
        remote_items.extend(parse::parse_find_items(&resp)?);
    }

    // Build map of remote change_keys
    let remote_map: HashMap<String, String> = remote_items
        .iter()
        .map(|i| (i.exchange_item_id.clone(), i.change_key.clone()))
        .collect();

    // Get cached items for this user
    let cached: Vec<CachedItem> = {
        let conn = state.db.0.lock().unwrap();
        cache::get_range(&conn, email, &start, &end).unwrap_or_default()
    };
    // Map: exchange_item_id → (change_key, nome_tecnico_empty)
    let cached_map: HashMap<String, (String, bool)> = cached
        .iter()
        .map(|c| {
            let nome_empty = c.nome_tecnico.as_deref().unwrap_or("").is_empty();
            (c.exchange_item_id.clone(), (c.change_key.clone(), nome_empty))
        })
        .collect();

    // Find items that need a full GetItem fetch:
    // - new items (not in cache)
    // - changed change_key
    // - cached but nome_tecnico is empty (stale from before subject-fallback fix)
    let to_fetch: Vec<(String, String)> = remote_items
        .iter()
        .filter(|i| {
            match cached_map.get(&i.exchange_item_id) {
                None => true, // new item
                Some((ck, nome_empty)) => ck != &i.change_key || *nome_empty,
            }
        })
        .map(|i| (i.exchange_item_id.clone(), i.change_key.clone()))
        .collect();

    // Land FindItem metadata (subject/times/location/ext props) for the to-fetch
    // items right away, preserving any cached body. New items become visible
    // immediately and survive a throttled/failed GetItem; the body is filled in
    // by the full upsert below.
    {
        let to_fetch_ids: std::collections::HashSet<&str> =
            to_fetch.iter().map(|(id, _)| id.as_str()).collect();
        if let Ok(conn) = state.db.0.lock() {
            for item in remote_items.iter().filter(|i| to_fetch_ids.contains(i.exchange_item_id.as_str())) {
                let meta = CachedItem::from_item(item, email);
                cache::upsert_item_metadata(&conn, &meta).ok();
            }
        }
    }

    // Fetch full items in batched GetItem calls (many ItemIds per round-trip),
    // running several batches concurrently and keeping `concurrency` in flight.
    // Batching slashes round-trips and NTLM handshakes; the persistent EwsClient
    // reuses authenticated connections across batches.
    let client = Arc::new(client.clone());
    let batch_size = getitem_batch_size(state);
    let batches: Vec<Vec<(String, String)>> =
        to_fetch.chunks(batch_size).map(|c| c.to_vec()).collect();

    let mut joinset: tokio::task::JoinSet<Vec<parse::InterventionItem>> =
        tokio::task::JoinSet::new();
    let mut pending = batches.into_iter();

    let spawn_fetch = |joinset: &mut tokio::task::JoinSet<Vec<parse::InterventionItem>>,
                       batch: Vec<(String, String)>| {
        let c = client.clone();
        joinset.spawn_blocking(move || {
            let refs: Vec<(&str, &str)> =
                batch.iter().map(|(id, ck)| (id.as_str(), ck.as_str())).collect();
            let get_soap = soap::get_items(&refs);
            c.call_message("GetItem", &get_soap)
                .ok()
                .and_then(|xml| parse::parse_find_items(&xml).ok())
                .unwrap_or_default()
        });
    };

    let concurrency = fetch_concurrency(state);
    for _ in 0..concurrency {
        match pending.next() {
            Some(batch) => spawn_fetch(&mut joinset, batch),
            None => break,
        }
    }

    let mut count = 0i64;
    while let Some(res) = joinset.join_next().await {
        if let Ok(items) = res {
            for item in items {
                let cached_item = CachedItem::from_item(&item, email);
                if let Ok(conn) = state.db.0.lock() {
                    cache::upsert_item(&conn, &cached_item).ok();
                }
                count += 1;
            }
        }
        if let Some(batch) = pending.next() {
            spawn_fetch(&mut joinset, batch);
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn find_item_windows_split_large_sync_ranges_into_90_day_chunks() {
        let now = chrono::Utc.with_ymd_and_hms(2026, 6, 3, 13, 0, 0).unwrap();
        let windows = find_item_windows(now, 180);

        assert_eq!(windows.len(), 4);
        assert_eq!(windows[0].0, "2025-12-05T00:00:00Z");
        assert_eq!(windows[0].1, "2026-03-05T23:59:59Z");
        assert_eq!(windows[3].0, "2026-09-04T00:00:00Z");
        assert_eq!(windows[3].1, "2026-11-30T23:59:59Z");
    }
}

pub async fn start_sync_loop(state: Arc<AppState>, sync_status: SyncStatusMap, handle: tauri::AppHandle) {
    loop {
        // Read interval from config (sync_interval_minutes), fallback to constant
        let interval_secs = {
            if let Ok(conn) = state.db.0.lock() {
                cache::get_config(&conn, "sync_interval_minutes")
                    .ok()
                    .flatten()
                    .and_then(|s| s.parse::<u64>().ok())
                    .map(|m| m * 60)
                    .unwrap_or(SYNC_INTERVAL_SECS)
            } else {
                SYNC_INTERVAL_SECS
            }
        };
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;

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

            set_status(&sync_status, &email, |s| s.is_syncing = true);

            let client = match EwsClient::connect(&server, &email, domain.as_deref()) {
                Ok(c) => c,
                Err(e) => {
                    set_status(&sync_status, &email, |s| {
                        s.is_syncing = false;
                        s.last_error = Some(e.to_string());
                    });
                    continue;
                }
            };

            let _ = crate::flush::flush_pending(&client, &email, &state, Some(&handle)).await;

            match sync_account(&client, &email, &state, Some(&handle)).await {
                Ok(count) => set_status(&sync_status, &email, |s| {
                    s.is_syncing = false;
                    s.last_sync = Some(chrono::Utc::now().to_rfc3339());
                    s.last_count = count;
                    s.last_error = None;
                }),
                Err(e) => set_status(&sync_status, &email, |s| {
                    s.is_syncing = false;
                    s.last_error = Some(e.to_string());
                }),
            }
        }
    }
}
