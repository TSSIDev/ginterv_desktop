pub mod commands;
pub mod db;
pub mod exchange;
pub mod flush;
pub mod keychain;
pub mod ntlm;
pub mod pdf;
pub mod sync;

use db::DbConn;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use sync::SyncStatusMap;

pub struct AppState {
    pub db: DbConn,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::open().expect("failed to open SQLite database");
    let sync_status: SyncStatusMap = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .manage(AppState {
            db: DbConn(Mutex::new(conn)),
        })
        .manage(Arc::clone(&sync_status))
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn background sync loop
            let handle = app.handle().clone();
            let state_conn = db::open().expect("failed to open secondary DB connection for sync");
            let state = Arc::new(AppState {
                db: DbConn(Mutex::new(state_conn)),
            });
            let status = Arc::clone(&sync_status);
            tauri::async_runtime::spawn(async move {
                sync::start_sync_loop(state, status, handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // auth
            commands::auth::test_connection,
            commands::auth::save_account,
            commands::auth::list_accounts_cmd,
            commands::auth::delete_account_cmd,
            // interventions
            commands::interventions::list_interventions,
            commands::interventions::get_intervention,
            commands::interventions::create_intervention,
            commands::interventions::update_intervention,
            commands::interventions::delete_intervention,
            commands::interventions::save_signature,
            commands::interventions::get_signature,
            commands::interventions::get_client_email,
            commands::interventions::set_client_email,
            // email
            commands::email::send_email,
            // pdf
            commands::pdf::export_pdf,
            commands::pdf::export_pdf_bulk,
            // config
            commands::config::get_dropdown_data,
            commands::config::set_dropdown_list,
            commands::config::get_config_value,
            commands::config::set_config_value,
            commands::config::clear_cache,
            // sync
            commands::sync::trigger_sync,
            commands::sync::sync_status_cmd,
            commands::sync::flush_queue,
            commands::sync::list_conflicts,
            commands::sync::resolve_conflict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
