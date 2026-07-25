import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import crypto from 'crypto';
import { listJobs, runJob } from './services/jobRunner.js';
import { getJobSchedulerStatus } from './services/jobScheduler.js';
import { classifyJobFailure, executeTrackedJob, getJobExecutionHistory, getLatestJobExecution } from './services/jobExecutionTracker.js';
import { getJobConfigurationState } from './services/jobRegistry.js';
import { canRunSingletonServices, getClusterCoordinatorStatus } from '../../services/clusterCoordinator.js';
import { enviarPedidosManual, normalizePedidoRow } from './native/pedidos/manualAppsheet.service.js';

export const jobsRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const manualPedidoJobs = new Map();

function buildJobsView() {
  const jobs = listJobs();
  const scheduler = getJobSchedulerStatus();
  const schedulerById = new Map(scheduler.map((entry) => [entry.jobId, entry]));

  const enrichedJobs = jobs.map((job) => {
    const currentScheduler = schedulerById.get(job.id) || null;
    const configuration = getJobConfigurationState(job.id);
    return {
      ...job,
      ...configuration,
      scheduler: currentScheduler,
      lastExecution: getLatestJobExecution(job.id),
    };
  });

  const failingJobs = enrichedJobs.filter((job) => {
    const schedulerError = Boolean(job.scheduler?.lastError);
    const executionError = Boolean(job.lastExecution?.error) && job.lastExecution?.status === "failed";
    const configurationError = !job.configured;
    return schedulerError || executionError || configurationError;
  });

  const blockedJobs = failingJobs.filter((job) => {
    const failureKind = job.scheduler?.lastErrorKind || job.lastExecution?.failureKind || null;
    return failureKind === "auth_required";
  });

  const activeFailingJobs = failingJobs.filter((job) => {
    const failureKind = job.scheduler?.lastErrorKind || job.lastExecution?.failureKind || null;
    return failureKind !== "auth_required";
  });

  const runningJobs = enrichedJobs.filter((job) => job.scheduler?.running || job.lastExecution?.status === "running");
  const timeoutJobs = enrichedJobs.filter((job) => job.scheduler?.lastErrorKind === "timeout");
  const transientJobs = enrichedJobs.filter((job) => job.scheduler?.lastErrorKind === "transient");

  return {
    ok: true,
    jobs: enrichedJobs,
    scheduler,
    summary: {
      totalJobs: enrichedJobs.length,
      configuredJobs: enrichedJobs.filter((job) => job.configured).length,
      enabledJobs: scheduler.filter((entry) => entry.enabled).length,
      runningJobs: runningJobs.length,
      failingJobs: activeFailingJobs.length,
      blockedJobs: blockedJobs.length,
      timeoutJobs: timeoutJobs.length,
      transientJobs: transientJobs.length,
      failingJobIds: activeFailingJobs.map((job) => job.id),
    },
  };
}

function summarizeFailure(job) {
  if (!job.configured) {
    const missing = Array.isArray(job.missingEnv) && job.missingEnv.length > 0 ? job.missingEnv.join(", ") : "variables requeridas";
    return {
      id: job.id,
      description: job.description,
      configured: job.configured,
      lastError: `Faltan credenciales: ${missing}`,
      kind: "auth_required",
      retryable: false,
      recommendation: "Configurar las variables de entorno requeridas antes de volver a programar el job.",
      lastExecution: job.lastExecution,
      scheduler: job.scheduler,
    };
  }

  const schedulerFailure = job.scheduler?.lastError ? classifyJobFailure(job.scheduler.lastError) : null;
  const executionFailure = job.lastExecution?.error ? classifyJobFailure(job.lastExecution.error) : null;
  const failure = schedulerFailure || executionFailure;

  if (!failure) return null;

  return {
    id: job.id,
    description: job.description,
    configured: job.configured,
    lastError: job.scheduler?.lastError || job.lastExecution?.error || failure.message,
    kind: failure.kind,
    retryable: failure.retryable,
    recommendation: job.scheduler?.lastErrorRecommendation || failure.recommendation,
    lastExecution: job.lastExecution,
    scheduler: job.scheduler,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) return "Sin dato";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: process.env.DASHBOARD_TIMEZONE || "America/Chihuahua",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function buildJobsLandingHtml(view) {
  const summary = view?.summary || {};
  const jobs = Array.isArray(view?.jobs) ? view.jobs : [];
  const failingJobs = jobs.filter((job) => Boolean(job.scheduler?.lastError) || Boolean(job.lastExecution?.error));
  const runningJobs = jobs.filter((job) => job.scheduler?.running || job.lastExecution?.status === "running");

  const getJobPriority = (job) => {
    const scheduler = job.scheduler || null;
    const latest = job.lastExecution || null;
    const failureKind = !job.configured ? "auth_required" : (scheduler?.lastErrorKind || latest?.failureKind || null);
    const hasError = !job.configured || Boolean(scheduler?.lastError) || Boolean(latest?.error);
    if (hasError && failureKind !== "auth_required") return 0;
    if (scheduler?.running || latest?.status === "running") return 1;
    if (failureKind === "auth_required") return 2;
    if (latest?.status === "failed" || scheduler?.lastResult?.ok === false) return 3;
    if (scheduler?.enabled) return 4;
    return 5;
  };

  const sortedJobs = [...jobs].sort((a, b) => {
    const priorityDiff = getJobPriority(a) - getJobPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return String(a.description || a.id).localeCompare(String(b.description || b.id), "es");
  });

  const cards = sortedJobs.map((job) => {
    const scheduler = job.scheduler || null;
    const latest = job.lastExecution || null;
    const latestError = latest?.error || "";
    const schedulerError = scheduler?.lastError || "";
    const configurationError = !job.configured
      ? `Faltan credenciales: ${(job.missingEnv || []).join(", ") || "variables requeridas"}`
      : "";
    const detailSummary = [
      scheduler?.enabled ? "habilitado" : "desactivado",
      job.configured ? null : "faltan credenciales",
      scheduler?.running || latest?.status === "running" ? "en ejecucion" : null,
      latest?.status === "failed" || schedulerError ? "con incidencia" : null,
    ].filter(Boolean).join(" · ");
    const state = scheduler?.enabled
      ? (!job.configured || (scheduler?.lastErrorKind || latest?.failureKind) === "auth_required")
        ? "En standby"
        : latest?.status === "failed" || scheduler?.lastError
        ? "Con error"
        : scheduler?.running || latest?.status === "running"
          ? "Ejecutando"
          : latest?.status === "done"
            ? "Correcto"
            : "Programado"
      : "Desactivado";

    return `
      <article class="job-card">
        <div class="job-card__header">
          <div>
            <p class="job-card__eyebrow">${escapeHtml(job.type || "job")}</p>
            <h2>${escapeHtml(job.description || job.id)}</h2>
            <p class="job-card__id">${escapeHtml(job.id)}</p>
          </div>
          <span class="pill ${scheduler?.enabled ? (state === "Con error" ? "fail" : state === "Ejecutando" || state === "Correcto" ? "ok" : "warn") : "neutral"}">${escapeHtml(state)}</span>
        </div>
        <p class="job-card__text">${escapeHtml(job.description || "Sin descripcion adicional.")}</p>
        <p class="job-card__summary">${escapeHtml(detailSummary || "Sin metadatos destacados.")}</p>
        ${configurationError ? `<p class="job-card__error"><strong>Configuracion faltante:</strong> ${escapeHtml(configurationError)}</p>` : ""}
        ${latestError ? `<p class="job-card__error"><strong>Ultimo error:</strong> ${escapeHtml(latestError)}</p>` : ""}
        ${schedulerError ? `<p class="job-card__error"><strong>Error del scheduler:</strong> ${escapeHtml(schedulerError)}</p>` : ""}
        <details class="job-card__details">
          <summary>Ver detalle tecnico</summary>
          <dl class="job-card__meta">
            <div><dt>Configurado</dt><dd>${job.configured ? "Si" : "No"}</dd></div>
            <div><dt>Habilitado</dt><dd>${scheduler?.enabled ? "Si" : "No"}</dd></div>
            <div><dt>Corriendo</dt><dd>${scheduler?.running || latest?.status === "running" ? "Si" : "No"}</dd></div>
            <div><dt>Proxima ejecucion</dt><dd>${escapeHtml(formatDateTime(scheduler?.nextRunAt))}</dd></div>
            <div><dt>Ultimo inicio</dt><dd>${escapeHtml(formatDateTime(latest?.startedAt || scheduler?.lastStartedAt))}</dd></div>
            <div><dt>Ultimo cierre</dt><dd>${escapeHtml(formatDateTime(latest?.finishedAt || scheduler?.lastFinishedAt))}</dd></div>
          </dl>
        </details>
        <div class="job-card__actions">
          <a class="button secondary" href="/jobs/history/${encodeURIComponent(job.id)}">Ver historial</a>
          <form method="post" action="/jobs/${encodeURIComponent(job.id)}/run">
            <button type="submit" class="button secondary">Ejecutar ahora</button>
          </form>
        </div>
      </article>
    `;
  }).join("");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Jobs operativos | Desarrollo EG</title>
    <style>
      :root {
        --bg: #0b1220;
        --panel: rgba(15, 23, 42, 0.9);
        --panel-border: rgba(148, 163, 184, 0.18);
        --text: #f8fafc;
        --muted: #cbd5e1;
        --accent: #38bdf8;
        --accent-2: #22c55e;
        --warn: #f59e0b;
        --fail: #ef4444;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 32%),
          radial-gradient(circle at top right, rgba(34, 197, 94, 0.16), transparent 28%),
          linear-gradient(180deg, #111827 0%, #020617 100%);
      }
      main {
        max-width: 1240px;
        margin: 0 auto;
        padding: 28px 20px 48px;
      }
      .skip-link {
        position: absolute;
        left: 16px;
        top: 16px;
        z-index: 20;
        padding: 10px 14px;
        border-radius: 999px;
        background: #f8fafc;
        color: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.28);
        font-weight: 800;
        text-decoration: none;
        transform: translateY(-180%);
        transition: transform 180ms ease;
      }
      .skip-link:focus { transform: translateY(0); }
      .hero {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
        align-items: start;
        margin-bottom: 20px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        padding: 24px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.24);
        backdrop-filter: blur(12px);
      }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 12px;
        font-weight: 800;
        color: var(--accent);
        margin: 0 0 12px;
      }
      h1 {
        margin: 0;
        font-size: clamp(32px, 5vw, 52px);
        line-height: 1;
      }
      .lead {
        margin: 14px 0 0;
        color: var(--muted);
        line-height: 1.65;
        max-width: 70ch;
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 20px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 999px;
        text-decoration: none;
        font-weight: 800;
      }
      .button.primary {
        background: linear-gradient(135deg, var(--accent) 0%, #7dd3fc 100%);
        color: #082f49;
      }
      .button.secondary {
        background: rgba(255, 255, 255, 0.05);
        color: var(--text);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .stat {
        border-radius: 18px;
        padding: 16px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .stat span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 8px;
      }
      .stat strong {
        font-size: 22px;
        line-height: 1.2;
      }
      .jobs-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      }
      .job-card {
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 20px;
        padding: 18px;
      }
      .job-card__header {
        display: flex;
        gap: 12px;
        justify-content: space-between;
        align-items: start;
      }
      .job-card__eyebrow {
        margin: 0 0 6px;
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 11px;
        font-weight: 800;
      }
      .job-card h2 {
        margin: 0;
        font-size: 19px;
        line-height: 1.2;
      }
      .job-card__id {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 800;
        border: 1px solid transparent;
      }
      .pill.ok { background: rgba(34, 197, 94, 0.12); color: #86efac; border-color: rgba(34, 197, 94, 0.22); }
      .pill.warn { background: rgba(245, 158, 11, 0.12); color: #fcd34d; border-color: rgba(245, 158, 11, 0.22); }
      .pill.fail { background: rgba(239, 68, 68, 0.12); color: #fca5a5; border-color: rgba(239, 68, 68, 0.22); }
      .pill.neutral { background: rgba(148, 163, 184, 0.12); color: #e2e8f0; border-color: rgba(148, 163, 184, 0.18); }
      .job-card__meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin: 18px 0 0;
      }
      .job-card__meta div {
        border-radius: 14px;
        padding: 12px;
        background: rgba(2, 6, 23, 0.34);
      }
      .job-card__meta dt {
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 5px;
      }
      .job-card__meta dd {
        margin: 0;
        font-size: 14px;
        line-height: 1.35;
      }
      .job-card__text,
      .job-card__error {
        margin: 14px 0 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .job-card__summary {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.45;
      }
      .job-card__error {
        color: #fecaca;
      }
      .job-card__details {
        margin-top: 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.10);
        padding-top: 12px;
      }
      .job-card__details summary {
        cursor: pointer;
        font-weight: 800;
        color: var(--accent);
        list-style: none;
      }
      .job-card__details summary::-webkit-details-marker {
        display: none;
      }
      .job-card__actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      .job-card__actions form {
        margin: 0;
      }
      .job-card__actions .button {
        border: 0;
        cursor: pointer;
        font: inherit;
      }
      .section-title {
        margin: 0 0 12px;
        font-size: 22px;
      }
      .note {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      @media (max-width: 900px) {
        .hero {
          grid-template-columns: 1fr;
        }
        .job-card__meta {
          grid-template-columns: 1fr;
        }
        .hero {
          grid-template-columns: 1fr;
        }
      }
  </style>
  </head>
  <body>
    <a class="skip-link" href="#jobs-main">Saltar al contenido principal</a>
    <main id="jobs-main" role="main" aria-label="Jobs operativos">
      <section class="hero">
        <article class="panel">
          <p class="eyebrow">Vista operativa</p>
          <h1>Jobs</h1>
          <p class="lead">Esta pagina agrupa los jobs del monolito con una lectura humana. Los jobs con incidencia aparecen primero, mientras que <code>/jobs</code> conserva el contrato JSON para integraciones y monitoreo tecnico.</p>
          <div class="actions">
            <a class="button primary" href="/jobs">Ver JSON tecnico</a>
            <a class="button secondary" href="/jobs/health">Health</a>
            <a class="button secondary" href="/status">Abrir portal</a>
          </div>
          <p class="note" style="margin-top:14px;">La lectura prioriza errores activos, ejecuciones en curso y bloqueos por credenciales para que la operacion humana no tenga que buscar el problema.</p>
        </article>
        <aside class="panel">
          <div class="stats">
            <div class="stat">
              <span>Total jobs</span>
              <strong>${escapeHtml(summary.totalJobs ?? jobs.length ?? 0)}</strong>
            </div>
            <div class="stat">
              <span>Configurados</span>
              <strong>${escapeHtml(summary.configuredJobs ?? 0)}</strong>
            </div>
            <div class="stat">
              <span>Activos</span>
              <strong>${escapeHtml(summary.enabledJobs ?? 0)}</strong>
            </div>
            <div class="stat">
              <span>En ejecucion</span>
              <strong>${escapeHtml(summary.runningJobs ?? runningJobs.length ?? 0)}</strong>
            </div>
            <div class="stat">
              <span>Con fallo</span>
              <strong>${escapeHtml(summary.failingJobs ?? failingJobs.length ?? 0)}</strong>
            </div>
            <div class="stat">
              <span>Bloqueados</span>
              <strong>${escapeHtml(summary.blockedJobs ?? 0)}</strong>
            </div>
            <div class="stat">
              <span>Fuente</span>
              <strong>Scheduler</strong>
            </div>
          </div>
        </aside>
      </section>
      <section>
        <h2 class="section-title">Estado por job</h2>
        <p class="note">Cada tarjeta muestra una lectura rapida; el detalle tecnico queda dentro de un bloque desplegable para que la vista no se sature.</p>
        <div class="jobs-grid">
          ${cards || "<p class='note'>No hay jobs configurados.</p>"}
        </div>
      </section>
    </main>
  </body>
</html>`;
}

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
  res.json(buildJobsView());
});

jobsRouter.get('/view', (_req, res) => {
  res.type('html').send(buildJobsLandingHtml(buildJobsView()));
});

jobsRouter.get('/health', (_req, res) => {
  const view = buildJobsView();
  const failures = view.jobs
    .filter((job) => Boolean(job.scheduler?.lastError) || Boolean(job.lastExecution?.error))
    .map((job) => summarizeFailure(job))
    .filter(Boolean);

  const activeFailures = failures.filter((failure) => failure.kind !== "auth_required");
  const retryableFailures = failures.filter((failure) => failure.retryable);
  const blockedFailures = failures.filter((failure) => failure.kind === "auth_required");

  res.status(activeFailures.length > 0 ? 503 : 200).json({
    ok: activeFailures.length === 0,
    summary: view.summary,
    failureSummary: {
      total: failures.length,
      active: activeFailures.length,
      retryable: retryableFailures.length,
      blocked: blockedFailures.length,
      kinds: failures.reduce((acc, failure) => {
        acc[failure.kind || "unknown"] = (acc[failure.kind || "unknown"] || 0) + 1;
        return acc;
      }, {}),
    },
    failures,
  });
});

jobsRouter.get('/history/:jobId', (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Job invalido.' });
  }

  res.json({
    ok: true,
    jobId,
    history: getJobExecutionHistory(jobId),
    latest: getLatestJobExecution(jobId),
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
    const result = await executeTrackedJob(req.params.jobId, () => runJob(req.params.jobId), { source: 'manual' });
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
});
