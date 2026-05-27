use crate::db::cache;
use crate::AppState;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use lettre::{
    message::{Attachment, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
use tauri::State;

#[tauri::command]
pub async fn send_email(
    to: String,
    cc: Option<String>,
    subject: String,
    body: String,
    attachment_base64: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (smtp_host, smtp_port, smtp_user, smtp_password, from_name, use_ssl) = {
        let conn = state.db.0.lock().map_err(|e| e.to_string())?;
        let get = |key: &str| cache::get_config(&conn, key).ok().flatten();

        let host = get("smtp_host").ok_or("SMTP host non configurato")?;
        let port: u16 = get("smtp_port")
            .and_then(|s| s.parse().ok())
            .unwrap_or(587);
        let user = get("smtp_user").ok_or("SMTP user non configurato")?;
        let password = get("smtp_password").ok_or("SMTP password non configurata")?;
        let name = get("smtp_from_name").unwrap_or_else(|| "Gestore Interventi".to_string());
        let ssl: bool = get("smtp_use_ssl")
            .and_then(|s| s.parse().ok())
            .unwrap_or(false);
        (host, port, user, password, name, ssl)
    };

    let from_str = format!("{} <{}>", from_name, smtp_user);
    let from = from_str
        .parse()
        .map_err(|e: lettre::address::AddressError| e.to_string())?;
    let to_addr = to
        .parse()
        .map_err(|e: lettre::address::AddressError| e.to_string())?;

    let mut builder = Message::builder()
        .from(from)
        .to(to_addr)
        .subject(subject);

    if let Some(cc_str) = &cc {
        let trimmed = cc_str.trim();
        if !trimmed.is_empty() {
            let cc_addr = trimmed
                .parse()
                .map_err(|e: lettre::address::AddressError| e.to_string())?;
            builder = builder.cc(cc_addr);
        }
    }

    let email = if let Some(pdf_b64) = attachment_base64 {
        let pdf_bytes = STANDARD.decode(&pdf_b64).map_err(|e| e.to_string())?;
        let attachment = Attachment::new("intervento.pdf".to_string())
            .body(pdf_bytes, "application/pdf".parse().unwrap());
        builder
            .multipart(
                MultiPart::mixed()
                    .singlepart(SinglePart::plain(body))
                    .singlepart(attachment),
            )
            .map_err(|e| e.to_string())?
    } else {
        builder.body(body).map_err(|e| e.to_string())?
    };

    let creds = Credentials::new(smtp_user, smtp_password);

    let mailer = if use_ssl {
        SmtpTransport::relay(&smtp_host)
            .map_err(|e| e.to_string())?
            .port(smtp_port)
            .credentials(creds)
            .build()
    } else {
        SmtpTransport::starttls_relay(&smtp_host)
            .map_err(|e| e.to_string())?
            .port(smtp_port)
            .credentials(creds)
            .build()
    };

    mailer.send(&email).map_err(|e| e.to_string())?;
    Ok(())
}
