use anyhow::{bail, Result};
use base64::Engine;
use std::time::Duration;

#[derive(Clone)]
pub struct EwsClient {
    pub endpoint: String,
    pub email: String,
    password: String,
    domain: Option<String>,
}

impl EwsClient {
    pub fn new(server: &str, email: &str, password: &str, domain: Option<&str>) -> Result<Self> {
        Ok(Self {
            endpoint: format!("https://{}/EWS/Exchange.asmx", server),
            email: email.to_string(),
            password: password.to_string(),
            domain: domain.map(String::from),
        })
    }

    /// Build a client, loading the account password from the OS keychain.
    pub fn connect(server: &str, email: &str, domain: Option<&str>) -> Result<Self> {
        let password = crate::keychain::load_password(email)?;
        Self::new(server, email, &password, domain)
    }

    fn http_client() -> Result<reqwest::blocking::Client> {
        Ok(reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(1) // keep connection alive for NTLM 3-step handshake
            .build()?)
    }

    /// Username candidates to try, ordered most-likely-first.
    /// Mirrors get_account() in exchange_service.py.
    fn candidates(&self) -> Vec<(String, String)> {
        // (user_for_ntlm_hash, domain_for_ntlm_hash)
        let short = self.email.split('@').next().unwrap_or(&self.email).to_string();
        let mut v: Vec<(String, String)> = Vec::new();
        if let Some(d) = &self.domain {
            v.push((short.clone(), d.clone()));            // DOMAIN\user  ← most common
        }
        v.push((self.email.clone(), String::new()));       // UPN, empty domain
        v.push((short.clone(), String::new()));            // sAMAccountName only
        v
    }

    /// Build the SOAPAction URL for a given EWS message (e.g. "GetItem").
    fn action_url(message: &str) -> String {
        format!("http://schemas.microsoft.com/exchange/services/2006/messages/{message}")
    }

    /// Blocking SOAP call by message name. Safe to use inside `spawn_blocking`.
    pub fn call_message(&self, message: &str, body: &str) -> Result<String> {
        self.call(&Self::action_url(message), body)
    }

    /// Like `call_message`, but yields the async runtime while the blocking HTTP
    /// work runs — for use directly on a Tokio worker (not inside spawn_blocking).
    pub fn call_action(&self, message: &str, body: &str) -> Result<String> {
        tokio::task::block_in_place(|| self.call_message(message, body))
    }

    /// Send a SOAP request, trying NTLM (multiple username formats) then Basic.
    pub fn call(&self, soap_action: &str, body: &str) -> Result<String> {
        let candidates = self.candidates();
        let mut last_err = String::new();

        for (user, domain) in &candidates {
            match self.call_ntlm(soap_action, body, user, domain) {
                Ok(r)  => return Ok(r),
                Err(e) => last_err = format!("NTLM {user}@{domain}: {e}"),
            }
        }
        for (user, domain) in &candidates {
            let username = if domain.is_empty() {
                user.clone()
            } else {
                format!("{}\\{}", domain, user)
            };
            match self.call_basic(soap_action, body, &username) {
                Ok(r)  => return Ok(r),
                Err(e) => last_err = format!("Basic {username}: {e}"),
            }
        }

        bail!("Exchange auth failed ({}): {}", self.endpoint, last_err)
    }

    /// NTLM 3-step handshake on a single pooled connection.
    fn call_ntlm(
        &self,
        soap_action: &str,
        body: &str,
        user: &str,
        domain: &str,
    ) -> Result<String> {
        let client = Self::http_client()?;
        let b64 = |bytes: &[u8]| -> String {
            base64::engine::general_purpose::STANDARD.encode(bytes)
        };

        // ── Step 1: Type1 Negotiate ──────────────────────────────────────────
        let type1_hdr = format!("NTLM {}", b64(&crate::ntlm::negotiate_msg()));
        let resp1 = client
            .post(&self.endpoint)
            .header("Authorization", type1_hdr)
            .header("SOAPAction", soap_action)
            .header("Content-Type", "text/xml; charset=utf-8")
            .body(body.to_string())
            .send()?;

        if resp1.status().is_success() {
            return Ok(resp1.text()?); // server accepted without challenge (rare)
        }
        if resp1.status() != 401 {
            bail!("NTLM Type1: HTTP {}", resp1.status());
        }

        // Extract Type2 token before consuming response
        let type2_b64 = resp1
            .headers()
            .get_all("WWW-Authenticate")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find_map(|s| s.strip_prefix("NTLM ").map(String::from))
            .ok_or_else(|| anyhow::anyhow!("No NTLM challenge in 401 response"))?;

        // Read (empty) body so the connection returns to the pool
        drop(resp1);

        // ── Step 2: parse Type2, build Type3 ────────────────────────────────
        let type2_bytes = base64::engine::general_purpose::STANDARD.decode(&type2_b64)?;
        let challenge = crate::ntlm::parse_challenge(&type2_bytes)
            .ok_or_else(|| anyhow::anyhow!("Invalid NTLM Type2 message"))?;

        let type3 = crate::ntlm::authenticate_msg(&challenge, user, domain, &self.password);
        let type3_hdr = format!("NTLM {}", b64(&type3));

        // ── Step 3: Type3 Authenticate (same pooled connection) ──────────────
        let resp2 = client
            .post(&self.endpoint)
            .header("Authorization", type3_hdr)
            .header("SOAPAction", soap_action)
            .header("Content-Type", "text/xml; charset=utf-8")
            .body(body.to_string())
            .send()?;

        if !resp2.status().is_success() {
            bail!("NTLM Type3: HTTP {}", resp2.status());
        }
        Ok(resp2.text()?)
    }

    fn call_basic(&self, soap_action: &str, body: &str, username: &str) -> Result<String> {
        let token = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", username, self.password).as_bytes());

        let client = Self::http_client()?;
        let resp = client
            .post(&self.endpoint)
            .header("Authorization", format!("Basic {}", token))
            .header("SOAPAction", soap_action)
            .header("Content-Type", "text/xml; charset=utf-8")
            .body(body.to_string())
            .send()?;

        if !resp.status().is_success() {
            bail!("Basic: HTTP {}", resp.status());
        }
        Ok(resp.text()?)
    }
}
