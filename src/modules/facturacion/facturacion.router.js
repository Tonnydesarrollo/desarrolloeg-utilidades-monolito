import express from "express";
import puppeteer from "puppeteer-core";
import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "node:crypto";
import { getCompanyAddress } from "../../config/company.js";
import driveRoutes from "./routes/drive.js";
import { construirDataHTML } from "./services/construirDataHTML.js";
import { prepararCotizacionDataParaPdf } from "./services/cotizacionPdfImages.js";
import { getPedidosLeyBranchOrderCoverage } from "../pedidos-ley/services/pedidosLey.js";
import {
  guardarCotizacion,
  listarCotizaciones,
  mapaCatalogo,
  mapaEmpresas,
  mapaEstados,
  mapaMunicipios,
  mapaProveedores,
  mapaSucursales,
  obtenerCotizacionCompleta,
  prewarmCotizacionesCaches,
} from "./services/appsheet.js";

export const cotizacionesRouter = express.Router();
export const facturacionRouter = cotizacionesRouter;
prewarmCotizacionesCaches();

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

function buildCotizacionPdfFilename(data) {
  const tituloBase = data.cotizacion?.TITULO || "Cotizacion";
  const centroNombre = data.cotizacion?.centroNombre || "";
  const centrosCount = data.centros?.length || 0;
  let name = "COTIZACION " + tituloBase;
  if (centrosCount === 1 && centroNombre) {
    name = "COTIZACION " + centroNombre + " " + tituloBase;
  }
  const safe = name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return (safe || "COTIZACION") + ".pdf";
}

const quoteSaveJobs = new Map();
const QUOTE_ASYNC_CENTER_THRESHOLD = 10;

function startQuoteSaveJob(input) {
  const jobId = crypto.randomUUID();
  const job = { status: "processing", createdAt: Date.now(), result: null, error: "" };
  quoteSaveJobs.set(jobId, job);
  void guardarCotizacion(input)
    .then((result) => {
      job.status = "completed";
      job.result = result;
    })
    .catch((error) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "No se pudo crear la cotizacion.";
      console.error(error);
    });
  setTimeout(() => quoteSaveJobs.delete(jobId), 30 * 60 * 1000).unref?.();
  return jobId;
}

cotizacionesRouter.use(express.json());
cotizacionesRouter.get(['/', ''], (_req, res) => {
  res.redirect('/cotizaciones/cotizacion/html');
});
cotizacionesRouter.use("/drive", driveRoutes);

cotizacionesRouter.get("/health", (_req, res) => {
  res.json({ service: "cotizaciones", status: "ok" });
});

const ALLOWED_PROXY_HOSTS = [
  /(^|\.)drive\.google\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)appsheet\.com$/i,
  /(^|\.)pcsinaloa\.gob\.mx$/i
];

const isAllowedProxyHost = (hostname) => {
  return ALLOWED_PROXY_HOSTS.some((pattern) => pattern.test(hostname));
};

const handleImgProxy = async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "");
    if (!rawUrl) return res.status(400).json({ error: "url requerida" });

    let targetUrl;
    try {
      targetUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: "url invalida" });
    }

    if (!isAllowedProxyHost(targetUrl.hostname)) {
      return res.status(400).json({ error: "host no permitido" });
    }

    const sz = req.query.sz ? String(req.query.sz) : "";
    if (sz && targetUrl.searchParams.has("id")) {
      targetUrl.searchParams.set("sz", sz);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(targetUrl.toString(), { redirect: "follow", signal: controller.signal });
    clearTimeout(timeout);

    res.status(resp.status);
    const contentType = resp.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    res.setHeader("cache-control", "public, max-age=3600");

    const buf = Buffer.from(await resp.arrayBuffer());
    return res.send(buf);
  } catch (err) {
    console.error("ERROR EN /img-proxy:", err);
    return res.status(500).json({ error: "img-proxy error" });
  }
};

cotizacionesRouter.get("/img-proxy", handleImgProxy);
cotizacionesRouter.get("/cotizaciones/img-proxy", handleImgProxy);

export function extractQuoteOptionsFromQuery(query = {}) {
  const formaPago = String(query.formaPago || query.forma_pago || query.fp || "").trim();

  const desgloseSet = new Set();
  const rawDesglose = String(query.desglose || "").trim();
  if (rawDesglose) {
    rawDesglose.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((k) => desgloseSet.add(k));
  }
  if (String(query.pipc || "").trim() === "1") desgloseSet.add("pipc");
  if (String(query.capacitaciones || query.capacitacion || "").trim() === "1") desgloseSet.add("capacitaciones");

  const desglose = desgloseSet.size > 0 ? Array.from(desgloseSet) : null;

  const parseBool = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const str = String(v).trim().toLowerCase();
    return str === "1" || str === "true" || str === "yes" || str === "si";
  };

  const mostrarCodigo = parseBool(query.codigo ?? query.mostrarCodigo ?? query.mostrar_codigo) === true;
  const mostrarDescripcion = parseBool(query.descripcion ?? query.mostrarDescripcion ?? query.mostrar_descripcion) === true;
  const mostrarDireccion = parseBool(query.direccion ?? query.mostrarDireccion ?? query.mostrar_direccion) === true;

  const formato = String(query.formato || query.template || query.fmt || "").trim().toLowerCase();

  return {
    formaPago: formaPago || undefined,
    desglose: desglose || undefined,
    mostrarCodigo,
    mostrarDescripcion,
    mostrarDireccion,
    formato: formato || undefined,
  };
}

cotizacionesRouter.get("/cotizacion/:id/html-data", async (req, res) => {
  try {
    const forceFresh = String(req.query.refresh || req.query.fresh || "").trim() === "1";
    if (forceFresh) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
    const json = await obtenerCotizacionCompleta(req.params.id, { forceFresh });
    const centroId = req.query.centro || req.query.sucursal || "";
    const quoteOptions = extractQuoteOptionsFromQuery(req.query);
    const data = construirDataHTML(json, { ...quoteOptions, centroId });
    res.json({ ok: true, data });
  } catch (err) {
    console.error("ERROR EN /html-data:", err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Error interno" });
  }
});

cotizacionesRouter.get("/pruebas", async (_req, res) => {
  try {
    res.render("pruebas");
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

cotizacionesRouter.get("/cotizacion/html", (_req, res) => {
  res.set("Cache-Control", "no-store, max-age=0");
  res.render("cotizacion_editable");
});

function logoEmpresaUrl(empresa = {}) {
  const raw = String(empresa.logoUrl || empresa.logo || "").trim();
  if (!raw) return "";
  if (empresa.id) return `/dashboard/empresas/${encodeURIComponent(empresa.id)}/logo`;
  return /^https?:\/\//i.test(raw) ? `/cotizaciones/img-proxy?url=${encodeURIComponent(raw)}` : "";
}

function inputDate(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2, "0")}-${String(mdy[2]).padStart(2, "0")}`;
  return raw;
}

cotizacionesRouter.get("/api/workspace", async (_req, res) => {
  try {
    const pedidosYear = new Date().getFullYear();
    const pedidosCoverage = getPedidosLeyBranchOrderCoverage(pedidosYear);
    const [empresasMap, sucursalesMap, proveedoresMap, catalogoMap, estadosMap, municipiosMap, cotizacionesRows] = await Promise.all([
      mapaEmpresas(), mapaSucursales(), mapaProveedores(), mapaCatalogo(), mapaEstados(), mapaMunicipios(), listarCotizaciones(),
    ]);
    const empresas = Object.values(empresasMap || {}).map((empresa) => ({
      ...empresa,
      logoUrl: logoEmpresaUrl(empresa),
    })).sort((a, b) => (a.nombreComercial || a.razonSocial).localeCompare(b.nombreComercial || b.razonSocial, "es-MX"));
    const firmas = Object.values(proveedoresMap || {}).filter((item) => item.firmaNombre || item.firmaUrl).map((item) => ({
      id: item.id,
      nombre: item.firmaNombre || item.nombre || "",
      puesto: item.firmaPuesto || "",
      firmaUrl: item.firmaUrl ? `/cotizaciones/img-proxy?url=${encodeURIComponent(item.firmaUrl)}` : "",
    }));
    const cotizaciones = cotizacionesRows.map((row) => {
      const empresaId = String(row.EMPRESA || row["RAZON SOCIAL"] || row["ID EMPRESA"] || "").trim();
      const empresa = empresasMap?.[empresaId] || {};
      return {
        id: String(row["Row ID"] || row.ID || "").trim(),
        fecha: String(row.FECHA || "").trim(),
        titulo: String(row.TITULO || "Cotizacion").trim(),
        cliente: String(empresa.nombreComercial || empresa.razonSocial || empresaId || "Cliente sin nombre").trim(),
        empresaId: empresa.id || "",
        logoUrl: logoEmpresaUrl(empresa),
        centrosCount: (Array.isArray(row.CENTRO_DE_TRABAJO || row.CENTROS_DE_TRABAJO || row["CENTRO DE TRABAJO"] || row["CENTROS DE TRABAJO"]) ? (row.CENTRO_DE_TRABAJO || row.CENTROS_DE_TRABAJO || row["CENTRO DE TRABAJO"] || row["CENTROS DE TRABAJO"]) : String(row.CENTRO_DE_TRABAJO || row.CENTROS_DE_TRABAJO || row["CENTRO DE TRABAJO"] || row["CENTROS DE TRABAJO"] || "").split(/[,;]+/g).filter(Boolean)).length,
      };
    }).filter((row) => row.id).reverse();
    res.json({ ok: true, data: {
      empresas,
      estados: Object.entries(estadosMap || {}).map(([id, value]) => ({ id, ...value })),
      municipios: Object.entries(municipiosMap || {}).map(([id, value]) => ({ id, ...value })),
      sucursales: Object.values(sucursalesMap || {}).map((sucursal) => {
        const coverage = pedidosCoverage.get(String(sucursal.id)) || {};
        const trabajos = String(sucursal.trabajos || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
        const status = String(sucursal.status || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
        const inactiva = ["INACTIVA", "INACTIVO", "BAJA", "CANCELADA", "CANCELADO"].some((value) => status.includes(value));
        return {
          ...sucursal,
          activa: !inactiva,
          requierePedidoEstatal: trabajos.includes("ESTATAL"),
          requierePedidoMunicipal: trabajos.includes("MUNICIPAL"),
          tienePedidoEstatal: coverage.estatal === true,
          tienePedidoMunicipal: coverage.municipal === true,
        };
      }),
      pedidosYear,
      conceptos: Object.values(catalogoMap || {}).sort((a, b) => a.nombre.localeCompare(b.nombre, "es-MX")),
      firmas,
      cotizaciones,
    } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "No se pudieron cargar las cotizaciones." });
  }
});

cotizacionesRouter.get("/api/cotizaciones/:id", async (req, res) => {
  try {
    const data = await obtenerCotizacionCompleta(req.params.id);
    const centros = Object.values(data.conceptos_por_centro || {});
    const esExterna = !data.empresa?.id;
    res.json({ ok: true, data: {
      id: data.cotizacion.id,
      empresaId: data.empresa?.id || "",
      destinatario: data.empresa?.id ? "" : (data.cotizacion.empresaRef || data.empresa?.razonSocial || ""),
      fecha: inputDate(data.cotizacion.fecha),
      proveedorId: data.cotizacion.proveedorId || "",
      centrosTrabajo: esExterna
        ? centros.map((centro) => centro.centro_nombre)
        : (data.cotizacion.centroDeTrabajoIds || centros.map((centro) => centro.centro_id)),
      lineas: centros.flatMap((centro) => centro.conceptos.map((concepto) => ({
        id: concepto.id,
        centroTrabajoId: esExterna ? centro.centro_nombre : centro.centro_id,
        centroTrabajoNombre: centro.centro_nombre,
        conceptoId: concepto.concepto_id,
        cantidad: concepto.cantidad,
        precio: concepto.precio,
        iva: concepto.iva,
      }))),
    } });
  } catch (err) {
    console.error(err);
    res.status(404).json({ ok: false, error: err instanceof Error ? err.message : "Cotizacion no encontrada." });
  }
});

cotizacionesRouter.post("/api/cotizaciones", async (req, res) => {
  try {
    const supportsAsync = String(req.get("x-quote-async") || "") === "1";
    if (supportsAsync && Array.isArray(req.body?.centrosTrabajo) && req.body.centrosTrabajo.length > QUOTE_ASYNC_CENTER_THRESHOLD) {
      const jobId = startQuoteSaveJob(req.body);
      return res.status(202).json({ ok: true, processing: true, jobId });
    }
    const result = await guardarCotizacion(req.body || {});
    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(422).json({ ok: false, error: err instanceof Error ? err.message : "No se pudo crear la cotizacion." });
  }
});

cotizacionesRouter.get("/api/cotizaciones-jobs/:jobId", (req, res) => {
  const job = quoteSaveJobs.get(String(req.params.jobId || ""));
  if (!job) return res.status(404).json({ ok: false, error: "El proceso de cotizacion ya no esta disponible." });
  return res.json({
    ok: job.status !== "failed",
    status: job.status,
    data: job.result,
    error: job.error || undefined,
  });
});

cotizacionesRouter.put("/api/cotizaciones/:id", async (req, res) => {
  try {
    const result = await guardarCotizacion(req.body || {}, req.params.id);
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(422).json({ ok: false, error: err instanceof Error ? err.message : "No se pudo actualizar la cotizacion." });
  }
});

export const CASTILLO_COMPANY_ADDRESS = "CALLE: MISION DE CARMELO N° 2602, FRACC. CAPISTRANO, CULIACAN, SINALOA, C.P.80194 TEL: 6673403135 Email: desarrolloeg@gmail.com";

export function seleccionarPlantillaCotizacion(json, query = {}, data = {}) {
  const formatoQuery = String(query.formato || query.template || query.fmt || "").trim().toLowerCase();
  if (formatoQuery === "castillo" || formatoQuery === "sergio" || formatoQuery === "sergio_castillo") {
    return "cotizacion_castillo";
  }
  if (formatoQuery === "ley") {
    return "cotizacion_ley";
  }
  if (formatoQuery === "estandar" || formatoQuery === "default") {
    return "cotizacion";
  }

  if (data?.esCastillo === true) {
    return "cotizacion_castillo";
  }

  const provId = String(json?.cotizacion?.proveedorId || json?.cotizacion?.PROVEEDOR || "").trim();
  const provNombre = String(json?.cotizacion?.proveedor?.nombre || json?.cotizacion?.proveedor || "").toUpperCase();
  const firmaNombre = String(json?.firma?.nombre || "").toUpperCase();

  const esCastillo =
    provId === "EiHiUQ9YHf4mA-C7L_ziyc" ||
    provNombre.includes("CASTILLO") ||
    firmaNombre.includes("CASTILLO") ||
    firmaNombre.includes("SERGIO GONZALEZ CASTILLO");

  if (esCastillo) {
    return "cotizacion_castillo";
  }

  const empresaId = String(json?.empresaId || "").trim();
  const usarPlantillaLey = empresaId === "1" || empresaId === "25";
  return usarPlantillaLey ? "cotizacion_ley" : "cotizacion";
}

cotizacionesRouter.get("/cotizacion/:id/html", async (req, res) => {
  try {
    const forceFresh = String(req.query.refresh || req.query.fresh || "").trim() === "1";
    if (forceFresh) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
    const json = await obtenerCotizacionCompleta(req.params.id, { forceFresh });
    const centroId = req.query.centro || req.query.sucursal || "";
    const quoteOptions = extractQuoteOptionsFromQuery(req.query);
    const data = construirDataHTML(json, { ...quoteOptions, centroId });
    data.isPdfExport = false;
    const autoprint = String(req.query.autoprint || "").trim() === "1";
    const templateName = seleccionarPlantillaCotizacion(json, req.query, data);
    res.render(templateName, {
      data,
      companyAddress: data.esCastillo ? CASTILLO_COMPANY_ADDRESS : getCompanyAddress(),
      autoprint,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

cotizacionesRouter.get("/cotizacion/:id/pdf", async (req, res) => {
  const forceFresh = String(req.query.refresh || req.query.fresh || "").trim() === "1";
  const centroId = req.query.centro || req.query.sucursal || "";
  const quoteOptions = extractQuoteOptionsFromQuery(req.query);
  try {
    const json = await obtenerCotizacionCompleta(req.params.id, { forceFresh });
    const rawData = construirDataHTML(json, { ...quoteOptions, centroId });
    const data = await prepararCotizacionDataParaPdf(rawData);
    const templateName = seleccionarPlantillaCotizacion(json, req.query, data);

    const html = await new Promise((resolve, reject) => {
      res.app.render(templateName, {
        data,
        companyAddress: data.esCastillo ? CASTILLO_COMPANY_ADDRESS : getCompanyAddress(),
        autoprint: false,
        isPdfExport: true,
      }, (err, str) => {
        if (err) reject(err);
        else resolve(str);
      });
    });

    const browser = await getPdfBrowser();
    let page = null;
    try {
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(30000);
      await page.setJavaScriptEnabled(true);
      await page.setContent(html, { waitUntil: "load", timeout: 30000 });
      await page.emulateMediaType("print");
      const pdfBytes = await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: {
          top: "0.2in",
          right: "0.2in",
          bottom: "0.2in",
          left: "0.2in",
        },
        preferCSSPageSize: true,
      });

      const filename = buildCotizacionPdfFilename(data);
      res.setHeader("Content-Type", "application/pdf");
      const encoded = encodeURIComponent(filename);
      res.setHeader("Content-Disposition", 'inline; filename="' + filename + '"; filename*=UTF-8\'\'' + encoded);
      return res.send(Buffer.from(pdfBytes));
    } finally {
      if (page) await page.close().catch(() => {});
    }
  } catch (err) {
    console.warn("Generacion headless de PDF para cotizacion redirigiendo a impresion web:", err?.message || err);
    const queryStr = new URLSearchParams();
    queryStr.set("autoprint", "1");
    if (centroId) queryStr.set("centro", centroId);
    if (forceFresh) queryStr.set("refresh", "1");
    if (quoteOptions.formato) queryStr.set("formato", quoteOptions.formato);
    if (quoteOptions.formaPago) queryStr.set("formaPago", quoteOptions.formaPago);
    if (quoteOptions.desglose?.length) queryStr.set("desglose", quoteOptions.desglose.join(","));
    if (quoteOptions.mostrarCodigo !== null && quoteOptions.mostrarCodigo !== undefined) queryStr.set("codigo", quoteOptions.mostrarCodigo ? "1" : "0");
    if (quoteOptions.mostrarDescripcion !== null && quoteOptions.mostrarDescripcion !== undefined) queryStr.set("descripcion", quoteOptions.mostrarDescripcion ? "1" : "0");
    if (quoteOptions.mostrarDireccion !== null && quoteOptions.mostrarDireccion !== undefined) queryStr.set("direccion", quoteOptions.mostrarDireccion ? "1" : "0");
    return res.redirect('/cotizaciones/cotizacion/' + encodeURIComponent(req.params.id) + '/html?' + queryStr.toString());
  }
});

cotizacionesRouter.get(["/cotizacion/:id/zip", "/cotizacion/:id/sucursales-zip"], async (req, res) => {
  req.setTimeout(180000);
  const forceFresh = String(req.query.refresh || req.query.fresh || "").trim() === "1";
  const quoteOptions = extractQuoteOptionsFromQuery(req.query);
  try {
    const json = await obtenerCotizacionCompleta(req.params.id, { forceFresh });
    const rawDataCompleta = construirDataHTML(json, { ...quoteOptions });
    const dataCompleta = await prepararCotizacionDataParaPdf(rawDataCompleta);
    const templateName = seleccionarPlantillaCotizacion(json, req.query, dataCompleta);
    const address = dataCompleta.esCastillo ? CASTILLO_COMPANY_ADDRESS : getCompanyAddress();
    const centros = dataCompleta.todosLosCentros || [];

    if (!centros.length) {
      return res.status(404).send("Esta cotizacion no tiene centros de trabajo.");
    }

    const browser = await getPdfBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(45000);
    await page.setJavaScriptEnabled(true);
    await page.emulateMediaType("print");

    const zip = new JSZip();

    try {
      // Si hay mas de 1 sucursal, incluir tambien el PDF de la cotizacion completa
      if (centros.length > 1) {
        dataCompleta.isPdfExport = true;
        const htmlCompleta = await new Promise((resolve, reject) => {
          res.app.render(templateName, {
            data: dataCompleta,
            companyAddress: address,
            autoprint: false,
            isPdfExport: true,
          }, (err, str) => (err ? reject(err) : resolve(str)));
        });
        await page.setContent(htmlCompleta, { waitUntil: "load", timeout: 45000 });
        const pdfBytesCompleta = await page.pdf({
          format: "Letter",
          printBackground: true,
          margin: { top: "0.2in", right: "0.2in", bottom: "0.2in", left: "0.2in" },
          preferCSSPageSize: true,
        });
        const nombreCompleto = ("00 - COTIZACION COMPLETA - " + (dataCompleta.cotizacion?.TITULO || "Cotizacion")).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() + ".pdf";
        zip.file(nombreCompleto, pdfBytesCompleta);
      }

      // Generar PDF individual para cada sucursal
      for (let i = 0; i < centros.length; i++) {
        const c = centros[i];
        const rawDataCentro = construirDataHTML(json, { ...quoteOptions, centroId: c.key });
        const dataCentro = await prepararCotizacionDataParaPdf(rawDataCentro);
        const htmlCentro = await new Promise((resolve, reject) => {
          res.app.render(templateName, {
            data: dataCentro,
            companyAddress: address,
            autoprint: false,
            isPdfExport: true,
          }, (err, str) => (err ? reject(err) : resolve(str)));
        });
        await page.setContent(htmlCentro, { waitUntil: "load", timeout: 45000 });
        const pdfBytesCentro = await page.pdf({
          format: "Letter",
          printBackground: true,
          margin: { top: "0.2in", right: "0.2in", bottom: "0.2in", left: "0.2in" },
          preferCSSPageSize: true,
        });
        const numPrefix = centros.length > 1 ? String(i + 1).padStart(2, "0") + " - " : "";
        const filename = numPrefix + buildCotizacionPdfFilename(dataCentro);
        zip.file(filename, pdfBytesCentro);
      }
    } finally {
      await page.close().catch(() => {});
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const folio = String(dataCompleta.cotizacion?.FOLIO || req.params.id).replace(/[\\/:*?"<>|]+/g, "-");
    const zipFilename = "COTIZACIONES_SUCURSALES_" + folio + ".zip";
    res.setHeader("Content-Type", "application/zip");
    const encodedZip = encodeURIComponent(zipFilename);
    res.setHeader("Content-Disposition", 'attachment; filename="' + zipFilename + '"; filename*=UTF-8\'\'' + encodedZip);
    return res.send(zipBuffer);
  } catch (err) {
    console.error("Error al generar ZIP de cotizaciones por sucursal:", err);
    res.status(500).send("No se pudo generar el archivo ZIP de las cotizaciones por sucursal: " + (err?.message || err));
  }
});
