import express from "express";
import puppeteer from "puppeteer-core";
import { obtenerSolventacionesCompleto, prepararSolventacionesPdf } from "./solventaciones.service.js";

export const solventacionesRouter = express.Router();

function getChromePath() {
  if (process.env.CHROME_PATH && String(process.env.CHROME_PATH).trim()) {
    return String(process.env.CHROME_PATH).trim();
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "/usr/bin/chromium";
}

function buildPdfFilename(reporte) {
  const parts = ["SOLVENTACIONES"];
  if (reporte?.filtros?.tienda) parts.push(`TIENDA ${reporte.filtros.tienda}`);
  if (reporte?.filtros?.razonSocial) parts.push(reporte.filtros.razonSocial);
  if (reporte?.filtros?.municipio) parts.push(reporte.filtros.municipio);
  const raw = `${parts.filter(Boolean).join(" - ")}.pdf`;
  return raw.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

function getPdfContentDisposition(fileName) {
  const fallback = fileName || "solventaciones.pdf";
  const encoded = encodeURIComponent(fallback);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function getPublicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();
  if (host) return `${proto}://${host}`;
  return "https://apps.desarrolloeg.com";
}

solventacionesRouter.get("/health", (_req, res) => {
  res.json({ service: "solventaciones", status: "ok" });
});

solventacionesRouter.get(["/", ""], (_req, res) => {
  res.redirect("/solventaciones/html");
});

solventacionesRouter.get("/html-data", async (req, res) => {
  try {
    const data = await obtenerSolventacionesCompleto(req.query);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("ERROR EN /solventaciones/html-data:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

solventacionesRouter.get("/html", async (req, res) => {
  try {
    const reporte = await obtenerSolventacionesCompleto(req.query);
    res.render("solventaciones", {
      reporte,
      filtros: reporte.filtros,
    });
  } catch (err) {
    console.error("ERROR EN /solventaciones/html:", err);
    res.status(500).send("Error");
  }
});

solventacionesRouter.get("/pdf", async (req, res) => {
  try {
    const reporteBase = await obtenerSolventacionesCompleto(req.query);
    const reporte = await prepararSolventacionesPdf(reporteBase);
    const baseUrl = getPublicOrigin(req);
    const html = await new Promise((resolve, reject) => {
      res.app.render("solventaciones_pdf", { reporte, filtros: reporte.filtros, baseUrl }, (err, rendered) => {
        if (err) reject(err);
        else resolve(rendered);
      });
    });

    const chromePath = getChromePath();
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(120000);
      await page.setContent(html, { waitUntil: "networkidle0" });
      await page.emulateMediaType("screen");
      const pdfBytes = await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: {
          top: "0.18in",
          right: "0.18in",
          bottom: "0.20in",
          left: "0.18in",
        },
        preferCSSPageSize: true,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", getPdfContentDisposition(buildPdfFilename(reporte)));
      res.send(Buffer.from(pdfBytes));
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error("ERROR EN /solventaciones/pdf:", err);
    res.status(500).send("Error al generar PDF");
  }
});
