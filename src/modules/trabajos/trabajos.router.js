import express from "express";
import { getTrabajoTableName, obtenerTrabajosResumen } from "./trabajos.service.js";

export const trabajosRouter = express.Router();

trabajosRouter.get("/api/:tipo", (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, data: obtenerTrabajosResumen(req.params.tipo, req.query) });
  } catch (error) {
    res.status(getTrabajoTableName(req.params.tipo) ? 500 : 404).json({ ok: false, error: error instanceof Error ? error.message : "Error interno" });
  }
});

trabajosRouter.get("/:tipo", (req, res) => {
  if (!getTrabajoTableName(req.params.tipo)) return res.status(404).send("Trabajo no encontrado");
  res.render("trabajos", {
    tipo: req.params.tipo.toLowerCase(),
    embedded: String(req.query.embed || "") === "1",
  });
});
