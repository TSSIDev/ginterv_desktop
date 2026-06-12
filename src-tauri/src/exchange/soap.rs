/// All 8 extended property names used by the IC050815 Outlook form.
const EXT_PROPS: &[(&str, &str)] = &[
    ("Nome tecnico:", "nome_tecnico"),
    ("Ragione Sociale:", "ragione_sociale"),
    ("Descrizione intervento", "descrizione"),
    ("Altro", "altro"),
    ("Tipo di tariffa:", "tipo_tariffa"),
    ("Tipo Fatturazione", "tipo_fatturazione"),
    ("Trasferta", "trasferta"),
    ("Durata intervento", "durata"),
];

fn ext_field_uris() -> String {
    EXT_PROPS
        .iter()
        .map(|(name, _)| {
            format!(
                r#"<t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="{}" PropertyType="String"/>"#,
                name
            )
        })
        .collect::<Vec<_>>()
        .join("\n        ")
}

fn soap_envelope(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    {}
  </soap:Body>
</soap:Envelope>"#,
        body
    )
}

/// FindItem (CalendarView) — returns IdOnly + core metadata + all extended props
/// for the date range. Carrying Subject/Start/End/Location here means new/changed
/// items can be cached immediately from FindItem; GetItem is only needed to pull
/// the (non-streamable) body afterwards.
pub fn find_items(email: &str, start: &str, end: &str) -> String {
    let meta_field_uris = r#"<t:FieldURI FieldURI="item:Subject"/>
        <t:FieldURI FieldURI="calendar:Start"/>
        <t:FieldURI FieldURI="calendar:End"/>
        <t:FieldURI FieldURI="item:Location"/>"#;
    let body = format!(
        r#"<m:FindItem Traversal="Shallow">
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        {meta}
        {ext}
      </m:ItemShape>
      <m:CalendarView StartDate="{start}" EndDate="{end}"/>
      <m:ParentFolderIds>
        <t:DistinguishedFolderId Id="calendar">
          <t:Mailbox><t:EmailAddress>{email}</t:EmailAddress></t:Mailbox>
        </t:DistinguishedFolderId>
      </m:ParentFolderIds>
    </m:FindItem>"#,
        meta = meta_field_uris,
        ext = ext_field_uris(),
        start = start,
        end = end,
        email = xml_escape(email),
    );
    soap_envelope(&body)
}

/// GetItem — AllProperties for a single calendar item.
pub fn get_item(item_id: &str, change_key: &str) -> String {
    get_items(std::slice::from_ref(&(item_id, change_key)))
}

/// GetItem — AllProperties for many calendar items in one round-trip.
/// EWS accepts multiple `<t:ItemId>` per request; the response carries one
/// item per id (per-id errors are reported individually, not as a SOAP fault).
pub fn get_items(ids: &[(&str, &str)]) -> String {
    let item_ids = ids
        .iter()
        .map(|(id, ck)| {
            format!(
                r#"<t:ItemId Id="{id}" ChangeKey="{ck}"/>"#,
                id = xml_escape(id),
                ck = xml_escape(ck),
            )
        })
        .collect::<Vec<_>>()
        .join("\n        ");

    let body = format!(
        r#"<m:GetItem>
      <m:ItemShape>
        <t:BaseShape>AllProperties</t:BaseShape>
        {ext}
      </m:ItemShape>
      <m:ItemIds>
        {item_ids}
      </m:ItemIds>
    </m:GetItem>"#,
        ext = ext_field_uris(),
        item_ids = item_ids,
    );
    soap_envelope(&body)
}

/// SyncFolderItems — server-side delta sync of the calendar folder.
/// With `sync_state = None` starts a fresh enumeration; with a token returns
/// only creates/updates/deletes since that token. The shape carries the same
/// metadata + extended props as FindItem so changed items can be cached
/// immediately, with GetItem needed only for the body.
///
/// NB: unlike CalendarView, recurring appointments come back as the master
/// only (no occurrence expansion) — the periodic FindItem reconcile covers that.
pub fn sync_folder_items(email: &str, sync_state: Option<&str>, max_changes: usize) -> String {
    let meta_field_uris = r#"<t:FieldURI FieldURI="item:Subject"/>
        <t:FieldURI FieldURI="calendar:Start"/>
        <t:FieldURI FieldURI="calendar:End"/>
        <t:FieldURI FieldURI="item:Location"/>"#;
    let state_xml = sync_state
        .map(|s| format!("<m:SyncState>{}</m:SyncState>\n      ", xml_escape(s)))
        .unwrap_or_default();
    let body = format!(
        r#"<m:SyncFolderItems>
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        <t:AdditionalProperties>
        {meta}
        {ext}
        </t:AdditionalProperties>
      </m:ItemShape>
      <m:SyncFolderId>
        <t:DistinguishedFolderId Id="calendar">
          <t:Mailbox><t:EmailAddress>{email}</t:EmailAddress></t:Mailbox>
        </t:DistinguishedFolderId>
      </m:SyncFolderId>
      {state}<m:MaxChangesReturned>{max_changes}</m:MaxChangesReturned>
    </m:SyncFolderItems>"#,
        meta = meta_field_uris,
        ext = ext_field_uris(),
        email = xml_escape(email),
        state = state_xml,
        max_changes = max_changes,
    );
    soap_envelope(&body)
}

pub struct CreateItemData<'a> {
    pub email: &'a str,
    pub subject: &'a str,
    pub start: &'a str,
    pub end: &'a str,
    pub body_html: &'a str,
    pub location: &'a str,
    pub nome_tecnico: &'a str,
    pub ragione_sociale: &'a str,
    pub descrizione: &'a str,
    pub altro: &'a str,
    pub tipo_tariffa: &'a str,
    pub tipo_fatturazione: &'a str,
    pub trasferta: &'a str,
    pub durata: &'a str,
}

fn ext_props_xml(d: &CreateItemData) -> String {
    let values = [
        ("Nome tecnico:", d.nome_tecnico),
        ("Ragione Sociale:", d.ragione_sociale),
        ("Descrizione intervento", d.descrizione),
        ("Altro", d.altro),
        ("Tipo di tariffa:", d.tipo_tariffa),
        ("Tipo Fatturazione", d.tipo_fatturazione),
        ("Trasferta", d.trasferta),
        ("Durata intervento", d.durata),
    ];
    values
        .iter()
        .map(|(name, val)| {
            format!(
                r#"<t:ExtendedProperty>
          <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="{}" PropertyType="String"/>
          <t:Value>{}</t:Value>
        </t:ExtendedProperty>"#,
                name,
                xml_escape(val)
            )
        })
        .collect::<Vec<_>>()
        .join("\n        ")
}

/// CreateItem — creates a CalendarItem.
pub fn create_item(d: &CreateItemData) -> String {
    let body = format!(
        r#"<m:CreateItem SendMeetingInvitations="SendToNone">
      <m:SavedItemFolderId>
        <t:DistinguishedFolderId Id="calendar">
          <t:Mailbox><t:EmailAddress>{email}</t:EmailAddress></t:Mailbox>
        </t:DistinguishedFolderId>
      </m:SavedItemFolderId>
      <m:Items>
        <t:CalendarItem>
          <t:Subject>{subject}</t:Subject>
          <t:Body BodyType="HTML">{body_html}</t:Body>
          <t:Start>{start}</t:Start>
          <t:End>{end}</t:End>
          <t:Location>{location}</t:Location>
          {ext}
        </t:CalendarItem>
      </m:Items>
    </m:CreateItem>"#,
        email = xml_escape(d.email),
        subject = xml_escape(d.subject),
        body_html = xml_escape(d.body_html),
        start = d.start,
        end = d.end,
        location = xml_escape(d.location),
        ext = ext_props_xml(d),
    );
    soap_envelope(&body)
}

/// UpdateItem — updates subject, times, body, and all extended props.
pub fn update_item(item_id: &str, change_key: &str, d: &CreateItemData) -> String {
    let field_updates = format!(
        r#"<t:SetItemField>
            <t:FieldURI FieldURI="item:Subject"/>
            <t:CalendarItem><t:Subject>{subject}</t:Subject></t:CalendarItem>
          </t:SetItemField>
          <t:SetItemField>
            <t:FieldURI FieldURI="item:Body"/>
            <t:CalendarItem><t:Body BodyType="HTML">{body_html}</t:Body></t:CalendarItem>
          </t:SetItemField>
          <t:SetItemField>
            <t:FieldURI FieldURI="calendar:Start"/>
            <t:CalendarItem><t:Start>{start}</t:Start></t:CalendarItem>
          </t:SetItemField>
          <t:SetItemField>
            <t:FieldURI FieldURI="calendar:End"/>
            <t:CalendarItem><t:End>{end}</t:End></t:CalendarItem>
          </t:SetItemField>
          <t:SetItemField>
            <t:FieldURI FieldURI="calendar:Location"/>
            <t:CalendarItem><t:Location>{location}</t:Location></t:CalendarItem>
          </t:SetItemField>
          {ext_updates}"#,
        subject = xml_escape(d.subject),
        body_html = xml_escape(d.body_html),
        start = d.start,
        end = d.end,
        location = xml_escape(d.location),
        ext_updates = ext_set_fields(d),
    );

    let body = format!(
        r#"<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AlwaysOverwrite" SendMeetingInvitationsOrCancellations="SendToNone">
      <m:ItemChanges>
        <t:ItemChange>
          <t:ItemId Id="{id}" ChangeKey="{ck}"/>
          <t:Updates>
            {updates}
          </t:Updates>
        </t:ItemChange>
      </m:ItemChanges>
    </m:UpdateItem>"#,
        id = xml_escape(item_id),
        ck = xml_escape(change_key),
        updates = field_updates,
    );
    soap_envelope(&body)
}

fn ext_set_fields(d: &CreateItemData) -> String {
    let values = [
        ("Nome tecnico:", d.nome_tecnico),
        ("Ragione Sociale:", d.ragione_sociale),
        ("Descrizione intervento", d.descrizione),
        ("Altro", d.altro),
        ("Tipo di tariffa:", d.tipo_tariffa),
        ("Tipo Fatturazione", d.tipo_fatturazione),
        ("Trasferta", d.trasferta),
        ("Durata intervento", d.durata),
    ];
    values
        .iter()
        .map(|(name, val)| {
            format!(
                r#"<t:SetItemField>
            <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="{}" PropertyType="String"/>
            <t:CalendarItem>
              <t:ExtendedProperty>
                <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="{}" PropertyType="String"/>
                <t:Value>{}</t:Value>
              </t:ExtendedProperty>
            </t:CalendarItem>
          </t:SetItemField>"#,
                name,
                name,
                xml_escape(val)
            )
        })
        .collect::<Vec<_>>()
        .join("\n          ")
}

/// DeleteItem — moves item to Deleted Items (soft delete).
pub fn delete_item(item_id: &str, change_key: &str) -> String {
    let body = format!(
        r#"<m:DeleteItem DeleteType="MoveToDeletedItems" SendMeetingCancellations="SendToNone">
      <m:ItemIds>
        <t:ItemId Id="{id}" ChangeKey="{ck}"/>
      </m:ItemIds>
    </m:DeleteItem>"#,
        id = xml_escape(item_id),
        ck = xml_escape(change_key),
    );
    soap_envelope(&body)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn ext_prop_names() -> &'static [(&'static str, &'static str)] {
    EXT_PROPS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_item_is_single_id_batch() {
        let single = get_item("AAA", "CK1");
        let batch = get_items(&[("AAA", "CK1")]);
        assert_eq!(single, batch);
    }

    #[test]
    fn get_items_emits_one_itemid_per_id() {
        let xml = get_items(&[("AAA", "CK1"), ("BBB", "CK2"), ("CCC", "CK3")]);
        assert_eq!(xml.matches("<t:ItemId ").count(), 3);
        assert!(xml.contains(r#"Id="BBB" ChangeKey="CK2""#));
        assert!(xml.contains("<m:GetItem>"));
    }

    #[test]
    fn get_items_escapes_ids() {
        let xml = get_items(&[("a&b", "c<d")]);
        assert!(xml.contains("a&amp;b"));
        assert!(xml.contains("c&lt;d"));
    }

    #[test]
    fn sync_folder_items_without_state_omits_syncstate() {
        let xml = sync_folder_items("u@u.com", None, 512);
        assert!(xml.contains("<m:SyncFolderItems>"));
        assert!(!xml.contains("<m:SyncState>"));
        assert!(xml.contains("<m:MaxChangesReturned>512</m:MaxChangesReturned>"));
        assert!(xml.contains("u@u.com"));
        // metadata + ext props in shape so cache can be primed without GetItem
        assert!(xml.contains(r#"FieldURI="calendar:Start""#));
        assert!(xml.contains(r#"PropertyName="Nome tecnico:""#));
    }

    #[test]
    fn sync_folder_items_with_state_includes_escaped_token() {
        let xml = sync_folder_items("u@u.com", Some("abc<&>123"), 256);
        assert!(xml.contains("<m:SyncState>abc&lt;&amp;&gt;123</m:SyncState>"));
        assert!(xml.contains("<m:MaxChangesReturned>256</m:MaxChangesReturned>"));
    }
}
