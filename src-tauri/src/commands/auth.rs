use crate::db::cache::{delete_account, list_accounts, AccountRow};
use crate::exchange::client::EwsClient;
use crate::exchange::soap;
use crate::keychain;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ConnectionResult {
    pub ok: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn test_connection(
    email: String,
    password: String,
    server: String,
    domain: Option<String>,
) -> Result<ConnectionResult, String> {
    let client =
        EwsClient::new(&server, &email, &password, domain.as_deref()).map_err(|e| e.to_string())?;

    // Try a simple FindItem for today to validate credentials
    let now = chrono::Utc::now();
    let start = now.format("%Y-%m-%dT00:00:00Z").to_string();
    let end = now.format("%Y-%m-%dT23:59:59Z").to_string();
    let soap_body = soap::find_items(&email, &start, &end);

    match client.call(
        "http://schemas.microsoft.com/exchange/services/2006/messages/FindItem",
        &soap_body,
    ) {
        Ok(resp) => {
            if resp.contains("NoError") || resp.contains("RootFolder") {
                Ok(ConnectionResult { ok: true, error: None })
            } else if resp.contains("Fault") || resp.contains("ErrorAccessDenied") {
                Ok(ConnectionResult {
                    ok: false,
                    error: Some("Credenziali non valide o accesso negato".into()),
                })
            } else {
                Ok(ConnectionResult { ok: true, error: None })
            }
        }
        Err(e) => Ok(ConnectionResult {
            ok: false,
            error: Some(e.to_string()),
        }),
    }
}

#[derive(Debug, Deserialize)]
pub struct SaveAccountInput {
    pub email: String,
    pub password: String,
    pub display_name: Option<String>,
    pub sigla: Option<String>,
    pub server: Option<String>,
    pub domain: Option<String>,
    pub is_primary: bool,
}

#[tauri::command]
pub async fn save_account(
    input: SaveAccountInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    keychain::store_password(&input.email, &input.password).map_err(|e| e.to_string())?;

    let acc = AccountRow {
        id: 0,
        email: input.email.clone(),
        display_name: input.display_name,
        sigla: input.sigla,
        server: input.server,
        domain: input.domain,
        is_primary: input.is_primary,
    };

    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    crate::db::cache::upsert_account(&conn, &acc).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_accounts_cmd(state: State<'_, AppState>) -> Result<Vec<AccountRow>, String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    list_accounts(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_account_cmd(email: String, state: State<'_, AppState>) -> Result<(), String> {
    keychain::delete_password(&email).ok(); // ignore if not found
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    delete_account(&conn, &email).map_err(|e| e.to_string())
}
