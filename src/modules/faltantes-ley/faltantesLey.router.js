import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getFaltantesLeyData, getFaltantesLeyWorkbookBuffer } from "./faltantesLey.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

export const faltantesLeyRouter = express.Router();

function handleError(res, error, status = 500) {
  res.status(status).json({ error: error?.message || "Error interno" });
}

faltantesLeyRouter.get("/health", (_req, res) => {
  res.json({ service: "faltantes-ley", status: "ok" });
});

faltantesLeyRouter.get("/api/data", async (req, res) => {
  try {
    const query = String(req.query.q || "");
    const estado = String(req.query.estado || "todas");
    res.json(await getFaltantesLeyData(query, estado));
  } catch (error) {
    handleError(res, error);
  }
});

faltantesLeyRouter.get("/api/export.xlsx", async (req, res) => {
  try {
    const query = String(req.query.q || "");
    const estado = String(req.query.estado || "todas");
    const buffer = await getFaltantesLeyWorkbookBuffer(query, estado);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"faltantes-ley.xlsx\"");
    res.send(buffer);
  } catch (error) {
    handleError(res, error);
  }
});

faltantesLeyRouter.use(express.static(publicDir));
faltantesLeyRouter.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
