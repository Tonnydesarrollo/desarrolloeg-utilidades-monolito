import express from 'express';
import {
  debugPedidoLey,
  fetchPedidoLeyFiles,
  fetchPedidosLeyAdminDashboardData,
  fetchPedidosLeySinLiberacion,
  markPedidoLeyEnviado,
  readPedidoLeyAttachment,
  recordPedidoLeySent,
  reconcilePedidoLeyEnviados,
  streamPedidoLeyFile,
  getPedidosLeyFilesDir,
} from './services/pedidosLey.js';
import {
  getPedidosLeySenderStatus,
  selectPedidosLeySenderAccount,
  sendPedidosLeyEmail,
} from './services/pedidosLeyMail.js';
import { loadAuthenticatedEmployee } from '../home/portalAuth.service.js';

export const pedidosLeyApiRouter = express.Router();
const pedidosLeySendInFlight = new Set();

async function requireAdmin(req, res) {
  const user = await loadAuthenticatedEmployee(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'No autenticado' });
    return null;
  }
  if (String(user.role || '').trim() !== 'admin') {
    res.status(403).json({ ok: false, error: 'Solo admins' });
    return null;
  }
  return user;
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      output[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker);
  await Promise.all(workers);
  return output;
}

pedidosLeyApiRouter.get('/config', (_req, res) => {
  res.json({
    ok: true,
    table: 'PEDIDOS_LEY',
    view: 'SIN LIBERACION',
    filesDir: getPedidosLeyFilesDir(),
    defaultRecipients: ['SGIIREGION1@casaley.com.mx'],
  });
});

pedidosLeyApiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    table: 'PEDIDOS_LEY',
    view: 'SIN LIBERACION',
    status: 'ready',
  });
});

pedidosLeyApiRouter.get('/sin-liberacion', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const facturadorId = String(req.query.facturadorId || req.query.facturador || req.query['facturador.nombre'] || req.query.facturadorNombre || '');
    const includeSent = String(req.query.includeSent || '') === '1';
    const forceRefresh = String(req.query.refresh || '') === '1';
    const data = await fetchPedidosLeySinLiberacion({ facturadorId, includeSent, forceRefresh });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.get('/debug', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const pedido = String(req.query.pedido || '').trim();
    const forceRefresh = String(req.query.refresh || '') === '1';
    const data = await debugPedidoLey({ pedido, forceRefresh });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.get('/admin-dashboard', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const data = await fetchPedidosLeyAdminDashboardData({
      year: req.query.year,
      facturadorId: String(req.query.facturadorId || '').trim(),
      forceRefresh: String(req.query.refresh || '') === '1',
      thresholds: {
        estatalMin: req.query.estatalMin,
        municipalMin: req.query.municipalMin,
      },
    });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.get('/pedido/:pedido/files', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const pedido = String(req.params.pedido || '').trim();
    const forceRefresh = String(req.query.refresh || '') === '1';
    const data = await fetchPedidoLeyFiles({ pedido, forceRefresh });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.post('/marcar-enviado', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const result = await markPedidoLeyEnviado(req.body || {});
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.post('/toggle-enviado', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const result = await markPedidoLeyEnviado(req.body || {});
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.post('/log-enviado', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const result = recordPedidoLeySent(req.body || {});
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.post('/reconciliar-enviados', async (_req, res) => {
  try {
    const user = await requireAdmin(_req, res);
    if (!user) return;
    const sentEntries = Array.isArray(_req.body?.sentEntries) ? _req.body.sentEntries : [];
    const result = await reconcilePedidoLeyEnviados(sentEntries);
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.get('/files', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const relativePath = String(req.query.path || '');
    if (!relativePath) {
      return res.status(400).json({ ok: false, error: 'path requerido' });
    }
    return streamPedidoLeyFile(res, relativePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    return res.status(404).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.get('/sender/status', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    res.json(getPedidosLeySenderStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.post('/sender/select', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const result = selectPedidosLeySenderAccount(req.body?.email || '');
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(400).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.post('/send', async (req, res) => {
  let sendKey = '';
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const payload = req.body || {};
    sendKey = String(payload.pedido || '').trim();
    if (!sendKey) return res.status(400).json({ ok: false, error: 'Falta el numero de pedido' });
    if (pedidosLeySendInFlight.has(sendKey)) {
      return res.status(409).json({ ok: false, error: `El pedido ${sendKey} ya se esta enviando` });
    }
    pedidosLeySendInFlight.add(sendKey);
    const selectedFiles = Array.isArray(payload.files) ? payload.files : [];
    const available = await fetchPedidoLeyFiles({ pedido: sendKey, forceRefresh: false });
    const availableFiles = Array.isArray(available.matchedFiles) ? available.matchedFiles : [];
    const fileKey = (file) => String(file?.id || file?.path || file?.relativePath || '').trim();
    const allowedKeys = new Set(availableFiles.map(fileKey).filter(Boolean));
    const validatedFiles = selectedFiles.filter((file) => allowedKeys.has(fileKey(file)));
    if (!validatedFiles.length) {
      return res.status(400).json({ ok: false, error: 'Selecciona al menos un archivo disponible para este pedido' });
    }
    if (validatedFiles.length !== selectedFiles.length) {
      return res.status(409).json({ ok: false, error: 'La lista de archivos cambio. Vuelve a abrir los archivos y confirma la seleccion' });
    }
    console.info('[pedidos-ley] iniciando envio', {
      pedido: sendKey,
      archivos: validatedFiles.length,
    });
    const attachments = (await mapWithConcurrency(validatedFiles, 3, async (file) => {
      const key = String(file?.id || file?.path || file?.relativePath || '').trim();
      if (!key) return null;
      return readPedidoLeyAttachment(key);
    })).filter(Boolean);
    console.info('[pedidos-ley] adjuntos preparados', {
      pedido: String(payload.pedido || '').trim(),
      archivos: attachments.length,
      bytes: attachments.reduce((total, attachment) => total + Number(attachment?.content?.length || 0), 0),
    });

    const result = await sendPedidosLeyEmail({
      to: payload.to || '',
      subject: `Pedido ${String(payload.pedido || '').trim()} listo para entrega`,
      textBody: String(payload.textBody || '').trim() || [
        `Hola, buen dia.`,
        ``,
        `Le informamos que el trabajo correspondiente al pedido ${String(payload.pedido || '').trim()} ya esta listo.`,
        `Adjuntamos el documento final para su revision.`,
        ``,
        `Quedamos atentos.`,
      ].join('\n'),
      htmlBody: String(payload.htmlBody || '').trim() || [
        `<p>Hola, buen dia.</p>`,
        `<p>Le informamos que el trabajo correspondiente al pedido <strong>${String(payload.pedido || '').trim()}</strong> ya esta listo.</p>`,
        `<p>Adjuntamos el documento final para su revision.</p>`,
        `<p>Quedamos atentos.</p>`,
      ].join(''),
      attachments,
      fromEmail: payload.fromEmail || '',
    });
    console.info('[pedidos-ley] correo confirmado por Apps Script', {
      pedido: String(payload.pedido || '').trim(),
      archivos: attachments.length,
    });

    try {
      recordPedidoLeySent({
        pedido: String(payload.pedido || '').trim(),
        to: String(payload.to || '').trim(),
        fromEmail: String(payload.fromEmail || '').trim(),
        facturadorNombre: String(payload.facturadorNombre || '').trim(),
        subject: `Pedido ${String(payload.pedido || '').trim()} listo para entrega`,
        sentAt: new Date().toISOString(),
      });
    } catch {
      // Bitacora best-effort.
    }

    let syncWarning = '';
    if (String(payload.pedido || '').trim()) {
      try {
        await markPedidoLeyEnviado({ pedido: String(payload.pedido || '').trim(), enviado: true });
      } catch (error) {
        syncWarning = error instanceof Error ? error.message : 'No se pudo sincronizar el estado con AppSheet';
        console.warn('[pedidos-ley] El correo se envio, pero la sincronizacion remota quedo pendiente:', syncWarning);
      }
    }

    res.json({ ok: true, result, syncWarning });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error('[pedidos-ley] fallo al enviar pedido', {
      pedido: String(req.body?.pedido || '').trim(),
      archivos: Array.isArray(req.body?.files) ? req.body.files.length : 0,
      error: message,
    });
    res.status(500).json({ ok: false, error: message });
  } finally {
    if (sendKey) pedidosLeySendInFlight.delete(sendKey);
  }
});

pedidosLeyApiRouter.get('/sender/connect', (req, res) => {
  const next = String(req.query.next || '/pedidos-sin-liberacion').trim();
  const safeNext = next.startsWith('/') ? next : '/pedidos-sin-liberacion';
  res.redirect(`/pedidos-sin-liberacion/sender/connect?next=${encodeURIComponent(safeNext)}`);
});
