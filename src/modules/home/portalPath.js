import { AsyncLocalStorage } from "node:async_hooks";

const portalRequestStore = new AsyncLocalStorage();

export function normalizePortalBasePath(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "/") {
    return "";
  }

  const cleaned = text.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned) {
    return "";
  }

  return `/${cleaned}`;
}

export function getPortalContext() {
  return portalRequestStore.getStore() || null;
}

export function getActivePortalBasePath(basePath = undefined) {
  if (basePath !== undefined) {
    return normalizePortalBasePath(basePath);
  }

  return normalizePortalBasePath(getPortalContext()?.portalBasePath || "");
}

export function runWithPortalContext(context = {}, callback = () => {}) {
  const portalBasePath = normalizePortalBasePath(context?.portalBasePath || "");
  return portalRequestStore.run({ portalBasePath }, callback);
}

export function portalPath(path = "/", basePath = undefined) {
  const portalBasePath = getActivePortalBasePath(basePath);
  const cleanPath = String(path || "/").trim() || "/";
  const normalizedPath = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;

  if (!portalBasePath) {
    return normalizedPath;
  }

  if (normalizedPath === portalBasePath || normalizedPath.startsWith(`${portalBasePath}/`)) {
    return normalizedPath;
  }

  return `${portalBasePath}${normalizedPath}`;
}

export function stripPortalBasePath(pathname = "", basePath = undefined) {
  const portalBasePath = getActivePortalBasePath(basePath);
  const cleanPath = String(pathname || "/").trim() || "/";

  if (!portalBasePath || !cleanPath.startsWith(portalBasePath)) {
    return cleanPath;
  }

  const remainder = cleanPath.slice(portalBasePath.length) || "/";
  return remainder.startsWith("/") ? remainder : `/${remainder}`;
}

export function getPortalCookieSuffix(basePath = undefined) {
  const portalBasePath = getActivePortalBasePath(basePath);
  return portalBasePath ? portalBasePath.replace(/\//g, "_").toLowerCase() : "";
}
