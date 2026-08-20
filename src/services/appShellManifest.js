import { getBackgroundServicesStatus } from "./backgroundServices.js";
import { getClusterCoordinatorStatus } from "./clusterCoordinator.js";
import { getReleaseInfo } from "./releaseInfo.js";

export function getAppShellManifest() {
  return {
    brand: {
      name: "DesarrolloEG",
      subtitle: "AppSheet como base principal + cache backend + frontend por AJAX",
      accent: "#1D4ED8",
      secondary: "#0F4C5C",
    },
    layout: {
      homePath: "/",
      quickAccessPath: "/shell",
      apiManifestPath: "/api/app-shell/manifest",
    },
    runtime: {
      release: getReleaseInfo(),
      background: getBackgroundServicesStatus(),
      cluster: getClusterCoordinatorStatus(),
    },
    cacheLayers: [
      {
        id: "appsheet-core",
        title: "AppSheet operativo",
        description: "Tablas maestras, cambios de usuario y auditoria.",
      },
      {
        id: "backend-cache",
        title: "Cache persistente backend",
        description: "Catalogos, respuestas frecuentes y relaciones ya resueltas.",
      },
      {
        id: "jobs-runtime",
        title: "Jobs persistentes",
        description: "Fetch, XML, PDFs, reconciliacion y procesos de negocio.",
      },
      {
        id: "frontend-ajax",
        title: "Frontend por AJAX",
        description: "La UI consume al backend y no recalienta datos por usuario.",
      },
    ],
    moduleGroups: [
      {
        id: "entrada",
        title: "Entrada y panel",
        modules: [
          { title: "Home", path: "/", description: "Portal principal y entrada del sistema.", priority: "P0" },
          { title: "Login", path: "/login", description: "Acceso y sesiones.", priority: "P0" },
          { title: "Password", path: "/password", description: "Cambio de contrasena.", priority: "P1" },
          { title: "Dashboard", path: "/status", description: "Estado operativo y release.", priority: "P0" },
        ],
      },
      {
        id: "operacion",
        title: "Operacion",
        modules: [
          { title: "Facturacion", path: "/facturacion", description: "Cotizacion, render y salidas.", priority: "P1" },
          { title: "Planeacion", path: "/Planeacion-ley/", description: "Planeacion y cache de soporte.", priority: "P1" },
          { title: "Constancias", path: "/CONSTANCIAS/", description: "Constancias v2.", priority: "P2" },
          { title: "Contabilidad", path: "/contabilidad", description: "Integracion contable.", priority: "P1" },
        ],
      },
      {
        id: "jobs",
        title: "Jobs y sync",
        modules: [
          { title: "Jobs", path: "/jobs", description: "Ejecucion, logs y reintentos.", priority: "P0" },
          { title: "Pedidos Ley", path: "/api/pedidos-ley", description: "Base para pedidos y liberaciones.", priority: "P1" },
          { title: "CasaLey", path: "/jobs", description: "Procesos de facturacion y relaciones.", priority: "P1" },
        ],
      },
      {
        id: "soporte",
        title: "Soporte y documentos",
        modules: [
          { title: "Faltantes Ley", path: "/FALTANTES-LEY/", description: "Seguimiento de faltantes.", priority: "P2" },
          { title: "Separar PIPC", path: "/SEPARAR-PIPC/", description: "Flujo de separacion.", priority: "P3" },
          { title: "Solventaciones", path: "/SOLVENTACIONES/", description: "Casos y resoluciones.", priority: "P3" },
          { title: "Sucursales Docs", path: "/SUCURSALES-DOCS/", description: "Documentacion por sucursal.", priority: "P3" },
        ],
      },
    ],
  };
}
