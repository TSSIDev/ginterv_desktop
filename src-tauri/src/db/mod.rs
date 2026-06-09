pub mod cache;
pub mod migrations;
pub mod queue;

use anyhow::Result;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbConn(pub Mutex<Connection>);

pub fn open() -> Result<Connection> {
    let path = db_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(&path)?;
    // synchronous=NORMAL is safe under WAL and avoids an fsync per commit
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
    )?;
    migrations::run(&conn)?;
    Ok(conn)
}

fn db_path() -> Result<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        dirs_path()
    } else {
        home_local_share()
    };
    Ok(base.join("gestoreinterventi").join("cache.db"))
}

fn dirs_path() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn home_local_share() -> PathBuf {
    std::env::var("HOME")
        .map(|h| PathBuf::from(h).join(".local").join("share"))
        .unwrap_or_else(|_| PathBuf::from("."))
}
