import express from "express";

export const bolsaSyncRouter = express.Router();

const DEFAULT_TARGET = "http://127.0.0.1:8787";

function getTargetBaseUrl() {
  return String(process.env.BOLSA_SYNC_WEBHOOK_TARGET || DEFAULT_TARGET).replace(/\/+$/, "");
}

function getSharedSecret() {
  return process.env.BOLSA_SYNC_WEBHOOK_SECRET || process.env.APPSHEET_WEBHOOK_SECRET || "";
}

function sameSecret(left, right) {
  return left && right && String(left) === String(right);
}

function isAuthorized(req) {
  const expected = getSharedSecret();
  if (!expected) return false;

  const provided =
    req.get("x-webhook-secret") ||
    req.get("x-appsheet-webhook-secret") ||
    req.query.secret;

  return sameSecret(provided, expected);
}

async function forwardToSyncService(req, path) {
  const targetUrl = `${getTargetBaseUrl()}${path}`;
  const secret = getSharedSecret();

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-webhook-secret": secret,
    },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body ?? {}),
  });

  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  return { status: response.status, body };
}

bolsaSyncRouter.get("/health", async (_req, res) => {
  try {
    const response = await fetch(`${getTargetBaseUrl()}/health`);
    const body = await response.json().catch(() => ({}));
    res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      proxy: "bolsa-sync",
      target: response.ok ? "reachable" : "unhealthy",
      service: body,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      proxy: "bolsa-sync",
      target: "unreachable",
      error: error.message,
    });
  }
});

bolsaSyncRouter.post("/webhooks/appsheet", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const forwarded = await forwardToSyncService(req, "/webhooks/appsheet");
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudo reenviar el webhook al servicio local de bolsa",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.get("/webhooks/appsheet/events", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const forwarded = await forwardToSyncService(req, "/webhooks/appsheet/events");
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudo consultar eventos del servicio local de bolsa",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.get("/local/solicitudes-vacantes", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const forwarded = await forwardToSyncService(req, "/local/solicitudes-vacantes");
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudieron consultar las solicitudes centrales de vacantes",
      detail: error.message,
    });
  }
});
