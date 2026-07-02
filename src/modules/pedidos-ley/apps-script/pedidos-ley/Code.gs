const DEFAULT_BACKEND_BASE_URL = 'https://apps.desarrolloeg.com';

function getBackendBaseUrl_() {
  const value = PropertiesService.getScriptProperties().getProperty('PEDIDOS_LEY_BACKEND_BASE_URL') || DEFAULT_BACKEND_BASE_URL;
  return String(value || '').replace(/\/+$/, '');
}

function fetchJson_(path, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = UrlFetchApp.fetch(getBackendBaseUrl_() + path, {
      muteHttpExceptions: true,
      ...options,
    });
    const text = response.getContentText() || '';
    let data = {};
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error('El backend no devolvio JSON valido.');
      }
    }
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      return data;
    }
    const rawSnippet = text.trim() ? text.trim().slice(0, 300) : '';
    const detail = rawSnippet ? ' | respuesta: ' + rawSnippet : '';
    lastError = new Error((data.error || ('Backend fallo (' + response.getResponseCode() + ')')) + detail);
    if (!(response.getResponseCode() === 429 || response.getResponseCode() >= 500) || attempt === 4) {
      break;
    }
    Utilities.sleep(500 * attempt);
  }
  throw lastError || new Error('Backend fallo');
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index.html')
    .setTitle('Pedidos sin liberacion')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getPedidosLeyData(facturadorId) {
  const facturadorValue = String(facturadorId || '').trim();
  const params = [];
  if (facturadorValue) params.push('facturadorId=' + encodeURIComponent(facturadorValue));
  params.push('includeSent=1');
  const query = '?' + params.join('&');
  return fetchJson_('/api/pedidos-ley/sin-liberacion' + query, { method: 'get' });
}

function getBackendConfig() {
  return fetchJson_('/api/pedidos-ley/config', { method: 'get' });
}

function getBackendBaseUrl() {
  return getBackendBaseUrl_();
}

function getMailQuotaInfo() {
  const remaining = Number(MailApp.getRemainingDailyQuota());
  return {
    ok: true,
    remaining: Number.isFinite(remaining) ? remaining : null,
    exhausted: Number.isFinite(remaining) ? remaining <= 0 : null,
  };
}

function getPedidosLeySentIndex(daysBack) {
  const lookback = Math.max(1, Number(daysBack || 30));
  const query = 'in:sent subject:"Pedido " newer_than:' + lookback + 'd';
  const threads = GmailApp.search(query, 0, 200);
  const index = {};

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(message) {
      const subject = String(message.getSubject() || '').trim();
      const match = subject.match(/\bPedido\s+(\d+)\b/i);
      if (!match) return;
      const pedido = String(match[1] || '').trim();
      if (!pedido) return;
      index[pedido] = {
        pedido: pedido,
        sentAt: message.getDate().toISOString(),
        to: normalizeRecipients_(message.getTo()),
        subject: subject,
      };
    });
  });

  return { ok: true, index: index };
}

function reconcilePedidosLeyEnviados() {
  const sentIndexResponse = getPedidosLeySentIndex(120);
  return fetchJson_('/api/pedidos-ley/reconciliar-enviados', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      sentEntries: sentIndexResponse && sentIndexResponse.index ? Object.values(sentIndexResponse.index) : [],
    }),
  });
}

function normalizeFacturadorNombre_(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const candidate = value.nombre || value.name || value.label || '';
    return String(candidate || '').trim();
  }
  return '';
}

function normalizeScalarText_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    return normalizeFacturadorNombre_(value) || String(value.value || value.text || '').trim();
  }
  return String(value).trim();
}

function normalizeRecipients_(value) {
  return String(value || '')
    .split(',')
    .map(function(part) {
      return String(part || '').trim();
    })
    .filter(Boolean)
    .join(', ');
}

function sendPedidoLeyEmail(payload) {
  const pedido = normalizeScalarText_((payload && payload.pedido) || '');
  const rowId = normalizeScalarText_((payload && payload.rowId) || '');
  const to = normalizeRecipients_((payload && payload.to) || '');
  const selectedFiles = Array.isArray(payload && payload.files) ? payload.files : [];
  const facturadorNombre = normalizeFacturadorNombre_(
    (payload && payload.facturadorNombre) ||
    (payload && payload.facturador && payload.facturador.nombre) ||
    (payload && payload.facturador)
  );

  if (!pedido) throw new Error('pedido requerido');
  if (!to) throw new Error('correo destino requerido');
  if (!selectedFiles.length) throw new Error('selecciona al menos un archivo');

  const attachments = selectedFiles.map(function(file) {
    const url = String(file && file.downloadUrl || '').trim();
    if (!url) throw new Error('archivo sin URL');
    const absoluteUrl = url.indexOf('http') === 0 ? url : getBackendBaseUrl_() + url;
    const response = UrlFetchApp.fetch(absoluteUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error('No se pudo descargar: ' + (file.name || absoluteUrl));
    }
    return response.getBlob().setName(file.name || 'archivo');
  });

  const subject = 'Pedido ' + pedido;
  const bodyLines = [
    'Se adjunta informacion para el pedido ' + pedido + '.',
    facturadorNombre ? 'Facturador: ' + facturadorNombre : '',
    '',
    'Archivos adjuntos:',
  ].concat(selectedFiles.map(function(file) {
    return '- ' + (file.name || '');
  }));

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: bodyLines.join('\n'),
    htmlBody: '<p>Se adjunta informacion para el pedido <strong>' + escapeHtml_(pedido) + '</strong>.</p>'
      + (facturadorNombre ? '<p><strong>Facturador:</strong> ' + escapeHtml_(facturadorNombre) + '</p>' : '')
      + '<p><strong>Archivos adjuntos:</strong></p><ul>'
      + selectedFiles.map(function(file) {
        return '<li>' + escapeHtml_(file.name || '') + '</li>';
      }).join('')
      + '</ul>',
    attachments: attachments,
  });

  let logError = '';
  try {
    fetchJson_('/api/pedidos-ley/log-enviado', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        pedido: pedido,
        rowId: rowId,
        to: to,
        facturadorNombre: facturadorNombre,
        sentAt: new Date().toISOString(),
        subject: subject,
      }),
    });
  } catch (error) {
    logError = error && error.message ? error.message : 'No se pudo guardar la bitacora';
  }

  let marked = false;
  let markError = '';
  try {
    fetchJson_('/api/pedidos-ley/marcar-enviado', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        pedido: pedido,
        rowId: rowId,
        enviado: true,
      }),
    });
    marked = true;
  } catch (error) {
    markError = error && error.message ? error.message : 'No se pudo marcar en AppSheet';
  }

  return { ok: true, marked: marked, logError: logError, markError: markError };
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
