use anyhow::{bail, Result};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

use super::soap::ext_prop_names;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InterventionItem {
    pub exchange_item_id: String,
    pub change_key: String,
    pub start_dt: String,
    pub end_dt: String,
    pub subject: String,
    pub nome_tecnico: String,
    pub ragione_sociale: String,
    pub descrizione: String,
    pub altro: String,
    pub tipo_tariffa: String,
    pub tipo_fatturazione: String,
    pub trasferta: String,
    pub durata: String,
    pub body_html: String,
    pub luogo: String,
}

/// Simple XML text extractor: returns the text content of the first element matching `tag_local`.
fn find_text(xml: &str, tag_local: &str) -> String {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut inside = false;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = local_name(&e.name());
                if local == tag_local {
                    inside = true;
                }
            }
            Ok(Event::Text(e)) if inside => {
                return e.unescape().unwrap_or_default().to_string();
            }
            Ok(Event::CData(e)) if inside => {
                return String::from_utf8_lossy(e.into_inner().as_ref()).to_string();
            }
            Ok(Event::End(e)) => {
                if local_name(&e.name()) == tag_local {
                    inside = false;
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    String::new()
}

fn local_name(qname: &quick_xml::name::QName) -> String {
    let bytes = qname.local_name().into_inner();
    String::from_utf8_lossy(bytes).to_string()
}

/// Default wait when EWS reports throttling without a `BackOffMilliseconds` hint.
const DEFAULT_THROTTLE_BACKOFF_MS: u64 = 5_000;
/// Upper bound so a bogus/huge hint can't stall a sync indefinitely.
const MAX_THROTTLE_BACKOFF_MS: u64 = 60_000;

/// If `xml` is an EWS throttling response (`ErrorServerBusy`), return how long
/// to back off — the server's `BackOffMilliseconds` hint, or a default — clamped
/// to a sane ceiling. Returns `None` for any non-throttled response.
pub fn throttle_backoff(xml: &str) -> Option<std::time::Duration> {
    if !xml.contains("ErrorServerBusy") {
        return None;
    }
    let ms = backoff_hint_ms(xml)
        .unwrap_or(DEFAULT_THROTTLE_BACKOFF_MS)
        .clamp(1, MAX_THROTTLE_BACKOFF_MS);
    Some(std::time::Duration::from_millis(ms))
}

/// Extract `<t:Value Name="BackOffMilliseconds">N</t:Value>` from a fault's MessageXml.
fn backoff_hint_ms(xml: &str) -> Option<u64> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut capture = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) if local_name(&e.name()) == "Value" => {
                capture = e.attributes().flatten().any(|a| {
                    a.key.local_name().into_inner() == b"Name"
                        && a.unescape_value().map(|v| v == "BackOffMilliseconds").unwrap_or(false)
                });
            }
            Ok(Event::Text(e)) if capture => {
                return e.unescape().ok()?.trim().parse::<u64>().ok();
            }
            Ok(Event::End(_)) => capture = false,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

/// Check that the SOAP response is not a Fault.
fn check_fault(xml: &str) -> Result<()> {
    if xml.contains("<soap:Fault>") || xml.contains(":Fault>") {
        let msg = find_text(xml, "faultstring");
        if msg.is_empty() {
            bail!("EWS SOAP Fault");
        }
        bail!("EWS SOAP Fault: {}", msg);
    }
    Ok(())
}

/// Parse FindItem response → list of lightweight items (id + change_key + ext props, no body).
pub fn parse_find_items(xml: &str) -> Result<Vec<InterventionItem>> {
    check_fault(xml)?;
    let mut items = Vec::new();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut current: Option<InterventionItem> = None;
    let mut tag_stack: Vec<String> = Vec::new();
    let mut in_ext_prop = false;
    let mut current_prop_name = String::new();
    let mut capture_next_text: Option<String> = None; // field name to fill

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = local_name(&e.name());
                tag_stack.push(local.clone());

                match local.as_str() {
                    "CalendarItem" | "Item" => {
                        current = Some(InterventionItem::default());
                        in_ext_prop = false;
                    }
                    "ItemId" => {
                        if let Some(ref mut item) = current {
                            for attr in e.attributes().flatten() {
                                let key = String::from_utf8_lossy(attr.key.local_name().into_inner()).to_string();
                                let val = attr.unescape_value().unwrap_or_default().to_string();
                                match key.as_str() {
                                    "Id" => item.exchange_item_id = val,
                                    "ChangeKey" => item.change_key = val,
                                    _ => {}
                                }
                            }
                        }
                    }
                    "ExtendedProperty" => in_ext_prop = true,
                    "ExtendedFieldURI" if in_ext_prop => {
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.local_name().into_inner()).to_string();
                            if key == "PropertyName" {
                                let prop_name = attr.unescape_value().unwrap_or_default().to_string();
                                current_prop_name = ext_prop_names()
                                    .iter()
                                    .find(|(n, _)| *n == prop_name.as_str())
                                    .map(|(_, f)| f.to_string())
                                    .unwrap_or_default();
                            }
                        }
                    }
                    "Value" if in_ext_prop && !current_prop_name.is_empty() => {
                        capture_next_text = Some(current_prop_name.clone());
                    }
                    "Start" => capture_next_text = Some("start_dt".to_string()),
                    "End" => capture_next_text = Some("end_dt".to_string()),
                    "Subject" => capture_next_text = Some("subject".to_string()),
                    "Body" => capture_next_text = Some("body_html".to_string()),
                    "Location" => capture_next_text = Some("location".to_string()),
                    _ => {}
                }
            }
            // Handle self-closing elements (e.g. <t:ItemId Id="..." ChangeKey="..."/>)
            Ok(Event::Empty(e)) => {
                let local = local_name(&e.name());
                match local.as_str() {
                    "ItemId" => {
                        if let Some(ref mut item) = current {
                            for attr in e.attributes().flatten() {
                                let key = String::from_utf8_lossy(attr.key.local_name().into_inner()).to_string();
                                let val = attr.unescape_value().unwrap_or_default().to_string();
                                match key.as_str() {
                                    "Id" => item.exchange_item_id = val,
                                    "ChangeKey" => item.change_key = val,
                                    _ => {}
                                }
                            }
                        }
                    }
                    "ExtendedFieldURI" if in_ext_prop => {
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.local_name().into_inner()).to_string();
                            if key == "PropertyName" {
                                let prop_name = attr.unescape_value().unwrap_or_default().to_string();
                                current_prop_name = ext_prop_names()
                                    .iter()
                                    .find(|(n, _)| *n == prop_name.as_str())
                                    .map(|(_, f)| f.to_string())
                                    .unwrap_or_default();
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();
                if let Some(ref field) = capture_next_text.take() {
                    if let Some(ref mut item) = current {
                        fill_field(item, field, &text);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let local = local_name(&e.name());
                tag_stack.pop();
                match local.as_str() {
                    "CalendarItem" | "Item" => {
                        if let Some(mut item) = current.take() {
                            // Fallback: if extended props missing, parse from subject
                            // (mirrors _parse_subject fallback in exchange_service.py)
                            if item.nome_tecnico.is_empty() && !item.subject.is_empty() {
                                let p = super::subject::parse_subject(&item.subject);
                                item.nome_tecnico    = p.nome_tecnico;
                                item.ragione_sociale = p.ragione_sociale;
                                item.descrizione     = p.descrizione;
                                item.altro           = p.altro;
                                if item.tipo_tariffa.is_empty() {
                                    item.tipo_tariffa = p.tipo_tariffa;
                                }
                                if item.tipo_fatturazione.is_empty() {
                                    item.tipo_fatturazione = p.tipo_fatturazione;
                                }
                            }
                            if !item.exchange_item_id.is_empty() {
                                items.push(item);
                            }
                        }
                        in_ext_prop = false;
                        current_prop_name.clear();
                    }
                    "ExtendedProperty" => {
                        in_ext_prop = false;
                        current_prop_name.clear();
                    }
                    _ => {}
                }
                if matches!(local.as_str(), "Value" | "Start" | "End" | "Subject" | "Body") {
                    capture_next_text = None;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(items)
}

/// Parse GetItem response → single InterventionItem with body.
pub fn parse_get_item(xml: &str) -> Result<InterventionItem> {
    check_fault(xml)?;
    let items = parse_find_items(xml)?;
    items.into_iter().next().ok_or_else(|| anyhow::anyhow!("GetItem returned no item"))
}

/// Parse CreateItem response → (item_id, change_key).
pub fn parse_create_item(xml: &str) -> Result<(String, String)> {
    check_fault(xml)?;
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                if local_name(&e.name()) == "ItemId" {
                    let mut id = String::new();
                    let mut ck = String::new();
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.local_name().into_inner()).to_string();
                        let val = attr.unescape_value().unwrap_or_default().to_string();
                        match key.as_str() {
                            "Id" => id = val,
                            "ChangeKey" => ck = val,
                            _ => {}
                        }
                    }
                    if !id.is_empty() {
                        return Ok((id, ck));
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    bail!("CreateItem response contained no ItemId")
}

/// Parse UpdateItem response → new change_key.
pub fn parse_update_item(xml: &str) -> Result<String> {
    check_fault(xml)?;
    let (_, ck) = parse_create_item(xml)?;
    Ok(ck)
}

/// Parse DeleteItem — just check for fault.
pub fn parse_delete_item(xml: &str) -> Result<()> {
    check_fault(xml)
}

fn fill_field(item: &mut InterventionItem, field: &str, value: &str) {
    match field {
        "nome_tecnico" => item.nome_tecnico = value.to_string(),
        "ragione_sociale" => item.ragione_sociale = value.to_string(),
        "descrizione" => item.descrizione = value.to_string(),
        "altro" => item.altro = value.to_string(),
        "tipo_tariffa" => item.tipo_tariffa = value.to_string(),
        "tipo_fatturazione" => item.tipo_fatturazione = value.to_string(),
        "trasferta" => item.trasferta = value.to_string(),
        "durata" => item.durata = value.to_string(),
        "start_dt" => item.start_dt = value.to_string(),
        "end_dt" => item.end_dt = value.to_string(),
        "subject" => item.subject = value.to_string(),
        "body_html" => item.body_html = value.to_string(),
        "location" => item.luogo = value.to_string(),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIND_ITEM_RESPONSE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    <m:FindItemResponse>
      <m:ResponseMessages>
        <m:FindItemResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:RootFolder TotalItemsInView="1">
            <t:Items>
              <t:CalendarItem>
                <t:ItemId Id="AAMkABC123" ChangeKey="DwAAABY"/>
                <t:Subject>MR - ACME Srl - Assistenza - TB Fatturato</t:Subject>
                <t:Start>2024-01-10T09:00:00Z</t:Start>
                <t:End>2024-01-10T11:00:00Z</t:End>
                <t:ExtendedProperty>
                  <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="Nome tecnico:" PropertyType="String"/>
                  <t:Value>MR</t:Value>
                </t:ExtendedProperty>
                <t:ExtendedProperty>
                  <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="Ragione Sociale:" PropertyType="String"/>
                  <t:Value>ACME Srl</t:Value>
                </t:ExtendedProperty>
                <t:ExtendedProperty>
                  <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="Tipo di tariffa:" PropertyType="String"/>
                  <t:Value>TB</t:Value>
                </t:ExtendedProperty>
                <t:ExtendedProperty>
                  <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="Tipo Fatturazione" PropertyType="String"/>
                  <t:Value>Fatturato</t:Value>
                </t:ExtendedProperty>
              </t:CalendarItem>
            </t:Items>
          </m:RootFolder>
        </m:FindItemResponseMessage>
      </m:ResponseMessages>
    </m:FindItemResponse>
  </soap:Body>
</soap:Envelope>"#;

    const CREATE_RESPONSE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    <m:CreateItemResponse>
      <m:ResponseMessages>
        <m:CreateItemResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:Items>
            <t:CalendarItem>
              <t:ItemId Id="AAMkNEW456" ChangeKey="DwAAABZ"/>
            </t:CalendarItem>
          </m:Items>
        </m:CreateItemResponseMessage>
      </m:ResponseMessages>
    </m:CreateItemResponse>
  </soap:Body>
</soap:Envelope>"#;

    const FAULT_RESPONSE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>Access denied</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>"#;

    #[test]
    fn test_parse_find_items() {
        let items = parse_find_items(FIND_ITEM_RESPONSE).unwrap();
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.exchange_item_id, "AAMkABC123");
        assert_eq!(item.change_key, "DwAAABY");
        assert_eq!(item.subject, "MR - ACME Srl - Assistenza - TB Fatturato");
        assert_eq!(item.nome_tecnico, "MR");
        assert_eq!(item.ragione_sociale, "ACME Srl");
        assert_eq!(item.tipo_tariffa, "TB");
        assert_eq!(item.tipo_fatturazione, "Fatturato");
        assert_eq!(item.start_dt, "2024-01-10T09:00:00Z");
    }

    #[test]
    fn test_parse_create_item() {
        let (id, ck) = parse_create_item(CREATE_RESPONSE).unwrap();
        assert_eq!(id, "AAMkNEW456");
        assert_eq!(ck, "DwAAABZ");
    }

    const THROTTLE_RESPONSE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    <m:GetItemResponse>
      <m:ResponseMessages>
        <m:GetItemResponseMessage ResponseClass="Error">
          <m:ResponseCode>ErrorServerBusy</m:ResponseCode>
          <m:MessageXml>
            <t:Value Name="BackOffMilliseconds">25000</t:Value>
          </m:MessageXml>
        </m:GetItemResponseMessage>
      </m:ResponseMessages>
    </m:GetItemResponse>
  </soap:Body>
</soap:Envelope>"#;

    #[test]
    fn test_throttle_backoff_reads_hint() {
        let d = throttle_backoff(THROTTLE_RESPONSE).expect("should detect throttling");
        assert_eq!(d.as_millis(), 25_000);
    }

    #[test]
    fn test_throttle_backoff_none_for_normal() {
        assert!(throttle_backoff(FIND_ITEM_RESPONSE).is_none());
    }

    #[test]
    fn test_throttle_backoff_default_without_hint() {
        let xml = "<x><m:ResponseCode>ErrorServerBusy</m:ResponseCode></x>";
        let d = throttle_backoff(xml).expect("throttled");
        assert_eq!(d.as_millis(), DEFAULT_THROTTLE_BACKOFF_MS as u128);
    }

    #[test]
    fn test_fault_returns_error() {
        assert!(parse_find_items(FAULT_RESPONSE).is_err());
        let err = parse_find_items(FAULT_RESPONSE).unwrap_err();
        assert!(err.to_string().contains("Access denied"), "err: {}", err);
    }
}
