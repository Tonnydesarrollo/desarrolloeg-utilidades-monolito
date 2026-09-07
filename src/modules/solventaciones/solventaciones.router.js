import express from "express";
import puppeteer from "puppeteer-core";
import {
  obtenerSistemaPcResumen,
  obtenerSolventacionesCompleto,
  prepararSolventacionesPdf,
} from "./solventaciones.service.js";

export const solventacionesRouter = express.Router();
let pdfBrowserPromise = null;

function getChromePath() {
  if (process.env.CHROME_PATH && String(process.env.CHROME_PATH).trim()) {
    return String(process.env.CHROME_PATH).trim();
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "/usr/bin/chromium";
}

async function getPdfBrowser() {
  if (!pdfBrowserPromise) {
    pdfBrowserPromise = puppeteer.launch({
      executablePath: getChromePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    }).then((browser) => {
      browser.once("disconnected", () => {
        pdfBrowserPromise = null;
      });
      return browser;
    }).catch((error) => {
      pdfBrowserPromise = null;
      throw error;
    });
  }

  return pdfBrowserPromise;
}

function buildPdfFilename(reporte) {
  const parts = ["SOLVENTACIONES"];
  if (reporte?.filtros?.tienda) parts.push(`TIENDA ${reporte.filtros.tienda}`);
  if (reporte?.filtros?.razonSocial) parts.push(reporte.filtros.razonSocial);
  if (reporte?.filtros?.municipio) parts.push(reporte.filtros.municipio);
  if (reporte?.filtros?.year) parts.push(String(reporte.filtros.year));
  if (reporte?.filtros?.solicitudIds?.length > 1) parts.push(`${reporte.filtros.solicitudIds.length} SUCURSALES`);
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

solventacionesRouter.get("/api/overview", async (req, res) => {
  try {
    const data = await obtenerSistemaPcResumen(req.query);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, data });
  } catch (err) {
    console.error("ERROR EN /solventaciones/api/overview:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

solventacionesRouter.get("/html", (req, res) => {
  const embedded = String(req.query.embed || "").trim() === "1";
  res.render("solventaciones_system", { currentYear: new Date().getFullYear(), embedded });
});

solventacionesRouter.get("/report", async (req, res) => {
  try {
    const reporte = await obtenerSolventacionesCompleto(req.query);
    res.render("solventaciones", { reporte, filtros: reporte.filtros });
  } catch (err) {
    console.error("ERROR EN /solventaciones/report:", err);
    res.status(500).send("Error al generar el reporte");
  }
});

solventacionesRouter.get("/pdf", async (req, res) => {
  const startedAt = performance.now();
  try {
    const reporteBase = await obtenerSolventacionesCompleto(req.query);
    const reportReadyAt = performance.now();
    const reporte = await prepararSolventacionesPdf(reporteBase);
    const imagesReadyAt = performance.now();
    const baseUrl = getPublicOrigin(req);
    const html = await new Promise((resolve, reject) => {
      res.app.render("solventaciones_pdf", { reporte, filtros: reporte.filtros, baseUrl }, (err, rendered) => {
        if (err) reject(err);
        else resolve(rendered);
      });
    });
    const htmlReadyAt = performance.now();

    const browser = await getPdfBrowser();
    const browserReadyAt = performance.now();
    let page = null;
    try {
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(30_000);
      await page.setJavaScriptEnabled(false);
      await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
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
      const pdfReadyAt = performance.now();

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", getPdfContentDisposition(buildPdfFilename(reporte)));
      res.setHeader("Server-Timing", [
        `report;dur=${(reportReadyAt - startedAt).toFixed(1)}`,
        `images;dur=${(imagesReadyAt - reportReadyAt).toFixed(1)}`,
        `template;dur=${(htmlReadyAt - imagesReadyAt).toFixed(1)}`,
        `browser;dur=${(browserReadyAt - htmlReadyAt).toFixed(1)}`,
        `render;dur=${(pdfReadyAt - browserReadyAt).toFixed(1)}`,
      ].join(", "));
      res.send(Buffer.from(pdfBytes));
    } finally {
      if (page) await page.close().catch(() => {});
    }
  } catch (err) {
    console.error("ERROR EN /solventaciones/pdf:", err);
    res.status(500).send("Error al generar PDF");
  }
});
