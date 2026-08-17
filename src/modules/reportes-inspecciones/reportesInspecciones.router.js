import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  getReportDefaults,
  listSucursalesConInspecciones,
  renderInspectionReportHtml,
  renderInspectionReportPdf,
} from "./reportesInspecciones.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

export const reportesInspeccionesRouter = express.Router();

function getPdfFilenameHeader(fileBaseName) {
  const fallback = `${fileBaseName}.pdf`;
  const encoded = encodeURIComponent(`${fileBaseName}.pdf`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function handleError(res, error, status = 500) {
  res.status(status).json({ error: error?.message || "Error interno" });
}

reportesInspeccionesRouter.get("/health", (_req, res) => {
  res.json({ service: "reportes-inspecciones", status: "ok" });
});

reportesInspeccionesRouter.get("/api/defaults", async (_req, res) => {
  try {
    res.json(await getReportDefaults());
  } catch (error) {
    handleError(res, error);
  }
});

reportesInspeccionesRouter.get("/api/sucursales", async (req, res) => {
  try {
    const period = String(req.query.period || "last12months");
    const year = String(req.query.year || "");
    const q = String(req.query.q || "");
    res.json(await listSucursalesConInspecciones({ period, year, q }));
  } catch (error) {
    handleError(res, error);
  }
});

reportesInspeccionesRouter.post("/api/preview", async (req, res) => {
  try {
    if (!req.body?.id) {
      return handleError(res, new Error("Debes seleccionar una sucursal."), 400);
    }

    const { html } = await renderInspectionReportHtml({
      id: req.body.id,
      period: req.body.period,
      year: req.body.year,
    });
    res.type("html").send(html);
  } catch (error) {
    handleError(res, error, 400);
  }
});

reportesInspeccionesRouter.post("/api/pdf", async (req, res) => {
  try {
    if (!req.body?.id) {
      return handleError(res, new Error("Debes seleccionar una sucursal."), 400);
    }

    const { buffer, fileBaseName } = await renderInspectionReportPdf({
      id: req.body.id,
      period: req.body.period,
      year: req.body.year,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", getPdfFilenameHeader(fileBaseName));
    res.send(buffer);
  } catch (error) {
    handleError(res, error, 400);
  }
});

reportesInspeccionesRouter.use(express.static(publicDir));
reportesInspeccionesRouter.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
