const FIXED_SENDER_EMAIL = String(process.env.PEDIDOS_LEY_FIXED_SENDER_EMAIL || 'contacto.gga.sc@gmail.com').trim().toLowerCase();
const APPS_SCRIPT_WEBAPP_URL = String(
  process.env.PEDIDOS_LEY_APPS_SCRIPT_WEBAPP_URL ||
  process.env.PEDIDOS_LEY_MAIL_SERVICE_URL ||
  process.env.PEDIDOS_LEY_EMAIL_SERVICE_URL ||
  ''
).trim();
const APPS_SCRIPT_SECRET = String(
  process.env.PEDIDOS_LEY_APPS_SCRIPT_SECRET ||
  process.env.PEDIDOS_LEY_MAIL_SERVICE_SECRET ||
  process.env.PEDIDOS_LEY_EMAIL_SERVICE_SECRET ||
  ''
).trim();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRecipients(value) {
  return String(value || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(', ');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function toBase64(value) {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return Buffer.from(String(value)).toString('base64');
}

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

async function fetchAppsScriptJson(url, payload) {
  const requestBody = JSON.stringify(payload);
  const signal = AbortSignal.timeout(120_000);
  const firstResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: requestBody,
    redirect: 'manual',
    signal,
  });

  const location = firstResponse.headers.get('location') || '';
  if (firstResponse.status === 302 || firstResponse.status === 303) {
    if (!location) {
      const text = await firstResponse.text();
      throw new Error(`Servicio Apps Script redirigio sin location (${firstResponse.status})` + (text ? ` | respuesta: ${text.slice(0, 300)}` : ''));
    }

    const redirectedResponse = await fetch(location, {
      method: 'GET',
      signal,
    });
    const redirectedText = await redirectedResponse.text();
    let redirectedData = null;
    try {
      redirectedData = safeJsonParse(redirectedText);
    } catch {
      redirectedData = null;
    }

    if (!redirectedResponse.ok) {
      const snippet = redirectedText.trim().slice(0, 300);
      throw new Error((redirectedData?.error || `Servicio Apps Script fallo (${redirectedResponse.status})`) + (snippet ? ` | respuesta: ${snippet}` : ''));
    }

    return { response: redirectedResponse, text: redirectedText, data: redirectedData };
  }

  const text = await firstResponse.text();
  let data = null;
  try {
    data = safeJsonParse(text);
  } catch {
    data = null;
  }

  return { response: firstResponse, text, data };
}

function buildAttachmentPayload(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).map((attachment) => {
    const filename = normalizeText(attachment?.filename || attachment?.name || 'archivo');
    const mimeType = normalizeText(attachment?.mimeType || 'application/octet-stream');
    const content = attachment?.content ?? attachment?.bytes ?? attachment?.buffer ?? '';
    return {
      filename,
      mimeType,
      contentBase64: toBase64(content),
    };
  });
}

function getFixedSenderAccount() {
  return {
    email: FIXED_SENDER_EMAIL,
    name: 'Apps Script',
    picture: '',
    connectedAt: '',
    active: true,
  };
}

export function buildPedidosLeySenderAuthUrl() {
  return '';
}

export async function exchangePedidosLeySenderAuthCode() {
  throw new Error('El envio de pedidos ahora usa Apps Script y no requiere OAuth.');
}

export function selectPedidosLeySenderAccount(email) {
  const normalized = normalizeEmail(email);
  if (normalized && normalized !== FIXED_SENDER_EMAIL) {
    throw new Error(`El remitente esta fijo en ${FIXED_SENDER_EMAIL}`);
  }
  return getPedidosLeySenderStatus();
}

export function getPedidosLeySenderStatus() {
  return {
    ok: true,
    activeEmail: FIXED_SENDER_EMAIL,
    active: getFixedSenderAccount(),
    accounts: [getFixedSenderAccount()],
    service: 'apps-script',
    webappConfigured: Boolean(APPS_SCRIPT_WEBAPP_URL),
  };
}

export async function sendPedidosLeyEmail({
  to = '',
  subject = '',
  textBody = '',
  htmlBody = '',
  attachments = [],
  fromEmail = '',
} = {}) {
  if (!APPS_SCRIPT_WEBAPP_URL) {
    throw new Error('Falta configurar PEDIDOS_LEY_APPS_SCRIPT_WEBAPP_URL');
  }
  if (!APPS_SCRIPT_SECRET) {
    throw new Error('Falta configurar PEDIDOS_LEY_APPS_SCRIPT_SECRET');
  }

  const payload = {
    secret: APPS_SCRIPT_SECRET,
    to: normalizeRecipients(to),
    subject: normalizeText(subject),
    textBody: normalizeText(textBody),
    htmlBody: normalizeText(htmlBody),
    fromEmail: normalizeEmail(fromEmail) || FIXED_SENDER_EMAIL,
    attachments: buildAttachmentPayload(attachments),
  };

  const { response, text, data } = await fetchAppsScriptJson(APPS_SCRIPT_WEBAPP_URL, payload);

  if (!response.ok) {
    const snippet = text.trim().slice(0, 300);
    throw new Error((data?.error || `Servicio Apps Script fallo (${response.status})`) + (snippet ? ` | respuesta: ${snippet}` : ''));
  }

  if (!data || typeof data !== 'object') {
    throw new Error('El servicio Apps Script no devolvio JSON valido');
  }

  if (data.ok === false) {
    const snippet = text.trim().slice(0, 300);
    throw new Error((data.error || 'El servicio Apps Script rechazo el envio') + (snippet ? ` | respuesta: ${snippet}` : ''));
  }

  return {
    ok: true,
    from: data.from || FIXED_SENDER_EMAIL,
    result: data,
  };
}
