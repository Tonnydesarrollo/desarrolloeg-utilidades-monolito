import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import { google } from "googleapis";

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

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createDriveSignature(fileId) {
  const secret = getSharedSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(String(fileId)).digest("hex");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createOAuthDriveClient(credentialsPath, tokenPath) {
  const credentials = readJsonFile(credentialsPath);
  const token = readJsonFile(tokenPath);
  const oauthConfig = credentials.installed || credentials.web || credentials;
  const client = new google.auth.OAuth2(
    oauthConfig.client_id,
    oauthConfig.client_secret,
    oauthConfig.redirect_uris?.[0],
  );
  client.setCredentials(token);
  return google.drive({ version: "v3", auth: client });
}

function getDriveClients() {
  const candidates = [
    [
      process.env.FACTURACION_GOOGLE_CREDENTIALS_PATH,
      process.env.FACTURACION_GOOGLE_TOKEN_PATH,
    ],
    [
      process.env.PEDIDOS_GOOGLE_CLIENT_CREDENTIALS,
      process.env.PEDIDOS_GOOGLE_TOKEN_PATH,
    ],
  ];

  return candidates
    .filter(([credentialsPath, tokenPath]) => credentialsPath && tokenPath)
    .map(([credentialsPath, tokenPath]) =>
      createOAuthDriveClient(credentialsPath, tokenPath),
    );
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

async function forwardAuthorizedLocalGet(req, res, path, errorMessage) {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const forwarded = await forwardToSyncService(req, path);
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: errorMessage,
      detail: error.message,
    });
  }
}

bolsaSyncRouter.get("/local/empresas", async (req, res) => {
  await forwardAuthorizedLocalGet(
    req,
    res,
    "/local/empresas",
    "No se pudieron consultar las empresas centrales",
  );
});

bolsaSyncRouter.get("/local/vacantes", async (req, res) => {
  await forwardAuthorizedLocalGet(
    req,
    res,
    "/local/vacantes",
    "No se pudieron consultar las vacantes centrales",
  );
});

bolsaSyncRouter.get("/local/alumnos", async (req, res) => {
  await forwardAuthorizedLocalGet(
    req,
    res,
    "/local/alumnos",
    "No se pudieron consultar los alumnos centrales",
  );
});

bolsaSyncRouter.get("/local/solicitudes-vacantes", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const status = req.query.status ? `?status=${encodeURIComponent(String(req.query.status))}` : "";
    const forwarded = await forwardToSyncService(req, `/local/solicitudes-vacantes${status}`);
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudieron consultar las solicitudes centrales de vacantes",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.get("/local/solicitudes-empresas", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const status = req.query.status ? `?status=${encodeURIComponent(String(req.query.status))}` : "";
    const forwarded = await forwardToSyncService(req, `/local/solicitudes-empresas${status}`);
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudieron consultar las solicitudes centrales de empresas",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.post("/local/solicitudes-empresas/:id/aprobar", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const id = encodeURIComponent(String(req.params.id || ""));
    const forwarded = await forwardToSyncService(req, `/local/solicitudes-empresas/${id}/aprobar`);
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudo aprobar la solicitud central de empresa",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.get("/local/solicitudes-alta", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const status = req.query.status ? `?status=${encodeURIComponent(String(req.query.status))}` : "";
    const forwarded = await forwardToSyncService(req, `/local/solicitudes-alta${status}`);
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudieron consultar las solicitudes centrales de alta",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.post("/local/solicitudes-alta/:id/aprobar", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const id = encodeURIComponent(String(req.params.id || ""));
    const forwarded = await forwardToSyncService(req, `/local/solicitudes-alta/${id}/aprobar`);
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudo aprobar la solicitud central de alta",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.post("/local/solicitudes-vacantes/:id/aprobar", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const id = encodeURIComponent(String(req.params.id || ""));
    const forwarded = await forwardToSyncService(req, `/local/solicitudes-vacantes/${id}/aprobar`);
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudo aprobar la solicitud central de vacante",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.post("/local/solicitudes-vacantes/:id/rechazar", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  try {
    const id = encodeURIComponent(String(req.params.id || ""));
    const forwarded = await forwardToSyncService(req, `/local/solicitudes-vacantes/${id}/rechazar`);
    res.status(forwarded.status).json(forwarded.body);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: "No se pudo rechazar la solicitud central de vacante",
      detail: error.message,
    });
  }
});

bolsaSyncRouter.get("/drive-image/:fileId", async (req, res) => {
  const fileId = String(req.params.fileId || "").trim();
  const expectedSignature = createDriveSignature(fileId);

  if (!fileId || !safeEqual(req.query.sig, expectedSignature)) {
    res.status(401).json({ ok: false, error: "No autorizado" });
    return;
  }

  for (const drive of getDriveClients()) {
    try {
      const metadata = await drive.files.get({
        fileId,
        fields: "name,mimeType,size",
      });
      const media = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream" },
      );

      res.setHeader("Content-Type", metadata.data.mimeType || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (metadata.data.size) {
        res.setHeader("Content-Length", metadata.data.size);
      }
      media.data.pipe(res);
      return;
    } catch {
      // Try the next configured Drive identity.
    }
  }

  res.status(404).json({ ok: false, error: "Logo no encontrado" });
});
