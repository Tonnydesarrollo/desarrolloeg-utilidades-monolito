import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.router.js";
import { homeRouter } from "./modules/home/home.router.js";
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
import { reportesInspeccionesRouter } from "./modules/reportes-inspecciones/reportesInspecciones.router.js";
import { polizaLeyRouter } from "./modules/poliza-ley/polizaLey.router.js";
import { pedidosLeyApiRouter } from "./modules/pedidos-ley/pedidosLey.router.js";
import { appShellRouter } from "./modules/app-shell/appShell.router.js";
import { portalPath, runWithPortalContext } from "./modules/home/portalPath.js";
import { getBackgroundServicesStatus } from "./services/backgroundServices.js";
import { getClusterCoordinatorStatus } from "./services/clusterCoordinator.js";
import { getReleaseInfo } from "./services/releaseInfo.js";

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
      req.url = preserveQuery(req, "/cotizaciones/health");
      return next();
    }

    if (req.path === "/") {
      req.url = preserveQuery(req, "/cotizaciones/cotizacion/html");
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

function applyPortalEnvironmentCompatibility(req, res, next) {
  const hasPortalPrefix = /^\/qa(?:\/|$)/i.test(req.path);
  const portalBasePath = hasPortalPrefix ? "/QA" : "";
  req.portalBasePath = portalBasePath;

  if (portalBasePath) {
    const currentUrl = String(req.url || req.originalUrl || "/");
    const rewrittenUrl = currentUrl.replace(/^\/qa(?=\/|$)/i, "") || "/";
    req.url = preserveQuery(req, rewrittenUrl);
  }

  const originalRedirect = res.redirect.bind(res);
  res.redirect = (...args) => {
    if (!portalBasePath) {
      return originalRedirect(...args);
    }

    const nextArgs = [...args];
    if (nextArgs.length === 1 && typeof nextArgs[0] === "string") {
      nextArgs[0] = portalPath(nextArgs[0], portalBasePath);
    } else if (nextArgs.length >= 2 && typeof nextArgs[1] === "string") {
      nextArgs[1] = portalPath(nextArgs[1], portalBasePath);
    }
    return originalRedirect(...nextArgs);
  };

  runWithPortalContext({ portalBasePath }, next);
}

function serveBrandLogo(req, res, next) {
  const publicImgPath = process.env.PUBLICIMG_PATH;
  if (!publicImgPath) {
    next();
    return;
  }

  const logoPath = path.join(publicImgPath, "Logo sin fondo 3D HD.png");
  res.sendFile(logoPath, (err) => {
    if (err) next(err);
  });
}

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.set("view engine", "ejs");
  app.set("views", [
    path.join(__dirname, "modules", "facturacion", "views"),
    path.join(__dirname, "modules", "solventaciones", "views"),
    path.join(__dirname, "modules", "jobs", "views")
  ]);

  const publicImgPath = process.env.PUBLICIMG_PATH;
  if (publicImgPath) {
    app.use("/img", express.static(publicImgPath));
    app.get("/img/brand-logo.png", serveBrandLogo);
  }
  app.use("/ui", express.static(path.join(__dirname, "public", "ui")));

  app.use(applyHostCompatibility);
  app.use(applyPortalEnvironmentCompatibility);
  app.use("/assets", express.static(path.join(__dirname, "modules", "constancias-v2", "public", "assets")));
  app.use("/CONSTANCIAS", constanciasV2Router);
  app.use("/constancias", constanciasV2Router);
  app.use("/blinders", constanciasV2Router);
  app.use("/constancia-editable", constanciasV2Router);
  app.use("/editable-constancia", constanciasV2Router);
  app.use("/constancias-editables", constanciasV2Router);

  app.use("/contabilidad", contabilidadRouter);
  app.use("/facturacion", facturacionRouter);
  app.use("/cotizaciones", facturacionRouter);
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
  app.use("/REPORTES-INSPECCIONES", reportesInspeccionesRouter);
  app.use("/reportes-inspecciones", reportesInspeccionesRouter);
  app.use("/POLIZA_LEY", polizaLeyRouter);
  app.use("/poliza-ley", polizaLeyRouter);
  app.use("/api/pedidos-ley", pedidosLeyApiRouter);

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      environment: env.environment,
      nodeEnv: env.nodeEnv,
      port: env.port,
      release: getReleaseInfo(),
      background: getBackgroundServicesStatus(),
      cluster: getClusterCoordinatorStatus(),
    });
  });

  app.use("/shell", appShellRouter);
  app.use("/api/app-shell", appShellRouter);

  app.get("/status.json", (_req, res) => {
    res.redirect(302, "/status/status.json");
  });

  app.use("/status", dashboardRouter);
  app.use("/", homeRouter);
  app.use("/", facturacionRouter);

  app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    if (res.headersSent) return;
    res.status(500).json({ ok: false, error: message });
  });

  return app;
}

