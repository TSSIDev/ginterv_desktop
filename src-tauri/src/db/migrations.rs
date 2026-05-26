use rusqlite::{Connection, Result};

pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS intervention_cache (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email        TEXT NOT NULL,
            exchange_item_id  TEXT NOT NULL,
            change_key        TEXT NOT NULL,
            start_dt          TEXT NOT NULL,
            end_dt            TEXT NOT NULL,
            subject           TEXT,
            nome_tecnico      TEXT,
            ragione_sociale   TEXT,
            descrizione       TEXT,
            altro             TEXT,
            tipo_tariffa      TEXT,
            tipo_fatturazione TEXT,
            trasferta         TEXT,
            durata            TEXT,
            body_html         TEXT,
            schema_version    INTEGER NOT NULL DEFAULT 1,
            synced_at         TEXT NOT NULL,
            UNIQUE(user_email, exchange_item_id)
        );

        CREATE TABLE IF NOT EXISTS signatures (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            exchange_item_id TEXT NOT NULL UNIQUE,
            png_base64       TEXT NOT NULL,
            created_at       TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            email        TEXT NOT NULL UNIQUE,
            display_name TEXT,
            sigla        TEXT,
            server       TEXT,
            domain       TEXT,
            is_primary   INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS app_config (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
        ",
    )
}
