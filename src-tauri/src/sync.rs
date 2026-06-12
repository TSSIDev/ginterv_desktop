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
const SYNC_MAX_CHANGES: usize = 512; // SyncFolderItems page size
const RECONCILE_INTERVAL_SECS: i64 = 86_400; // full CalendarView reconcile cadence alongside delta sync

/// Read a config value under a short DB lock.
fn get_cfg(state: &Arc<AppState>, key: &str) -> Option<String> {
    state
        .db
        .0
        .lock()
        .ok()
        .and_then(|conn| cache::get_config(&conn, key).ok().flatten())
}

/// Write a config value under a short DB lock (best effort).
fn set_cfg(state: &Arc<AppState>, key: &str, value: &str) {
    if let Ok(conn) = state.db.0.lock() {
        cache::set_config(&conn, key, value).ok();
    }
}

/// Read the configured sync half-window in days, clamped to 1..=SYNC_WINDOW_DAYS_MAX.
fn sync_window_days(state: &Arc<AppState>) -> i64 {
    get_cfg(state, "sync_window_days")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(SYNC_WINDOW_DAYS)
        .clamp(1, SYNC_WINDOW_DAYS_MAX)
}

/// Read the configured GetItem concurrency, clamped to 1..=FETCH_CONCURRENCY_MAX.
fn fetch_concurrency(state: &Arc<AppState>) -> usize {
    get_cfg(state, "sync_fetch_concurrency")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(FETCH_CONCURRENCY)
        .clamp(1, FETCH_CONCURRENCY_MAX)
}

/// Read the configured GetItem batch size, clamped to 1..=GETITEM_BATCH_SIZE_MAX.
fn getitem_batch_size(state: &Arc<AppState>) -> usize {
    get_cfg(state, "sync_getitem_batch_size")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(GETITEM_BATCH_SIZE)
        .clamp(1, GETITEM_BATCH_SIZE_MAX)
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

/// What the refetch decision needs to know about a cached row.
struct CachedMeta {
    change_key: String,
    nome_empty: bool,
    body_fetched: bool,
}

impl CachedMeta {
    fn of(c: &CachedItem) -> Self {
        CachedMeta {
            change_key: c.change_key.clone(),
            nome_empty: c.nome_tecnico.as_deref().unwrap_or("").is_empty(),
            body_fetched: c.body_fetched,
        }
    }
}

/// True if the item needs a full GetItem: new, changed change_key, or a stale
/// pre-`body_fetched` row that never got a real fetch. Once a row is
/// body_fetched, an empty nome_tecnico is accepted as genuine — no refetch loop.
fn needs_full_fetch(cached: Option<&CachedMeta>, remote_change_key: &str) -> bool {
    match cached {
        None => true, // new item
        Some(m) => m.change_key != remote_change_key || (m.nome_empty && !m.body_fetched),
    }
}

/// Entry point for one account sync. Uses the cheap SyncFolderItems delta when
/// a server token is available; falls back to (and periodically reconciles
/// with) the full CalendarView enumeration, which also expands recurring
/// appointments that the delta only reports as masters.
pub async fn sync_account(
    client: &EwsClient,
    email: &str,
    state: &Arc<AppState>,
    window: Option<&tauri::AppHandle>,
) -> anyhow::Result<i64> {
    let token_key = format!("sync_state_{email}");
    let reconcile_key = format!("sync_reconcile_at_{email}");

    let reconcile_due = get_cfg(state, &reconcile_key)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|t| {
            chrono::Utc::now().signed_duration_since(t).num_seconds() >= RECONCILE_INTERVAL_SECS
        })
        .unwrap_or(true);
    let saved_token = get_cfg(state, &token_key).filter(|t| !t.is_empty());

    let mut delta_count = None;
    if let Some(token) = saved_token.filter(|_| !reconcile_due) {
        match delta_sync(client, email, state, &token).await {
            Ok((count, new_token)) => {
                set_cfg(state, &token_key, &new_token);
                delta_count = Some(count);
            }
            // Server no longer recognizes the token → full resync below.
            Err(e) if e.to_string().contains("ErrorInvalidSyncStateData") => {
                set_cfg(state, &token_key, "");
            }
            Err(e) => return Err(e),
        }
    }

    let count = match delta_count {
        Some(c) => c,
        None => {
            let c = full_sync(client, email, state).await?;
            // (Re)build the delta token if missing; a still-valid token survives
            // the reconcile (re-reported changes are skipped via change_key).
            if get_cfg(state, &token_key).filter(|t| !t.is_empty()).is_none() {
                if let Ok(token) = bootstrap_sync_state(client, email).await {
                    set_cfg(state, &token_key, &token);
                }
            }
            set_cfg(state, &reconcile_key, &chrono::Utc::now().to_rfc3339());
            c
        }
    };

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

/// Full CalendarView enumeration of the configured window + client-side diff.
async fn full_sync(client: &EwsClient, email: &str, state: &Arc<AppState>) -> anyhow::Result<i64> {
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
    let cached: Vec<CachedItem> = state
        .db
        .0
        .lock()
        .ok()
        .map(|conn| cache::get_range(&conn, email, &start, &end).unwrap_or_default())
        .unwrap_or_default();
    let cached_map: HashMap<String, CachedMeta> = cached
        .iter()
        .map(|c| (c.exchange_item_id.clone(), CachedMeta::of(c)))
        .collect();

    let to_fetch: Vec<(String, String)> = remote_items
        .iter()
        .filter(|i| needs_full_fetch(cached_map.get(&i.exchange_item_id), &i.change_key))
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
            if let Ok(tx) = conn.unchecked_transaction() {
                for item in remote_items.iter().filter(|i| to_fetch_ids.contains(i.exchange_item_id.as_str())) {
                    let meta = CachedItem::from_item(item, email);
                    cache::upsert_item_metadata(&tx, &meta).ok();
                }
                tx.commit().ok();
            }
        }
    }

    let count = fetch_full_items(client, email, state, to_fetch).await;

    // Remove cached items that no longer exist on Exchange
    let stale: Vec<&String> = cached_map
        .keys()
        .filter(|id| !remote_map.contains_key(*id))
        .collect();
    if !stale.is_empty() {
        if let Ok(conn) = state.db.0.lock() {
            if let Ok(tx) = conn.unchecked_transaction() {
                for id in stale {
                    cache::delete_item(&tx, email, id).ok();
                }
                tx.commit().ok();
            }
        }
    }

    Ok(count)
}

/// SyncFolderItems delta: the server reports only creates/updates/deletes since
/// `token`. A quiet sync is a single tiny round-trip — no enumeration, no diff.
/// Returns (items fully fetched, new token to persist).
async fn delta_sync(
    client: &EwsClient,
    email: &str,
    state: &Arc<AppState>,
    token: &str,
) -> anyhow::Result<(i64, String)> {
    let mut token = token.to_string();
    let mut changed: Vec<parse::InterventionItem> = Vec::new();
    let mut deleted_ids: Vec<String> = Vec::new();
    loop {
        let soap_body = soap::sync_folder_items(email, Some(&token), SYNC_MAX_CHANGES);
        let resp = client.call_action("SyncFolderItems", &soap_body)?;
        let page = parse::parse_sync_folder_items(&resp)?;
        if !page.sync_state.is_empty() {
            token = page.sync_state;
        }
        changed.extend(page.changed);
        deleted_ids.extend(page.deleted_ids);
        if page.includes_last_item {
            break;
        }
    }

    if !deleted_ids.is_empty() {
        if let Ok(conn) = state.db.0.lock() {
            if let Ok(tx) = conn.unchecked_transaction() {
                for id in &deleted_ids {
                    cache::delete_item(&tx, email, id).ok();
                }
                tx.commit().ok();
            }
        }
    }

    if changed.is_empty() {
        return Ok((0, token));
    }

    // Refetch decision against the cache, one lock for the whole pass.
    let metas: HashMap<String, CachedMeta> = match state.db.0.lock() {
        Ok(conn) => changed
            .iter()
            .filter_map(|i| {
                cache::get_by_item_id(&conn, email, &i.exchange_item_id)
                    .ok()
                    .flatten()
                    .map(|c| (i.exchange_item_id.clone(), CachedMeta::of(&c)))
            })
            .collect(),
        Err(_) => HashMap::new(),
    };
    let to_process: Vec<&parse::InterventionItem> = changed
        .iter()
        .filter(|i| needs_full_fetch(metas.get(&i.exchange_item_id), &i.change_key))
        .collect();

    // Land metadata right away (also moves items whose Start changed).
    if let Ok(conn) = state.db.0.lock() {
        if let Ok(tx) = conn.unchecked_transaction() {
            for item in &to_process {
                cache::upsert_item_metadata(&tx, &CachedItem::from_item(item, email)).ok();
            }
            tx.commit().ok();
        }
    }

    // Body fetch only for items inside the configured window; out-of-window
    // rows keep metadata only and get reconciled by the periodic full sync.
    let now = chrono::Utc::now();
    let window_days = sync_window_days(state);
    let start = (now - chrono::Duration::days(window_days))
        .format("%Y-%m-%dT00:00:00Z")
        .to_string();
    let end = (now + chrono::Duration::days(window_days))
        .format("%Y-%m-%dT23:59:59Z")
        .to_string();
    let to_fetch: Vec<(String, String)> = to_process
        .iter()
        .filter(|i| i.start_dt.as_str() >= start.as_str() && i.start_dt.as_str() <= end.as_str())
        .map(|i| (i.exchange_item_id.clone(), i.change_key.clone()))
        .collect();

    let count = fetch_full_items(client, email, state, to_fetch).await;
    Ok((count, token))
}

/// Walk SyncFolderItems from scratch, discarding the reported items, just to
/// obtain a current SyncState token after a full sync has landed the data.
async fn bootstrap_sync_state(client: &EwsClient, email: &str) -> anyhow::Result<String> {
    let mut token: Option<String> = None;
    loop {
        let soap_body = soap::sync_folder_items(email, token.as_deref(), SYNC_MAX_CHANGES);
        let resp = client.call_action("SyncFolderItems", &soap_body)?;
        let page = parse::parse_sync_folder_items(&resp)?;
        if page.sync_state.is_empty() {
            anyhow::bail!("SyncFolderItems returned an empty SyncState");
        }
        let done = page.includes_last_item;
        token = Some(page.sync_state);
        if done {
            return Ok(token.unwrap_or_default());
        }
    }
}

/// Fetch full items in batched GetItem calls (many ItemIds per round-trip),
/// running several batches concurrently and keeping `concurrency` in flight.
/// Batching slashes round-trips and NTLM handshakes; the persistent EwsClient
/// reuses authenticated connections across batches. Each landed batch is one
/// lock + one transaction. Returns the number of items landed.
async fn fetch_full_items(
    client: &EwsClient,
    email: &str,
    state: &Arc<AppState>,
    to_fetch: Vec<(String, String)>,
) -> i64 {
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
            if let Ok(conn) = state.db.0.lock() {
                if let Ok(tx) = conn.unchecked_transaction() {
                    for item in &items {
                        cache::upsert_item(&tx, &CachedItem::from_item(item, email)).ok();
                    }
                    tx.commit().ok();
                }
            }
            count += items.len() as i64;
        }
        if let Some(batch) = pending.next() {
            spawn_fetch(&mut joinset, batch);
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn meta(ck: &str, nome_empty: bool, body_fetched: bool) -> CachedMeta {
        CachedMeta { change_key: ck.to_string(), nome_empty, body_fetched }
    }

    #[test]
    fn needs_full_fetch_rules() {
        // new item → fetch
        assert!(needs_full_fetch(None, "CK1"));
        // changed change_key → fetch
        assert!(needs_full_fetch(Some(&meta("CK0", false, true)), "CK1"));
        // unchanged, nome present → no fetch
        assert!(!needs_full_fetch(Some(&meta("CK1", false, true)), "CK1"));
        // unchanged, nome empty but never body-fetched (stale pre-fix row) → fetch once
        assert!(needs_full_fetch(Some(&meta("CK1", true, false)), "CK1"));
        // unchanged, nome genuinely empty AND already fully fetched → NO eternal refetch loop
        assert!(!needs_full_fetch(Some(&meta("CK1", true, true)), "CK1"));
    }

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
