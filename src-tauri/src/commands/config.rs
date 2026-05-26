use crate::db::cache;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct DropdownData {
    pub sigla: Vec<String>,
    pub clienti: Vec<String>,
    pub luoghi: Vec<String>,
    pub tipo_intervento: Vec<String>,
    pub tipo_tariffa: Vec<String>,
    pub tipo_addebito: Vec<String>,
    pub durata: Vec<String>,
}

#[tauri::command]
pub async fn get_dropdown_data(state: State<'_, AppState>) -> Result<DropdownData, String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    let get = |key: &str| -> Vec<String> {
        cache::get_config(&conn, key)
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    };
    Ok(DropdownData {
        sigla: get("dropdown_sigla"),
        clienti: get("dropdown_clienti"),
        luoghi: get("dropdown_luoghi"),
        tipo_intervento: get("dropdown_tipo_intervento"),
        tipo_tariffa: get("dropdown_tipo_tariffa"),
        tipo_addebito: get("dropdown_tipo_addebito"),
        durata: get("dropdown_durata"),
    })
}

#[tauri::command]
pub async fn set_dropdown_list(
    list_name: String,
    items: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let allowed = ["sigla", "clienti", "luoghi", "tipo_intervento", "tipo_tariffa", "tipo_addebito", "durata"];
    if !allowed.contains(&list_name.as_str()) {
        return Err(format!("Lista non valida: {}", list_name));
    }
    let key = format!("dropdown_{}", list_name);
    let value = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    cache::set_config(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_config_value(key: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    cache::get_config(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_config_value(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    cache::set_config(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_cache(email: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.0.lock().map_err(|e| e.to_string())?;
    cache::clear_for_user(&conn, &email).map_err(|e| e.to_string())
}
