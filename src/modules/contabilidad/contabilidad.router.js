import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getContabilidadOverview,
  normalizeTicketScanPayload,
  renderContabilidadHtml,
} from "./contabilidad.service.js";

export const contabilidadRouter = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

contabilidadRouter.use(express.json());

contabilidadRouter.get(["/", ""], (_req, res) => {
  const data = getContabilidadOverview();
  res.type("html").send(renderContabilidadHtml(data));
});

contabilidadRouter.get("/health", (_req, res) => {
  res.json({ service: "contabilidad", status: "ok" });
});

contabilidadRouter.get("/status.json", (_req, res) => {
  res.json(getContabilidadOverview());
});

contabilidadRouter.get("/client.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "contabilidad.client.js"));
});

contabilidadRouter.post("/tickets/scan", (req, res) => {
  const result = normalizeTicketScanPayload(req.body);

  if (!result.ok) {
    return res.status(result.status).json({
      ok: false,
      error: result.error,
    });
  }

  return res.json({
    ok: true,
    message:
      "Ticket recibido correctamente. La captura ya quedo lista para el siguiente paso de extraccion.",
    ticket: result.payload,
  });
});
