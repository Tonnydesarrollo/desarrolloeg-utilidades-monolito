import express from "express";
import multer from "multer";
import { analyzePipcPdf, renderSplitPipcHtml, splitPipcPdfToZip } from "./separarPipc.service.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
export const separarPipcRouter = express.Router();

function handleError(res, error, status = 500) {
  res.status(status).json({ error: error instanceof Error ? error.message : "Error interno" });
}

function getAttachmentHeader(fileBaseName) {
  const fallback = `${fileBaseName}.zip`;
  const encoded = encodeURIComponent(fallback);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

separarPipcRouter.get("/health", (_req, res) => {
  res.json({ service: "separar-pipc", status: "ok" });
});

separarPipcRouter.get("/", (_req, res) => {
  res.type("html").send(renderSplitPipcHtml());
});

separarPipcRouter.post("/api/preview", upload.single("sourceDocument"), async (req, res) => {
  try {
    const analysis = await analyzePipcPdf(req.file);
    res.json(analysis);
  } catch (error) {
    handleError(res, error, 400);
  }
});

separarPipcRouter.post("/api/split", upload.single("sourceDocument"), async (req, res) => {
  try {
    const { zipBuffer, fileBaseName } = await splitPipcPdfToZip(req.file);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", getAttachmentHeader(fileBaseName || "separar-pipc"));
    res.send(zipBuffer);
  } catch (error) {
    handleError(res, error, 400);
  }
});
