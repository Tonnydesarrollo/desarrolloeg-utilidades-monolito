import express from "express";
import { construirThumbnailDesdeLogoPath } from "../utils/drive.utils.js";
import { drive } from "../utils/drive.client.js";

const router = express.Router();

router.post("/logo-url", async (req, res) => {
  try {
    const { logoPath } = req.body;
    if (!logoPath) return res.status(400).json({ error: "logoPath requerido" });
    const url = await construirThumbnailDesdeLogoPath(drive, logoPath);
    return res.json({ url });
  } catch (err) {
    console.error("ERROR DRIVE:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
