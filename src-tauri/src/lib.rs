pub mod commands;
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
            // config
            commands::config::get_dropdown_data,
            commands::config::set_dropdown_list,
            commands::config::get_config_value,
            commands::config::set_config_value,
            commands::config::clear_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
