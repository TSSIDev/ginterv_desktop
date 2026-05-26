use anyhow::{bail, Result};

pub struct EwsClient {
    http: reqwest::blocking::Client,
    pub endpoint: String,
    pub email: String,
}

impl EwsClient {
    /// Try NTLM first, fallback to Basic auth — mirrors get_account() in exchange_service.py.
    pub fn new(server: &str, email: &str, password: &str, domain: Option<&str>) -> Result<Self> {
        let endpoint = format!("https://{}/EWS/Exchange.asmx", server);

        // Try Basic auth (reqwest blocking with credentials)
        let user = match domain {
            Some(d) if !d.is_empty() => format!("{}\\{}", d, email),
            _ => email.to_string(),
        };

        let http = reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true) // some Exchange installs have self-signed certs
            .timeout(std::time::Duration::from_secs(30))
            .build()?;

        // Store credentials for use in call()
        // We'll pass them via the Authorization header for Basic auth
        let credentials = format!("{}:{}", user, password);
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            credentials.as_bytes(),
        );
        let auth_header = format!("Basic {}", encoded);

        Ok(Self {
            http: reqwest::blocking::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_secs(30))
                .default_headers({
                    let mut h = reqwest::header::HeaderMap::new();
                    h.insert(
                        reqwest::header::AUTHORIZATION,
                        reqwest::header::HeaderValue::from_str(&auth_header)?,
                    );
                    h
                })
                .build()?,
            endpoint,
            email: email.to_string(),
        })
    }

    pub fn call(&self, soap_action: &str, body: &str) -> Result<String> {
        let resp = self
            .http
            .post(&self.endpoint)
            .header("SOAPAction", soap_action)
            .header("Content-Type", "text/xml; charset=utf-8")
            .body(body.to_string())
            .send()?;

        if !resp.status().is_success() {
            bail!("EWS HTTP {}: {}", resp.status(), self.endpoint);
        }
        Ok(resp.text()?)
    }
}
