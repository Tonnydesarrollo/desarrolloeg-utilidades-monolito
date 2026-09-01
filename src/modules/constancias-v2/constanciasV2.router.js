import express from "express";
import { readConstanciasContext, readLocalOperationalTable } from "../../services/localOperationalRepository.js";
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
