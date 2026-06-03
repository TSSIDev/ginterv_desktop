use crate::db::cache::{self, CachedItem};
use crate::exchange::client::EwsClient;
use crate::exchange::{parse, soap};
use crate::AppState;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

const SYNC_INTERVAL_SECS: u64 = 900; // 15 min
const SYNC_WINDOW_DAYS: i64 = 90;
const FETCH_CONCURRENCY: usize = 6; // default parallel GetItem round-trips per sync
const FETCH_CONCURRENCY_MAX: usize = 32; // clamp to avoid hammering Exchange

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
    let start = (now - chrono::Duration::days(SYNC_WINDOW_DAYS))
        .format("%Y-%m-%dT00:00:00Z")
        .to_string();
    let end = (now + chrono::Duration::days(SYNC_WINDOW_DAYS))
        .format("%Y-%m-%dT23:59:59Z")
        .to_string();

    let soap_body = soap::find_items(email, &start, &end);
    let resp = client.call_action("FindItem", &soap_body)?;

    let remote_items = parse::parse_find_items(&resp)?;

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

    // Fetch full items concurrently (bounded), keeping FETCH_CONCURRENCY in flight.
    // Each GetItem is an independent blocking HTTP round-trip, so they parallelize well.
    let client = Arc::new(client.clone());
    let mut joinset: tokio::task::JoinSet<Option<parse::InterventionItem>> =
        tokio::task::JoinSet::new();
    let mut pending = to_fetch.into_iter();

    let spawn_fetch = |joinset: &mut tokio::task::JoinSet<Option<parse::InterventionItem>>,
                       job: (String, String)| {
        let c = client.clone();
        joinset.spawn_blocking(move || {
            let (item_id, change_key) = job;
            let get_soap = soap::get_item(&item_id, &change_key);
            c.call_message("GetItem", &get_soap)
                .ok()
                .and_then(|xml| parse::parse_get_item(&xml).ok())
        });
    };

    let concurrency = fetch_concurrency(state);
    for _ in 0..concurrency {
        match pending.next() {
            Some(job) => spawn_fetch(&mut joinset, job),
            None => break,
        }
    }

    let mut count = 0i64;
    while let Some(res) = joinset.join_next().await {
        if let Ok(Some(item)) = res {
            let cached_item = CachedItem::from_item(&item, email);
            if let Ok(conn) = state.db.0.lock() {
                cache::upsert_item(&conn, &cached_item).ok();
            }
            count += 1;
        }
        if let Some(job) = pending.next() {
            spawn_fetch(&mut joinset, job);
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
