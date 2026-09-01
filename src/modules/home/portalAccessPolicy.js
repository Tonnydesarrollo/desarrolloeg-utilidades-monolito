const ALL_VIEWS = [
  "calendario",
  "capacitaciones",
  "constancias-faltantes",
  "crear-constancias-por-capacitador",
  "crear-constancias-por-capacitacion",
  "informacion-sucursales",
  "notas",
  "pedidos",
  "faltantes-ley",
  "gestion",
  "jobs",
  "whatsapp",
  "facturacion",
  "planeacion",
  "documentos",
  "reportes",
  "poliza",
];

const ADMIN_PUESTOS = new Set(["DIRECTOR GENERAL", "MEJORA CONTINUA"]);
const GERENTE_PUESTOS = new Set(["GERENTE GENERAL"]);
const CAPACITADOR_PUESTOS = new Set(["CAPACITADOR"]);

const VIEW_ALIASES = {
  "informacion-de-sucursales": "informacion-sucursales",
};

function normalizePolicyText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeViewKey(value = "") {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return VIEW_ALIASES[normalized] || normalized;
}

function allViewPermissions({ actions = ["view", "create", "edit", "delete"], scope = "all" } = {}) {
  return Object.fromEntries(ALL_VIEWS.map((view) => [view, { actions, scope }]));
}

const CAPACITADOR_VIEW_PERMISSIONS = {
  calendario: { actions: ["view", "create", "edit"], scope: "own" },
  capacitaciones: { actions: ["view", "create", "edit"], scope: "own" },
  "constancias-faltantes": { actions: ["view"], scope: "own" },
  "crear-constancias-por-capacitador": { actions: ["view", "create", "edit"], scope: "own" },
  "crear-constancias-por-capacitacion": { actions: ["view", "create", "edit"], scope: "own" },
  "informacion-sucursales": { actions: ["view"], scope: "all" },
  notas: { actions: ["view", "create", "edit", "delete"], scope: "own-with-global-read" },
};

export const PORTAL_ACCESS_PROFILES = {
  "DIRECTOR GENERAL": {
    key: "director-general",
    label: "Director general",
    role: "admin",
    allPermissions: true,
    views: allViewPermissions(),
  },
  "MEJORA CONTINUA": {
    key: "mejora-continua",
    label: "Mejora continua",
    role: "admin",
    allPermissions: true,
    views: allViewPermissions(),
  },
  "GERENTE GENERAL": {
    key: "gerente-general",
    label: "Gerente general",
    role: "admin",
    allPermissions: false,
    views: allViewPermissions({ actions: ["view", "create", "edit"], scope: "all" }),
  },
  CAPACITADOR: {
    key: "capacitador",
    label: "Capacitador",
    role: "capacitador",
    allPermissions: false,
    views: CAPACITADOR_VIEW_PERMISSIONS,
  },
};

export function resolvePortalAccessProfile(employee = {}) {
  const puesto = normalizePolicyText(employee?.puesto);
  const capacita = Boolean(employee?.capacita);

  if (ADMIN_PUESTOS.has(puesto) || GERENTE_PUESTOS.has(puesto)) {
    return PORTAL_ACCESS_PROFILES[puesto];
  }

  if (CAPACITADOR_PUESTOS.has(puesto) || capacita) {
    return PORTAL_ACCESS_PROFILES.CAPACITADOR;
  }

  return {
    key: "sin-acceso",
    label: "Sin acceso",
    role: "sin-acceso",
    allPermissions: false,
    views: {},
  };
}

export function getPortalViewPermission(employee = {}, view = "") {
  const profile = employee?.accessProfile || resolvePortalAccessProfile(employee);
  return profile.views[normalizeViewKey(view)] || { actions: [], scope: "none" };
}

export function canUsePortalView(employee = {}, view = "", action = "view") {
  const permission = getPortalViewPermission(employee, view);
  return permission.actions.includes(String(action || "view").trim().toLowerCase());
}

export function canViewAllForPortalView(employee = {}, view = "") {
  const permission = getPortalViewPermission(employee, view);
  return permission.scope === "all" || permission.scope === "own-with-global-read";
}

export function getPortalAccessMatrix() {
  return PORTAL_ACCESS_PROFILES;
}
