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

/// FindItem (CalendarView) — returns IdOnly + all extended props for date range.
pub fn find_items(email: &str, start: &str, end: &str) -> String {
    let body = format!(
        r#"<m:FindItem Traversal="Shallow">
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        {ext}
      </m:ItemShape>
      <m:CalendarView StartDate="{start}" EndDate="{end}"/>
      <m:ParentFolderIds>
        <t:DistinguishedFolderId Id="calendar">
          <t:Mailbox><t:EmailAddress>{email}</t:EmailAddress></t:Mailbox>
        </t:DistinguishedFolderId>
      </m:ParentFolderIds>
    </m:FindItem>"#,
        ext = ext_field_uris(),
        start = start,
        end = end,
        email = xml_escape(email),
    );
    soap_envelope(&body)
}

/// GetItem — AllProperties for a single calendar item.
pub fn get_item(item_id: &str, change_key: &str) -> String {
    let body = format!(
        r#"<m:GetItem>
      <m:ItemShape>
        <t:BaseShape>AllProperties</t:BaseShape>
        {ext}
      </m:ItemShape>
      <m:ItemIds>
        <t:ItemId Id="{id}" ChangeKey="{ck}"/>
      </m:ItemIds>
    </m:GetItem>"#,
        ext = ext_field_uris(),
        id = xml_escape(item_id),
        ck = xml_escape(change_key),
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
