use rusqlite::{params, Connection, Result, Row};
use serde::{Deserialize, Serialize};

pub const CACHE_SCHEMA_VERSION: i64 = 1;

/// Column list shared by every `intervention_cache` SELECT (order matches `row_to_cached`).
const CACHE_COLS: &str = "id, user_email, exchange_item_id, change_key, start_dt, end_dt,
        subject, nome_tecnico, ragione_sociale, descrizione, altro,
        tipo_tariffa, tipo_fatturazione, trasferta, durata, body_html,
        luogo, schema_version, synced_at";

fn row_to_cached(r: &Row) -> Result<CachedItem> {
    Ok(CachedItem {
        id: r.get(0)?,
        user_email: r.get(1)?,
        exchange_item_id: r.get(2)?,
        change_key: r.get(3)?,
        start_dt: r.get(4)?,
        end_dt: r.get(5)?,
        subject: r.get(6)?,
        nome_tecnico: r.get(7)?,
        ragione_sociale: r.get(8)?,
        descrizione: r.get(9)?,
        altro: r.get(10)?,
        tipo_tariffa: r.get(11)?,
        tipo_fatturazione: r.get(12)?,
        trasferta: r.get(13)?,
        durata: r.get(14)?,
        body_html: r.get(15)?,
        luogo: r.get(16)?,
        schema_version: r.get(17)?,
        synced_at: r.get(18)?,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedItem {
    pub id: i64,
    pub user_email: String,
    pub exchange_item_id: String,
    pub change_key: String,
    pub start_dt: String,
    pub end_dt: String,
    pub subject: Option<String>,
    pub nome_tecnico: Option<String>,
    pub ragione_sociale: Option<String>,
    pub descrizione: Option<String>,
    pub altro: Option<String>,
    pub tipo_tariffa: Option<String>,
    pub tipo_fatturazione: Option<String>,
    pub trasferta: Option<String>,
    pub durata: Option<String>,
    pub body_html: Option<String>,
    pub luogo: Option<String>,
    pub schema_version: i64,
    pub synced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRow {
    pub id: i64,
    pub email: String,
    pub display_name: Option<String>,
    pub sigla: Option<String>,
    pub server: Option<String>,
    pub domain: Option<String>,
    pub is_primary: bool,
}

impl CachedItem {
    /// Build a cache row from a parsed Exchange item for the given user.
    pub fn from_item(item: &crate::exchange::parse::InterventionItem, email: &str) -> Self {
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
            luogo: Some(item.luogo.clone()),
            schema_version: CACHE_SCHEMA_VERSION,
            synced_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

impl From<CachedItem> for crate::exchange::parse::InterventionItem {
    fn from(c: CachedItem) -> Self {
        crate::exchange::parse::InterventionItem {
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
            luogo: c.luogo.unwrap_or_default(),
        }
    }
}

pub fn upsert_item(conn: &Connection, item: &CachedItem) -> Result<()> {
    conn.execute(
        "INSERT INTO intervention_cache (
            user_email, exchange_item_id, change_key, start_dt, end_dt,
            subject, nome_tecnico, ragione_sociale, descrizione, altro,
            tipo_tariffa, tipo_fatturazione, trasferta, durata, body_html,
            luogo, schema_version, synced_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
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
            schema_version    = excluded.schema_version,
            synced_at         = excluded.synced_at",
        params![
            item.user_email, item.exchange_item_id, item.change_key,
            item.start_dt, item.end_dt, item.subject, item.nome_tecnico,
            item.ragione_sociale, item.descrizione, item.altro,
            item.tipo_tariffa, item.tipo_fatturazione, item.trasferta,
            item.durata, item.body_html, item.luogo, item.schema_version, item.synced_at,
        ],
    )?;
    Ok(())
}

pub fn get_range(
    conn: &Connection,
    user_email: &str,
    start: &str,
    end: &str,
) -> Result<Vec<CachedItem>> {
    let sql = format!(
        "SELECT {CACHE_COLS}
         FROM intervention_cache
         WHERE user_email = ?1 AND start_dt >= ?2 AND start_dt < ?3
         ORDER BY start_dt"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![user_email, start, end], row_to_cached)?;
    rows.collect()
}

pub fn get_by_item_id(
    conn: &Connection,
    user_email: &str,
    exchange_item_id: &str,
) -> Result<Option<CachedItem>> {
    let sql = format!(
        "SELECT {CACHE_COLS}
         FROM intervention_cache
         WHERE user_email = ?1 AND exchange_item_id = ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![user_email, exchange_item_id], row_to_cached)?;
    rows.next().transpose()
}

pub fn get_signature_b64(conn: &Connection, exchange_item_id: &str) -> Result<Option<String>> {
    let mut stmt =
        conn.prepare("SELECT png_base64 FROM signatures WHERE exchange_item_id = ?1")?;
    let mut rows = stmt.query(params![exchange_item_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn delete_item(conn: &Connection, user_email: &str, exchange_item_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM intervention_cache WHERE user_email = ?1 AND exchange_item_id = ?2",
        params![user_email, exchange_item_id],
    )?;
    Ok(())
}

pub fn clear_for_user(conn: &Connection, user_email: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM intervention_cache WHERE user_email = ?1",
        params![user_email],
    )?;
    Ok(())
}

pub fn upsert_account(conn: &Connection, acc: &AccountRow) -> Result<()> {
    conn.execute(
        "INSERT INTO accounts (email, display_name, sigla, server, domain, is_primary)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(email) DO UPDATE SET
             display_name = excluded.display_name,
             sigla        = excluded.sigla,
             server       = excluded.server,
             domain       = excluded.domain,
             is_primary   = excluded.is_primary",
        params![
            acc.email, acc.display_name, acc.sigla, acc.server, acc.domain,
            acc.is_primary as i64,
        ],
    )?;
    Ok(())
}

pub fn list_accounts(conn: &Connection) -> Result<Vec<AccountRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, email, display_name, sigla, server, domain, is_primary FROM accounts ORDER BY is_primary DESC, id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(AccountRow {
            id: r.get(0)?,
            email: r.get(1)?,
            display_name: r.get(2)?,
            sigla: r.get(3)?,
            server: r.get(4)?,
            domain: r.get(5)?,
            is_primary: r.get::<_, i64>(6)? != 0,
        })
    })?;
    rows.collect()
}

pub fn delete_account(conn: &Connection, email: &str) -> Result<()> {
    conn.execute("DELETE FROM accounts WHERE email = ?1", params![email])?;
    Ok(())
}

pub fn get_config(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM app_config WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_config(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    #[test]
    fn test_upsert_and_get_range() {
        let conn = setup();
        let item = CachedItem {
            id: 0,
            user_email: "test@example.com".into(),
            exchange_item_id: "AAA".into(),
            change_key: "CK1".into(),
            start_dt: "2024-01-10T09:00:00".into(),
            end_dt: "2024-01-10T11:00:00".into(),
            subject: Some("Test soggetto".into()),
            nome_tecnico: Some("MR".into()),
            ragione_sociale: Some("ACME".into()),
            descrizione: Some("Assistenza".into()),
            altro: None,
            tipo_tariffa: Some("Orario".into()),
            tipo_fatturazione: Some("Fatturato".into()),
            trasferta: Some("No".into()),
            durata: Some("120".into()),
            body_html: Some("<p>note</p>".into()),
            luogo: None,
            schema_version: CACHE_SCHEMA_VERSION,
            synced_at: "2024-01-10T12:00:00".into(),
        };
        upsert_item(&conn, &item).unwrap();
        let results = get_range(&conn, "test@example.com", "2024-01-01", "2024-02-01").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].exchange_item_id, "AAA");
        assert_eq!(results[0].ragione_sociale.as_deref(), Some("ACME"));
    }

    #[test]
    fn test_upsert_updates_existing() {
        let conn = setup();
        let mut item = CachedItem {
            id: 0,
            user_email: "u@u.com".into(),
            exchange_item_id: "BBB".into(),
            change_key: "CK1".into(),
            start_dt: "2024-03-01T08:00:00".into(),
            end_dt: "2024-03-01T09:00:00".into(),
            subject: None, nome_tecnico: None, ragione_sociale: None,
            descrizione: None, altro: None, tipo_tariffa: None,
            tipo_fatturazione: None, trasferta: None, durata: None,
            body_html: None, luogo: None, schema_version: 1,
            synced_at: "2024-03-01T10:00:00".into(),
        };
        upsert_item(&conn, &item).unwrap();
        item.change_key = "CK2".into();
        item.nome_tecnico = Some("XY".into());
        upsert_item(&conn, &item).unwrap();
        let results = get_range(&conn, "u@u.com", "2024-03-01", "2024-04-01").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].change_key, "CK2");
        assert_eq!(results[0].nome_tecnico.as_deref(), Some("XY"));
    }

    #[test]
    fn test_delete_item() {
        let conn = setup();
        let item = CachedItem {
            id: 0, user_email: "a@b.com".into(), exchange_item_id: "CCC".into(),
            change_key: "CK".into(), start_dt: "2024-05-01T10:00:00".into(),
            end_dt: "2024-05-01T11:00:00".into(), subject: None, nome_tecnico: None,
            ragione_sociale: None, descrizione: None, altro: None, tipo_tariffa: None,
            tipo_fatturazione: None, trasferta: None, durata: None, body_html: None,
            luogo: None, schema_version: 1, synced_at: "2024-05-01T12:00:00".into(),
        };
        upsert_item(&conn, &item).unwrap();
        delete_item(&conn, "a@b.com", "CCC").unwrap();
        let results = get_range(&conn, "a@b.com", "2024-01-01", "2025-01-01").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_account_crud() {
        let conn = setup();
        let acc = AccountRow {
            id: 0,
            email: "tech@tssi.it".into(),
            display_name: Some("Marco".into()),
            sigla: Some("MR".into()),
            server: Some("mail.tssi.it".into()),
            domain: Some("TSSI".into()),
            is_primary: true,
        };
        upsert_account(&conn, &acc).unwrap();
        let accounts = list_accounts(&conn).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].sigla.as_deref(), Some("MR"));
        delete_account(&conn, "tech@tssi.it").unwrap();
        assert!(list_accounts(&conn).unwrap().is_empty());
    }

    #[test]
    fn test_config_roundtrip() {
        let conn = setup();
        set_config(&conn, "sync_interval", "900").unwrap();
        let val = get_config(&conn, "sync_interval").unwrap();
        assert_eq!(val.as_deref(), Some("900"));
        set_config(&conn, "sync_interval", "1800").unwrap();
        let val = get_config(&conn, "sync_interval").unwrap();
        assert_eq!(val.as_deref(), Some("1800"));
    }
}
