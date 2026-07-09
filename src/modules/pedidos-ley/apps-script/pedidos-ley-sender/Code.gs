const DEFAULT_SENDER_EMAIL = 'contacto.gga.sc@gmail.com';
const DEFAULT_SECRET_PROPERTY = 'PEDIDOS_LEY_WEBAPP_SECRET';
const DEFAULT_FROM_EMAIL_PROPERTY = 'PEDIDOS_LEY_FROM_EMAIL';
const DEFAULT_SECRET_FALLBACK = 'IwbYfual2W/wV6Wu3gu8DRomym4N3BtwIOLsY9W13/A=';

function getScriptSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty(DEFAULT_SECRET_PROPERTY) || DEFAULT_SECRET_FALLBACK || '').trim();
}

function getFromEmail_() {
  return String(PropertiesService.getScriptProperties().getProperty(DEFAULT_FROM_EMAIL_PROPERTY) || DEFAULT_SENDER_EMAIL).trim().toLowerCase();
}

function getEffectiveUserEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (error) {
    return '';
  }
}

function json_ (payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeRecipients_(value) {
  return String(value || '')
    .split(',')
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

function decodeAttachment_(attachment) {
  const filename = String(attachment?.filename || 'archivo').trim();
  const mimeType = String(attachment?.mimeType || 'application/octet-stream').trim();
  const contentBase64 = String(attachment?.contentBase64 || '').trim();
  if (!contentBase64) {
    throw new Error(`El archivo ${filename} no incluye contenido`);
  }
  const bytes = Utilities.base64Decode(contentBase64);
  return Utilities.newBlob(bytes, mimeType, filename);
}

function sendMail_(payload) {
  const to = normalizeRecipients_(payload.to);
  const subject = String(payload.subject || '').trim();
  const textBody = String(payload.textBody || '').trim();
  const htmlBody = String(payload.htmlBody || '').trim();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments.map(decodeAttachment_) : [];

  if (!to) throw new Error('Correo destino requerido');
  if (!subject) throw new Error('Asunto requerido');
  if (!attachments.length) throw new Error('No hay adjuntos para enviar');

  GmailApp.sendEmail(to, subject, textBody || 'Se adjunta informacion.', {
    htmlBody: htmlBody || undefined,
    attachments,
    name: 'Pedidos Ley',
    replyTo: getFromEmail_(),
  });

  return {
    ok: true,
    from: getFromEmail_(),
    sentBy: getEffectiveUserEmail_(),
    to,
    subject,
    attachments: attachments.length,
    sentAt: new Date().toISOString(),
  };
}

function authorizePedidosLeySender() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['https://mail.google.com/']);
  return json_({
    ok: true,
    status: 'authorized',
    sender: getFromEmail_(),
  });
}

function doGet() {
  return json_({
    ok: true,
    service: 'pedidos-ley-sender',
    sender: getFromEmail_(),
    effectiveUser: getEffectiveUserEmail_(),
    secretConfigured: Boolean(getScriptSecret_()),
    status: 'ready',
  });
}

function doPost(e) {
  try {
    const raw = String(e?.postData?.contents || '').trim();
    const payload = raw ? JSON.parse(raw) : {};
    const secret = String(payload.secret || '').trim();
    if (!secret || secret !== getScriptSecret_()) {
      throw new Error('Acceso no autorizado');
    }

    const result = sendMail_(payload);
    return json_(result);
  } catch (error) {
    return json_({
      ok: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
}
