use anyhow::{bail, Result};
use base64::Engine;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Max authenticated session-clients kept warm in the idle pool.
const MAX_IDLE_SESSIONS: usize = 32;
/// How many times to honour an EWS `ErrorServerBusy` back-off before giving up.
const MAX_THROTTLE_RETRIES: u32 = 3;

/// A credential that has been proven to work, so warm calls skip the
/// candidate-probing sweep and re-authenticate directly when needed.
#[derive(Clone)]
enum Auth {
    Ntlm { user: String, domain: String },
    Basic { username: String },
}

#[derive(Clone)]
pub struct EwsClient {
    pub endpoint: String,
    pub email: String,
    password: String,
    domain: Option<String>,
    /// Remembered winning credential (shared across clones).
    auth: Arc<Mutex<Option<Auth>>>,
    /// Pool of idle, already-authenticated session-clients. Each holds a single
    /// keep-alive connection; borrowing one and issuing a bare (header-less)
    /// request reuses its NTLM-authenticated connection — paying the handshake
    /// once per connection instead of once per call.
    sessions: Arc<Mutex<Vec<reqwest::blocking::Client>>>,
}

impl EwsClient {
    pub fn new(server: &str, email: &str, password: &str, domain: Option<&str>) -> Result<Self> {
        Ok(Self {
            endpoint: format!("https://{}/EWS/Exchange.asmx", server),
            email: email.to_string(),
            password: password.to_string(),
            domain: domain.map(String::from),
            auth: Arc::new(Mutex::new(None)),
            sessions: Arc::new(Mutex::new(Vec::new())),
        })
    }

    /// Build a client, loading the account password from the OS keychain.
    pub fn connect(server: &str, email: &str, domain: Option<&str>) -> Result<Self> {
        let password = crate::keychain::load_password(email)?;
        Self::new(server, email, &password, domain)
    }

    /// One session-client = one keep-alive connection. `pool_max_idle_per_host(1)`
    /// keeps the NTLM Type1/Type3 handshake pinned to the same TCP connection,
    /// which is required for connection-oriented NTLM to succeed.
    fn new_session_client() -> Result<reqwest::blocking::Client> {
        Ok(reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(1)
            .pool_idle_timeout(Duration::from_secs(120))
            .gzip(true) // EWS supports gzip; large SOAP XML payloads compress well
            .build()?)
    }

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    /// Username candidates to try, ordered most-likely-first.
    /// Mirrors get_account() in exchange_service.py.
    fn candidates(&self) -> Vec<(String, String)> {
        // (user_for_ntlm_hash, domain_for_ntlm_hash)
        let short = self.email.split('@').next().unwrap_or(&self.email).to_string();
        let mut v: Vec<(String, String)> = Vec::new();
        if let Some(d) = &self.domain {
            v.push((short.clone(), d.clone())); // DOMAIN\user  ← most common
        }
        v.push((self.email.clone(), String::new())); // UPN, empty domain
        v.push((short.clone(), String::new())); // sAMAccountName only
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

    fn remember(&self, auth: Auth) {
        if let Ok(mut g) = self.auth.lock() {
            *g = Some(auth);
        }
    }

    /// Return a still-authenticated session-client to the idle pool (bounded).
    fn release(&self, client: reqwest::blocking::Client) {
        if let Ok(mut v) = self.sessions.lock() {
            if v.len() < MAX_IDLE_SESSIONS {
                v.push(client);
            }
        }
    }

    /// Send a SOAP request, honouring EWS throttling: when the server replies
    /// with `ErrorServerBusy` it includes a `BackOffMilliseconds` hint — we wait
    /// that long and retry instead of hammering the server (which earns a ban).
    pub fn call(&self, soap_action: &str, body: &str) -> Result<String> {
        let mut attempt = 0u32;
        loop {
            let text = self.call_once(soap_action, body)?;
            if let Some(backoff) = crate::exchange::parse::throttle_backoff(&text) {
                if attempt < MAX_THROTTLE_RETRIES {
                    attempt += 1;
                    std::thread::sleep(backoff);
                    continue;
                }
            }
            return Ok(text);
        }
    }

    /// One transport attempt: reuses an authenticated keep-alive connection when
    /// available; otherwise authenticates (remembered credential first, then a
    /// full NTLM→Basic candidate sweep) and remembers what worked.
    fn call_once(&self, soap_action: &str, body: &str) -> Result<String> {
        // Borrow a warm session if one is idle.
        let warm = self.sessions.lock().ok().and_then(|mut v| v.pop());

        if let Some(client) = warm {
            // The connection is (probably) already authenticated → bare request.
            if let Ok(text) = self.call_bare(&client, soap_action, body) {
                self.release(client);
                return Ok(text);
            }
            // Connection dropped or expired: re-authenticate this same client.
            match self.authenticate(&client, soap_action, body) {
                Ok(text) => {
                    self.release(client);
                    return Ok(text);
                }
                Err(_) => { /* drop client, fall through to a fresh one */ }
            }
        }

        // Cold path: brand-new session-client, authenticate from scratch.
        let client = Self::new_session_client()?;
        let text = self.authenticate(&client, soap_action, body)?;
        self.release(client);
        Ok(text)
    }

    /// Authenticate `client`, preferring the remembered credential, then a full
    /// candidate sweep (NTLM for each username form, then Basic). Remembers the
    /// winner so later calls re-authenticate directly.
    fn authenticate(
        &self,
        client: &reqwest::blocking::Client,
        soap_action: &str,
        body: &str,
    ) -> Result<String> {
        // Fast path: re-use the credential we already know works.
        let remembered = self.auth.lock().ok().and_then(|g| g.clone());
        if let Some(auth) = remembered {
            let r = match &auth {
                Auth::Ntlm { user, domain } => {
                    self.call_ntlm(client, soap_action, body, user, domain)
                }
                Auth::Basic { username } => self.call_basic(client, soap_action, body, username),
            };
            if let Ok(text) = r {
                return Ok(text);
            }
            // Remembered credential stopped working → fall through to full probe.
        }

        let candidates = self.candidates();
        let mut last_err = String::new();

        for (user, domain) in &candidates {
            match self.call_ntlm(client, soap_action, body, user, domain) {
                Ok(r) => {
                    self.remember(Auth::Ntlm { user: user.clone(), domain: domain.clone() });
                    return Ok(r);
                }
                Err(e) => last_err = format!("NTLM {user}@{domain}: {e}"),
            }
        }
        for (user, domain) in &candidates {
            let username = if domain.is_empty() {
                user.clone()
            } else {
                format!("{}\\{}", domain, user)
            };
            match self.call_basic(client, soap_action, body, &username) {
                Ok(r) => {
                    self.remember(Auth::Basic { username });
                    return Ok(r);
                }
                Err(e) => last_err = format!("Basic {username}: {e}"),
            }
        }

        bail!("Exchange auth failed ({}): {}", self.endpoint, last_err)
    }

    /// Bare request with no Authorization header — succeeds only if the
    /// underlying keep-alive connection is already NTLM-authenticated.
    fn call_bare(
        &self,
        client: &reqwest::blocking::Client,
        soap_action: &str,
        body: &str,
    ) -> Result<String> {
        let resp = client
            .post(&self.endpoint)
            .header("SOAPAction", soap_action)
            .header("Content-Type", "text/xml; charset=utf-8")
            .body(body.to_string())
            .send()?;
        if resp.status().is_success() {
            Ok(resp.text()?)
        } else {
            bail!("connection not authenticated: HTTP {}", resp.status())
        }
    }

    /// NTLM 3-step handshake on a single pooled connection of `client`.
    fn call_ntlm(
        &self,
        client: &reqwest::blocking::Client,
        soap_action: &str,
        body: &str,
        user: &str,
        domain: &str,
    ) -> Result<String> {
        // ── Step 1: Type1 Negotiate ──────────────────────────────────────────
        let type1_hdr = format!("NTLM {}", Self::b64(&crate::ntlm::negotiate_msg()));
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
        let type3_hdr = format!("NTLM {}", Self::b64(&type3));

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

    fn call_basic(
        &self,
        client: &reqwest::blocking::Client,
        soap_action: &str,
        body: &str,
        username: &str,
    ) -> Result<String> {
        let token = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", username, self.password).as_bytes());

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
