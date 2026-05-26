pub mod db;
pub mod exchange;
pub mod keychain;

use db::DbConn;
use std::sync::Mutex;

pub struct AppState {
    pub db: DbConn,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::open().expect("failed to open SQLite database");

    tauri::Builder::default()
        .manage(AppState {
            db: DbConn(Mutex::new(conn)),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
