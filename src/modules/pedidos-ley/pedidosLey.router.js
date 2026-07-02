import express from 'express';
import {
  fetchPedidosLeySinLiberacion,
  markPedidoLeyEnviado,
  recordPedidoLeySent,
  reconcilePedidoLeyEnviados,
  streamPedidoLeyFile,
  clearPedidosLeyCache,
  getPedidosLeyFilesDir,
} from './services/pedidosLey.js';

export const pedidosLeyApiRouter = express.Router();

pedidosLeyApiRouter.get('/config', (_req, res) => {
  res.json({
    ok: true,
    table: 'PEDIDOS_LEY',
    view: 'SIN LIBERACION',
    filesDir: getPedidosLeyFilesDir(),
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
    const result = await markPedidoLeyEnviado(req.body || {});
    clearPedidosLeyCache();
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.post('/log-enviado', (req, res) => {
  try {
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
    const sentEntries = Array.isArray(_req.body?.sentEntries) ? _req.body.sentEntries : [];
    const result = await reconcilePedidoLeyEnviados(sentEntries);
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ ok: false, error: message });
  }
});

pedidosLeyApiRouter.get('/files', (req, res) => {
  try {
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
