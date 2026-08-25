(function () {
  const SCRIPT_VERSION = "20260824";
  const REFRESH_ENDPOINT = "/api/app-shell/cache/refresh";

  function getPortalUrl(path) {
    if (typeof window.__PORTAL_URL__ === "function") {
      return window.__PORTAL_URL__(path);
    }
    return path;
  }

  function inferScope() {
    const body = document.body;
    if (!body) return "all";
    const classes = new Set(Array.from(body.classList || []).map((item) => String(item || "").toLowerCase()));
    if (classes.has("portal-facturacion") || classes.has("portal-cotizaciones")) return "facturacion";
    if (classes.has("portal-dashboard") || classes.has("portal-jobs") || classes.has("portal-whatsapp") || classes.has("portal-solventaciones")) {
      return "portal";
    }
    return "portal";
  }

  function getRefreshUrl(scope) {
    const normalizedScope = String(scope || inferScope()).trim() || inferScope();
    const query = new URLSearchParams({ scope: normalizedScope });
    return getPortalUrl(`${REFRESH_ENDPOINT}?${query.toString()}`);
  }

  async function refreshCache(scope, { reload = true, quiet = false } = {}) {
    const response = await fetch(getRefreshUrl(scope), {
      method: "POST",
      headers: {
        "X-Requested-With": "fetch",
      },
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorText = payload?.error || payload?.message || "No se pudo actualizar la cache.";
      throw new Error(errorText);
    }

    const resolvedScope = String(scope || inferScope()).trim() || inferScope();
    if (reload) {
      window.location.reload();
    } else if (!quiet) {
      window.dispatchEvent(
        new CustomEvent("desarrolloeg:cache-refreshed", {
          detail: { scope: resolvedScope, payload },
        }),
      );
    }
    return payload;
  }

  function setBusyState(button, working) {
    if (!button) return;
    button.classList.toggle("is-working", Boolean(working));
    button.disabled = Boolean(working);
    button.setAttribute("aria-busy", working ? "true" : "false");
  }

  async function runRefresh(button) {
    const scope = String(button?.dataset?.refreshScope || inferScope()).trim() || inferScope();
    const originalLabel = button.textContent;
    setBusyState(button, true);
    button.innerHTML = '<span class="portal-refresh-fab__spinner" aria-hidden="true"></span><span>Actualizando</span>';
    try {
      await refreshCache(scope, { reload: true, quiet: false });
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo actualizar la cache.");
      button.textContent = originalLabel;
    } finally {
      setBusyState(button, false);
      if (button.textContent !== originalLabel) {
        button.textContent = originalLabel;
      }
    }
  }

  function createFloatingButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button primary portal-refresh-fab";
    button.dataset.portalRefresh = "true";
    button.dataset.refreshScope = inferScope();
    button.setAttribute("aria-label", "Actualizar datos desde AppSheet y la cache");
    button.title = "Actualizar datos desde AppSheet y la cache";
    button.textContent = "Actualizar";
    button.addEventListener("click", () => runRefresh(button));
    document.body.appendChild(button);
    return button;
  }

  function bindButtons() {
    const dashboardRefreshButton = document.querySelector("[data-dashboard-reload]");
    if (dashboardRefreshButton) {
      return;
    }

    const buttons = Array.from(document.querySelectorAll("[data-portal-refresh]"));
    if (buttons.length > 0) {
      buttons.forEach((button) => {
        if (button.dataset.portalRefreshBound === "1") return;
        button.dataset.portalRefreshBound = "1";
        if (!button.dataset.refreshScope) {
          button.dataset.refreshScope = inferScope();
        }
        button.addEventListener("click", () => runRefresh(button));
      });
      return;
    }

    createFloatingButton();
  }

  function init() {
    if (!document.body || !document.body.classList.contains("portal-shell")) return;
    window.__DESARROLLOEG_REFRESH_CACHE__ = async function (options = {}) {
      if (typeof options === "string") {
        return refreshCache(options, { reload: true, quiet: false });
      }
      const scope = options.scope || inferScope();
      return refreshCache(scope, {
        reload: options.reload !== false,
        quiet: Boolean(options.quiet),
      });
    };
    bindButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
