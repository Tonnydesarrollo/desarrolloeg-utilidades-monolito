import { reconcilePortalCaches } from "../modules/home/portalAuth.service.js";
import { syncAppsheetBaseToLocal } from "../modules/jobs/native/appsheetBaseSync.js";
import { prewarmFacturacionCaches } from "../modules/facturacion/services/appsheet.js";
import { reconcileAppShellCachesFromAudit } from "./appShellAuditReconciler.js";

function normalizeScope(scope = "all") {
  const value = String(scope || "").trim().toLowerCase();
  if (!value) return "all";
  if (["portal", "portal-v2", "desarrolloeg", "v2"].includes(value)) return "portal";
  if (["facturacion", "finanzas", "finance", "cotizaciones"].includes(value)) return "facturacion";
  if (["all", "todo", "general", "completo"].includes(value)) return "all";
  return value;
}

export async function refreshAppShellCaches({ scope = "all", runAsUserEmail = "", mode = "auto" } = {}) {
  const normalizedScope = normalizeScope(scope);
  const normalizedMode = String(mode || "auto").trim().toLowerCase();
  const results = [];

  if (normalizedMode !== "full") {
    const auditResult = await reconcileAppShellCachesFromAudit({ scope: normalizedScope, runAsUserEmail });
    if (auditResult?.ok) {
      results.push({
        scope: normalizedScope,
        mode: "audit",
        ...auditResult,
      });

      return {
        ok: true,
        scope: normalizedScope,
        mode: "audit",
        results,
      };
    }
  }

  if (normalizedScope === "portal" || normalizedScope === "all") {
    const portalResult = await reconcilePortalCaches({ runAsUserEmail });
    results.push({
      scope: "portal",
      ...portalResult,
    });
  }

  if (normalizedScope === "facturacion" || normalizedScope === "all") {
    const localSyncResult = await syncAppsheetBaseToLocal();
    prewarmFacturacionCaches();
    results.push({
      scope: "facturacion",
      ok: true,
      localSync: localSyncResult,
      warmed: true,
    });
  }

  return {
    ok: true,
    scope: normalizedScope,
    mode: "full",
    results,
  };
}
