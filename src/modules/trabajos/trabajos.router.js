import express from "express";
import { getTrabajoTableName, obtenerTrabajosResumen } from "./trabajos.service.js";
import { updateTrabajo } from "./trabajos.mutations.service.js";
import { loadAuthenticatedEmployee } from "../home/portalAuth.service.js";

export const trabajosRouter = express.Router();

trabajosRouter.get("/api/:tipo", (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, data: obtenerTrabajosResumen(req.params.tipo, req.query) });
  } catch (error) {
    res.status(getTrabajoTableName(req.params.tipo) ? 500 : 404).json({ ok: false, error: error instanceof Error ? error.message : "Error interno" });
  }
});

trabajosRouter.patch("/api/:tipo/:rowId", express.json(), async (req, res) => {
  try {
    const user = await loadAuthenticatedEmployee(req);
    if (!user) return res.status(401).json({ ok: false, error: "No autenticado" });
    if (user.role !== "admin") return res.status(403).json({ ok: false, error: "No tienes permiso para editar trabajos." });
    await updateTrabajo(req.params.tipo, req.params.rowId, req.body || {});
    res.set("Cache-Control", "no-store");
    res.json({ ok: true });
  } catch (error) {
    res.status(getTrabajoTableName(req.params.tipo) ? 422 : 404).json({ ok: false, error: error instanceof Error ? error.message : "No se pudo actualizar" });
  }
});

trabajosRouter.get("/:tipo", (req, res) => {
  if (!getTrabajoTableName(req.params.tipo)) return res.status(404).send("Trabajo no encontrado");
  res.render("trabajos", {
    tipo: req.params.tipo.toLowerCase(),
    embedded: String(req.query.embed || "") === "1",
  });
});
