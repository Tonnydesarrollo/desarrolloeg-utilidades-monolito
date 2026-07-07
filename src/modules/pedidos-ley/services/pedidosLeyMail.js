import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moduleRoot = path.resolve(__dirname, '..');

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
];

const DEFAULT_CONFIG = {
  credentialsPath: path.join(moduleRoot, 'services', 'credentials.json'),
  tokenPath: path.join(moduleRoot, 'services', 'token.json'),
  senderStorePath: path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'senders.json'),
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function getConfig() {
  return {
    credentialsPath: String(process.env.PEDIDOS_GOOGLE_CLIENT_CREDENTIALS || process.env.FACTURACION_GOOGLE_CREDENTIALS_PATH || DEFAULT_CONFIG.credentialsPath).trim(),
    tokenPath: String(process.env.PEDIDOS_GOOGLE_TOKEN_PATH || process.env.FACTURACION_GOOGLE_TOKEN_PATH || DEFAULT_CONFIG.tokenPath).trim(),
    senderStorePath: String(process.env.PEDIDOS_LEY_SENDER_STORE_PATH || DEFAULT_CONFIG.senderStorePath).trim(),
    authCallbackPath: String(process.env.PEDIDOS_GOOGLE_REDIRECT_URI || process.env.PORTAL_GOOGLE_REDIRECT_URI || 'https://apps.desarrolloeg.com/auth/google/callback').trim(),
    clientId: String(process.env.PORTAL_GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.PORTAL_GOOGLE_CLIENT_SECRET || '').trim(),
  };
}

function readCredentials() {
  const config = getConfig();
  const filePath = config.credentialsPath;
  if (!fs.existsSync(filePath)) {
    throw new Error(`No se encontro credentials.json para pedidos en ${filePath}`);
  }

  const parsed = readJson(filePath, {});
  const oauthConfig = parsed.installed || parsed.web || parsed;
  const clientId = oauthConfig.client_id || config.clientId;
  const clientSecret = oauthConfig.client_secret || config.clientSecret;
  const redirectUri = (oauthConfig.redirect_uris && oauthConfig.redirect_uris[0]) || config.authCallbackPath;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Falta configurar el cliente OAuth de Google para pedidos');
  }

  return { clientId, clientSecret, redirectUri };
}

function createOauthClient(scopes = GOOGLE_SCOPES) {
  const credentials = readCredentials();
  const oauthClient = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, credentials.redirectUri);
  oauthClient.scopes = scopes;
  return oauthClient;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getSenderStore() {
  const config = getConfig();
  ensureDir(path.dirname(config.senderStorePath));
  if (!fs.existsSync(config.senderStorePath)) {
    return { activeEmail: '', accounts: {} };
  }

  const parsed = readJson(config.senderStorePath, {});
  return {
    activeEmail: normalizeEmail(parsed.activeEmail || ''),
    accounts: parsed.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {},
  };
}

function setSenderStore(store) {
  const config = getConfig();
  writeJson(config.senderStorePath, {
    activeEmail: normalizeEmail(store.activeEmail || ''),
    accounts: store.accounts && typeof store.accounts === 'object' ? store.accounts : {},
  });
}

function safeAccountPublicData(account) {
  if (!account) return null;
  return {
    email: normalizeEmail(account.email || ''),
    name: String(account.name || '').trim(),
    picture: String(account.picture || '').trim(),
    connectedAt: String(account.connectedAt || '').trim(),
    active: Boolean(account.active),
  };
}

export function buildPedidosLeySenderAuthUrl(state) {
  const oauthClient = createOauthClient(GOOGLE_SCOPES);
  return oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state: String(state || '').trim(),
  });
}

async function fetchUserInfo(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`No se pudo leer el perfil de Google (${response.status})`);
  }

  return response.json();
}

export async function exchangePedidosLeySenderAuthCode(code) {
  const oauthClient = createOauthClient(GOOGLE_SCOPES);
  const { tokens } = await oauthClient.getToken(String(code || '').trim());
  oauthClient.setCredentials(tokens);

  const accessToken = tokens.access_token;
  if (!accessToken) {
    throw new Error('Google no devolvio access_token para pedidos');
  }

  const profile = await fetchUserInfo(accessToken);
  const email = normalizeEmail(profile.email);
  if (!email) {
    throw new Error('Google no entrego un correo valido para pedidos');
  }

  const store = getSenderStore();
  store.accounts[email] = {
    email,
    name: String(profile.name || '').trim(),
    picture: String(profile.picture || '').trim(),
    tokens,
    connectedAt: new Date().toISOString(),
    active: true,
  };
  for (const key of Object.keys(store.accounts)) {
    store.accounts[key].active = key === email;
  }
  store.activeEmail = email;
  setSenderStore(store);

  return safeAccountPublicData(store.accounts[email]);
}

export function listPedidosLeySenderAccounts() {
  const store = getSenderStore();
  return {
    activeEmail: store.activeEmail,
    accounts: Object.values(store.accounts).map((account) => safeAccountPublicData(account)).filter(Boolean),
  };
}

export function selectPedidosLeySenderAccount(email) {
  const store = getSenderStore();
  const normalized = normalizeEmail(email);
  if (!normalized) {
    store.activeEmail = '';
  } else if (store.accounts[normalized]) {
    store.activeEmail = normalized;
  } else {
    throw new Error('No existe esa cuenta de remitente');
  }

  for (const key of Object.keys(store.accounts)) {
    store.accounts[key].active = key === store.activeEmail;
  }
  setSenderStore(store);
  return listPedidosLeySenderAccounts();
}

function getActiveSenderAccount() {
  const store = getSenderStore();
  const activeEmail = normalizeEmail(store.activeEmail || '');
  const account = activeEmail ? store.accounts[activeEmail] : null;
  if (!account) {
    return null;
  }
  return account;
}

function buildGmailClientFromAccount(account) {
  const credentials = readCredentials();
  const oauthClient = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, credentials.redirectUri);
  oauthClient.setCredentials(account.tokens || {});
  return google.gmail({ version: 'v1', auth: oauthClient });
}

function normalizeRecipients(value) {
  return String(value || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(', ');
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildMimeMessage({ from, to, subject, textBody, htmlBody, attachments = [] }) {
  const boundary = `boundary_${crypto.randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];

  if (attachments.length) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = [];
    const bodyBoundary = `body_${crypto.randomBytes(10).toString('hex')}`;
    parts.push(`--${boundary}`);
    if (htmlBody) {
      parts.push(`Content-Type: multipart/alternative; boundary="${bodyBoundary}"`);
      parts.push('');
      parts.push(`--${bodyBoundary}`);
      parts.push('Content-Type: text/plain; charset="UTF-8"');
      parts.push('Content-Transfer-Encoding: 7bit');
      parts.push('');
      parts.push(textBody || '');
      parts.push(`--${bodyBoundary}`);
      parts.push('Content-Type: text/html; charset="UTF-8"');
      parts.push('Content-Transfer-Encoding: 7bit');
      parts.push('');
      parts.push(htmlBody);
      parts.push(`--${bodyBoundary}--`);
    } else {
      parts.push('Content-Type: text/plain; charset="UTF-8"');
      parts.push('Content-Transfer-Encoding: 7bit');
      parts.push('');
      parts.push(textBody || '');
    }

    for (const attachment of attachments) {
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${attachment.mimeType || 'application/octet-stream'}; name="${attachment.filename}"`);
      parts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      parts.push('Content-Transfer-Encoding: base64');
      parts.push('');
      parts.push(Buffer.from(attachment.content).toString('base64'));
    }

    parts.push(`--${boundary}--`);
    return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
  }

  headers.push('Content-Type: multipart/alternative; boundary="alt"');
  return `${headers.join('\r\n')}\r\n\r\n--alt\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${textBody || ''}\r\n--alt\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${htmlBody || ''}\r\n--alt--`;
}

export async function sendPedidosLeyEmail({
  to = '',
  subject = '',
  textBody = '',
  htmlBody = '',
  attachments = [],
  fromEmail = '',
} = {}) {
  const account = fromEmail ? getSenderAccountByEmail(fromEmail) : getActiveSenderAccount();
  if (!account) {
    throw new Error('No hay una sesion de remitente configurada');
  }

  const gmail = buildGmailClientFromAccount(account);
  const rawMime = buildMimeMessage({
    from: account.email,
    to: normalizeRecipients(to),
    subject: String(subject || '').trim(),
    textBody: String(textBody || ''),
    htmlBody: String(htmlBody || ''),
    attachments: Array.isArray(attachments) ? attachments : [],
  });

  const raw = encodeBase64Url(rawMime);
  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return {
    ok: true,
    from: account.email,
    id: response?.data?.id || '',
    labelIds: response?.data?.labelIds || [],
  };
}

function getSenderAccountByEmail(email) {
  const store = getSenderStore();
  const normalized = normalizeEmail(email);
  return normalized ? store.accounts[normalized] || null : null;
}

export function getPedidosLeySenderStatus() {
  const store = getSenderStore();
  const active = store.activeEmail ? safeAccountPublicData(store.accounts[store.activeEmail]) : null;
  return {
    ok: true,
    activeEmail: store.activeEmail,
    active,
    accounts: Object.values(store.accounts).map((account) => safeAccountPublicData(account)).filter(Boolean),
  };
}

