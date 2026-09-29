import express from "express";
import fetch from "node-fetch";
import { getCompanyAddress } from "../../config/company.js";
import driveRoutes from "./routes/drive.js";
import { construirDataHTML } from "./services/construirDataHTML.js";
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

cotizacionesRouter.get("/cotizacion/:id/html-data", async (req, res) => {
  try {
    const forceFresh = String(req.query.refresh || req.query.fresh || "").trim() === "1";
    if (forceFresh) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
    const json = await obtenerCotizacionCompleta(req.params.id, { forceFresh });
    const data = construirDataHTML(json);
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
      };
    }).filter((row) => row.id).reverse();
    res.json({ ok: true, data: {
      empresas,
      estados: Object.entries(estadosMap || {}).map(([id, value]) => ({ id, ...value })),
      municipios: Object.entries(municipiosMap || {}).map(([id, value]) => ({ id, ...value })),
      sucursales: Object.values(sucursalesMap || {}).map((sucursal) => {
        const coverage = pedidosCoverage.get(String(sucursal.id)) || {};
        const trabajos = String(sucursal.trabajos || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
        return {
          ...sucursal,
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
    const result = await guardarCotizacion(req.body || {});
    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(422).json({ ok: false, error: err instanceof Error ? err.message : "No se pudo crear la cotizacion." });
  }
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

cotizacionesRouter.get("/cotizacion/:id/html", async (req, res) => {
  try {
    const forceFresh = String(req.query.refresh || req.query.fresh || "").trim() === "1";
    if (forceFresh) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
    const json = await obtenerCotizacionCompleta(req.params.id, { forceFresh });
    const data = construirDataHTML(json);
    const empresaId = String(json.empresaId || "").trim();
    const usarPlantillaLey = empresaId === "1" || empresaId === "25";
    res.render(usarPlantillaLey ? "cotizacion_ley" : "cotizacion", {
      data,
      companyAddress: getCompanyAddress(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});
