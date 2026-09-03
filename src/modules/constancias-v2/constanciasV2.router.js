import express from "express";
import { readConstanciasContext, readLocalOperationalTable } from "../../services/localOperationalRepository.js";
import {
  resolveConstanciasDriveDestination,
  sanitizePdfFileName,
  uploadConstanciasPdf,
} from "./constanciasDrive.service.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

export const constanciasV2Router = express.Router();

constanciasV2Router.get("/health", (_req, res) => {
  res.json({ service: "constancias-v2", status: "ok" });
});

constanciasV2Router.get("/api/context", (_req, res) => {
  res.json(readConstanciasContext());
});

constanciasV2Router.get("/api/tables/:tableName", (req, res) => {
  res.json(readLocalOperationalTable(req.params.tableName));
});

constanciasV2Router.post(
  "/api/pdf/drive",
  express.raw({ type: "application/pdf", limit: "80mb" }),
  async (req, res) => {
    try {
      const pdf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        return res.status(400).json({ ok: false, error: "El archivo recibido no es un PDF valido." });
      }

      const destination = resolveConstanciasDriveDestination({
        sucursalId: req.query.sucursalId,
        sucursalLabel: req.query.sucursalLabel,
        capacitacionId: req.query.capacitacionId,
      });
      const fileName = sanitizePdfFileName(
        req.query.fileName,
        `${destination.sucursalLabel} DIP.pdf`,
      );
      const file = await uploadConstanciasPdf({ buffer: pdf, fileName, destination });

      return res.status(201).json({ ok: true, file, destination });
    } catch (error) {
      const knownError = String(error?.code || "").startsWith("CONSTANCIAS_");
      console.error("[constancias-drive] No se pudo guardar el PDF:", error);
      return res.status(knownError ? 422 : 502).json({
        ok: false,
        error: knownError ? error.message : "Google Drive rechazo el archivo. Revisa la sesion del servicio.",
      });
    }
  },
);

constanciasV2Router.get("/capacitaciones/:capacitacionId/HTML", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

constanciasV2Router.get(["/plantilla-blanca/HTML", "/blanco/HTML", "/constancia-blanca/HTML"], (_req, res) => {
  res.sendFile(path.join(publicDir, "constancia_blanca.html"));
});

constanciasV2Router.use(express.static(publicDir));
constanciasV2Router.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
constanciasV2Router.get("/*splat", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
