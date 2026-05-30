import { promises as fs } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { getBackgroundServicesStatus } from "../../services/backgroundServices.js";
import { getClusterCoordinatorStatus } from "../../services/clusterCoordinator.js";

const execAsync = promisify(exec);
const LOG_LINES = 8;
const SERVICE_TIMEOUT_MS = 5000;
const DASHBOARD_TIMEZONE = process.env.DASHBOARD_TIMEZONE || "America/Chihuahua";

const monolithServices = [
  {
    id: "contabilidad",
    name: "Contabilidad",
    description: "API interna del modulo contable dentro del monolito.",
    path: "/contabilidad/health",
    probeUrl: "https://apps.desarrolloeg.com/contabilidad/health",
    href: "https://apps.desarrolloeg.com/contabilidad/health",
  },
  {
    id: "facturacion",
    name: "Facturacion",
    description: "Entrada publica de cotizaciones y facturacion.",
    path: "/facturacion/health",
    probeUrl: "https://api-cotizaciones.desarrolloeg.com/health",
    href: "https://api-cotizaciones.desarrolloeg.com/health",
  },
  {
    id: "constancias-v2",
    name: "Constancias V2",
    description: "Aplicacion publica de constancias y consulta de folios.",
    path: "/CONSTANCIAS/health",
    probeUrl: "https://api-constancias.desarrolloeg.com/health",
    href: "https://api-constancias.desarrolloeg.com/health",
  },
  {
    id: "planeacion",
    name: "Planeacion Ley",
    description: "Interfaz web de planeacion mensual dentro de apps.",
    path: "/Planeacion-ley/",
    probeUrl: "https://apps.desarrolloeg.com/Planeacion-ley/",
    href: "https://apps.desarrolloeg.com/Planeacion-ley/",
  },
  {
    id: "planeacion-api",
    name: "Planeacion API",
    description: "API consumida por la vista de planeacion.",
    path: "/api/branches",
    probeUrl: "https://apps.desarrolloeg.com/api/branches",
    href: "https://apps.desarrolloeg.com/api/branches",
  },
  {
    id: "clubfactura",
    name: "ClubFactura",
    description: "Proxy de descarga para XML y PDF de ClubFactura.",
    path: "/clubfactura/health",
    probeUrl: "https://clubfactura.desarrolloeg.com/health",
    href: "https://clubfactura.desarrolloeg.com/health",
  },
  {
    id: "jobs",
    name: "Jobs",
    description: "API para ejecutar y observar jobs migrados al monolito.",
    path: "/jobs",
    probeUrl: "https://apps.desarrolloeg.com/jobs",
    href: "https://apps.desarrolloeg.com/jobs",
  },
  {
    id: "separar-pipc",
    name: "Separar PIPC",
    description: "Herramienta para dividir un PIPC usando el indice del documento y sus pies de pagina.",
    path: "/SEPARAR-PIPC/health",
    probeUrl: "https://apps.desarrolloeg.com/SEPARAR-PIPC/health",
    href: "https://apps.desarrolloeg.com/SEPARAR-PIPC/",
  },
  {
    id: "solventaciones",
    name: "Solventaciones",
    description: "Reporte de visitas y solventaciones por tienda, razon social y municipio.",
    path: "/SOLVENTACIONES/health",
    probeUrl: "https://apps.desarrolloeg.com/SOLVENTACIONES/health",
    href: "https://apps.desarrolloeg.com/SOLVENTACIONES/html",
  },
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripAnsi(value = "") {
  return String(value).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function trimText(value = "", maxLength = 220) {
  const normalized = String(value).trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function isQrNoise(value = "") {
  const line = String(value);
  const matches = line.match(/[\u2588\u2584\u2580]{8,}/g) || [];
  return matches.length > 0;
}

function sanitizeLogLines(lines) {
  return lines
    .map((line) => trimText(stripAnsi(line)))
    .filter(Boolean)
    .filter((line) => !isQrNoise(line));
}

function pickPreviewLine(...groups) {
  const lines = groups.flat().filter(Boolean).reverse();
  const useful = lines.find((line) => !/^(?:\}|\]|\)|at\s)/.test(String(line).trim()));
  return useful || lines[0] || "Sin actividad reciente";
}

function formatDateTime(value) {
  if (!value) return "Sin dato";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: DASHBOARD_TIMEZONE,
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatJsonPreview(value) {
  if (value === null || value === undefined) return "Sin resultado";
  try {
    return trimText(JSON.stringify(value), 180);
  } catch {
    return trimText(String(value), 180);
  }
}

function buildAbsoluteUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

function getJobState(job) {
  if (!job.enabled) return { tone: "neutral", label: "Desactivado" };
  if (job.lastError) return { tone: "fail", label: "Con error" };
  if (job.running) return { tone: "ok", label: "Ejecutando" };
  if (job.lastResult?.ok) return { tone: "ok", label: "Correcto" };
  if (job.nextRunAt) return { tone: "neutral", label: "Programado" };
  return { tone: "neutral", label: "Pendiente" };
}

function getSchedulerState(jobs, started) {
  const enabledJobs = jobs.filter((job) => job.enabled);
  const runningJobs = enabledJobs.filter((job) => job.running);
  const failingJobs = enabledJobs.filter((job) => job.lastError);

  if (!started) {
    return {
      tone: "warn",
      label: "No iniciado",
      enabledJobs: enabledJobs.length,
      runningJobs: runningJobs.length,
      failingJobs: failingJobs.length,
    };
  }

  if (!enabledJobs.length) {
    return {
      tone: "neutral",
      label: "Sin jobs activos",
      enabledJobs: 0,
      runningJobs: 0,
      failingJobs: 0,
    };
  }

  if (failingJobs.length) {
    return {
      tone: "fail",
      label: "Con errores",
      enabledJobs: enabledJobs.length,
      runningJobs: runningJobs.length,
      failingJobs: failingJobs.length,
    };
  }

  if (runningJobs.length) {
    return {
      tone: "ok",
      label: "Ejecutando",
      enabledJobs: enabledJobs.length,
      runningJobs: runningJobs.length,
      failingJobs: 0,
    };
  }

  return {
    tone: "ok",
    label: "Programado",
    enabledJobs: enabledJobs.length,
    runningJobs: 0,
    failingJobs: 0,
  };
}

function getWhatsAppState(service = {}) {
  if (!service.enabled) return { tone: "neutral", label: "Desactivado" };

  switch (service.status) {
    case "standby":
      return { tone: "neutral", label: "Standby" };
    case "idle":
      return { tone: "neutral", label: "En espera" };
    case "ready":
      return { tone: "ok", label: "Conectado" };
    case "awaiting_qr":
      return { tone: "warn", label: "Esperando QR" };
    case "starting":
      return { tone: "warn", label: "Arrancando" };
    case "restarting":
      return { tone: "warn", label: "Reiniciando" };
    case "auth_failure":
      return { tone: "fail", label: "Fallo de autenticacion" };
    case "disconnected":
      return { tone: "fail", label: "Desconectado" };
    case "error":
      return { tone: "fail", label: "Con error" };
    default:
      return { tone: "neutral", label: trimText(service.status || "Sin estado", 40) };
  }
}

function getProcessState(proc) {
  if (proc.isMonolith) {
    return proc.status === "online"
      ? { tone: "ok", label: "Principal" }
      : { tone: "fail", label: trimText(proc.status || "desconocido", 24) };
  }

  if (proc.status === "stopped") return { tone: "neutral", label: "Retirado" };
  if (proc.status === "online") return { tone: "warn", label: "Legacy activo" };
  return { tone: "fail", label: trimText(proc.status || "desconocido", 24) };
}

async function tailFile(filePath, lines = LOG_LINES) {
  if (!filePath) return [];
  try {
    const content = await fs.readFile(filePath, "utf8");
    return sanitizeLogLines(content.split(/\r?\n/)).slice(-lines);
  } catch {
    return [];
  }
}

async function getMonolithStatuses(baseUrl) {
  const checks = await Promise.all(
    monolithServices.map(async (service) => {
      const probeUrl = service.probeUrl || buildAbsoluteUrl(baseUrl, service.path);
      const startedAt = Date.now();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SERVICE_TIMEOUT_MS);
        const response = await fetch(probeUrl, {
          signal: controller.signal,
          redirect: "follow",
        });
        clearTimeout(timeout);

        try {
          response.body?.cancel?.();
        } catch {
          // ignore body cleanup errors
        }

        return {
          ...service,
          probeUrl,
          ok: response.ok,
          status: response.status,
          latencyMs: Date.now() - startedAt,
          contentType: response.headers.get("content-type") || "",
        };
      } catch (error) {
        return {
          ...service,
          probeUrl,
          ok: false,
          status: 0,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : "Error desconocido",
          contentType: "",
        };
      }
    })
  );

  return checks;
}

async function getPm2Processes() {
  try {
    const { stdout } = await execAsync("npx pm2 jlist", { windowsHide: true });
    const normalizedStdout = String(stdout || "").trim();
    if (!normalizedStdout.startsWith("[")) {
      return [];
    }

    const rawList = JSON.parse(normalizedStdout);
    const relevant = rawList.filter((proc) => {
      const cwd = String(proc?.pm2_env?.pm_cwd || proc?.pm2_env?.cwd || "");
      const script = String(proc?.pm2_env?.pm_exec_path || "");
      const haystack = `${cwd} ${script}`.toUpperCase();
      return haystack.includes("DESARROLLOEG_UTILIDADES") || haystack.includes("DESARROLLOEG_UTILIDADES_MONOLITO");
    });

    const processes = await Promise.all(
      relevant.map(async (proc) => {
        const env = proc.pm2_env || {};
        const outLog = env.pm_out_log_path || "";
        const errLog = env.pm_err_log_path || "";
        const outTail = await tailFile(outLog);
        const errTail = await tailFile(errLog);
        const isMonolith = proc.name === "desarrolloeg-monolito";
        const preview = pickPreviewLine(errTail, outTail);

        return {
          name: proc.name,
          status: env.status || "unknown",
          cwd: env.pm_cwd || env.cwd || "",
          script: env.pm_exec_path || "",
          outLog,
          errLog,
          outTail,
          errTail,
          preview,
          isMonolith,
        };
      })
    );

    const statusRank = {
      online: 0,
      launching: 1,
      restart: 2,
      errored: 3,
      stopped: 4,
      unknown: 5,
    };

    return processes.sort((left, right) => {
      if (left.isMonolith !== right.isMonolith) return left.isMonolith ? -1 : 1;
      const leftRank = statusRank[left.status] ?? 99;
      const rightRank = statusRank[right.status] ?? 99;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.name.localeCompare(right.name);
    });
  } catch (error) {
    return [];
  }
}

function getBackgroundData() {
  const raw = getBackgroundServicesStatus();
  const cluster = getClusterCoordinatorStatus();
  const standbyNode = cluster.enabled && cluster.role === "standby";
  const jobs = Array.isArray(raw.scheduler) ? raw.scheduler : [];
  const normalizedJobs = jobs.map((job) => {
    const state = standbyNode && job.enabled ? { tone: "neutral", label: "Standby" } : getJobState(job);
    return {
      ...job,
      tone: state.tone,
      stateLabel: state.label,
      runPath: `/jobs/${encodeURIComponent(job.jobId)}/run`,
    };
  });
  const schedulerState = standbyNode
    ? {
        tone: "neutral",
        label: "Standby",
        enabledJobs: normalizedJobs.filter((job) => job.enabled).length,
        runningJobs: 0,
        failingJobs: 0,
      }
    : getSchedulerState(normalizedJobs, Boolean(raw.started));

  const whatsappRaw = standbyNode && raw.whatsappCapacitadores?.enabled
    ? { ...(raw.whatsappCapacitadores || {}), status: "standby", connected: false, lastError: null }
    : raw.whatsappCapacitadores;

  const whatsapp = {
    ...(whatsappRaw || {}),
    ...getWhatsAppState(whatsappRaw),
    healthPath: "/whatsapp-capacitadores/health",
    qrPath: "/whatsapp-capacitadores/qr",
  };

  return {
    started: Boolean(raw.started),
    cluster: {
      ...cluster,
      tone: !cluster.enabled
        ? "neutral"
        : cluster.conflictingLeaderDetected
          ? "fail"
          : cluster.role === "leader"
            ? "ok"
            : cluster.role === "standby"
              ? "warn"
              : "neutral",
      label: !cluster.enabled
        ? "Modo unico"
        : cluster.conflictingLeaderDetected
          ? "Conflicto"
          : cluster.role === "leader"
            ? "Lider"
            : cluster.role === "standby"
              ? "Standby"
              : "Sin rol",
    },
    scheduler: {
      tone: schedulerState.tone,
      label: schedulerState.label,
      enabledJobs: schedulerState.enabledJobs,
      runningJobs: schedulerState.runningJobs,
      failingJobs: schedulerState.failingJobs,
      jobs: normalizedJobs,
    },
    whatsappCapacitadores: whatsapp,
  };
}

function buildSummary(services, background, pm2) {
  const healthyServices = services.filter((service) => service.ok).length;
  const totalServices = services.length;
  const primaryProcess = pm2.find((proc) => proc.isMonolith) || null;
  const pm2HasPrimary = Boolean(primaryProcess);
  const legacyActive = pm2.filter((proc) => !proc.isMonolith && proc.status === "online");
  const legacyRetired = pm2.filter((proc) => !proc.isMonolith && proc.status === "stopped");
  const legacyAlerts = pm2.filter(
    (proc) => !proc.isMonolith && proc.status !== "online" && proc.status !== "stopped"
  );
  const cluster = background.cluster || {};
  const standbyNode = cluster.enabled && cluster.role === "standby";
  const clusterTone = !cluster.enabled
    ? "neutral"
    : cluster.conflictingLeaderDetected
      ? "fail"
      : cluster.role === "leader"
        ? "ok"
        : cluster.role === "standby"
          ? "warn"
          : "neutral";
  const clusterLabel = !cluster.enabled
    ? "Modo unico"
    : cluster.conflictingLeaderDetected
      ? "Conflicto"
      : cluster.role === "leader"
        ? "Nodo lider"
        : cluster.role === "standby"
          ? "Nodo standby"
          : "Sin rol";
  const clusterDetail = !cluster.enabled
    ? "Este nodo siempre ejecuta los servicios singleton."
    : cluster.conflictingLeaderDetected
      ? "Se detecto mas de un lider publico; conviene revisar el failover."
      : cluster.role === "leader"
        ? "Este nodo ejecuta jobs y WhatsApp."
        : "Este nodo espera a que el health publico deje de reportar un lider.";

  let overallTone = "ok";
  let overallLabel = "Operativo";
  let overallDetail = "Servicios publicos y monolito respondiendo.";

  if (
    healthyServices !== totalServices ||
    (pm2HasPrimary && primaryProcess?.status !== "online") ||
    background.scheduler.tone === "fail" ||
    background.whatsappCapacitadores.tone === "fail" ||
    clusterTone === "fail" ||
    legacyAlerts.length
  ) {
    overallTone = "fail";
    overallLabel = "Atencion requerida";
    overallDetail = "Hay fallas activas o diagnosticos rojos que revisar.";
  } else if (standbyNode) {
    overallTone = "warn";
    overallLabel = "Nodo en espera";
    overallDetail = "Otro nodo deberia estar ejecutando los servicios singleton en este momento.";
  } else if (
    background.whatsappCapacitadores.tone === "warn" ||
    legacyActive.length
  ) {
    overallTone = "warn";
    overallLabel = "Con avisos";
    overallDetail = "El monolito esta arriba, pero hay piezas pendientes de estabilizar.";
  }

  const backgroundReadyCount = [background.scheduler, background.whatsappCapacitadores].filter(
    (item) => item.tone === "ok"
  ).length;
  const backgroundTotal = 2;

  const pm2Tone = legacyAlerts.length ? "fail" : legacyActive.length ? "warn" : "ok";
  const pm2Label = legacyAlerts.length
    ? "Con alertas"
    : legacyActive.length
      ? "Pendiente limpiar"
      : "Migracion estable";

  return {
    overall: {
      tone: overallTone,
      label: overallLabel,
      detail: overallDetail,
    },
    services: {
      healthy: healthyServices,
      total: totalServices,
      tone: healthyServices === totalServices ? "ok" : "fail",
    },
    background: {
      ready: backgroundReadyCount,
      total: backgroundTotal,
      tone:
        standbyNode
          ? "neutral"
          : background.scheduler.tone === "fail" || background.whatsappCapacitadores.tone === "fail"
          ? "fail"
          : background.whatsappCapacitadores.tone === "warn"
            ? "warn"
            : "ok",
    },
    cluster: {
      tone: clusterTone,
      label: clusterLabel,
      detail: clusterDetail,
    },
    pm2: {
      total: pm2.length,
      active: pm2.filter((proc) => proc.status === "online").length,
      retired: legacyRetired.length,
      alerts: legacyAlerts.length,
      legacyActive: legacyActive.length,
      tone: pm2Tone,
      label: pm2Label,
    },
    primaryProcess,
    legacyActive,
    legacyRetired,
    legacyAlerts,
  };
}

export async function getDashboardData(baseUrl) {
  const [services, pm2] = await Promise.all([getMonolithStatuses(baseUrl), getPm2Processes()]);
  const background = getBackgroundData();
  const summary = buildSummary(services, background, pm2);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    services,
    background,
    pm2Summary: summary.pm2,
    pm2,
  };
}

function renderBadge(tone, label) {
  return `<span class="badge tone-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function renderSummaryCards(summary) {
  const cards = [
    {
      tone: summary.overall.tone,
      eyebrow: "Salud general",
      value: summary.overall.label,
      detail: summary.overall.detail,
    },
    {
      tone: summary.services.tone,
      eyebrow: "Servicios publicos",
      value: `${summary.services.healthy}/${summary.services.total}`,
      detail: summary.services.healthy === summary.services.total
        ? "Todos responden correctamente."
        : "Hay endpoints publicos degradados.",
    },
    {
      tone: summary.background.tone,
      eyebrow: "Servicios de fondo",
      value: `${summary.background.ready}/${summary.background.total}`,
      detail: summary.cluster.label === "Nodo standby"
        ? "Este nodo esta en espera y no ejecuta scheduler ni WhatsApp."
        : "Scheduler y bot de WhatsApp dentro del monolito.",
    },
    {
      tone: summary.cluster.tone,
      eyebrow: "Cluster",
      value: summary.cluster.label,
      detail: summary.cluster.detail,
    },
    {
      tone: summary.pm2.tone,
      eyebrow: "Huella PM2",
      value: `${summary.pm2.active} activos`,
      detail: `${summary.pm2.retired} retirados / ${summary.pm2.alerts} alertas legacy`,
    },
  ];

  return cards
    .map(
      (card) => `
        <article class="stat-card tone-${escapeHtml(card.tone)}">
          <p class="eyebrow">${escapeHtml(card.eyebrow)}</p>
          <div class="stat-value">${escapeHtml(card.value)}</div>
          <p class="stat-detail">${escapeHtml(card.detail)}</p>
        </article>
      `
    )
    .join("\n");
}

function renderServiceCards(services) {
  return services
    .map((service) => {
      const badge = service.ok ? renderBadge("ok", "Disponible") : renderBadge("fail", "Con falla");
      const detail = service.ok
        ? `HTTP ${service.status} / ${service.latencyMs} ms`
        : service.error || `HTTP ${service.status}`;

      return `
        <article class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Servicio</p>
              <h3>${escapeHtml(service.name)}</h3>
            </div>
            ${badge}
          </div>
          <p class="panel-copy">${escapeHtml(service.description)}</p>
          <dl class="meta-list">
            <div><dt>Ruta</dt><dd>${escapeHtml(service.path)}</dd></div>
            <div><dt>Probe</dt><dd>${escapeHtml(service.probeUrl)}</dd></div>
            <div><dt>Diagnostico</dt><dd>${escapeHtml(detail)}</dd></div>
          </dl>
          <a class="inline-link" href="${escapeHtml(service.href || service.probeUrl)}" target="_blank" rel="noreferrer">
            Abrir endpoint
          </a>
        </article>
      `;
    })
    .join("\n");
}

function renderWhatsAppCard(whatsapp) {
  const qrLink = whatsapp.status === "awaiting_qr"
    ? `<a class="inline-link" href="${escapeHtml(whatsapp.qrPath)}" target="_blank" rel="noreferrer">Ver QR</a>`
    : "";

  return `
    <article class="panel accent">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Bot</p>
          <h3>WhatsApp Capacitadores</h3>
        </div>
        ${renderBadge(whatsapp.tone, whatsapp.label)}
      </div>
      <p class="panel-copy">Estado de la sesion de WhatsApp Web dentro del monolito.</p>
      <dl class="meta-list">
        <div><dt>Conexion</dt><dd>${escapeHtml(whatsapp.connected ? "Conectado" : "Sin conexion")}</dd></div>
        <div><dt>Inicio</dt><dd>${escapeHtml(formatDateTime(whatsapp.startedAt))}</dd></div>
        <div><dt>Ready</dt><dd>${escapeHtml(formatDateTime(whatsapp.readyAt))}</dd></div>
        <div><dt>Ultimo QR</dt><dd>${escapeHtml(formatDateTime(whatsapp.qrGeneratedAt))}</dd></div>
        <div><dt>Error</dt><dd>${escapeHtml(whatsapp.lastError || "Sin errores")}</dd></div>
      </dl>
      <div class="link-row">
        <a class="inline-link" href="${escapeHtml(whatsapp.healthPath)}" target="_blank" rel="noreferrer">Health</a>
        ${qrLink}
      </div>
    </article>
  `;
}

function renderClusterCard(cluster) {
  return `
    <article class="panel accent">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Cluster</p>
          <h3>Coordinacion entre nodos</h3>
        </div>
        ${renderBadge(cluster.tone, cluster.label)}
      </div>
      <p class="panel-copy">El nodo consulta el health publico antes de activar jobs y WhatsApp, para reducir colisiones entre maquinas.</p>
      <dl class="meta-list">
        <div><dt>Instance ID</dt><dd>${escapeHtml(cluster.instanceId || "Sin dato")}</dd></div>
        <div><dt>Estrategia</dt><dd>${escapeHtml(cluster.strategy || "Sin dato")}</dd></div>
        <div><dt>Ultimo check</dt><dd>${escapeHtml(formatDateTime(cluster.lastCheckAt))}</dd></div>
        <div><dt>Ultimo lider visto</dt><dd>${escapeHtml(formatDateTime(cluster.lastLeaderSeenAt))}</dd></div>
        <div><dt>Proxima promocion</dt><dd>${escapeHtml(formatDateTime(cluster.nextPromotionAt))}</dd></div>
        <div><dt>Decision</dt><dd>${escapeHtml(cluster.lastDecision || "Sin dato")}</dd></div>
      </dl>
      <a class="inline-link" href="${escapeHtml(cluster.publicHealthUrl || "/health")}" target="_blank" rel="noreferrer">Ver health publico</a>
    </article>
  `;
}

function renderSchedulerCard(scheduler) {
  return `
    <article class="panel accent">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Scheduler</p>
          <h3>Jobs programados</h3>
        </div>
        ${renderBadge(scheduler.tone, scheduler.label)}
      </div>
      <p class="panel-copy">Resumen del motor interno que reemplaza los cron y procesos sueltos.</p>
      <dl class="meta-list">
        <div><dt>Habilitados</dt><dd>${escapeHtml(String(scheduler.enabledJobs))}</dd></div>
        <div><dt>Ejecutando</dt><dd>${escapeHtml(String(scheduler.runningJobs))}</dd></div>
        <div><dt>Con error</dt><dd>${escapeHtml(String(scheduler.failingJobs))}</dd></div>
        <div><dt>Endpoint</dt><dd>/jobs</dd></div>
      </dl>
      <a class="inline-link" href="/jobs" target="_blank" rel="noreferrer">Ver JSON de jobs</a>
    </article>
  `;
}

function renderJobCards(jobs) {
  if (!jobs.length) {
    return `<article class="panel"><h3>Sin jobs registrados</h3><p class="panel-copy">Todavia no hay jobs configurados en el scheduler.</p></article>`;
  }

  return jobs
    .map((job) => `
      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Job</p>
            <h3>${escapeHtml(job.label)}</h3>
          </div>
          ${renderBadge(job.tone, job.stateLabel)}
        </div>
        <p class="panel-copy">${escapeHtml(job.jobId)}</p>
        <dl class="meta-list">
          <div><dt>Intervalo</dt><dd>${escapeHtml(`${job.intervalMinutes} min`)}</dd></div>
          <div><dt>Inicio manual</dt><dd>${escapeHtml(job.runPath)}</dd></div>
          <div><dt>Ultimo inicio</dt><dd>${escapeHtml(formatDateTime(job.lastStartedAt))}</dd></div>
          <div><dt>Ultimo fin</dt><dd>${escapeHtml(formatDateTime(job.lastFinishedAt))}</dd></div>
          <div><dt>Proxima corrida</dt><dd>${escapeHtml(formatDateTime(job.nextRunAt))}</dd></div>
          <div><dt>Resultado</dt><dd>${escapeHtml(formatJsonPreview(job.lastResult))}</dd></div>
          <div><dt>Error</dt><dd>${escapeHtml(job.lastError || "Sin errores")}</dd></div>
        </dl>
      </article>
    `)
    .join("\n");
}

function renderLogBlock(title, filePath, lines) {
  const content = lines.length ? lines.join("\n") : "Sin lineas recientes";
  return `
    <details class="log-block">
      <summary>${escapeHtml(title)} / ${escapeHtml(filePath || "sin archivo")}</summary>
      <pre>${escapeHtml(content)}</pre>
    </details>
  `;
}

function renderProcessCards(processes) {
  if (!processes.length) {
    return `<article class="panel"><h3>Sin procesos</h3><p class="panel-copy">No hay procesos PM2 que coincidan con la huella de DESARROLLOEG.</p></article>`;
  }

  return processes
    .map((proc) => {
      const state = getProcessState(proc);
      const location = proc.cwd || proc.script || "Sin ruta";

      return `
        <article class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">PM2</p>
              <h3>${escapeHtml(proc.name)}</h3>
            </div>
            ${renderBadge(state.tone, state.label)}
          </div>
          <p class="panel-copy">${escapeHtml(proc.preview)}</p>
          <dl class="meta-list">
            <div><dt>Estado</dt><dd>${escapeHtml(proc.status)}</dd></div>
            <div><dt>Ruta</dt><dd>${escapeHtml(location)}</dd></div>
            <div><dt>Script</dt><dd>${escapeHtml(proc.script || "Sin script")}</dd></div>
          </dl>
          ${renderLogBlock("stdout", proc.outLog, proc.outTail)}
          ${renderLogBlock("stderr", proc.errLog, proc.errTail)}
        </article>
      `;
    })
    .join("\n");
}

export function renderDashboardHtml(data) {
  const { summary, background } = data;
  const primaryProcess = summary.primaryProcess ? [summary.primaryProcess] : [];
  const diagnosticProcesses = [...summary.legacyAlerts, ...summary.legacyActive];
  const retiredProcesses = summary.legacyRetired;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Estado de Servicios | DESARROLLOEG</title>
  <style>
    :root {
      --bg: #f4efe8;
      --panel: rgba(255, 251, 245, 0.86);
      --panel-strong: rgba(255, 255, 255, 0.92);
      --ink: #15202b;
      --muted: #5f6d7a;
      --line: rgba(33, 49, 63, 0.12);
      --shadow: 0 18px 60px rgba(21, 32, 43, 0.08);
      --ok: #145c40;
      --ok-soft: #d9f4e7;
      --warn: #875b00;
      --warn-soft: #fff1c6;
      --fail: #9f2d30;
      --fail-soft: #fde4e4;
      --neutral: #5b6673;
      --neutral-soft: #e8edf2;
      --accent: #0f4c5c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15, 76, 92, 0.16), transparent 24%),
        radial-gradient(circle at top right, rgba(196, 138, 48, 0.18), transparent 28%),
        linear-gradient(180deg, #f0e9df 0%, #f8f4ee 48%, #efe7dc 100%);
      font-family: Bahnschrift, Aptos, "Segoe UI", sans-serif;
    }
    main {
      max-width: 1280px;
      margin: 0 auto;
      padding: 30px 18px 56px;
    }
    a { color: inherit; }
    .hero {
      position: relative;
      overflow: hidden;
      background: linear-gradient(135deg, rgba(15, 76, 92, 0.92), rgba(21, 32, 43, 0.94));
      color: #f6f8fb;
      border-radius: 28px;
      padding: 28px;
      box-shadow: var(--shadow);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .hero::after {
      content: "";
      position: absolute;
      inset: auto -8% -40% auto;
      width: 320px;
      height: 320px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255, 211, 122, 0.30), transparent 70%);
      pointer-events: none;
    }
    .hero-grid {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.9fr);
      gap: 22px;
    }
    .hero h1 {
      margin: 0;
      font-size: clamp(2rem, 4vw, 3.4rem);
      line-height: 0.95;
      letter-spacing: -0.03em;
    }
    .hero p {
      margin: 14px 0 0;
      max-width: 720px;
      color: rgba(246, 248, 251, 0.82);
      font-size: 1rem;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
    }
    .button {
      appearance: none;
      border: 0;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 11px 14px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 0.95rem;
      transition: transform 180ms ease;
    }
    .button:hover { transform: translateY(-1px); }
    .button.primary {
      background: #f4c15d;
      color: #1b1c1d;
    }
    .button.ghost {
      background: rgba(255,255,255,0.10);
      color: #f6f8fb;
      border: 1px solid rgba(255,255,255,0.12);
    }
    .hero-side {
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .hero-note {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 18px;
      padding: 16px;
    }
    .hero-note p {
      margin: 4px 0 0;
      font-size: 0.95rem;
    }
    .hero-note strong {
      display: block;
      font-size: 0.84rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(246, 248, 251, 0.72);
    }
    .summary-grid,
    .panel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }
    .summary-grid { margin-top: 18px; }
    .stat-card,
    .panel {
      background: var(--panel);
      backdrop-filter: blur(14px);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .stat-card {
      padding: 18px 18px 20px;
      border-top-width: 5px;
      border-top-style: solid;
    }
    .panel { padding: 18px; }
    .panel.accent {
      background:
        linear-gradient(180deg, rgba(15, 76, 92, 0.05), rgba(255, 255, 255, 0.72)),
        var(--panel-strong);
    }
    .tone-ok { border-top-color: var(--ok); }
    .tone-warn { border-top-color: var(--warn); }
    .tone-fail { border-top-color: var(--fail); }
    .tone-neutral { border-top-color: var(--neutral); }
    .eyebrow {
      margin: 0 0 10px;
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.11em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .stat-value {
      font-size: clamp(1.7rem, 4vw, 2.8rem);
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 0.95;
    }
    .stat-detail,
    .panel-copy,
    .section-copy {
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.45;
    }
    section { margin-top: 26px; }
    .section-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: end;
      gap: 12px;
      margin-bottom: 14px;
    }
    .section-head h2 {
      margin: 0;
      font-size: clamp(1.35rem, 2.2vw, 1.9rem);
      letter-spacing: -0.02em;
    }
    .section-head p {
      margin: 0;
      max-width: 760px;
      color: var(--muted);
    }
    .section-head strong { color: var(--ink); }
    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 14px;
    }
    .panel h3 {
      margin: 0;
      font-size: 1.18rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 7px 12px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
      border: 0;
    }
    .badge.tone-ok { color: var(--ok); background: var(--ok-soft); }
    .badge.tone-warn { color: var(--warn); background: var(--warn-soft); }
    .badge.tone-fail { color: var(--fail); background: var(--fail-soft); }
    .badge.tone-neutral { color: var(--neutral); background: var(--neutral-soft); }
    .meta-list {
      display: grid;
      gap: 10px;
      margin: 16px 0 0;
    }
    .meta-list div {
      display: grid;
      gap: 3px;
      padding-top: 10px;
      border-top: 1px dashed rgba(33, 49, 63, 0.12);
    }
    .meta-list dt {
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--muted);
    }
    .meta-list dd {
      margin: 0;
      word-break: break-word;
      line-height: 1.35;
    }
    .inline-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      color: var(--accent);
      font-weight: 800;
      text-decoration: none;
    }
    .inline-link:hover { text-decoration: underline; }
    .link-row {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
    }
    .log-block {
      margin-top: 14px;
      border-top: 1px solid rgba(33, 49, 63, 0.12);
      padding-top: 12px;
    }
    .log-block summary {
      cursor: pointer;
      font-weight: 800;
      color: var(--accent);
    }
    pre {
      margin: 12px 0 0;
      padding: 14px;
      border-radius: 16px;
      overflow: auto;
      background: #15202b;
      color: #eff5fb;
      font-size: 0.8rem;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .footer-note {
      margin-top: 18px;
      color: var(--muted);
      font-size: 0.92rem;
    }
    @media (max-width: 900px) {
      .hero-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="hero-grid">
        <div>
          <h1>Estado de Servicios</h1>
          <p>Esta pagina prioriza el estado operativo real del monolito, los servicios de fondo y la huella residual de PM2 despues de la migracion.</p>
          <div class="hero-actions">
            <a class="button primary" href="/status/status.json" target="_blank" rel="noreferrer">Ver JSON</a>
            <a class="button ghost" href="/" rel="noreferrer">Inicio</a>
            <a class="button ghost" href="/health" target="_blank" rel="noreferrer">Health</a>
            <button class="button ghost" type="button" data-refresh-now>Actualizar ahora</button>
          </div>
        </div>
        <div class="hero-side">
          <div class="hero-note">
            <strong>Actualizado</strong>
            <p>${escapeHtml(formatDateTime(data.generatedAt))}</p>
          </div>
          <div class="hero-note">
            <strong>Resumen</strong>
            <p>${escapeHtml(summary.overall.label)} / ${escapeHtml(summary.overall.detail)}</p>
          </div>
          <div class="hero-note">
            <strong>Auto refresh</strong>
            <p>La pagina se recarga en <span data-refresh-count>60</span>s.</p>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="summary-grid">
        ${renderSummaryCards(summary)}
      </div>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>Servicios Publicos</h2>
          <p class="section-copy">Se prueban los endpoints publicos que hoy representan la cara visible del monolito y sus compatibilidades de host.</p>
        </div>
      </div>
      <div class="panel-grid">
        ${renderServiceCards(data.services)}
      </div>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>Servicios De Fondo</h2>
          <p class="section-copy">Aqui vive lo que antes dependia de procesos separados: coordinacion del nodo, scheduler, jobs migrados y el bot de WhatsApp.</p>
        </div>
      </div>
      <div class="panel-grid">
        ${renderClusterCard(background.cluster)}
        ${renderSchedulerCard(background.scheduler)}
        ${renderWhatsAppCard(background.whatsappCapacitadores)}
      </div>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>Jobs Programados</h2>
          <p class="section-copy">Cada tarjeta muestra frecuencia, siguiente corrida, ultimo resultado y si el job necesita atencion.</p>
        </div>
      </div>
      <div class="panel-grid">
        ${renderJobCards(background.scheduler.jobs)}
      </div>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>PM2 Y Diagnostico</h2>
          <p class="section-copy">Los procesos <strong>stopped</strong> de abajo son legado retirado. Lo importante es que el proceso principal del monolito este sano y no haya legacy activos inesperados.</p>
        </div>
      </div>
      <div class="panel-grid">
        ${renderProcessCards(primaryProcess)}
      </div>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>Legacy Activo O Con Alertas</h2>
          <p class="section-copy">Solo se listan aqui procesos heredados que siguen corriendo o dejaron un estado distinto a <strong>stopped</strong>.</p>
        </div>
      </div>
      <div class="panel-grid">
        ${renderProcessCards(diagnosticProcesses)}
      </div>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>Procesos Retirados</h2>
          <p class="section-copy">Referencia historica de los procesos de PM2 apagados despues de la migracion. Sus logs sirven como diagnostico, pero no implican una falla actual por si solos.</p>
        </div>
      </div>
      <div class="panel-grid">
        ${renderProcessCards(retiredProcesses)}
      </div>
      <p class="footer-note">Zona horaria mostrada: ${escapeHtml(DASHBOARD_TIMEZONE)}.</p>
    </section>
  </main>

  <script>
    (function () {
      const refreshEveryMs = 60000;
      let remainingSeconds = Math.floor(refreshEveryMs / 1000);
      const counter = document.querySelector("[data-refresh-count]");
      const refreshButton = document.querySelector("[data-refresh-now]");

      function renderCountdown() {
        if (counter) counter.textContent = String(remainingSeconds);
      }

      renderCountdown();

      setInterval(function () {
        remainingSeconds = Math.max(0, remainingSeconds - 1);
        renderCountdown();
      }, 1000);

      setTimeout(function () {
        window.location.reload();
      }, refreshEveryMs);

      if (refreshButton) {
        refreshButton.addEventListener("click", function () {
          window.location.reload();
        });
      }
    })();
  </script>
</body>
</html>`;
}

