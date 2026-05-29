import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { dashboardRouter } from "./modules/dashboard/dashboard.router.js";
import { contabilidadRouter } from "./modules/contabilidad/contabilidad.router.js";
import { facturacionRouter } from "./modules/facturacion/facturacion.router.js";
import { constanciasV2Router } from "./modules/constancias-v2/constanciasV2.router.js";
import { planeacionRouter, planeacionApiRouter } from "./modules/planeacion/planeacion.router.js";
import { jobsRouter } from "./modules/jobs/jobs.router.js";
import { clubfacturaDownloadProxyRouter } from "./modules/jobs/native/facturas/downloadProxy.router.js";
import { faltantesLeyRouter } from "./modules/faltantes-ley/faltantesLey.router.js";
import { separarPipcRouter } from "./modules/separar-pipc/separarPipc.router.js";
import { whatsappCapacitadoresRouter } from "./modules/whatsapp-capacitadores/whatsappCapacitadores.router.js";
import { solventacionesRouter } from "./modules/solventaciones/solventaciones.router.js";
import { sucursalesDocsRouter } from "./modules/sucursales-docs/sucursalesDocs.router.js";
import { getBackgroundServicesStatus } from "./services/backgroundServices.js";
import { getClusterCoordinatorStatus } from "./services/clusterCoordinator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getRequestHost(req) {
  return String(req.hostname || req.get("host") || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function preserveQuery(req, pathname) {
  const queryIndex = req.url.indexOf("?");
  return queryIndex >= 0 ? `${pathname}${req.url.slice(queryIndex)}` : pathname;
}

function applyHostCompatibility(req, _res, next) {
  const host = getRequestHost(req);

  if (host === "api-cotizaciones.desarrolloeg.com") {
    if (req.path === "/health") {
      req.url = preserveQuery(req, "/facturacion/health");
      return next();
    }

    if (req.path === "/") {
      req.url = preserveQuery(req, "/cotizacion/html");
    }
    return next();
  }

  if (host === "api-constancias.desarrolloeg.com") {
    if (
      !req.path.startsWith("/assets") &&
      !req.path.startsWith("/img") &&
      !req.path.startsWith("/img-proxy") &&
      !req.path.startsWith("/constancias") &&
      !req.path.startsWith("/CONSTANCIAS")
    ) {
      const targetPath = req.path === "/" ? "/constancias" : `/constancias${req.path}`;
      req.url = preserveQuery(req, targetPath);
    }
    return next();
  }

  if (host === "clubfactura.desarrolloeg.com") {
    if (req.path === "/health") {
      req.url = preserveQuery(req, "/clubfactura/health");
      return next();
    }

    if (/^\/(xml|pdf)\/\d+$/.test(req.path)) {
      req.url = preserveQuery(req, `/clubfactura${req.path}`);
    }
  }

  next();
}

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.set("view engine", "ejs");
  app.set("views", [
    path.join(__dirname, "modules", "facturacion", "views"),
    path.join(__dirname, "modules", "solventaciones", "views")
  ]);

  const publicImgPath = process.env.PUBLICIMG_PATH;
  if (publicImgPath) {
    app.use("/img", express.static(publicImgPath));
  }

  app.use(applyHostCompatibility);
  app.use("/assets", express.static(path.join(__dirname, "modules", "constancias-v2", "public", "assets")));
  app.use("/CONSTANCIAS", constanciasV2Router);
  app.use("/constancias", constanciasV2Router);
  app.use("/blinders", constanciasV2Router);
  app.use("/constancia-editable", constanciasV2Router);
  app.use("/editable-constancia", constanciasV2Router);
  app.use("/constancias-editables", constanciasV2Router);

  app.use("/contabilidad", contabilidadRouter);
  app.use("/facturacion", facturacionRouter);
  app.use("/Planeacion-ley", planeacionRouter);
  app.use("/FALTANTES-LEY", faltantesLeyRouter);
  app.use("/faltantes-ley", faltantesLeyRouter);
  app.use("/api", planeacionApiRouter);
  app.use("/jobs", jobsRouter);
  app.use("/clubfactura", clubfacturaDownloadProxyRouter);
  app.use("/SEPARAR-PIPC", separarPipcRouter);
  app.use("/separar-pipc", separarPipcRouter);
  app.use("/whatsapp-capacitadores", whatsappCapacitadoresRouter);
  app.use("/SOLVENTACIONES", solventacionesRouter);
  app.use("/solventaciones", solventacionesRouter);
  app.use("/SUCURSALES-DOCS", sucursalesDocsRouter);
  app.use("/sucursales-docs", sucursalesDocsRouter);

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      background: getBackgroundServicesStatus(),
      cluster: getClusterCoordinatorStatus(),
    });
  });

  app.use("/", dashboardRouter);
  app.use("/", facturacionRouter);

  return app;
}
