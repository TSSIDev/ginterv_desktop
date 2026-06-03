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
    let rows = stmt.query_map(params![user_email], row_to_op)?;
    rows.collect()
}

/// Ops still awaiting a flush attempt (status='pending'), oldest first.
pub fn list_pending(conn: &Connection, user_email: &str) -> Result<Vec<PendingOp>> {
    let sql = format!(
        "SELECT {COLS} FROM pending_ops WHERE user_email = ?1 AND status = 'pending' ORDER BY id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![user_email], row_to_op)?;
    rows.collect()
}

/// Ops in conflict, oldest first.
pub fn list_conflicts(conn: &Connection, user_email: &str) -> Result<Vec<PendingOp>> {
    let sql = format!(
        "SELECT {COLS} FROM pending_ops WHERE user_email = ?1 AND status = 'conflict' ORDER BY id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![user_email], row_to_op)?;
    rows.collect()
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

    #[test]
    fn test_list_all_returns_every_status() {
        let conn = setup();
        let a = enqueue(&conn, "u@u.com", "create", "t1", None, None, Some("{}")).unwrap();
        enqueue(&conn, "u@u.com", "update", "X", Some("X"), Some("CK"), Some("{}")).unwrap();
        mark_conflict(&conn, a).unwrap();
        assert_eq!(list_all(&conn, "u@u.com").unwrap().len(), 2);
    }
}
