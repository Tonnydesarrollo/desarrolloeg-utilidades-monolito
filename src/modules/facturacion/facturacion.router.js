import express from "express";
import fetch from "node-fetch";
import driveRoutes from "./routes/drive.js";
import { construirDataHTML } from "./services/construirDataHTML.js";
import { obtenerCotizacionCompleta, mapaSucursales, mapaProveedores } from "./services/appsheet.js";

export const facturacionRouter = express.Router();

facturacionRouter.use(express.json());
facturacionRouter.get(['/', ''], (_req, res) => {
  res.redirect('/facturacion/cotizacion/html');
});
facturacionRouter.use("/drive", driveRoutes);

facturacionRouter.get("/health", (_req, res) => {
  res.json({ service: "facturacion", status: "ok" });
});

const ALLOWED_PROXY_HOSTS = [
  /(^|\.)drive\.google\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)appsheet\.com$/i
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

facturacionRouter.get("/img-proxy", handleImgProxy);

facturacionRouter.get("/cotizacion/:id/html-data", async (req, res) => {
  try {
    const json = await obtenerCotizacionCompleta(req.params.id);
    const data = construirDataHTML(json);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("ERROR EN /html-data:", err);
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
});

facturacionRouter.get("/pruebas", async (_req, res) => {
  try {
    res.render("pruebas");
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

facturacionRouter.get("/cotizacion/html", async (_req, res) => {
  try {
    const [sucursalesMap, proveedoresMap] = await Promise.all([mapaSucursales(), mapaProveedores()]);

    const wrapDriveUrl = (url) => {
      if (!url) return "";
      const str = String(url);
      if (!/drive\.google\.com/i.test(str)) return str;
      return `/facturacion/img-proxy?url=${encodeURIComponent(str)}`;
    };

    const sucursales = Object.values(sucursalesMap || {}).map(s => ({ nombre: s.nombre || "" }));
    const firmas = Object.values(proveedoresMap || {}).map(p => ({
      nombre: p.firmaNombre || p.nombre || "",
      puesto: p.firmaPuesto || "",
      firmaUrl: wrapDriveUrl(p.firmaUrl || "")
    }));

    res.render("cotizacion_editable", { sucursales, firmas });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

facturacionRouter.get("/cotizacion/:id/html", async (req, res) => {
  try {
    const json = await obtenerCotizacionCompleta(req.params.id);
    const data = construirDataHTML(json);
    res.render(String(json.empresaId) === "1" ? "cotizacion_ley" : "cotizacion", { data });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});
