/// NTLMv2 message builder — mirrors the behaviour of exchangelib/requests-ntlm.
///
/// Protocol reference: [MS-NLMP]
/// Flow: client sends Type1 (negotiate) → server replies Type2 (challenge) →
///       client sends Type3 (authenticate) on the **same** TCP connection.
use digest::Digest;
use hmac::{Hmac, Mac};
use md4::Md4;
use md5::Md5;

type HmacMd5 = Hmac<Md5>;

// ── helpers ──────────────────────────────────────────────────────────────────

pub fn utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(|c| c.to_le_bytes()).collect()
}

fn read_u16le(b: &[u8], off: usize) -> u16 {
    u16::from_le_bytes(b[off..off + 2].try_into().unwrap_or_default())
}

fn read_u32le(b: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(b[off..off + 4].try_into().unwrap_or_default())
}

// Flags sent in Type1 and echoed in Type3.
// ESS (0x00080000) forces NTLMv2; 128-bit (0x20000000) & 56-bit (0x80000000)
// signal key strength.
const FLAGS: u32 = 0x00000001  // NEGOTIATE_UNICODE
    | 0x00000002  // NEGOTIATE_OEM
    | 0x00000004  // REQUEST_TARGET
    | 0x00000200  // NEGOTIATE_NTLM
    | 0x00008000  // NEGOTIATE_ALWAYS_SIGN
    | 0x00080000  // NEGOTIATE_EXTENDED_SESSION_SECURITY (NTLMv2)
    | 0x20000000  // NEGOTIATE_128
    | 0x80000000; // NEGOTIATE_56

// ── Type 1: Negotiate ────────────────────────────────────────────────────────

pub fn negotiate_msg() -> Vec<u8> {
    // Minimum 32-byte Type1 with no domain/workstation payload.
    let mut msg = vec![0u8; 32];
    msg[0..8].copy_from_slice(b"NTLMSSP\0");
    msg[8..12].copy_from_slice(&1u32.to_le_bytes());
    msg[12..16].copy_from_slice(&FLAGS.to_le_bytes());
    msg
}

// ── Type 2: Challenge (parse) ────────────────────────────────────────────────

pub struct Challenge {
    pub server_challenge: [u8; 8],
    pub target_info: Vec<u8>,
}

pub fn parse_challenge(data: &[u8]) -> Option<Challenge> {
    if data.len() < 48 || &data[0..8] != b"NTLMSSP\0" || read_u32le(data, 8) != 2 {
        return None;
    }
    let mut sc = [0u8; 8];
    sc.copy_from_slice(&data[24..32]);

    // TargetInfoFields: Len@40, MaxLen@42, Offset@44
    let ti_len = read_u16le(data, 40) as usize;
    let ti_off = read_u32le(data, 44) as usize;
    let target_info = if ti_len > 0 && ti_off + ti_len <= data.len() {
        data[ti_off..ti_off + ti_len].to_vec()
    } else {
        vec![]
    };

    Some(Challenge { server_challenge: sc, target_info })
}

// ── Type 3: Authenticate ─────────────────────────────────────────────────────

fn windows_filetime_now() -> [u8; 8] {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Windows epoch starts 1601-01-01; diff from Unix epoch (1970) = 11644473600 s
    let ft = (secs + 11_644_473_600) * 10_000_000;
    ft.to_le_bytes()
}

fn write_secbuf(out: &mut Vec<u8>, len: u16, offset: u32) {
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&len.to_le_bytes()); // MaxLen == Len
    out.extend_from_slice(&offset.to_le_bytes());
}

/// Build Type3 (Authenticate) message.
///
/// `user`   — plain account name, no DOMAIN\ prefix (e.g. "manuel.meliconi")
/// `domain` — NetBIOS domain or empty string (e.g. "TSSI")
/// `password` — clear-text password
pub fn authenticate_msg(
    ch: &Challenge,
    user: &str,
    domain: &str,
    password: &str,
) -> Vec<u8> {
    // NT hash = MD4(UTF-16LE(password))
    let nt_hash: [u8; 16] = Md4::digest(utf16le(password)).into();

    // ResponseKeyNT = HMAC-MD5(nt_hash, UTF-16LE(uppercase(user) + domain))
    // Per [MS-NLMP] 3.3.2 — domain is NOT uppercased
    let mut identity = utf16le(&user.to_uppercase());
    identity.extend(utf16le(domain));
    let mut mac = HmacMd5::new_from_slice(&nt_hash).expect("hmac key");
    mac.update(&identity);
    let response_key: [u8; 16] = mac.finalize().into_bytes().into();

    // Client challenge: 8 bytes from UUID entropy
    let client_challenge: [u8; 8] = {
        let u = uuid::Uuid::new_v4();
        u.as_bytes()[..8].try_into().unwrap()
    };

    // Blob = RespType | HiRespType | Reserved×2 | Timestamp | ClientChallenge |
    //        Reserved | TargetInfo | Reserved
    let mut blob: Vec<u8> = Vec::new();
    blob.extend_from_slice(&[0x01, 0x01, 0x00, 0x00]); // RespType/HiRespType/Reserved
    blob.extend_from_slice(&[0u8; 4]);                  // Reserved
    blob.extend_from_slice(&windows_filetime_now());
    blob.extend_from_slice(&client_challenge);
    blob.extend_from_slice(&[0u8; 4]);                  // Reserved
    blob.extend_from_slice(&ch.target_info);
    blob.extend_from_slice(&[0u8; 4]);                  // trailing Reserved

    // NTProofStr = HMAC-MD5(response_key, server_challenge | blob)
    let mut mac2 = HmacMd5::new_from_slice(&response_key).expect("hmac key");
    mac2.update(&ch.server_challenge);
    mac2.update(&blob);
    let nt_proof: [u8; 16] = mac2.finalize().into_bytes().into();

    // NT response = NTProofStr + blob
    let mut nt_resp: Vec<u8> = nt_proof.to_vec();
    nt_resp.extend_from_slice(&blob);

    // LMv2 response = HMAC-MD5(response_key, server_challenge | client_challenge)
    //                 + client_challenge  → 24 bytes
    let mut lm_mac = HmacMd5::new_from_slice(&response_key).expect("hmac key");
    lm_mac.update(&ch.server_challenge);
    lm_mac.update(&client_challenge);
    let lm_proof: [u8; 16] = lm_mac.finalize().into_bytes().into();
    let mut lm_resp: Vec<u8> = lm_proof.to_vec();
    lm_resp.extend_from_slice(&client_challenge); // 24 bytes total

    // Strings in UTF-16LE for the message payload
    let domain_b = utf16le(domain);
    let user_b   = utf16le(user);
    let ws_b     = utf16le("WORKSTATION");

    // Header layout (64 bytes, no MIC/Version):
    // sig(8) + type(4) + lm(8) + nt(8) + dom(8) + usr(8) + ws(8) + sess(8) + flags(4)
    const HDR: u32 = 64;
    let lm_off   = HDR;
    let nt_off   = lm_off + lm_resp.len() as u32;
    let dom_off  = nt_off + nt_resp.len() as u32;
    let usr_off  = dom_off + domain_b.len() as u32;
    let ws_off   = usr_off + user_b.len() as u32;
    let sess_off = ws_off  + ws_b.len() as u32;

    let mut msg: Vec<u8> = Vec::new();
    msg.extend_from_slice(b"NTLMSSP\0");
    msg.extend_from_slice(&3u32.to_le_bytes());
    write_secbuf(&mut msg, lm_resp.len() as u16, lm_off);
    write_secbuf(&mut msg, nt_resp.len() as u16, nt_off);
    write_secbuf(&mut msg, domain_b.len() as u16, dom_off);
    write_secbuf(&mut msg, user_b.len() as u16, usr_off);
    write_secbuf(&mut msg, ws_b.len() as u16, ws_off);
    write_secbuf(&mut msg, 0, sess_off); // empty session key
    msg.extend_from_slice(&FLAGS.to_le_bytes());

    debug_assert_eq!(msg.len(), 64, "NTLM Type3 header must be 64 bytes");

    msg.extend_from_slice(&lm_resp);
    msg.extend_from_slice(&nt_resp);
    msg.extend_from_slice(&domain_b);
    msg.extend_from_slice(&user_b);
    msg.extend_from_slice(&ws_b);

    msg
}
