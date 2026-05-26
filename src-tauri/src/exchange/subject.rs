/// Mirrors build_subject() from exchange_service.py (IC050815 formula).
pub fn build_subject(
    nome_tecnico: &str,
    ragione_sociale: &str,
    descrizione: &str,
    altro: &str,
    tipo_tariffa: &str,
    tipo_fatturazione: &str,
) -> String {
    let mut parts: Vec<&str> = vec![
        nome_tecnico.trim(),
        ragione_sociale.trim(),
        descrizione.trim(),
        altro.trim(),
    ];
    // strip trailing empty parts
    while parts.last().map(|s| s.is_empty()).unwrap_or(false) {
        parts.pop();
    }
    let tariff_buf;
    let tariff = {
        let t = tipo_tariffa.trim();
        let a = tipo_fatturazione.trim();
        tariff_buf = format!("{} {}", t, a);
        tariff_buf.trim()
    };
    if !tariff.is_empty() {
        parts.push(tariff);
    }
    parts.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" - ")
}

#[derive(Debug, Default, PartialEq)]
pub struct ParsedSubject {
    pub nome_tecnico: String,
    pub ragione_sociale: String,
    pub descrizione: String,
    pub altro: String,
    pub tipo_tariffa: String,
    pub tipo_fatturazione: String,
}

/// Mirrors _parse_subject() from exchange_service.py.
pub fn parse_subject(subject: &str) -> ParsedSubject {
    let parts: Vec<&str> = subject.split(" - ").map(str::trim).collect();
    let mut r = ParsedSubject::default();
    if parts.len() >= 1 {
        r.nome_tecnico = parts[0].to_string();
    }
    if parts.len() >= 2 {
        r.ragione_sociale = parts[1].to_string();
    }
    if parts.len() >= 3 {
        r.descrizione = parts[2].to_string();
    }
    if parts.len() >= 4 {
        r.altro = parts[3].to_string();
    }
    if parts.len() >= 5 {
        let last = parts[4];
        // "TB (Addebito Reale)" → split on first whitespace
        if let Some(idx) = last.find(char::is_whitespace) {
            r.tipo_tariffa = last[..idx].to_string();
            r.tipo_fatturazione = last[idx..].trim().to_string();
        } else {
            r.tipo_tariffa = last.to_string();
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_full() {
        let s = build_subject("MR", "ACME Srl", "Assistenza server", "", "TB", "Addebito Reale");
        assert_eq!(s, "MR - ACME Srl - Assistenza server - TB Addebito Reale");
    }

    #[test]
    fn test_build_no_tariff() {
        let s = build_subject("MR", "ACME Srl", "Assistenza", "", "", "");
        assert_eq!(s, "MR - ACME Srl - Assistenza");
    }

    #[test]
    fn test_build_strips_trailing_empty() {
        let s = build_subject("MR", "ACME Srl", "", "", "", "");
        assert_eq!(s, "MR - ACME Srl");
    }

    #[test]
    fn test_build_with_altro() {
        let s = build_subject("MR", "Cliente", "Tipo", "Nota extra", "Orario", "Fatturato");
        assert_eq!(s, "MR - Cliente - Tipo - Nota extra - Orario Fatturato");
    }

    #[test]
    fn test_parse_full() {
        let p = parse_subject("MR - ACME Srl - Assistenza server - Note - TB Addebito Reale");
        assert_eq!(p.nome_tecnico, "MR");
        assert_eq!(p.ragione_sociale, "ACME Srl");
        assert_eq!(p.descrizione, "Assistenza server");
        assert_eq!(p.altro, "Note");
        assert_eq!(p.tipo_tariffa, "TB");
        assert_eq!(p.tipo_fatturazione, "Addebito Reale");
    }

    #[test]
    fn test_parse_partial() {
        let p = parse_subject("MR - Cliente");
        assert_eq!(p.nome_tecnico, "MR");
        assert_eq!(p.ragione_sociale, "Cliente");
        assert_eq!(p.descrizione, "");
        assert_eq!(p.tipo_tariffa, "");
    }

    #[test]
    fn test_roundtrip() {
        let s = build_subject("AB", "Rossi Srl", "Configurazione", "Rete locale", "Orario", "Fatturato");
        let p = parse_subject(&s);
        assert_eq!(p.nome_tecnico, "AB");
        assert_eq!(p.ragione_sociale, "Rossi Srl");
        assert_eq!(p.descrizione, "Configurazione");
        assert_eq!(p.altro, "Rete locale");
        assert_eq!(p.tipo_tariffa, "Orario");
        assert_eq!(p.tipo_fatturazione, "Fatturato");
    }
}
