# Offline Write-Queue + Optimistic Write + Conflict Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make intervention create/update/delete optimistic and offline-capable, with a durable queue flushed in the background and explicit conflict resolution (keep mine / keep server) instead of silent overwrite.

**Architecture:** Every write applies to the local SQLite cache immediately (optimistic), enqueues a row in a new `pending_ops` table, and returns at once. A `flush` module drains the queue FIFO per account: creates reconcile a temp id to the real Exchange id; updates/deletes compare the stored `base_change_key` against the live server `change_key` and, on mismatch, mark the op `conflict` and emit an event the UI resolves with a field-level diff.

**Tech Stack:** Rust (Tauri 2, rusqlite, reqwest blocking, quick-xml), vanilla JS frontend.

**Spec:** `docs/superpowers/specs/2026-06-03-write-queue-offline-design.md`

---

## File Structure

- `src-tauri/src/db/migrations.rs` — add `pending_ops` table + `pending_op` column (modify)
- `src-tauri/src/db/cache.rs` — `pending_op` on `CachedItem`, tombstone filter, reconcile helpers (modify)
- `src-tauri/src/db/queue.rs` — **new**: `pending_ops` CRUD + types
- `src-tauri/src/db/mod.rs` — register `queue` module (modify)
- `src-tauri/src/exchange/parse.rs` — add `pending_op` field to `InterventionItem` (modify)
- `src-tauri/src/flush.rs` — **new**: `is_conflict`, `flush_pending`, conflict snapshot
- `src-tauri/src/commands/interventions.rs` — optimistic write commands (modify)
- `src-tauri/src/commands/sync.rs` — `flush_queue`, `list_conflicts`, `resolve_conflict` (modify)
- `src-tauri/src/lib.rs` — register `flush` module + new commands (modify)
- `src/app.js` — optimistic badges, conflict modal + diff, `flush_queue` on online/focus (modify)
- `src/index.html` — conflict modal markup, bump `app.js?v=` (modify)
- `src/style.css` — pending badge + conflict diff styles (modify)

---

## Task 1: DB migration — pending_ops table + pending_op column

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`

- [ ] **Step 1: Add the table and column to `run()`**

In `src-tauri/src/db/migrations.rs`, add the `pending_ops` table inside the `execute_batch` string (after the `app_config` table), and a new `ALTER TABLE` after the existing `luogo` alter:

```rust
        CREATE TABLE IF NOT EXISTS app_config (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS pending_ops (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email       TEXT NOT NULL,
            op_type          TEXT NOT NULL,
            local_id         TEXT NOT NULL,
            exchange_item_id TEXT,
            base_change_key  TEXT,
            payload          TEXT,
            status           TEXT NOT NULL DEFAULT 'pending',
            attempts         INTEGER NOT NULL DEFAULT 0,
            last_error       TEXT,
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL
        );
        ",
    )?;
    // Add luogo column to existing DBs (ignored if already present)
    conn.execute(
        "ALTER TABLE intervention_cache ADD COLUMN luogo TEXT",
        [],
    ).ok();
    // Optimistic-write marker: create | update | delete (NULL = synced)
    conn.execute(
        "ALTER TABLE intervention_cache ADD COLUMN pending_op TEXT",
        [],
    ).ok();
    Ok(())
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds (warnings ok). The `cache::tests` `setup()` runs `migrations::run`, so the new schema is exercised by later tasks.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat(db): add pending_ops table and pending_op cache column"
```

---

## Task 2: cache.rs — pending_op field, tombstone filter, reconcile helpers

**Files:**
- Modify: `src-tauri/src/db/cache.rs`

- [ ] **Step 1: Write failing tests**

Append these tests inside the existing `mod tests` in `src-tauri/src/db/cache.rs` (before the closing `}`):

```rust
    #[test]
    fn test_get_range_hides_delete_tombstones() {
        let conn = setup();
        let mut item = CachedItem {
            id: 0, user_email: "u@u.com".into(), exchange_item_id: "T1".into(),
            change_key: "CK".into(), start_dt: "2024-08-01T08:00:00".into(),
            end_dt: "2024-08-01T09:00:00".into(), subject: Some("x".into()),
            nome_tecnico: None, ragione_sociale: None, descrizione: None, altro: None,
            tipo_tariffa: None, tipo_fatturazione: None, trasferta: None, durata: None,
            body_html: None, luogo: None, pending_op: None, schema_version: 1,
            synced_at: "2024-08-01T10:00:00".into(),
        };
        upsert_item(&conn, &item).unwrap();
        assert_eq!(get_range(&conn, "u@u.com", "2024-08-01", "2024-08-02").unwrap().len(), 1);
        // Tombstone it
        mark_pending(&conn, "u@u.com", "T1", "delete").unwrap();
        assert!(get_range(&conn, "u@u.com", "2024-08-01", "2024-08-02").unwrap().is_empty());
        // But pending update stays visible
        item.exchange_item_id = "T2".into();
        upsert_item(&conn, &item).unwrap();
        mark_pending(&conn, "u@u.com", "T2", "update").unwrap();
        let rows = get_range(&conn, "u@u.com", "2024-08-01", "2024-08-02").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pending_op.as_deref(), Some("update"));
    }

    #[test]
    fn test_reconcile_create_migrates_id_and_signature() {
        let conn = setup();
        let item = CachedItem {
            id: 0, user_email: "u@u.com".into(), exchange_item_id: "tmp-abc".into(),
            change_key: "".into(), start_dt: "2024-09-01T08:00:00".into(),
            end_dt: "2024-09-01T09:00:00".into(), subject: Some("new".into()),
            nome_tecnico: None, ragione_sociale: None, descrizione: None, altro: None,
            tipo_tariffa: None, tipo_fatturazione: None, trasferta: None, durata: None,
            body_html: None, luogo: None, pending_op: Some("create".into()), schema_version: 1,
            synced_at: "2024-09-01T10:00:00".into(),
        };
        upsert_item(&conn, &item).unwrap();
        conn.execute(
            "INSERT INTO signatures (exchange_item_id, png_base64, created_at) VALUES ('tmp-abc','PNG','t')",
            [],
        ).unwrap();

        reconcile_create(&conn, "u@u.com", "tmp-abc", "REAL-1", "CK-NEW").unwrap();

        let row = get_by_item_id(&conn, "u@u.com", "REAL-1").unwrap().unwrap();
        assert_eq!(row.change_key, "CK-NEW");
        assert_eq!(row.pending_op, None);
        assert!(get_by_item_id(&conn, "u@u.com", "tmp-abc").unwrap().is_none());
        let sig = get_signature_b64(&conn, "REAL-1").unwrap();
        assert_eq!(sig.as_deref(), Some("PNG"));
    }

    #[test]
    fn test_reconcile_update_clears_pending() {
        let conn = setup();
        let item = CachedItem {
            id: 0, user_email: "u@u.com".into(), exchange_item_id: "U1".into(),
            change_key: "OLD".into(), start_dt: "2024-10-01T08:00:00".into(),
            end_dt: "2024-10-01T09:00:00".into(), subject: Some("s".into()),
            nome_tecnico: None, ragione_sociale: None, descrizione: None, altro: None,
            tipo_tariffa: None, tipo_fatturazione: None, trasferta: None, durata: None,
            body_html: None, luogo: None, pending_op: Some("update".into()), schema_version: 1,
            synced_at: "2024-10-01T10:00:00".into(),
        };
        upsert_item(&conn, &item).unwrap();
        reconcile_update(&conn, "u@u.com", "U1", "NEWCK").unwrap();
        let row = get_by_item_id(&conn, "u@u.com", "U1").unwrap().unwrap();
        assert_eq!(row.change_key, "NEWCK");
        assert_eq!(row.pending_op, None);
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cache::tests 2>&1`
Expected: compile errors — `pending_op` field missing on `CachedItem`, `mark_pending`/`reconcile_create`/`reconcile_update` not found.

- [ ] **Step 3: Add `pending_op` to `CachedItem` and the column plumbing**

In `src-tauri/src/db/cache.rs`:

Update `CACHE_COLS` to add `pending_op` before `schema_version`:

```rust
const CACHE_COLS: &str = "id, user_email, exchange_item_id, change_key, start_dt, end_dt,
        subject, nome_tecnico, ragione_sociale, descrizione, altro,
        tipo_tariffa, tipo_fatturazione, trasferta, durata, body_html,
        luogo, pending_op, schema_version, synced_at";
```

Update `row_to_cached` indices (luogo=16, pending_op=17, schema_version=18, synced_at=19):

```rust
        luogo: r.get(16)?,
        pending_op: r.get(17)?,
        schema_version: r.get(18)?,
        synced_at: r.get(19)?,
    })
}
```

Add the field to the struct (after `luogo`):

```rust
    pub luogo: Option<String>,
    pub pending_op: Option<String>,
    pub schema_version: i64,
```

In `from_item`, set it after `luogo`:

```rust
            luogo: Some(item.luogo.clone()),
            pending_op: None,
```

- [ ] **Step 4: Thread `pending_op` through both upserts**

In `upsert_item`, add `pending_op` to the column list, values list (`?17` shifts), and the `ON CONFLICT` set. Replace the body:

```rust
pub fn upsert_item(conn: &Connection, item: &CachedItem) -> Result<()> {
    conn.execute(
        "INSERT INTO intervention_cache (
            user_email, exchange_item_id, change_key, start_dt, end_dt,
            subject, nome_tecnico, ragione_sociale, descrizione, altro,
            tipo_tariffa, tipo_fatturazione, trasferta, durata, body_html,
            luogo, pending_op, schema_version, synced_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
        ON CONFLICT(user_email, exchange_item_id) DO UPDATE SET
            change_key        = excluded.change_key,
            start_dt          = excluded.start_dt,
            end_dt            = excluded.end_dt,
            subject           = excluded.subject,
            nome_tecnico      = excluded.nome_tecnico,
            ragione_sociale   = excluded.ragione_sociale,
            descrizione       = excluded.descrizione,
            altro             = excluded.altro,
            tipo_tariffa      = excluded.tipo_tariffa,
            tipo_fatturazione = excluded.tipo_fatturazione,
            trasferta         = excluded.trasferta,
            durata            = excluded.durata,
            body_html         = excluded.body_html,
            luogo             = excluded.luogo,
            pending_op        = excluded.pending_op,
            schema_version    = excluded.schema_version,
            synced_at         = excluded.synced_at",
        params![
            item.user_email, item.exchange_item_id, item.change_key,
            item.start_dt, item.end_dt, item.subject, item.nome_tecnico,
            item.ragione_sociale, item.descrizione, item.altro,
            item.tipo_tariffa, item.tipo_fatturazione, item.trasferta,
            item.durata, item.body_html, item.luogo, item.pending_op,
            item.schema_version, item.synced_at,
        ],
    )?;
    Ok(())
}
```

In `upsert_item_metadata`, do the same column/value additions but **omit `pending_op` and `body_html` from the `ON CONFLICT` SET** (metadata sync must not clobber a local pending flag or body). Add `pending_op` to the INSERT column list and `?17` value, keep the SET list without `body_html`/`pending_op`:

```rust
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
        ON CONFLICT(user_email, exchange_item_id) DO UPDATE SET
            change_key        = excluded.change_key,
            start_dt          = excluded.start_dt,
            end_dt            = excluded.end_dt,
            subject           = excluded.subject,
            nome_tecnico      = excluded.nome_tecnico,
            ragione_sociale   = excluded.ragione_sociale,
            descrizione       = excluded.descrizione,
            altro             = excluded.altro,
            tipo_tariffa      = excluded.tipo_tariffa,
            tipo_fatturazione = excluded.tipo_fatturazione,
            trasferta         = excluded.trasferta,
            durata            = excluded.durata,
            luogo             = excluded.luogo,
            schema_version    = excluded.schema_version,
            synced_at         = excluded.synced_at",
        params![
            item.user_email, item.exchange_item_id, item.change_key,
            item.start_dt, item.end_dt, item.subject, item.nome_tecnico,
            item.ragione_sociale, item.descrizione, item.altro,
            item.tipo_tariffa, item.tipo_fatturazione, item.trasferta,
            item.durata, item.body_html, item.luogo, item.pending_op,
            item.schema_version, item.synced_at,
        ],
    )?;
    Ok(())
}
```

Also add `user_email, exchange_item_id, change_key, ..., luogo, pending_op, schema_version, synced_at` to the metadata INSERT column list (mirror `upsert_item`'s column list including `pending_op`).

- [ ] **Step 5: Add tombstone filter to `get_range`**

Replace the `get_range` SQL `WHERE` clause:

```rust
        "SELECT {CACHE_COLS}
         FROM intervention_cache
         WHERE user_email = ?1 AND start_dt >= ?2 AND start_dt < ?3
           AND (pending_op IS NULL OR pending_op != 'delete')
         ORDER BY start_dt"
```

- [ ] **Step 6: Add the reconcile/mark helpers**

Add these functions after `delete_item` in `src-tauri/src/db/cache.rs`:

```rust
/// Flag a cached row as having an unsynced local change (create/update/delete).
pub fn mark_pending(conn: &Connection, user_email: &str, exchange_item_id: &str, op: &str) -> Result<()> {
    conn.execute(
        "UPDATE intervention_cache SET pending_op = ?3
         WHERE user_email = ?1 AND exchange_item_id = ?2",
        params![user_email, exchange_item_id, op],
    )?;
    Ok(())
}

/// A flushed create: migrate the optimistic temp id to the real Exchange id in
/// both the cache and the signatures table, and clear the pending flag.
pub fn reconcile_create(
    conn: &Connection,
    user_email: &str,
    local_id: &str,
    real_id: &str,
    change_key: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE intervention_cache
         SET exchange_item_id = ?3, change_key = ?4, pending_op = NULL
         WHERE user_email = ?1 AND exchange_item_id = ?2",
        params![user_email, local_id, real_id, change_key],
    )?;
    conn.execute(
        "UPDATE signatures SET exchange_item_id = ?2 WHERE exchange_item_id = ?1",
        params![local_id, real_id],
    )?;
    Ok(())
}

/// A flushed update: store the new change_key and clear the pending flag.
pub fn reconcile_update(conn: &Connection, user_email: &str, exchange_item_id: &str, change_key: &str) -> Result<()> {
    conn.execute(
        "UPDATE intervention_cache SET change_key = ?3, pending_op = NULL
         WHERE user_email = ?1 AND exchange_item_id = ?2",
        params![user_email, exchange_item_id, change_key],
    )?;
    Ok(())
}
```

- [ ] **Step 7: Fix the existing test structs**

The existing tests build `CachedItem` literals without `pending_op`. Add `pending_op: None,` after each `luogo: ...,` in `test_upsert_and_get_range`, `test_upsert_updates_existing`, `test_delete_item`, `test_upsert_metadata_preserves_body`, `test_upsert_metadata_inserts_new` (5 structs).

- [ ] **Step 8: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cache::tests 2>&1`
Expected: PASS (all cache tests including the 3 new ones).

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/db/cache.rs
git commit -m "feat(cache): pending_op marker, tombstone filter, reconcile helpers"
```

---

## Task 3: db/queue.rs — pending_ops CRUD

**Files:**
- Create: `src-tauri/src/db/queue.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Register the module**

In `src-tauri/src/db/mod.rs` add alongside the other `pub mod` lines:

```rust
pub mod queue;
```

- [ ] **Step 2: Write `queue.rs` with the type, functions, and tests**

Create `src-tauri/src/db/queue.rs`:

```rust
use rusqlite::{params, Connection, Result, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingOp {
    pub id: i64,
    pub user_email: String,
    pub op_type: String,            // create | update | delete
    pub local_id: String,
    pub exchange_item_id: Option<String>,
    pub base_change_key: Option<String>,
    pub payload: Option<String>,    // JSON InterventionData
    pub status: String,             // pending | conflict | error
    pub attempts: i64,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_op(r: &Row) -> Result<PendingOp> {
    Ok(PendingOp {
        id: r.get(0)?,
        user_email: r.get(1)?,
        op_type: r.get(2)?,
        local_id: r.get(3)?,
        exchange_item_id: r.get(4)?,
        base_change_key: r.get(5)?,
        payload: r.get(6)?,
        status: r.get(7)?,
        attempts: r.get(8)?,
        last_error: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

const COLS: &str = "id, user_email, op_type, local_id, exchange_item_id,
        base_change_key, payload, status, attempts, last_error, created_at, updated_at";

/// Insert a new pending operation; returns its queue id.
#[allow(clippy::too_many_arguments)]
pub fn enqueue(
    conn: &Connection,
    user_email: &str,
    op_type: &str,
    local_id: &str,
    exchange_item_id: Option<&str>,
    base_change_key: Option<&str>,
    payload: Option<&str>,
) -> Result<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO pending_ops
         (user_email, op_type, local_id, exchange_item_id, base_change_key,
          payload, status, attempts, last_error, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,'pending',0,NULL,?7,?7)",
        params![user_email, op_type, local_id, exchange_item_id, base_change_key, payload, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// All ops for a user (any status), oldest first.
pub fn list_all(conn: &Connection, user_email: &str) -> Result<Vec<PendingOp>> {
    let sql = format!("SELECT {COLS} FROM pending_ops WHERE user_email = ?1 ORDER BY id");
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_map(params![user_email], row_to_op)?.collect()
}

/// Ops still awaiting a flush attempt (status='pending'), oldest first.
pub fn list_pending(conn: &Connection, user_email: &str) -> Result<Vec<PendingOp>> {
    let sql = format!(
        "SELECT {COLS} FROM pending_ops WHERE user_email = ?1 AND status = 'pending' ORDER BY id"
    );
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_map(params![user_email], row_to_op)?.collect()
}

/// Ops in conflict, oldest first.
pub fn list_conflicts(conn: &Connection, user_email: &str) -> Result<Vec<PendingOp>> {
    let sql = format!(
        "SELECT {COLS} FROM pending_ops WHERE user_email = ?1 AND status = 'conflict' ORDER BY id"
    );
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_map(params![user_email], row_to_op)?.collect()
}

pub fn get(conn: &Connection, id: i64) -> Result<Option<PendingOp>> {
    let sql = format!("SELECT {COLS} FROM pending_ops WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], row_to_op)?;
    rows.next().transpose()
}

pub fn mark_conflict(conn: &Connection, id: i64) -> Result<()> {
    set_status(conn, id, "conflict", None)
}

pub fn mark_error(conn: &Connection, id: i64, err: &str) -> Result<()> {
    conn.execute(
        "UPDATE pending_ops
         SET status = CASE WHEN attempts + 1 >= 5 THEN 'error' ELSE 'pending' END,
             attempts = attempts + 1, last_error = ?2, updated_at = ?3
         WHERE id = ?1",
        params![id, err, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn set_status(conn: &Connection, id: i64, status: &str, err: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE pending_ops SET status = ?2, last_error = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, status, err, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub fn delete_op(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM pending_ops WHERE id = ?1", params![id])?;
    Ok(())
}

/// Re-base a conflicted op on a fresh change_key and return it to the pending queue.
pub fn rebase_pending(conn: &Connection, id: i64, base_change_key: &str) -> Result<()> {
    conn.execute(
        "UPDATE pending_ops SET base_change_key = ?2, status = 'pending', updated_at = ?3 WHERE id = ?1",
        params![id, base_change_key, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    #[test]
    fn test_enqueue_and_list_pending() {
        let conn = setup();
        enqueue(&conn, "u@u.com", "create", "tmp-1", None, None, Some("{}")).unwrap();
        enqueue(&conn, "u@u.com", "update", "X2", Some("X2"), Some("CK"), Some("{}")).unwrap();
        let pend = list_pending(&conn, "u@u.com").unwrap();
        assert_eq!(pend.len(), 2);
        assert_eq!(pend[0].op_type, "create");
        assert_eq!(pend[1].base_change_key.as_deref(), Some("CK"));
    }

    #[test]
    fn test_mark_conflict_excludes_from_pending() {
        let conn = setup();
        let id = enqueue(&conn, "u@u.com", "update", "X", Some("X"), Some("CK"), Some("{}")).unwrap();
        mark_conflict(&conn, id).unwrap();
        assert!(list_pending(&conn, "u@u.com").unwrap().is_empty());
        assert_eq!(list_conflicts(&conn, "u@u.com").unwrap().len(), 1);
    }

    #[test]
    fn test_mark_error_escalates_after_5() {
        let conn = setup();
        let id = enqueue(&conn, "u@u.com", "delete", "X", Some("X"), Some("CK"), None).unwrap();
        for _ in 0..4 {
            mark_error(&conn, id, "boom").unwrap();
            assert_eq!(get(&conn, id).unwrap().unwrap().status, "pending");
        }
        mark_error(&conn, id, "boom").unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().status, "error");
    }

    #[test]
    fn test_rebase_and_delete() {
        let conn = setup();
        let id = enqueue(&conn, "u@u.com", "update", "X", Some("X"), Some("OLD"), Some("{}")).unwrap();
        mark_conflict(&conn, id).unwrap();
        rebase_pending(&conn, id, "NEW").unwrap();
        let op = get(&conn, id).unwrap().unwrap();
        assert_eq!(op.status, "pending");
        assert_eq!(op.base_change_key.as_deref(), Some("NEW"));
        delete_op(&conn, id).unwrap();
        assert!(get(&conn, id).unwrap().is_none());
    }
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml queue::tests 2>&1`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/queue.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): pending_ops queue CRUD module"
```

---

## Task 4: InterventionItem carries pending_op

**Files:**
- Modify: `src-tauri/src/exchange/parse.rs`
- Modify: `src-tauri/src/db/cache.rs` (the `From<CachedItem>` impl)

- [ ] **Step 1: Add the field**

In `src-tauri/src/exchange/parse.rs`, add to `InterventionItem` after `luogo`:

```rust
    pub luogo: String,
    #[serde(default)]
    pub pending_op: String,
```

- [ ] **Step 2: Populate it from the cache**

In `src-tauri/src/db/cache.rs`, in `impl From<CachedItem> for ...InterventionItem`, add after `luogo`:

```rust
            luogo: c.luogo.unwrap_or_default(),
            pending_op: c.pending_op.unwrap_or_default(),
```

- [ ] **Step 3: Build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1`
Expected: builds. `InterventionItem::default()` still works (String default = ""), so `parse.rs` call sites are unaffected.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/exchange/parse.rs src-tauri/src/db/cache.rs
git commit -m "feat: expose pending_op on InterventionItem for the UI"
```

---

## Task 5: flush.rs — conflict decision + queue drain

**Files:**
- Create: `src-tauri/src/flush.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod flush;`)

- [ ] **Step 1: Write the failing test for the pure conflict function**

Create `src-tauri/src/flush.rs` with just the function + test first:

```rust
/// A conflict exists when the server's current change_key differs from the one
/// the queued edit/delete was based on. An empty/absent base means "no baseline"
/// (treat as no conflict — e.g. a create has no base).
pub fn is_conflict(base_change_key: Option<&str>, server_change_key: &str) -> bool {
    match base_change_key {
        None => false,
        Some(b) if b.is_empty() => false,
        Some(b) => b != server_change_key,
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
```

- [ ] **Step 2: Register module and run the test**

In `src-tauri/src/lib.rs` add after `pub mod exchange;`:

```rust
pub mod flush;
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml flush::tests 2>&1`
Expected: PASS.

- [ ] **Step 3: Add the queue-drain implementation**

Append to `src-tauri/src/flush.rs` (above the `#[cfg(test)]`):

```rust
use crate::db::{cache, queue};
use crate::exchange::client::EwsClient;
use crate::exchange::{parse, soap};
use crate::commands::interventions::InterventionData;
use crate::AppState;
use std::sync::Arc;
use tauri::Emitter;

/// Read the live server change_key for an item (None if it no longer exists).
fn server_change_key(client: &EwsClient, item_id: &str, base_ck: &str) -> Option<String> {
    let xml = client.call_message("GetItem", &soap::get_item(item_id, base_ck)).ok()?;
    parse::parse_get_item(&xml).ok().map(|i| i.change_key)
}

fn data_from_payload(payload: &Option<String>) -> Option<InterventionData> {
    serde_json::from_str(payload.as_deref()?).ok()
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
        let conn = state.db.0.lock().unwrap();
        queue::list_pending(&conn, email)?
    };

    let mut flushed = 0i64;
    let mut had_conflict = false;

    for op in ops {
        let result = flush_one(client, email, state, &op);
        match result {
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
                // Network/transient: stop draining; try again on the next trigger.
                break;
            }
        }
    }

    if let Some(handle) = window {
        if had_conflict {
            let _ = handle.emit("write-conflict", serde_json::json!({ "account": email }));
        }
        if flushed > 0 {
            let _ = handle.emit("flush-complete", serde_json::json!({ "account": email, "flushed": flushed }));
        }
    }
    Ok(flushed)
}

enum FlushOutcome {
    Done,
    Conflict,
    Retry(String),
}

fn flush_one(client: &EwsClient, email: &str, state: &Arc<AppState>, op: &queue::PendingOp) -> FlushOutcome {
    match op.op_type.as_str() {
        "create" => {
            let Some(data) = data_from_payload(&op.payload) else {
                return FlushOutcome::Retry("invalid create payload".into());
            };
            let subject = crate::commands::interventions::resolve_subject(&data);
            let soap_data = crate::commands::interventions::build_soap_data(email, &data, &subject);
            match client.call_message("CreateItem", &soap::create_item(&soap_data)) {
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
            match client.call_message("UpdateItem", &soap::update_item(&item_id, &server_ck, &soap_data)) {
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
            match client.call_message("DeleteItem", &soap::delete_item(&item_id, &server_ck)) {
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
```

- [ ] **Step 4: Make the reused helpers public**

In `src-tauri/src/commands/interventions.rs`, change `fn resolve_subject`, `fn build_soap_data`, and `struct InterventionData` to `pub`:

```rust
pub fn build_soap_data<'a>(...) -> soap::CreateItemData<'a> {
pub fn resolve_subject(d: &InterventionData) -> String {
```
(`InterventionData` is already `pub`.) Also add `#[derive(Serialize)]` to `InterventionData` so payloads can be round-tripped, i.e. change its derive line to:

```rust
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct InterventionData {
```

- [ ] **Step 5: Build + run flush tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml flush 2>&1`
Expected: builds, `is_conflict` test passes.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/flush.rs src-tauri/src/lib.rs src-tauri/src/commands/interventions.rs
git commit -m "feat(flush): queue drain with conflict detection"
```

---

## Task 6: Optimistic write commands

**Files:**
- Modify: `src-tauri/src/commands/interventions.rs`

- [ ] **Step 1: Add a helper to spawn a background flush for one account**

At the top of `src-tauri/src/commands/interventions.rs` add imports and a spawn helper:

```rust
use crate::db::queue;
use crate::flush;
use std::sync::Arc;

/// Fire-and-forget flush of the queue for `email` (used after optimistic writes).
fn spawn_flush(email: String, app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let acc = {
            let st = app.state::<AppState>();
            let conn = match st.db.0.lock() { Ok(c) => c, Err(_) => return };
            crate::db::cache::list_accounts(&conn).ok()
                .and_then(|v| v.into_iter().find(|a| a.email == email))
        };
        let Some(acc) = acc else { return };
        let server = acc.server.unwrap_or_default();
        let client = match EwsClient::connect(&server, &email, acc.domain.as_deref()) {
            Ok(c) => c,
            Err(_) => return,
        };
        let state = Arc::new(AppState {
            db: crate::db::DbConn(std::sync::Mutex::new(match crate::db::open() {
                Ok(c) => c, Err(_) => return,
            })),
        });
        let _ = flush::flush_pending(&client, &email, &state, Some(&app)).await;
    });
}
```

Note: this requires `use tauri::Manager;` for `app.state::<T>()`. Add it to the imports.

- [ ] **Step 2: Rewrite `create_intervention` to be optimistic**

Replace the function. It no longer takes a client; it needs `app: tauri::AppHandle`:

```rust
#[tauri::command]
pub async fn create_intervention(
    data: InterventionData,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<InterventionItem, String> {
    let subject = resolve_subject(&data);
    let local_id = format!("tmp-{}", uuid::Uuid::new_v4());
    let mut item = item_from_data(local_id.clone(), String::new(), &data, subject);
    item.pending_op = "create".to_string();

    {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        let mut cached = CachedItem::from_item(&item, &data.email);
        cached.pending_op = Some("create".into());
        cache::upsert_item(&conn, &cached).map_err(|e| e.to_string())?;
        let payload = serde_json::to_string(&data).map_err(|e| e.to_string())?;
        queue::enqueue(&conn, &data.email, "create", &local_id, None, None, Some(&payload))
            .map_err(|e| e.to_string())?;
    }

    spawn_flush(data.email.clone(), app);
    Ok(item)
}
```

- [ ] **Step 3: Rewrite `update_intervention`**

```rust
#[tauri::command]
pub async fn update_intervention(
    input: UpdateInterventionInput,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<InterventionItem, String> {
    let subject = resolve_subject(&input.data);
    let mut item = item_from_data(input.item_id.clone(), input.change_key.clone(), &input.data, subject);
    item.pending_op = "update".to_string();

    {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        let mut cached = CachedItem::from_item(&item, &input.email);
        cached.pending_op = Some("update".into());
        cache::upsert_item(&conn, &cached).map_err(|e| e.to_string())?;
        let payload = serde_json::to_string(&input.data).map_err(|e| e.to_string())?;
        queue::enqueue(
            &conn, &input.email, "update", &input.item_id,
            Some(&input.item_id), Some(&input.change_key), Some(&payload),
        ).map_err(|e| e.to_string())?;
    }

    spawn_flush(input.email.clone(), app);
    Ok(item)
}
```

- [ ] **Step 4: Rewrite `delete_intervention`**

```rust
#[tauri::command]
pub async fn delete_intervention(
    email: String,
    item_id: String,
    change_key: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        cache::mark_pending(&conn, &email, &item_id, "delete").map_err(|e| e.to_string())?;
        queue::enqueue(
            &conn, &email, "delete", &item_id,
            Some(&item_id), Some(&change_key), None,
        ).map_err(|e| e.to_string())?;
    }
    spawn_flush(email, app);
    Ok(())
}
```

- [ ] **Step 5: Remove the now-unused `cache_upserted` if the compiler flags it**

`get_intervention` still uses `cache_upserted`; keep it. If `get_client` becomes unused (it is no longer referenced by the write commands but `get_intervention` still uses it), keep it. Build to confirm.

- [ ] **Step 6: Build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1`
Expected: builds. Fix any unused-import warnings (e.g. `parse`, `soap`) by removing genuinely unused imports.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/interventions.rs
git commit -m "feat: optimistic create/update/delete via queue + background flush"
```

---

## Task 7: flush_queue / list_conflicts / resolve_conflict commands + sync wiring

**Files:**
- Modify: `src-tauri/src/commands/sync.rs`
- Modify: `src-tauri/src/sync.rs`

- [ ] **Step 1: Add the conflict/flush commands**

Append to `src-tauri/src/commands/sync.rs`:

```rust
use crate::db::queue;
use crate::flush;
use crate::exchange::{parse, soap};

/// Manually drain the queue for an account (called on online/focus).
#[tauri::command]
pub async fn flush_queue(
    email: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<i64, String> {
    let acc = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        cache::list_accounts(&conn).map_err(|e| e.to_string())?
            .into_iter().find(|a| a.email == email)
            .ok_or_else(|| format!("Account {} non trovato", email))?
    };
    let server = acc.server.unwrap_or_default();
    let client = EwsClient::connect(&server, &email, acc.domain.as_deref()).map_err(|e| e.to_string())?;
    let state_arc = Arc::new(AppState {
        db: crate::db::DbConn(std::sync::Mutex::new(crate::db::open().map_err(|e| e.to_string())?)),
    });
    flush::flush_pending(&client, &email, &state_arc, Some(&app_handle)).await.map_err(|e| e.to_string())
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
        cache::list_accounts(&conn).map_err(|e| e.to_string())?
            .into_iter().find(|a| a.email == email)
    };
    let client = acc.as_ref().and_then(|a| {
        EwsClient::connect(&a.server.clone().unwrap_or_default(), &email, a.domain.as_deref()).ok()
    });

    let mut out = Vec::new();
    for op in ops {
        let item_id = op.exchange_item_id.clone().unwrap_or_default();
        // "mine" = optimistic local cache row
        let mine = {
            let conn = state.db.0.lock().map_err(|e| e.to_string())?;
            cache::get_by_item_id(&conn, &email, &item_id).ok().flatten().map(Into::into)
        };
        // "server" = fresh GetItem (best-effort)
        let server = client.as_ref().and_then(|c| {
            let base = op.base_change_key.as_deref().unwrap_or("");
            c.call_message("GetItem", &soap::get_item(&item_id, base)).ok()
                .and_then(|xml| parse::parse_get_item(&xml).ok())
        });
        out.push(ConflictView { op_id: op.id, op_type: op.op_type, mine, server });
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
        queue::get(&conn, op_id).map_err(|e| e.to_string())?
            .ok_or_else(|| "Op non trovata".to_string())?
    };
    let item_id = op.exchange_item_id.clone().unwrap_or_default();
    let acc = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        cache::list_accounts(&conn).map_err(|e| e.to_string())?
            .into_iter().find(|a| a.email == email)
            .ok_or_else(|| "Account non trovato".to_string())?
    };
    let client = EwsClient::connect(&acc.server.clone().unwrap_or_default(), &email, acc.domain.as_deref())
        .map_err(|e| e.to_string())?;

    // Read the current server change_key to rebase on.
    let server_ck = client.call_message("GetItem", &soap::get_item(&item_id, op.base_change_key.as_deref().unwrap_or("")))
        .ok()
        .and_then(|xml| parse::parse_get_item(&xml).ok())
        .map(|i| i.change_key);

    if choice == "server" {
        // Discard local op; pull server version into cache (clearing pending).
        if let Some(xml) = client.call_message("GetItem", &soap::get_item(&item_id, server_ck.as_deref().unwrap_or(""))).ok() {
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
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        queue::rebase_pending(&conn, op_id, &ck).map_err(|e| e.to_string())?;
        drop(conn);
        let state_arc = Arc::new(AppState {
            db: crate::db::DbConn(std::sync::Mutex::new(crate::db::open().map_err(|e| e.to_string())?)),
        });
        flush::flush_pending(&client, &email, &state_arc, Some(&app_handle)).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 2: Flush before each scheduled sync**

In `src-tauri/src/sync.rs`, inside `start_sync_loop`, after a client is successfully built and before `sync_account`, drain the queue so background sync also flushes writes. Locate the `match sync_account(&client, ...)` call and precede it with:

```rust
            let _ = crate::flush::flush_pending(&client, &email, &state, Some(&handle)).await;

            match sync_account(&client, &email, &state, Some(&handle)).await {
```

- [ ] **Step 3: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler!` list under `// sync`:

```rust
            commands::sync::trigger_sync,
            commands::sync::sync_status_cmd,
            commands::sync::flush_queue,
            commands::sync::list_conflicts,
            commands::sync::resolve_conflict,
```

- [ ] **Step 4: Build + full test run**

Run: `cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | Select-Object -Last 20`
Expected: builds; all unit tests pass.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets 2>&1 | Select-String "error\["`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/sync.rs src-tauri/src/sync.rs src-tauri/src/lib.rs
git commit -m "feat: flush_queue/list_conflicts/resolve_conflict commands + sync-loop flush"
```

---

## Task 8: Frontend — optimistic badges, flush on focus, conflict modal + diff

**Files:**
- Modify: `src/app.js`
- Modify: `src/index.html`
- Modify: `src/style.css`

- [ ] **Step 1: Trigger queue flush on connectivity/focus**

In `src/app.js`, extend `maybeSyncOnFocus` to also flush the queue. After the existing `this.triggerSync();` line, change the method to:

```js
  maybeSyncOnFocus(force = false) {
    if (!this.accounts?.length) return;
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (primary) invoke('flush_queue', { email: primary.email }).catch(() => {});
    if (this._syncing) return;
    if (!force && this._lastSyncAt && Date.now() - this._lastSyncAt < this._SYNC_FOCUS_STALE_MS) return;
    this.triggerSync();
  },
```

- [ ] **Step 2: Listen for flush + conflict events**

In `src/app.js` `init()`, after the `sync-complete` listener block, add:

```js
    listenEvent('flush-complete', () => this.loadInterventions());
    listenEvent('write-conflict', () => this.checkConflicts());
```

- [ ] **Step 3: Add a pending badge when rendering items**

Find where interventions are rendered into cards/detail (search `renderList`/`loadInterventions` and the detail renderer). For each item, when `item.pending_op` is truthy, append a badge. Add this helper near the top-level helpers in `src/app.js`:

```js
function pendingBadge(item) {
  if (!item || !item.pending_op) return '';
  const label = item.pending_op === 'delete' ? 'eliminazione…'
    : item.pending_op === 'create' ? 'in invio…' : 'modifica…';
  return `<span class="pending-badge">${label}</span>`;
}
```

Insert `${pendingBadge(item)}` into the card title markup and the detail header markup (wherever the subject/title is emitted).

- [ ] **Step 4: Block sign/email for not-yet-synced creates**

In `src/app.js`, at the start of `openSignModal`/`firmaConfirm` is fine offline (local), but `openEmailModal` and `pdfExport` need a real id. At the start of `openEmailModal(itemJson)` and `pdfExport(...)` add:

```js
    if (item.exchange_item_id && item.exchange_item_id.startsWith('tmp-')) {
      toast('Intervento non ancora sincronizzato', 'warning');
      return;
    }
```

- [ ] **Step 5: Conflict modal markup**

In `src/index.html`, before the closing `</body>` (next to the other modals), add:

```html
<div id="modal-conflict" class="modal-overlay hidden">
  <div class="modal-card">
    <div class="modal-head"><h3>Conflitto di sincronizzazione</h3></div>
    <div id="conflict-body" class="modal-body"></div>
  </div>
</div>
```

- [ ] **Step 6: Conflict check + render + resolve in app.js**

Add to the `App` object in `src/app.js`:

```js
  async checkConflicts() {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    if (!primary) return;
    let conflicts = [];
    try { conflicts = await invoke('list_conflicts', { email: primary.email }); } catch(e) { return; }
    if (!conflicts.length) { $('modal-conflict')?.classList.add('hidden'); return; }
    this._renderConflicts(conflicts);
    $('modal-conflict')?.classList.remove('hidden', 'closing');
  },

  _renderConflicts(conflicts) {
    const FIELDS = [
      ['subject', 'Oggetto'], ['start_dt', 'Inizio'], ['end_dt', 'Fine'],
      ['luogo', 'Luogo'], ['ragione_sociale', 'Cliente'], ['descrizione', 'Descrizione'],
      ['durata', 'Durata'], ['body_html', 'Note'],
    ];
    const blocks = conflicts.map(c => {
      const mine = c.mine || {}, srv = c.server || {};
      const rows = FIELDS.filter(([k]) => (mine[k] || '') !== (srv[k] || '')).map(([k, label]) =>
        `<tr><td class="cf-k">${label}</td>
             <td class="cf-mine">${escHtml(mine[k] || '—')}</td>
             <td class="cf-srv">${escHtml(srv[k] || '—')}</td></tr>`
      ).join('');
      const diff = rows
        ? `<table class="cf-diff"><thead><tr><th></th><th>Le mie modifiche</th><th>Versione server</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="cf-nodiff">Differenze non mostrabili (item eliminato sul server).</p>`;
      return `<div class="cf-item">
        <div class="cf-title">${escHtml((c.mine && c.mine.subject) || c.op_type)}</div>
        ${diff}
        <div class="cf-actions">
          <button class="btn" onclick="App.resolveConflict(${c.op_id}, 'mine')">Tieni le mie modifiche</button>
          <button class="btn ghost" onclick="App.resolveConflict(${c.op_id}, 'server')">Tieni versione server</button>
        </div>
      </div>`;
    }).join('');
    $('conflict-body').innerHTML = blocks;
  },

  async resolveConflict(opId, choice) {
    const primary = this.accounts.find(a => a.is_primary) || this.accounts[0];
    try {
      await invoke('resolve_conflict', { opId, choice, email: primary.email });
      toast('Conflitto risolto', 'success');
    } catch(e) {
      toast('Errore risoluzione: ' + e, 'error');
    }
    this.loadInterventions();
    this.checkConflicts();
  },
```

- [ ] **Step 7: Styles**

In `src/style.css` append:

```css
.pending-badge {
  display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 999px;
  font-size: 10px; font-weight: 600; color: var(--text-3);
  background: color-mix(in oklch, var(--accent) 14%, transparent);
}
.cf-item { padding: 12px 0; border-bottom: 1px solid var(--line, rgba(0,0,0,.08)); }
.cf-title { font-weight: 700; margin-bottom: 8px; }
.cf-diff { width: 100%; border-collapse: collapse; font-size: 12px; }
.cf-diff th, .cf-diff td { text-align: left; padding: 4px 8px; vertical-align: top; }
.cf-k { color: var(--text-3); white-space: nowrap; }
.cf-mine { color: var(--accent); }
.cf-srv { color: var(--text-2); }
.cf-actions { display: flex; gap: 8px; margin-top: 10px; }
.cf-nodiff { color: var(--text-3); font-size: 12px; }
```

- [ ] **Step 8: Bump cache-buster + check on load**

In `src/index.html` change `app.js?v=29` to `app.js?v=30`. In `enterApp()` (src/app.js), after `this.loadInterventions();` add `this.checkConflicts();`.

- [ ] **Step 9: Verify JS syntax**

Run: `node --check src/app.js`
Expected: no output (valid).

- [ ] **Step 10: Commit**

```bash
git add src/app.js src/index.html src/style.css
git commit -m "feat(ui): optimistic badges, flush on focus, conflict modal with field diff"
```

---

## Task 9: Manual verification + spec checkbox

**Files:**
- Modify: `todo.md`

- [ ] **Step 1: Manual test checklist (run the app: `npm run tauri dev`)**

  - [ ] Create an intervention online → appears instantly with "in invio…" then badge clears after flush; reload shows it with a real id.
  - [ ] Edit an intervention → "modifica…" badge → clears after flush.
  - [ ] Delete → disappears from list immediately; reappears only if a conflict is detected.
  - [ ] Go offline (disable network) → create/edit/delete still work optimistically and persist across an app restart (queue survives). Re-enable network or refocus the window → queue flushes.
  - [ ] Save-and-sign offline → signature attaches; after flush the signature is on the real item.
  - [ ] Conflict: edit the same item in Outlook/OWA, then flush a queued edit → conflict modal shows the field diff; "Tieni le mie" overwrites, "Tieni server" discards local.

- [ ] **Step 2: Mark the todo items done**

In `todo.md`, change the three checkboxes to `[x]` with a short "✅ FATTO" note: **Write-queue offline**, **Conflict handling sul flush**, **Optimistic write**.

- [ ] **Step 3: Commit**

```bash
git add todo.md
git commit -m "docs: mark write-queue/optimistic/conflict items done"
```

---

## Self-Review notes

- **Spec coverage:** pending_ops table (Task 1,3), pending_op cache column + tombstones + reconcile incl. signature migration (Task 2), InterventionItem.pending_op (Task 4), conflict pure fn + FIFO drain (Task 5), optimistic commands + temp-id creates + background flush (Task 6), flush_queue/list_conflicts/resolve_conflict + sync-loop flush + 5-attempt escalation (Task 3 `mark_error`, Task 7), frontend badges/flush-on-focus/conflict diff/save-and-sign-offline guard (Task 8). Out-of-scope items (#3, streaming, per-field merge) intentionally excluded.
- **Type consistency:** `reconcile_create(local_id, real_id, change_key)`, `reconcile_update(id, ck)`, `is_conflict(Option<&str>, &str)`, `queue::enqueue(..., Option<&str> x3)`, `PendingOp` fields, `flush_pending(client, email, &Arc<AppState>, Option<&AppHandle>)`, command params `opId`/`choice`/`email` (camelCase auto-mapped by Tauri) used consistently across backend and `invoke` calls.
- **Placeholder scan:** none — every step has concrete code/commands.
