import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { listJobs, runJob } from './services/jobRunner.js';
import { getJobSchedulerStatus } from './services/jobScheduler.js';
import { classifyJobFailure, executeTrackedJob, getJobExecutionHistory, getLatestJobExecution } from './services/jobExecutionTracker.js';
import { getJobConfigurationState } from './services/jobRegistry.js';
import { canRunSingletonServices, getClusterCoordinatorStatus } from '../../services/clusterCoordinator.js';
import { enviarPedidosManual, normalizePedidoRow } from './native/pedidos/manualAppsheet.service.js';
import {
  deleteEstatalesLocalRows,
  deleteMunicipalesLocalRows,
  upsertEstatalesLocalRows,
  upsertMunicipalesLocalRows,
} from './services/localAppsheetDb.js';

export const jobsRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const manualPedidoJobs = new Map();
const LOGS_DIR = path.resolve(process.env.RUNTIME_LOGS_DIR || path.join(process.cwd(), 'runtime', 'logs'));
const LOG_TAIL_BYTES = Math.max(1024, Number(process.env.JOBS_LOG_TAIL_BYTES || 128 * 1024));
const LOG_HEARTBEAT_MS = Math.max(5000, Number(process.env.JOBS_LOG_HEARTBEAT_MS || 15000));

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

function normalizeLogFileName(value) {
  const fileName = path.basename(String(value || '').trim());
  if (!fileName || fileName !== String(value || '').trim()) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) return null;
  return fileName;
}

function resolveLogPath(fileName) {
  const safeName = normalizeLogFileName(fileName);
  if (!safeName) return null;
  const resolvedPath = path.resolve(LOGS_DIR, safeName);
  const relative = path.relative(LOGS_DIR, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolvedPath;
}

function listRuntimeLogFiles() {
  try {
    if (!fs.existsSync(LOGS_DIR)) return [];
    return fs.readdirSync(LOGS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(LOGS_DIR, entry.name);
        const stat = fs.statSync(filePath);
        return {
          name: entry.name,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  } catch {
    return [];
  }
}

function readLogTail(filePath, maxBytes = LOG_TAIL_BYTES) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  if (length <= 0) {
    return { text: '', nextOffset: stat.size };
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return {
      text: buffer.toString('utf8'),
      nextOffset: stat.size,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function sendLogEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function renderRealtimeLogsHtml(files, selectedFile) {
  const options = files.map((file) => {
    const selected = file.name === selectedFile ? ' selected' : '';
    return `<option value="${escapeHtml(file.name)}"${selected}>${escapeHtml(file.name)} (${escapeHtml(String(Math.round(file.size / 1024)))} KB)</option>`;
  }).join('');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logs en tiempo real</title>
  <style>
    :root { color-scheme: dark; --bg:#101419; --panel:#161d24; --text:#edf3f8; --muted:#9fb0bd; --line:#26313b; --ok:#75d99b; --warn:#ffd166; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font-family: Consolas, "Liberation Mono", monospace; }
    header { display:flex; gap:12px; align-items:center; justify-content:space-between; padding:14px 18px; background:var(--panel); border-bottom:1px solid var(--line); }
    h1 { margin:0; font:700 16px/1.2 system-ui, sans-serif; letter-spacing:0; }
    form { display:flex; gap:8px; align-items:center; margin:0; }
    select, button { min-height:34px; border:1px solid var(--line); border-radius:6px; background:#0d1116; color:var(--text); padding:0 10px; }
    button { cursor:pointer; font-weight:700; }
    .meta { color:var(--muted); font:500 12px/1.2 system-ui, sans-serif; }
    #status { color:var(--warn); }
    #status.connected { color:var(--ok); }
    main { height:calc(100vh - 64px); overflow:auto; padding:16px; }
    pre { margin:0; white-space:pre-wrap; word-break:break-word; line-height:1.35; font-size:12px; }
    .empty { color:var(--muted); font:500 14px/1.4 system-ui, sans-serif; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Logs en tiempo real</h1>
      <div class="meta">Directorio: ${escapeHtml(LOGS_DIR)}</div>
    </div>
    <form method="get" action="/jobs/logs">
      <select name="file">${options}</select>
      <button type="submit">Abrir</button>
      <span id="status">conectando</span>
    </form>
  </header>
  <main id="viewport"><pre id="log"></pre></main>
  <script>
    const file = ${JSON.stringify(selectedFile)};
    const statusNode = document.getElementById('status');
    const logNode = document.getElementById('log');
    const viewport = document.getElementById('viewport');
    if (!file) {
      statusNode.textContent = 'sin archivo';
      logNode.innerHTML = '<span class="empty">No hay archivos en runtime/logs.</span>';
    } else {
      const source = new EventSource('/jobs/logs/stream?file=' + encodeURIComponent(file));
      const append = (text) => {
        if (!text) return;
        logNode.textContent += text;
        viewport.scrollTop = viewport.scrollHeight;
      };
      source.addEventListener('open', () => {
        statusNode.textContent = 'conectado';
        statusNode.classList.add('connected');
      });
      source.addEventListener('tail', (event) => append(JSON.parse(event.data).text || ''));
      source.addEventListener('append', (event) => append(JSON.parse(event.data).text || ''));
      source.addEventListener('error', () => {
        statusNode.textContent = 'reconectando';
        statusNode.classList.remove('connected');
      });
    }
  </script>
  <script src="/ui/portal-shell.js?v=20260901b" defer></script>
</body>
</html>`;
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

  const featuredJobs = sortedJobs.filter((job) => getJobPriority(job) <= 2);
  const supportJobs = sortedJobs.filter((job) => getJobPriority(job) > 2);

  const renderJobCard = (job) => {
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
  };

  const featuredCards = featuredJobs.map(renderJobCard).join("");
  const supportCards = supportJobs.map(renderJobCard).join("");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Jobs operativos | Desarrollo EG</title>
  <link rel="stylesheet" href="/ui/portal-shell.css?v=20260828a" />
    <style>
      * { box-sizing: border-box; }
      body.portal-shell.portal-jobs main.page { max-width: 1440px; }
      .hero {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.85fr);
        align-items: start;
      }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 12px;
        font-weight: 800;
        color: var(--portal-accent-3);
        margin: 0 0 12px;
      }
      h1 { margin: 0; font-size: clamp(32px, 5vw, 52px); line-height: 1; }
      .lead,
      .note,
      .job-card__text,
      .job-card__summary,
      .job-card__error { line-height: 1.6; }
      .lead,
      .note,
      .job-card__text,
      .job-card__summary { color: var(--portal-muted); }
      .lead { margin: 14px 0 0; max-width: 70ch; }
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
      .button.secondary { background: rgba(15, 23, 42, 0.04); }
      .stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .jobs-hero,
      .jobs-section,
      .jobs-support { margin-top: 24px; }
      .jobs-support-details {
        border-radius: 24px;
        border: 1px solid rgba(33, 49, 63, 0.10);
        background: rgba(255, 255, 255, 0.72);
        box-shadow: var(--shadow);
        padding: 16px 18px;
      }
      .jobs-support-details summary {
        cursor: pointer;
        font-weight: 900;
        color: var(--portal-accent-3);
        list-style: none;
      }
      .jobs-support-details summary::-webkit-details-marker { display: none; }
      .jobs-support-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 10px;
        align-items: end;
        margin-bottom: 12px;
      }
      .jobs-support-header h2 { margin: 0; font-size: 22px; }
      .jobs-support-header p { margin: 6px 0 0; color: var(--portal-muted); }
      .jobs-grid--compact {
        margin-top: 12px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      .stat {
        border-radius: 18px;
        padding: 16px;
        background: rgba(255, 255, 255, 0.68);
        border: 1px solid rgba(33, 49, 63, 0.10);
      }
      .stat span {
        display: block;
        color: var(--portal-muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 8px;
      }
      .stat strong { font-size: 22px; line-height: 1.2; }
      .jobs-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        margin-top: 16px;
      }
      .job-card {
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid rgba(33, 49, 63, 0.10);
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
        color: var(--portal-accent-3);
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 11px;
        font-weight: 800;
      }
      .job-card h2 { margin: 0; font-size: 19px; line-height: 1.2; }
      .job-card__id {
        margin: 8px 0 0;
        color: var(--portal-muted);
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
      .pill.ok { background: rgba(34, 197, 94, 0.12); color: #166534; border-color: rgba(34, 197, 94, 0.22); }
      .pill.warn { background: rgba(245, 158, 11, 0.12); color: #92400e; border-color: rgba(245, 158, 11, 0.22); }
      .pill.fail { background: rgba(239, 68, 68, 0.12); color: #991b1b; border-color: rgba(239, 68, 68, 0.22); }
      .pill.neutral { background: rgba(148, 163, 184, 0.12); color: #334155; border-color: rgba(148, 163, 184, 0.18); }
      .job-card__meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin: 18px 0 0;
      }
      .job-card__meta div {
        border-radius: 14px;
        padding: 12px;
        background: rgba(15, 23, 42, 0.04);
      }
      .job-card__meta dt {
        color: var(--portal-muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 5px;
      }
      .job-card__meta dd { margin: 0; font-size: 14px; line-height: 1.35; }
      .job-card__error {
        margin: 14px 0 0;
        color: #b91c1c;
      }
      .job-card__details {
        margin-top: 14px;
        border-top: 1px solid rgba(33, 49, 63, 0.10);
        padding-top: 12px;
      }
      .job-card__details summary {
        cursor: pointer;
        font-weight: 800;
        color: var(--portal-accent-3);
        list-style: none;
      }
      .job-card__details summary::-webkit-details-marker { display: none; }
      .job-card__actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      .job-card__actions form { margin: 0; }
      .job-card__actions .button {
        border: 0;
        cursor: pointer;
        font: inherit;
      }
      .section-title {
        margin: 0 0 12px;
        font-size: 22px;
      }
      @media (max-width: 900px) {
        .hero { grid-template-columns: 1fr; }
        .job-card__meta,
        .jobs-grid--compact { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body class="portal-shell portal-jobs">
    <a class="skip-link" href="#jobs-main">Saltar al contenido principal</a>
    <main id="jobs-main" class="page" role="main" aria-label="Jobs operativos">
      <section class="hero jobs-hero">
        <article class="panel">
          <p class="eyebrow">Soporte operativo</p>
          <h1>Jobs</h1>
          <p class="lead">Vista de soporte para revisar primero incidencias y ejecuciones activas. El contrato JSON de <code>/jobs</code> sigue disponible para integraciones y monitoreo tecnico.</p>
          <div class="actions">
            <a class="button primary" href="/jobs">Abrir JSON tecnico</a>
            <a class="button secondary" href="/jobs/health">Health</a>
            <a class="button secondary" href="/status">Abrir portal</a>
          </div>
          <p class="note" style="margin-top:14px;">La lectura prioriza errores activos, ejecuciones en curso y bloqueos por credenciales para que el problema no quede escondido.</p>
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
              <span>Lectura</span>
              <strong>Activa</strong>
            </div>
          </div>
          <p class="note" style="margin-top:14px;">El detalle tecnico queda dentro de cada tarjeta para no saturar la primera lectura.</p>
        </aside>
      </section>
      <section class="jobs-section">
        <h2 class="section-title">Prioridad alta</h2>
        <p class="note">Incidencias activas y ejecuciones en curso. Todo lo demas baja a soporte.</p>
        <div class="jobs-grid">
          ${featuredCards || "<p class='note'>No hay jobs prioritarios.</p>"}
        </div>
      </section>
      <section class="jobs-support">
        <details class="jobs-support-details">
          <summary>Mostrar soporte y jobs estables</summary>
          <div class="jobs-support-header">
            <div>
              <h2>Soporte y estado estable</h2>
              <p>Jobs programados, habilitados y sin incidencia visible en la primera lectura.</p>
            </div>
          </div>
          <div class="jobs-grid jobs-grid--compact">
            ${supportCards || "<p class='note'>No hay jobs de soporte para mostrar.</p>"}
          </div>
        </details>
      </section>
    </main>
    <script src="/ui/portal-shell.js?v=20260901b" defer></script>
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

function normalizeWebhookTable(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeWebhookOperation(value) {
  const operation = normalizeWebhookTable(value);
  if (["DELETE", "DELETED", "ELIMINAR", "ELIMINADO"].includes(operation)) return "Delete";
  if (["ADD", "ADDED", "INSERT", "INSERTAR", "AGREGAR", "NUEVO"].includes(operation)) return "Add";
  return "Edit";
}

function getWebhookRows(body = {}) {
  if (Array.isArray(body?.Rows)) return body.Rows;
  if (Array.isArray(body?.rows)) return body.rows;
  if (Array.isArray(body?.RowsToUpdate)) return body.RowsToUpdate;
  if (Array.isArray(body?.rowsToUpdate)) return body.rowsToUpdate;
  if (Array.isArray(body?.row)) return body.row;
  if (body?.row && typeof body.row === "object") return [body.row];
  if (body?.Row && typeof body.Row === "object") return [body.Row];
  if (body && typeof body === "object") return [body];
  return [];
}

function getWebhookRowKey(row = {}, fallback = "") {
  const keys = ["row_id", "Row ID", "ROW ID", "Row Id", "id", "ID", "_RowNumber", "_ROWNUMBER"];
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return String(fallback || "").trim();
}

function isAuthorizedAppSheetWebhook(req) {
  const expected = String(process.env.APPSHEET_WEBHOOK_SECRET || "").trim();
  if (!expected) return true;
  const provided = String(
    req.get("x-appsheet-webhook-secret")
    || req.get("x-webhook-secret")
    || req.query?.secret
    || req.body?.secret
    || "",
  ).trim();
  return provided === expected;
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

jobsRouter.get('/logs', (req, res) => {
  const files = listRuntimeLogFiles();
  const requestedFile = normalizeLogFileName(req.query?.file);
  const selectedFile = requestedFile && files.some((file) => file.name === requestedFile)
    ? requestedFile
    : files[0]?.name || '';

  res.type('html').send(renderRealtimeLogsHtml(files, selectedFile));
});

jobsRouter.get('/logs/files', (_req, res) => {
  res.json({
    ok: true,
    directory: LOGS_DIR,
    files: listRuntimeLogFiles(),
  });
});

jobsRouter.get('/logs/stream', (req, res) => {
  const fileName = normalizeLogFileName(req.query?.file);
  const filePath = resolveLogPath(fileName);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: 'Log no encontrado.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let offset = 0;
  let closed = false;

  const sendTail = () => {
    try {
      const tail = readLogTail(filePath);
      offset = tail.nextOffset;
      sendLogEvent(res, 'tail', { file: fileName, text: tail.text, offset });
    } catch (error) {
      sendLogEvent(res, 'error', { file: fileName, error: error instanceof Error ? error.message : 'No se pudo leer el log.' });
    }
  };

  const sendAppend = () => {
    if (closed) return;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < offset) {
        offset = 0;
        sendLogEvent(res, 'append', { file: fileName, text: '\n[log reiniciado]\n', offset });
      }
      if (stat.size <= offset) return;

      const length = stat.size - offset;
      const fd = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, offset);
        offset = stat.size;
        sendLogEvent(res, 'append', { file: fileName, text: buffer.toString('utf8'), offset });
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      sendLogEvent(res, 'error', { file: fileName, error: error instanceof Error ? error.message : 'No se pudo seguir el log.' });
    }
  };

  sendTail();
  const watcher = fs.watch(filePath, { persistent: false }, sendAppend);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, LOG_HEARTBEAT_MS);

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    watcher.close();
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
      return res.status(400).json({ ok: false, error: 'No se recibieron filas vÃ¡lidas.' });
    }

    const job = createManualPedidoJob();
    res.status(202).json({
      ok: true,
      queued: true,
      jobId: job.jobId,
      total: rows.length,
      message: 'La importaciÃ³n quedÃ³ en proceso.',
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

jobsRouter.post('/appsheet/webhook', (req, res) => {
  if (!isAuthorizedAppSheetWebhook(req)) {
    return res.status(401).json({ ok: false, error: 'Webhook no autorizado.' });
  }

  const table = normalizeWebhookTable(req.body?.table || req.body?.tabla || req.body?.TableName || req.body?.Table || req.query?.table);
  const operation = normalizeWebhookOperation(req.body?.operation || req.body?.operacion || req.body?.action || req.body?.Action || req.query?.operation);
  const rows = getWebhookRows(req.body)
    .map((row) => (row && typeof row === "object" ? row : null))
    .filter(Boolean);
  const explicitKey = String(req.body?.key || req.body?.Key || req.query?.key || "").trim();

  try {
    if (table === "ESTATALES") {
      if (operation === "Delete") {
        const keys = rows.map((row) => getWebhookRowKey(row, explicitKey)).filter(Boolean);
        const deleted = deleteEstatalesLocalRows(keys);
        return res.json({ ok: true, table, operation, rows: rows.length, deleted });
      }
      upsertEstatalesLocalRows(rows);
      return res.json({ ok: true, table, operation, rows: rows.length });
    }

    if (table === "MUNICIPALES") {
      if (operation === "Delete") {
        const keys = rows.map((row) => getWebhookRowKey(row, explicitKey)).filter(Boolean);
        const deleted = deleteMunicipalesLocalRows(keys);
        return res.json({ ok: true, table, operation, rows: rows.length, deleted });
      }
      upsertMunicipalesLocalRows(rows);
      return res.json({ ok: true, table, operation, rows: rows.length });
    }

    return res.status(400).json({ ok: false, error: 'Tabla no soportada por este webhook.', table });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      table,
      operation,
      error: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
});

jobsRouter.post('/:jobId/run', async (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  const forceValue = String(req.query?.force ?? req.body?.force ?? "").trim().toLowerCase();
  const force = forceValue === "1" || forceValue === "true" || forceValue === "yes" || forceValue === "on";

  if (!canRunSingletonServices()) {
    return res.status(409).json({
      ok: false,
      error: 'Este nodo esta en standby. Ejecuta el job en el nodo lider.',
      cluster: getClusterCoordinatorStatus(),
    });
  }

  try {
    const result = await executeTrackedJob(jobId, () => runJob(jobId, { force }), { source: 'manual' });
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
});
