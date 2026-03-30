import express from "express";
import { descargarPdf, descargarXml } from "./services/clubfactura.download.js";

export const clubfacturaDownloadProxyRouter = express.Router();

function sendError(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function isAuthorized(req) {
  const requiredKey = process.env.FACTURAS_DOWNLOAD_PROXY_KEY || process.env.DOWNLOAD_PROXY_KEY;
  if (!requiredKey) return true;
  return String(req.query.key || "") === requiredKey;
}

async function pipeDownload(res, response) {
  const { status, headers, data } = response;
  res.status(status);
  if (headers?.["content-type"]) {
    res.setHeader("Content-Type", headers["content-type"]);
  }
  if (headers?.["content-disposition"]) {
    res.setHeader("Content-Disposition", headers["content-disposition"]);
  }
  res.send(Buffer.from(data));
}

async function handleDownload(req, res, downloader) {
  try {
    if (!isAuthorized(req)) {
      return sendError(res, 401, { error: "Unauthorized" });
    }

    const id = String(req.params.id || "").trim();
    if (!/^\d+$/.test(id)) {
      return sendError(res, 400, { error: "ID invalido" });
    }

    const response = await downloader(id);
    return pipeDownload(res, response);
  } catch (error) {
    const status = error?.response?.status ?? 500;
    const data = error?.response?.data;

    if (Buffer.isBuffer(data)) {
      res.status(status);
      res.setHeader("Content-Type", "application/octet-stream");
      return res.send(data);
    }

    return sendError(res, status, {
      error: error?.message || "Unknown error",
      details: data ?? null,
    });
  }
}

clubfacturaDownloadProxyRouter.get("/health", (_req, res) => {
  res.json({ service: "clubfactura-download-proxy", status: "ok" });
});

clubfacturaDownloadProxyRouter.get("/xml/:id", async (req, res) => {
  await handleDownload(req, res, descargarXml);
});

clubfacturaDownloadProxyRouter.get("/pdf/:id", async (req, res) => {
  await handleDownload(req, res, descargarPdf);
});
