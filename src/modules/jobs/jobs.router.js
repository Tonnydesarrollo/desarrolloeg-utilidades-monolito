import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import crypto from 'crypto';
import { listJobs, runJob } from './services/jobRunner.js';
import { getJobSchedulerStatus } from './services/jobScheduler.js';
import { canRunSingletonServices, getClusterCoordinatorStatus } from '../../services/clusterCoordinator.js';
import { enviarPedidosManual, normalizePedidoRow } from './native/pedidos/manualAppsheet.service.js';

export const jobsRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const manualPedidoJobs = new Map();

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseRowsFromWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map((row) => {
    const mapped = {};
    for (const [key, value] of Object.entries(row || {})) {
      const normalized = normalizeHeader(key);
      if (normalized === "ESTABLECIMIENTO" || normalized === "NO_TIENDA" || normalized === "TIENDA") mapped.ESTABLECIMIENTO = value;
      else if (normalized === "IMPORTE" || normalized === "IMPORTE_MXN" || normalized === "MONTO" || normalized === "TOTAL") mapped.IMPORTE = value;
      else if (normalized === "PEDIDO" || normalized === "NO_PEDIDO") mapped.PEDIDO = value;
      else if (normalized === "DESCRIPCION" || normalized === "CONCEPTO") mapped.DESCRIPCION = value;
      else if (normalized === "PROVEEDOR") mapped.PROVEEDOR = value;
    }
    return normalizePedidoRow(mapped);
  });
}

function parseRowsFromCsvText(csvText) {
  const workbook = XLSX.read(csvText, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map((row) => {
    const mapped = {};
    for (const [key, value] of Object.entries(row || {})) {
      const normalized = normalizeHeader(key);
      if (normalized === "ESTABLECIMIENTO" || normalized === "NO_TIENDA" || normalized === "TIENDA") mapped.ESTABLECIMIENTO = value;
      else if (normalized === "IMPORTE" || normalized === "IMPORTE_MXN" || normalized === "MONTO" || normalized === "TOTAL") mapped.IMPORTE = value;
      else if (normalized === "PEDIDO" || normalized === "NO_PEDIDO") mapped.PEDIDO = value;
      else if (normalized === "DESCRIPCION" || normalized === "CONCEPTO") mapped.DESCRIPCION = value;
      else if (normalized === "PROVEEDOR") mapped.PROVEEDOR = value;
    }
    return normalizePedidoRow(mapped);
  });
}

function createManualPedidoJob() {
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    total: 0,
    result: null,
    error: null,
  };
  manualPedidoJobs.set(jobId, job);
  return job;
}

function updateManualPedidoJob(jobId, patch) {
  const current = manualPedidoJobs.get(jobId);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  manualPedidoJobs.set(jobId, next);
  return next;
}

jobsRouter.get('/', (_req, res) => {
  res.json({
    jobs: listJobs(),
    scheduler: getJobSchedulerStatus(),
  });
});

jobsRouter.get('/pedidos/manual', (_req, res) => {
  res.render('pedidos_manual');
});

jobsRouter.get('/pedidos/manual/status/:jobId', (req, res) => {
  const job = manualPedidoJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'Job no encontrado.' });
  }
  return res.json({ ok: true, ...job });
});

jobsRouter.post('/pedidos/manual/import', upload.single('file'), async (req, res) => {
  try {
    let rows = [];

    if (req.file?.buffer?.length) {
      const filename = String(req.file.originalname || '').toLowerCase();
      if (filename.endsWith('.csv')) {
        rows = parseRowsFromCsvText(req.file.buffer.toString('utf8'));
      } else {
        rows = parseRowsFromWorkbookBuffer(req.file.buffer);
      }
    } else if (Array.isArray(req.body?.rows)) {
      rows = req.body.rows;
    } else if (typeof req.body?.rows === 'string' && req.body.rows.trim()) {
      rows = JSON.parse(req.body.rows);
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se recibieron filas válidas.' });
    }

    const job = createManualPedidoJob();
    res.status(202).json({
      ok: true,
      queued: true,
      jobId: job.jobId,
      total: rows.length,
      message: 'La importación quedó en proceso.',
    });

    setImmediate(async () => {
      updateManualPedidoJob(job.jobId, { status: 'running', total: rows.length });
      try {
        const result = await enviarPedidosManual(rows);
        updateManualPedidoJob(job.jobId, {
          status: result.ok ? 'done' : 'done_with_errors',
          result,
          error: null,
          total: result.total ?? rows.length,
        });
      } catch (error) {
        updateManualPedidoJob(job.jobId, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
});

jobsRouter.post('/:jobId/run', async (req, res) => {
  if (!canRunSingletonServices()) {
    return res.status(409).json({
      ok: false,
      error: 'Este nodo esta en standby. Ejecuta el job en el nodo lider.',
      cluster: getClusterCoordinatorStatus(),
    });
  }

  try {
    const result = await runJob(req.params.jobId);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
});
