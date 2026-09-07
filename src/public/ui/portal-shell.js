(function () {
  const SCRIPT_VERSION = "20260901c";
  const REFRESH_ENDPOINT = "/api/app-shell/cache/refresh";
  const STATE_ENDPOINT = "/api/app-shell/cache/state";
  const DEFAULT_POLL_INTERVAL_MS = 15000;
  const MIN_RELOAD_DELAY_MS = 350;
  let cacheWatcherTimer = null;
  let cacheWatcherBusy = false;
  let cacheWatcherPromise = null;
  let lastObservedCursor = null;
  let lastObservedRevision = null;
  let liveBadge = null;
  let appNavigation = null;
  let appEventSource = null;

  const NAVIGATION_GROUPS = [
    {
      label: "Operacion",
      links: [
        { label: "Calendario", href: "/dashboard", view: "calendario", tab: "calendar" },
        { label: "Capacitaciones", href: "/dashboard?tab=capacitaciones", view: "capacitaciones", tab: "capacitaciones" },
        { label: "Constancias", href: "/dashboard?tab=constancias", view: "crear-constancias-por-capacitacion", tab: "constancias" },
        { label: "Notas", href: "/dashboard?tab=notas", view: "notas", tab: "notas" },
      ],
    },
    {
      label: "Clientes",
      links: [
        { label: "Empresas y sucursales", href: "/dashboard?tab=sucursales", view: "informacion-sucursales", tab: "sucursales" },
        { label: "Reporte Casa Ley", href: "/dashboard?tab=reporte-ley", view: "reportes", tab: "reporte-ley" },
      ],
    },
    {
      label: "Comercial y cobranza",
      links: [
        { label: "Pedidos", href: "/dashboard/pedidos", view: "pedidos" },
        { label: "Cotizaciones", href: "/cotizaciones/cotizacion/html", view: "facturacion" },
        { label: "Facturacion", href: "/facturacion", view: "facturacion" },
      ],
    },
    {
      label: "Trabajos",
      links: [
        { label: "Municipales", href: "/dashboard?tab=sucursales&trabajo=MUNICIPAL", view: "informacion-sucursales", tab: "sucursales", params: { trabajo: "MUNICIPAL" } },
        { label: "Estatales", href: "/dashboard?tab=sucursales&trabajo=ESTATAL", view: "informacion-sucursales", tab: "sucursales", params: { trabajo: "ESTATAL" } },
        { label: "Sistema de Proteccion Civil", href: "/dashboard?tab=solventaciones", view: "reportes", tab: "solventaciones" },
      ],
    },
    {
      label: "Documentos y cumplimiento",
      links: [
        { label: "Faltantes Ley", href: "/faltantes-ley", view: "faltantes-ley" },
        { label: "Planeacion", href: "/Planeacion-ley/", view: "planeacion" },
        { label: "Polizas", href: "/poliza-ley", view: "poliza" },
        { label: "Reportes", href: "/reportes-inspecciones", view: "reportes" },
      ],
    },
    {
      label: "Sistema",
      links: [
        { label: "Sincronizacion y jobs", href: "/jobs/view", view: "jobs" },
        { label: "WhatsApp", href: "/whatsapp-capacitadores", view: "whatsapp" },
        { label: "Diagnostico", href: "/shell", view: "gestion" },
      ],
    },
  ];

  function getPortalUrl(path) {
    if (typeof window.__PORTAL_URL__ === "function") {
      return window.__PORTAL_URL__(path);
    }
    return path;
  }

  function handleExpiredSession(response) {
    if (response?.status !== 401 || document.body?.classList.contains("portal-auth")) return false;
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const loginUrl = new URL(getPortalUrl("/login"), window.location.origin);
    loginUrl.searchParams.set("returnTo", returnTo);
    window.location.replace(loginUrl.toString());
    return true;
  }

  function canView(profile, view) {
    if (!view) return true;
    if (profile?.allPermissions) return true;
    return Array.isArray(profile?.views?.[view]?.actions)
      && profile.views[view].actions.includes("view");
  }

  function isNavigationLinkActive(link) {
    const url = new URL(window.location.href);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const requestedTab = url.searchParams.get("tab") || "";
    const activeTab = pathname.startsWith("/dashboard/empresas/")
      ? "sucursales"
      : requestedTab || "calendar";
    if (link.tab) {
      const isDashboardRoot = pathname === "/dashboard" || pathname.startsWith("/dashboard/capacitador/") || pathname.startsWith("/dashboard/empresas/");
      if (!isDashboardRoot || activeTab !== link.tab) return false;
      const expectedParams = link.params || {};
      if (Object.keys(expectedParams).length) {
        return Object.entries(expectedParams).every(([key, value]) => url.searchParams.get(key) === value);
      }
      if (link.tab === "sucursales" && url.searchParams.has("trabajo")) return false;
      return true;
    }
    const href = new URL(getPortalUrl(link.href), window.location.origin);
    const hrefPath = href.pathname.replace(/\/$/, "") || "/";
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  }

  function renderNavigationGroups(profile) {
    return NAVIGATION_GROUPS.map((group) => {
      const links = group.links.filter((link) => canView(profile, link.view));
      if (!links.length) return "";
      return `
        <section class="portal-app-nav__group">
          <h2>${group.label}</h2>
          <div class="portal-app-nav__links">
            ${links.map((link) => `
              <a class="portal-app-nav__link${isNavigationLinkActive(link) ? " is-active" : ""}"
                 href="${getPortalUrl(link.href)}"${isNavigationLinkActive(link) ? ' aria-current="page"' : ""}>
                <span>${link.label}</span>
              </a>
            `).join("")}
          </div>
        </section>
      `;
    }).join("");
  }

  function syncNavigationState(root = appNavigation) {
    if (!root) return;
    let activeLabel = "Calendario";
    root.querySelectorAll("[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const link = NAVIGATION_GROUPS.flatMap((group) => group.links)
        .find((candidate) => getPortalUrl(candidate.href) === href);
      if (!link) return;
      const active = isNavigationLinkActive(link);
      anchor.classList.toggle("is-active", active);
      if (active) {
        anchor.setAttribute("aria-current", "page");
        activeLabel = link.label;
      }
      else anchor.removeAttribute("aria-current");
    });
    const context = root.querySelector("[data-portal-current-section]");
    if (context) context.textContent = activeLabel;
  }

  function bindNavigationDrawer(root) {
    const openButton = root.querySelector("[data-portal-nav-open]");
    const drawer = root.querySelector("[data-portal-nav-drawer]");
    const panel = root.querySelector("[data-portal-nav-panel]");
    const closeButtons = Array.from(root.querySelectorAll("[data-portal-nav-close]"));
    if (!openButton || !drawer || !panel) return;
    let previousFocus = null;
    const focusables = () => Array.from(panel.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.offsetParent !== null);
    const close = () => {
      drawer.hidden = true;
      document.body.classList.remove("portal-nav-open");
      openButton.setAttribute("aria-expanded", "false");
      previousFocus?.focus?.();
    };
    const open = () => {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      drawer.hidden = false;
      document.body.classList.add("portal-nav-open");
      openButton.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => (focusables()[0] || panel).focus());
    };
    openButton.addEventListener("click", open);
    closeButtons.forEach((button) => button.addEventListener("click", close));
    panel.querySelectorAll("a[href]").forEach((link) => link.addEventListener("click", close));
    document.addEventListener("keydown", (event) => {
      if (drawer.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusables();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  async function ensureAppNavigation() {
    if (appNavigation || !document.body || document.body.classList.contains("portal-auth")) return appNavigation;
    try {
      const response = await fetch(getPortalUrl("/api/auth/me"), {
        credentials: "same-origin",
        headers: { "X-Requested-With": "fetch" },
      });
      if (handleExpiredSession(response)) return null;
      if (!response.ok) return null;
      const payload = await response.json();
      const user = payload?.user;
      if (!user) return null;
      const navigation = document.createElement("div");
      navigation.className = "portal-app-nav";
      navigation.innerHTML = `
        <header class="portal-app-topbar">
          <a class="portal-app-topbar__brand" href="${getPortalUrl("/dashboard")}" aria-label="Ir al calendario">
            <img src="${getPortalUrl("/img/brand-logo.png?v=20260825b")}" alt="Desarrollo EG" />
          </a>
          <div class="portal-app-topbar__context">
            <span>Plataforma operativa</span>
            <strong data-portal-current-section>${NAVIGATION_GROUPS.flatMap((group) => group.links).find(isNavigationLinkActive)?.label || "Calendario"}</strong>
          </div>
          <div class="portal-app-topbar__account">
            <span><strong>${user.nombre || "Usuario"}</strong><small>${user.puesto || ""}</small></span>
            <a class="portal-app-topbar__logout" href="${getPortalUrl("/api/auth/logout")}">Cerrar sesion</a>
          </div>
        </header>
        <button class="portal-app-menu" type="button" data-portal-nav-open aria-label="Abrir menu principal" aria-expanded="false">
          <span aria-hidden="true"></span><strong>Menu</strong>
        </button>
        <div class="portal-app-drawer" data-portal-nav-drawer hidden>
          <button class="portal-app-drawer__backdrop" type="button" data-portal-nav-close aria-label="Cerrar menu"></button>
          <aside class="portal-app-drawer__panel" data-portal-nav-panel role="dialog" aria-modal="true" aria-label="Menu principal" tabindex="-1">
            <div class="portal-app-drawer__header"><strong>Menu principal</strong><button type="button" data-portal-nav-close>Cerrar</button></div>
            <nav aria-label="Navegacion principal">${renderNavigationGroups(user.accessProfile)}</nav>
            <div class="portal-app-drawer__footer">
              <button class="portal-app-drawer__refresh" type="button" data-portal-refresh data-refresh-scope="${inferScope()}">Actualizar datos</button>
              <span>Sincronizacion local con AppSheet</span>
            </div>
          </aside>
        </div>
      `;
      document.body.prepend(navigation);
      appNavigation = navigation;
      if (liveBadge) navigation.querySelector(".portal-app-topbar__account")?.prepend(liveBadge);
      bindNavigationDrawer(navigation);
      window.addEventListener("popstate", () => syncNavigationState(navigation));
      window.addEventListener("desarrolloeg:navigation-changed", () => syncNavigationState(navigation));
      document.body.classList.add("portal-has-app-nav");
      return navigation;
    } catch {
      return null;
    }
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

  function getStateUrl(scope) {
    const normalizedScope = String(scope || inferScope()).trim() || inferScope();
    const query = new URLSearchParams({ scope: normalizedScope });
    return getPortalUrl(`${STATE_ENDPOINT}?${query.toString()}`);
  }

  function isUserActivelyEditing() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = String(active.tagName || "").toUpperCase();
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return true;
    return active.isContentEditable === true;
  }

  function setLiveBadgeState(state, detail = "") {
    if (!liveBadge) return;
    liveBadge.dataset.state = state;
    liveBadge.textContent = detail || (state === "watching" ? "En vivo" : state === "refreshing" ? "Actualizando" : "Cache");
  }

  function ensureLiveBadge() {
    if (liveBadge || !document.body || !document.body.classList.contains("portal-shell")) {
      return liveBadge;
    }

    liveBadge = document.createElement("div");
    liveBadge.className = "portal-live-badge";
    liveBadge.dataset.state = "watching";
    liveBadge.textContent = "En vivo";
    liveBadge.setAttribute("aria-live", "polite");
    document.body.appendChild(liveBadge);
    return liveBadge;
  }

  async function fetchCacheState(scope) {
    const response = await fetch(getStateUrl(scope), {
      method: "GET",
      headers: {
        "X-Requested-With": "fetch",
      },
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => null);
    if (handleExpiredSession(response)) return {};
    if (!response.ok) {
      const errorText = payload?.error || payload?.message || "No se pudo consultar el estado de la cache.";
      throw new Error(errorText);
    }
    return payload || {};
  }

  async function refreshFromWatcher(scope) {
    if (cacheWatcherBusy) return cacheWatcherPromise;
    cacheWatcherBusy = true;
    setLiveBadgeState("refreshing", "Actualizando");
    cacheWatcherPromise = (async () => {
      try {
        window.dispatchEvent(new CustomEvent("desarrolloeg:data-changed", {
          detail: { scope, cursor: lastObservedCursor, source: "cache-state" },
        }));
        setLiveBadgeState("watching", "Actualizado");
      } finally {
        cacheWatcherBusy = false;
      }
    })();
    return cacheWatcherPromise;
  }

  async function pollCacheState() {
    if (document.hidden || !document.body || !document.body.classList.contains("portal-shell")) {
      return;
    }

    const scope = inferScope();
    try {
      const state = await fetchCacheState(scope);
      const nextCursor = Number(state?.cursor || 0);
      const nextRevision = Number(state?.revision || 0);
      const hasCursor = Number.isFinite(nextCursor) && nextCursor > 0;
      const hasRevision = Number.isFinite(nextRevision) && nextRevision > 0;
      if (!hasCursor && !hasRevision) {
        setLiveBadgeState("watching", "En vivo");
        return;
      }

      if (lastObservedCursor === null && lastObservedRevision === null) {
        if (hasCursor) lastObservedCursor = nextCursor;
        if (hasRevision) lastObservedRevision = nextRevision;
        await refreshFromWatcher(scope);
        return;
      }

      const cursorChanged = hasCursor && nextCursor !== lastObservedCursor;
      const revisionChanged = hasRevision && nextRevision !== lastObservedRevision;
      if (cursorChanged || revisionChanged) {
        if (hasCursor) lastObservedCursor = nextCursor;
        if (hasRevision) lastObservedRevision = nextRevision;
        if (isUserActivelyEditing()) {
          setLiveBadgeState("dirty", "Cambio detectado");
          return;
        }

        setLiveBadgeState("refreshing", "Actualizando");
        await new Promise((resolve) => setTimeout(resolve, MIN_RELOAD_DELAY_MS));
        await refreshFromWatcher(scope);
      } else {
        setLiveBadgeState("watching", "En vivo");
      }
    } catch {
      setLiveBadgeState("watching", "En vivo");
    }
  }

  function startCacheWatcher() {
    if (cacheWatcherTimer || !document.body || !document.body.classList.contains("portal-shell")) {
      return;
    }

    window.__DESARROLLOEG_SHELL_REALTIME__ = true;
    ensureLiveBadge();
    startAppEventStream();
    const schedule = () => {
      void pollCacheState();
    };

    cacheWatcherTimer = window.setInterval(schedule, DEFAULT_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        schedule();
      }
    });
    schedule();
    window.setTimeout(() => {
      void refreshFromWatcher(inferScope());
    }, 500);
  }

  function startAppEventStream() {
    if (appEventSource || !("EventSource" in window)) return;
    const scope = inferScope();
    appEventSource = new EventSource(getPortalUrl(`/api/app-shell/events?scope=${encodeURIComponent(scope)}`));
    appEventSource.addEventListener("init", (event) => {
      const payload = JSON.parse(event.data || "{}");
      const cursor = Number(payload?.cursor || 0);
      const revision = Number(payload?.revision || 0);
      if (Number.isFinite(cursor) && cursor > 0) lastObservedCursor = cursor;
      if (Number.isFinite(revision) && revision > 0) lastObservedRevision = revision;
      setLiveBadgeState("watching", "En vivo");
    });
    appEventSource.addEventListener("app-shell-cache", (event) => {
      const payload = JSON.parse(event.data || "{}");
      const cursor = Number(payload?.cursor || 0);
      const revision = Number(payload?.revision || 0);
      if (Number.isFinite(cursor) && cursor > 0) lastObservedCursor = cursor;
      if (Number.isFinite(revision) && revision > 0) lastObservedRevision = revision;
      if (isUserActivelyEditing()) {
        setLiveBadgeState("dirty", "Cambio detectado");
        return;
      }
      setLiveBadgeState("refreshing", "Actualizando");
      window.dispatchEvent(new CustomEvent("desarrolloeg:data-changed", {
        detail: { ...payload, scope: payload?.scope || scope, source: "sse" },
      }));
      window.setTimeout(() => setLiveBadgeState("watching", "Actualizado"), 500);
    });
    appEventSource.addEventListener("error", () => {
      setLiveBadgeState("dirty", "Reconectando");
    });
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
    if (handleExpiredSession(response)) return {};
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
    document.querySelectorAll("details[open]:not([data-allow-open-on-load])").forEach((detail) => {
      detail.open = false;
    });
    const refreshAppShellCache = async function (scopeOrOptions = "portal", options = {}) {
      if (typeof scopeOrOptions === "string") {
        return refreshCache(scopeOrOptions, {
          reload: options.reload !== false,
          quiet: Boolean(options.quiet),
        });
      }

      const scope = scopeOrOptions.scope || inferScope();
      return refreshCache(scope, {
        reload: scopeOrOptions.reload !== false,
        quiet: Boolean(scopeOrOptions.quiet),
      });
    };
    window.__DESARROLLOEG_REFRESH_CACHE__ = refreshAppShellCache;
    window.refreshAppShellCache = refreshAppShellCache;
    startCacheWatcher();
    void ensureAppNavigation().finally(() => {
      bindButtons();
      document.dispatchEvent(new CustomEvent("desarrolloeg:shell-ready"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
