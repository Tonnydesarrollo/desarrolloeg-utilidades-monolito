import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildCartaCompromisoMunicipalPreset,
  buildCartaEntregaCuliacanPreset,
  buildCedulaSimulacroPreset,
  getWebDefaults,
  listEmpleadosSummary,
  listSucursalesSummary,
  renderSucursalDocumentHtml,
  renderSucursalDocumentPdf,
} from "./sucursalesDocs.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

export const sucursalesDocsRouter = express.Router();

function getPdfFilenameHeader(fileBaseName) {
  const fallback = `${fileBaseName}.pdf`;
  const encoded = encodeURIComponent(`${fileBaseName}.pdf`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function handleError(res, error, status = 500) {
  res.status(status).json({ error: error?.message || "Error interno" });
}

sucursalesDocsRouter.get("/health", (_req, res) => {
  res.json({ service: "sucursales-docs", status: "ok" });
});

sucursalesDocsRouter.get("/api/defaults", async (_req, res) => {
  try {
    res.json(await getWebDefaults());
  } catch (error) {
    handleError(res, error);
  }
});

sucursalesDocsRouter.get("/api/sucursales", async (req, res) => {
  try {
    res.json(await listSucursalesSummary(String(req.query.q || "")));
  } catch (error) {
    handleError(res, error);
  }
});

sucursalesDocsRouter.get("/api/empleados", async (req, res) => {
  try {
    res.json(await listEmpleadosSummary(String(req.query.q || "")));
  } catch (error) {
    handleError(res, error);
  }
});

sucursalesDocsRouter.get("/api/presets/carta-compromiso-municipal", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) {
      return handleError(res, new Error("Debes seleccionar una sucursal."), 400);
    }

    res.json(await buildCartaCompromisoMunicipalPreset(id, String(req.query.signerId || "").trim()));
  } catch (error) {
    handleError(res, error, 400);
  }
});

sucursalesDocsRouter.get("/api/presets/carta-entrega-culiacan", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) {
      return handleError(res, new Error("Debes seleccionar una sucursal."), 400);
    }

    res.json(await buildCartaEntregaCuliacanPreset(id, String(req.query.signerId || "").trim()));
  } catch (error) {
    handleError(res, error, 400);
  }
});

sucursalesDocsRouter.get("/api/presets/cedula-simulacro", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) {
      return handleError(res, new Error("Debes seleccionar una sucursal."), 400);
    }

    res.json(await buildCedulaSimulacroPreset(id));
  } catch (error) {
    handleError(res, error, 400);
  }
});

sucursalesDocsRouter.post("/api/preview", async (req, res) => {
  try {
    if (!req.body?.id) {
      return handleError(res, new Error("Debes seleccionar una sucursal."), 400);
    }

    const { html } = await renderSucursalDocumentHtml({
      id: req.body.id,
      title: req.body.title,
      subtitle: req.body.subtitle,
      bodyHtml: req.body.bodyHtml,
      templateId: req.body.templateId,
      fields: req.body.fields,
    });

    res.type("html").send(html);
  } catch (error) {
    handleError(res, error, 400);
  }
});

sucursalesDocsRouter.post("/api/pdf", async (req, res) => {
  try {
    if (!req.body?.id) {
      return handleError(res, new Error("Debes seleccionar una sucursal."), 400);
    }

    const { buffer, fileBaseName } = await renderSucursalDocumentPdf({
      id: req.body.id,
      title: req.body.title,
      subtitle: req.body.subtitle,
      bodyHtml: req.body.bodyHtml,
      templateId: req.body.templateId,
      fields: req.body.fields,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", getPdfFilenameHeader(fileBaseName));
    res.send(buffer);
  } catch (error) {
    handleError(res, error, 400);
  }
});

sucursalesDocsRouter.use(express.static(publicDir));
sucursalesDocsRouter.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
