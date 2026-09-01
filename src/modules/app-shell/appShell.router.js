import express from "express";
import { getAppShellManifest } from "../../services/appShellManifest.js";
import { getAppShellAuditState } from "../../services/appShellAuditReconciler.js";
import { refreshAppShellCaches } from "../../services/appShellRefresh.js";

export const appShellRouter = express.Router();

const appShellEventClients = new Set();
let appShellEventRevision = 0;
const appShellRevisionByScope = new Map();
let appShellEventUpdatedAt = null;

function sseSend(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function shouldNotifyClient(clientScope, payload) {
  const scope = String(payload?.scope || "all").trim().toLowerCase();
  const refreshedScopes = Array.isArray(payload?.refreshedScopes)
    ? payload.refreshedScopes.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];

  if (clientScope === "all" || scope === "all") return true;
  if (scope === clientScope) return true;
  return refreshedScopes.includes(clientScope);
}

function getAffectedScopes(payload) {
  const scope = String(payload?.scope || "all").trim().toLowerCase() || "all";
  const scopes = new Set([scope, "all"]);
  if (scope === "all") {
    scopes.add("portal");
    scopes.add("facturacion");
  }
  for (const value of Array.isArray(payload?.refreshedScopes) ? payload.refreshedScopes : []) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized) scopes.add(normalized);
  }
  return scopes;
}

function getAppShellLiveState(scope = "all") {
  const normalizedScope = String(scope || "all").trim().toLowerCase() || "all";
  return {
    ...getAppShellAuditState(normalizedScope),
    revision: Number(appShellRevisionByScope.get(normalizedScope) || 0),
    eventUpdatedAt: appShellEventUpdatedAt,
  };
}

function broadcastAppShellEvent(payload) {
  const sentAt = new Date().toISOString();
  appShellEventRevision += 1;
  appShellEventUpdatedAt = sentAt;
  for (const scope of getAffectedScopes(payload)) {
    appShellRevisionByScope.set(scope, appShellEventRevision);
  }
  const eventPayload = {
    ...payload,
    revision: appShellEventRevision,
    sentAt,
  };
  for (const client of appShellEventClients) {
    if (!shouldNotifyClient(client.scope, eventPayload)) continue;
    try {
      sseSend(client.res, "app-shell-cache", eventPayload);
    } catch {
      appShellEventClients.delete(client);
    }
  }
  return eventPayload;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeWebhookTable(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function scopeForWebhookTable(tableName = "") {
  const table = normalizeWebhookTable(tableName);
  if (["EMPLEADOS", "CAPACITACIONES", "CALENDARIO"].includes(table)) return "portal";
  if ([
    "EMPRESAS",
    "SUCURSALES",
    "MUNICIPIOS",
    "ESTADOS",
    "STATUS SISTEMA PC",
  ].includes(table)) return "all";
  if ([
    "CATALOGO",
    "PROVEEDORES",
    "COTIZACIONES_VARIOS_CT",
    "CONCEPTOS_VARIOS_CT",
    "ESTATALES",
    "MUNICIPALES",
  ].includes(table)) return "facturacion";
  return "all";
}

function isAuthorizedWebhook(req) {
  const expected = String(
    process.env.APPSHEET_WEBHOOK_SECRET
    || process.env.DESARROLLOEG_SYNC_WEBHOOK_SECRET
    || "",
  ).trim();
  if (!expected) return true;
  const provided = String(
    req.get("x-appsheet-webhook-secret")
    || req.get("x-webhook-secret")
    || req.query.secret
    || req.body?.secret
    || "",
  ).trim();
  return provided === expected;
}

function renderModuleCard(module) {
  return `
    <a class="module-card" href="${escapeHtml(module.path)}">
      <div class="module-card__head">
        <span class="module-card__eyebrow">Modulo</span>
        ${module.priority ? `<span class="module-card__priority">${escapeHtml(module.priority)}</span>` : ""}
      </div>
      <strong>${escapeHtml(module.title)}</strong>
      <p>${escapeHtml(module.description)}</p>
      <span class="module-card__link">Abrir</span>
    </a>
  `;
}

function renderShellHtml(manifest) {
  const cacheLayersHtml = manifest.cacheLayers
    .map(
      (layer) => `
        <article class="panel">
          <span class="eyebrow">${escapeHtml(layer.title)}</span>
          <p>${escapeHtml(layer.description)}</p>
        </article>
      `,
    )
    .join("");

  const moduleGroupsHtml = manifest.moduleGroups
    .map(
      (group) => `
        <section class="group">
          <div class="group__head">
            <h2>${escapeHtml(group.title)}</h2>
            <span>${group.modules.length} modulos</span>
          </div>
          <div class="group__grid">
            ${group.modules.map(renderModuleCard).join("")}
          </div>
        </section>
      `,
    )
    .join("");

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(manifest.brand.name)} Shell</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #f5f7fa;
          --surface: #ffffff;
          --surface-soft: #f8fafc;
          --text: #15202b;
          --muted: #5f6d7a;
          --line: rgba(21, 32, 43, 0.1);
          --accent: ${escapeHtml(manifest.brand.accent)};
          --secondary: ${escapeHtml(manifest.brand.secondary)};
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Inter, Arial, sans-serif;
          background: radial-gradient(circle at top, rgba(29, 78, 216, 0.08), transparent 32%), var(--bg);
          color: var(--text);
        }
        a { color: inherit; text-decoration: none; }
        .shell {
          max-width: 1320px;
          margin: 0 auto;
          padding: 24px;
        }
        .hero {
          display: grid;
          grid-template-columns: 1.4fr 0.9fr;
          gap: 20px;
          align-items: stretch;
          margin-bottom: 24px;
        }
        .hero__main, .panel, .module-card, .hero__side {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 24px;
          box-shadow: 0 16px 50px rgba(15, 23, 42, 0.08);
        }
        .hero__main {
          padding: 28px;
        }
        .hero__side {
          padding: 24px;
          display: grid;
          gap: 12px;
        }
        .eyebrow {
          display: inline-flex;
          gap: 8px;
          align-items: center;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.75rem;
          color: var(--secondary);
          font-weight: 700;
        }
        h1, h2, h3, p { margin: 0; }
        h1 {
          margin-top: 12px;
          font-size: clamp(2rem, 4vw, 3.5rem);
          line-height: 1.05;
        }
        .hero__main p, .panel p, .module-card p {
          color: var(--muted);
          line-height: 1.5;
        }
        .hero__actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 20px;
        }
        .button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 44px;
          padding: 0 18px;
          border-radius: 999px;
          border: 1px solid var(--line);
          font-weight: 700;
          background: var(--surface-soft);
        }
        .button--primary {
          background: linear-gradient(135deg, var(--accent), var(--secondary));
          color: white;
          border-color: transparent;
        }
        .stats {
          display: grid;
          gap: 10px;
        }
        .stats strong {
          font-size: 1.9rem;
        }
        .cache-grid, .group__grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }
        .section {
          margin-top: 24px;
        }
        .section h2 {
          margin-bottom: 14px;
          font-size: 1.2rem;
        }
        .panel, .module-card {
          padding: 18px;
        }
        .module-card {
          display: grid;
          gap: 10px;
          min-height: 150px;
        }
        .module-card__head {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: center;
        }
        .module-card__eyebrow, .module-card__link, .module-card__priority {
          font-size: 0.8rem;
          color: var(--secondary);
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .module-card__priority {
          color: var(--accent);
        }
        .module-card strong {
          font-size: 1.05rem;
        }
        .group {
          margin-top: 24px;
        }
        .group__head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: end;
          margin-bottom: 12px;
        }
        .group__head span {
          color: var(--muted);
          font-size: 0.92rem;
        }
        .meta {
          display: grid;
          gap: 10px;
          font-size: 0.95rem;
          color: var(--muted);
        }
        @media (max-width: 960px) {
          .hero {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <main class="shell">
        <section class="hero">
          <div class="hero__main">
            <span class="eyebrow">${escapeHtml(manifest.brand.subtitle)}</span>
            <h1>${escapeHtml(manifest.brand.name)}</h1>
            <p>Base principal en AppSheet, cache persistente en backend y frontend por AJAX. Esta pagina es el punto de partida para adaptar la experiencia visual y la estructura de modulo.</p>
            <div class="hero__actions">
              <a class="button button--primary" href="${escapeHtml(manifest.layout.homePath)}">Ir al portal</a>
              <a class="button" href="${escapeHtml(manifest.layout.apiManifestPath)}">Ver manifiesto JSON</a>
            </div>
          </div>
          <aside class="hero__side">
            <div class="stats">
              <span class="eyebrow">Runtime</span>
              <strong>${escapeHtml(manifest.runtime.release?.version || "local")}</strong>
              <p>${escapeHtml(manifest.runtime.cluster?.status || "cluster no reportado")}</p>
            </div>
            <div class="meta">
              <span>Background: ${escapeHtml(manifest.runtime.background?.status || "unknown")}</span>
              <span>Cache API: ${escapeHtml(manifest.layout.apiManifestPath)}</span>
              <span>Home: ${escapeHtml(manifest.layout.homePath)}</span>
            </div>
          </aside>
        </section>

        <section class="section">
          <h2>Capas de cache</h2>
          <div class="cache-grid">
            ${cacheLayersHtml}
          </div>
        </section>

        ${moduleGroupsHtml}
      </main>
    </body>
  </html>`;
}

appShellRouter.get("/manifest", (_req, res) => {
  res.json(getAppShellManifest());
});

appShellRouter.post("/cache/refresh", async (req, res) => {
  try {
    const scope = String(req.query.scope || req.body?.scope || "all").trim();
    const runAsUserEmail = String(req.body?.runAsUserEmail || "").trim();
    const result = await refreshAppShellCaches({ scope, runAsUserEmail });
    const state = getAppShellAuditState(scope);
    broadcastAppShellEvent({
      ok: true,
      triggeredBy: "manual-refresh",
      scope,
      cursor: state.cursor,
      updatedAt: state.updatedAt,
      refreshedScopes: result?.results?.flatMap((entry) => entry?.refreshedScopes || entry?.scope || []) || [],
      refresh: result,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "No se pudo actualizar la caché compartida.",
    });
  }
});

appShellRouter.get("/cache/state", (req, res) => {
  const scope = String(req.query.scope || "all").trim();
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.json(getAppShellLiveState(scope));
});

appShellRouter.get("/events", (req, res) => {
  const scope = String(req.query.scope || "all").trim().toLowerCase() || "all";
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const client = {
    scope,
    res,
  };
  appShellEventClients.add(client);
  sseSend(res, "init", {
    ...getAppShellLiveState(scope),
    event: "init",
    sentAt: new Date().toISOString(),
  });

  const heartbeat = setInterval(() => {
    try {
      sseSend(res, "heartbeat", {
        ok: true,
        scope,
        sentAt: new Date().toISOString(),
      });
    } catch {
      clearInterval(heartbeat);
      appShellEventClients.delete(client);
    }
  }, 25000);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    appShellEventClients.delete(client);
  });
});

appShellRouter.post("/webhook", async (req, res) => {
  if (!isAuthorizedWebhook(req)) {
    return res.status(401).json({ ok: false, error: "Webhook no autorizado." });
  }

  try {
    const table = String(req.body?.table || req.body?.tabla || req.body?.TableName || req.body?.Table || "").trim();
    const scope = scopeForWebhookTable(table);
    const runAsUserEmail = String(req.body?.runAsUserEmail || "").trim();
    const result = await refreshAppShellCaches({ scope, runAsUserEmail, mode: "auto" });
    const state = getAppShellAuditState(scope);
    broadcastAppShellEvent({
      ok: true,
      triggeredBy: "webhook",
      table: normalizeWebhookTable(table),
      scope,
      cursor: state.cursor,
      updatedAt: state.updatedAt,
      refreshedScopes: result?.results?.flatMap((entry) => entry?.refreshedScopes || entry?.scope || []) || [],
      refresh: result,
    });
    res.json({
      ok: true,
      triggeredBy: "webhook",
      table: normalizeWebhookTable(table),
      scope,
      state: getAppShellLiveState(scope),
      refresh: result,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "No se pudo procesar el webhook de cache.",
    });
  }
});

appShellRouter.get("/", (_req, res) => {
  const manifest = getAppShellManifest();
  res.type("html").send(renderShellHtml(manifest));
});
