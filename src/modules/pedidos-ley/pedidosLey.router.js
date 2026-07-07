import express from 'express';
import {
  fetchPedidosLeySinLiberacion,
  markPedidoLeyEnviado,
  readPedidoLeyAttachment,
  recordPedidoLeySent,
  reconcilePedidoLeyEnviados,
  streamPedidoLeyFile,
  clearPedidosLeyCache,
  getPedidosLeyFilesDir,
} from './services/pedidosLey.js';
import {
  exchangePedidosLeySenderAuthCode,
  getPedidosLeySenderStatus,
  selectPedidosLeySenderAccount,
  sendPedidosLeyEmail,
} from './services/pedidosLeyMail.js';
import { loadAuthenticatedEmployee } from '../home/portalAuth.service.js';

export const pedidosLeyApiRouter = express.Router();

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

pedidosLeyApiRouter.post('/marcar-enviado', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const result = await markPedidoLeyEnviado(req.body || {});
    clearPedidosLeyCache();
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
    clearPedidosLeyCache();
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
    clearPedidosLeyCache();
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
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const payload = req.body || {};
    const selectedFiles = Array.isArray(payload.files) ? payload.files : [];
    const attachments = [];
    for (const file of selectedFiles) {
      const key = String(file?.id || file?.path || file?.relativePath || '').trim();
      if (!key) continue;
      attachments.push(await readPedidoLeyAttachment(key));
    }

    const result = await sendPedidosLeyEmail({
      to: payload.to || '',
      subject: `Pedido ${String(payload.pedido || '').trim()}`,
      textBody: String(payload.textBody || '').trim(),
      htmlBody: String(payload.htmlBody || '').trim(),
      attachments,
      fromEmail: payload.fromEmail || '',
    });

    try {
      recordPedidoLeySent({
        pedido: String(payload.pedido || '').trim(),
        to: String(payload.to || '').trim(),
        fromEmail: String(payload.fromEmail || '').trim(),
        facturadorNombre: String(payload.facturadorNombre || '').trim(),
        subject: `Pedido ${String(payload.pedido || '').trim()}`,
        sentAt: new Date().toISOString(),
      });
    } catch {
      // Bitacora best-effort.
    }

    if (String(payload.pedido || '').trim()) {
      await markPedidoLeyEnviado({ pedido: String(payload.pedido || '').trim(), enviado: true });
      clearPedidosLeyCache();
    }

    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.get('/sender/connect', (req, res) => {
  const next = String(req.query.next || '/pedidos-sin-liberacion').trim();
  const safeNext = next.startsWith('/') ? next : '/pedidos-sin-liberacion';
  res.redirect(`/pedidos-sin-liberacion/sender/connect?next=${encodeURIComponent(safeNext)}`);
});
