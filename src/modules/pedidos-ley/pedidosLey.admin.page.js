function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeJsonForHtml(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function stripRawRows(row = {}) {
  const cleanNode = (node) => {
    if (!node || typeof node !== "object") return node;
    const clone = { ...node };
    delete clone.raw;
    return clone;
  };

  const clean = { ...row };
  delete clean.raw;
  clean.tienda = cleanNode(clean.tienda);
  clean.empresa = cleanNode(clean.empresa);
  clean.municipio = cleanNode(clean.municipio);
  clean.estado = cleanNode(clean.estado);
  return clean;
}

function buildPageState(data = {}) {
  const catalogs = data.catalogs || {};
  return {
    user: {
      nombre: String(data.user?.nombre || "").trim(),
      correo: String(data.user?.correo || "").trim(),
      role: String(data.user?.role || "").trim(),
    },
    year: Number(data.year || data.requestedYear || new Date().getFullYear()),
    thresholds: {
      estatalMin: Number(data.thresholds?.estatalMin || 32000),
      municipalMin: Number(data.thresholds?.municipalMin || 9794.98),
    },
    facturadorId: String(data.facturadorId || "").trim(),
    facturadorLabel: String(data.facturadorLabel || "").trim(),
    rows: Array.isArray(data.rows) ? data.rows.map(stripRawRows) : [],
    catalogs: {
      sucursales: Array.isArray(catalogs.sucursalesLookup?.rows) ? catalogs.sucursalesLookup.rows.map(stripRawRows) : [],
    },
    queryString: String(data.queryString || ""),
  };
}

export function renderPedidosLeyAdminPage({ user = null, data = {} } = {}) {
  const pageData = buildPageState({ ...data, user });
  const serialized = serializeJsonForHtml(pageData);
  const username = escapeHtml(pageData.user.nombre || pageData.user.correo || "Admin");
  const roleLabel = pageData.user.role === "admin" ? "Administrador" : "Usuario";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pedidos Admin | Desarrollo EG</title>
    <link rel="stylesheet" href="/ui/portal-shell.css?v=20260727">
    <style>
    :root {
      --bg:#f5f7fb;
      --surface:rgba(255,255,255,.98);
      --surface-soft:rgba(247,250,252,.92);
      --line:rgba(15,23,42,.12);
      --ink:#102133;
      --muted:#5b6777;
      --accent:#0f766e;
      --accent2:#1d4ed8;
      --warn:#b45309;
      --danger:#be123c;
      --ok:#166534;
      --shadow:0 24px 60px rgba(15,23,42,.10);
    }
    * { box-sizing:border-box; }
    html, body { margin:0; min-height:100%; }
    .skip-link {
      position:absolute;
      left:16px;
      top:12px;
      z-index:20;
      padding:10px 14px;
      border-radius:999px;
      background:#102133;
      color:#fff;
      font-weight:800;
      transform:translateY(-180%);
      transition:transform .18s ease;
      box-shadow:0 10px 24px rgba(15,23,42,.20);
    }
    .skip-link:focus {
      transform:translateY(0);
    }
    body {
      font-family: "Segoe UI", "Aptos", sans-serif;
      color:var(--ink);
      background:
        radial-gradient(circle at top left, rgba(29,78,216,.10), transparent 28%),
        radial-gradient(circle at top right, rgba(15,118,110,.10), transparent 26%),
        linear-gradient(180deg, #f9fbff 0%, #eef3f8 48%, #e8edf4 100%);
    }
    a { color:inherit; text-decoration:none; }
    .page {
      max-width:1680px;
      margin:0 auto;
      padding:24px 18px 56px;
    }
    .hero {
      position:relative;
      overflow:hidden;
      border-radius:24px;
      padding:20px 22px;
      background:linear-gradient(135deg, rgba(255,255,255,.98), rgba(246,250,254,.96));
      border:1px solid rgba(15,23,42,.10);
      box-shadow:var(--shadow);
      border-top:4px solid var(--accent2);
      display:flex;
      justify-content:space-between;
      gap:14px;
      align-items:center;
    }
    .hero h1 {
      margin:0;
      font-size:clamp(24px, 3vw, 38px);
      letter-spacing:.02em;
      text-transform:uppercase;
    }
    .hero p {
      margin:8px 0 0;
      color:var(--muted);
      max-width:860px;
      line-height:1.45;
    }
    .hero-meta { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; }
    .pill {
      display:inline-flex;
      align-items:center;
      gap:8px;
      border-radius:999px;
      padding:8px 11px;
      background:rgba(29,78,216,.06);
      border:1px solid var(--line);
      color:var(--ink);
      font-size:11px;
      font-weight:700;
    }
    a.pill {
      text-decoration:none;
    }
    .pill.strong {
      background:rgba(15,118,110,.10);
      border-color:rgba(15,118,110,.18);
      color:var(--accent);
    }
    .panel {
      background:var(--surface);
      border:1px solid rgba(15,23,42,.10);
      box-shadow:var(--shadow);
      border-radius:24px;
      margin-top:18px;
    }
    .controls { padding:16px; display:grid; gap:14px; }
    .controls-top {
      display:grid;
      grid-template-columns:minmax(0, 1fr) minmax(280px, .9fr) auto;
      gap:12px;
      align-items:end;
    }
    .controls-toolbar {
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      justify-content:flex-end;
      align-items:center;
    }
    .field label {
      display:block;
      margin:0 0 7px;
      color:var(--muted);
      font-size:11px;
      letter-spacing:.08em;
      text-transform:uppercase;
      font-weight:800;
    }
    .field input,
    .field select {
      width:100%;
      border-radius:14px;
      border:1px solid var(--line);
      background:var(--surface-soft);
      color:var(--ink);
      padding:11px 13px;
      font-size:14px;
      outline:none;
    }
    .field input:focus,
    .field select:focus {
      border-color:rgba(29,78,216,.42);
      box-shadow:0 0 0 3px rgba(29,78,216,.10);
    }
    .btn {
      border:0;
      border-radius:14px;
      padding:11px 15px;
      font-weight:800;
      cursor:pointer;
      transition:transform .12s ease, opacity .12s ease, box-shadow .12s ease;
      font-size:14px;
    }
    .btn:hover { transform:translateY(-1px); }
    .btn.primary {
      color:#fff;
      background:linear-gradient(135deg, var(--accent2), #0f766e);
      box-shadow:0 10px 22px rgba(29,78,216,.16);
    }
    .btn.secondary {
      color:var(--ink);
      background:rgba(15,23,42,.04);
      border:1px solid var(--line);
    }
    .advanced-filters {
      border:1px solid rgba(15,23,42,.10);
      border-radius:20px;
      background:rgba(247,250,252,.86);
      overflow:hidden;
    }
    .advanced-filters > summary {
      list-style:none;
      cursor:pointer;
      padding:14px 16px;
      font-weight:800;
      color:var(--ink);
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
    }
    .advanced-filters > summary::-webkit-details-marker { display:none; }
    .advanced-filters > summary::after {
      content:"Mostrar";
      color:var(--muted);
      font-size:11px;
      text-transform:uppercase;
      letter-spacing:.08em;
    }
    .advanced-filters[open] > summary::after { content:"Ocultar"; }
    .advanced-grid {
      display:grid;
      grid-template-columns:repeat(4, minmax(0, 1fr));
      gap:12px;
      padding:0 16px 16px;
    }
    .overview-grid {
      display:grid;
      grid-template-columns:repeat(4, minmax(0, 1fr));
      gap:14px;
      padding:0 16px 16px;
    }
    .coverage-fold {
      margin:18px 16px 0;
      border:1px solid rgba(15,23,42,.10);
      border-radius:20px;
      background:rgba(247,250,252,.78);
      overflow:hidden;
    }
    .coverage-fold > summary {
      list-style:none;
      cursor:pointer;
      padding:14px 16px;
      font-weight:900;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
    }
    .coverage-fold > summary::-webkit-details-marker { display:none; }
    .coverage-fold > summary::after {
      content:"Abrir";
      color:var(--muted);
      font-size:11px;
      text-transform:uppercase;
      letter-spacing:.08em;
    }
    .coverage-fold[open] > summary::after { content:"Cerrar"; }
    .coverage-fold-body {
      padding:0 0 16px;
      border-top:1px solid rgba(15,23,42,.08);
    }
    .summary-grid {
      margin-top:18px;
      display:grid;
      grid-template-columns:repeat(6, minmax(0, 1fr));
      gap:14px;
    }
    .summary-card {
      background:var(--surface);
      border:1px solid rgba(15,23,42,.10);
      box-shadow:var(--shadow);
      border-radius:18px;
      padding:16px 16px 14px;
      min-height:96px;
      border-top:4px solid rgba(29,78,216,.28);
    }
    .summary-card .eyebrow {
      font-size:10px;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:var(--muted);
      font-weight:800;
    }
    .summary-card .value {
      margin-top:8px;
      font-size:24px;
      font-weight:900;
      letter-spacing:-.03em;
    }
    .summary-card .detail {
      margin-top:5px;
      color:var(--muted);
      font-size:12px;
      line-height:1.35;
    }
    .tabs { display:flex; flex-wrap:wrap; gap:10px; padding:16px 16px 0; }
    .tab {
      border:1px solid var(--line);
      background:rgba(15,23,42,.03);
      color:var(--ink);
      border-radius:999px;
      padding:9px 13px;
      cursor:pointer;
      font-weight:800;
      font-size:12px;
      display:inline-flex;
      gap:8px;
      align-items:center;
    }
    .tab.active {
      background:rgba(29,78,216,.12);
      border-color:rgba(29,78,216,.35);
    }
    .tab .count {
      min-width:24px;
      padding:2px 7px;
      border-radius:999px;
      background:rgba(15,23,42,.08);
      font-size:12px;
      text-align:center;
    }
    .table-shell { padding:16px; overflow:auto; }
    table { width:100%; min-width:1700px; border-collapse:collapse; }
    th, td {
      border-top:1px solid var(--line);
      padding:9px 11px;
      vertical-align:top;
      font-size:12px;
    }
    th {
      position:sticky;
      top:0;
      z-index:1;
      background:rgba(248,251,255,.96);
      color:var(--muted);
      text-transform:uppercase;
      letter-spacing:.08em;
      font-size:10px;
      font-weight:800;
      white-space:nowrap;
      backdrop-filter: blur(10px);
    }
    tbody tr:nth-child(even) td { background:rgba(15,23,42,.015); }
    tbody tr:hover td { background:rgba(29,78,216,.05); }
    .pedido-title { font-weight:900; font-size:13px; }
    .pedido-subtitle, .muted { color:var(--muted); }
    .stack { display:grid; gap:4px; }
    .chip {
      display:inline-flex;
      align-items:center;
      gap:6px;
      border-radius:999px;
      padding:5px 9px;
      font-size:10px;
      font-weight:800;
      border:1px solid var(--line);
      background:rgba(15,23,42,.04);
      white-space:nowrap;
    }
    .chip.ok { color:#0f5132; background:rgba(22,101,52,.08); border-color:rgba(22,101,52,.20); }
    .chip.warn { color:#8a4c00; background:rgba(180,83,9,.10); border-color:rgba(180,83,9,.20); }
    .chip.fail { color:#991b1b; background:rgba(190,18,60,.10); border-color:rgba(190,18,60,.20); }
    .chip.blue { color:#1e3a8a; background:rgba(29,78,216,.08); border-color:rgba(29,78,216,.18); }
    .empty {
      padding:34px 18px;
      text-align:center;
      color:var(--muted);
      font-weight:700;
    }
    .filters-row {
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      align-items:center;
      justify-content:space-between;
      padding:0 16px 14px;
    }
    .filters-row .search {
      flex:1 1 380px;
      min-width:280px;
    }
    .filters-row input[type="text"] {
      width:100%;
      border-radius:14px;
      border:1px solid var(--line);
      background:var(--surface-soft);
      padding:10px 12px;
      color:var(--ink);
    }
    .stats { color:var(--muted); font-size:12px; font-weight:700; }
    .section-meta {
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      align-items:center;
      padding:0 16px 14px;
    }
    .section-meta .stats {
      flex:1 1 320px;
    }
    .section-meta .hint {
      color:var(--muted);
      font-size:12px;
      line-height:1.4;
    }
    @media (max-width: 1400px) {
      .summary-grid { grid-template-columns:repeat(3, minmax(0, 1fr)); }
      .controls-top { grid-template-columns:1fr; }
      .advanced-grid { grid-template-columns:1fr 1fr; }
      .overview-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 900px) {
      .hero { align-items:flex-start; flex-direction:column; }
      .summary-grid { grid-template-columns:1fr 1fr; }
      .advanced-grid { grid-template-columns:1fr; }
      .overview-grid { grid-template-columns:1fr 1fr; }
      .filters-row { flex-direction:column; align-items:stretch; }
      .controls-toolbar { justify-content:stretch; }
      .controls-toolbar .btn { flex:1 1 auto; }
    }
    @media (max-width: 640px) {
      .summary-grid { grid-template-columns:1fr; }
      .overview-grid { grid-template-columns:1fr; }
      .page { padding:18px 12px 40px; }
      .hero { padding:18px; }
      .coverage-fold { margin-left:12px; margin-right:12px; }
    }
  </style>
</head>
<body class="portal-shell portal-pedidos">
  <a class="skip-link" href="#pedidos-main">Saltar al contenido principal</a>
  <main id="pedidos-main" class="page" role="main" aria-label="Panel administrativo de pedidos">
    <section class="hero">
      <div>
        <h1>Pedidos</h1>
        <p>Panel administrativo para revisar pedidos, cobertura por sucursal y el estado de cada pedido estatal o municipal.</p>
      </div>
      <div class="hero-meta">
        <a class="pill" href="..">Volver al dashboard</a>
        <span class="pill">Usuario: ${username}</span>
        <span class="pill">${escapeHtml(roleLabel)}</span>
        <span class="pill" id="headerYearPill"></span>
      </div>
    </section>

    <section class="panel controls">
      <div class="controls-top">
        <div class="field">
          <label for="searchInput">Buscar</label>
          <input id="searchInput" type="text" placeholder="pedido, sucursal, municipio, estado, UUID...">
        </div>
      </div>
      <details class="advanced-filters" id="advancedFilters">
        <summary>Configuración oculta</summary>
        <div class="advanced-grid">
          <div class="field">
            <label for="yearInput">Año</label>
            <input id="yearInput" type="number" min="2020" max="2100" step="1">
          </div>
          <div class="field">
            <label for="facturadorInput">Facturador</label>
            <select id="facturadorInput">
              <option value="">Todos</option>
              <option value="xwDqa6Mt6a42iqKHzJG9L6">GONZALEZ GAMEZ Y ASOCIADOS</option>
              <option value="EiHiUQ9YHf4mA-C7L_ziyc">SERGIO GONZALEZ CASTILLO</option>
            </select>
          </div>
          <div class="field">
            <label for="estatalMinInput">Umbral estatal</label>
            <input id="estatalMinInput" type="number" min="0" step="0.01">
          </div>
          <div class="field">
            <label for="municipalMinInput">Umbral municipal</label>
            <input id="municipalMinInput" type="number" min="0" step="0.01">
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="btn primary" id="applyBtn" type="button" style="width:100%;">Aplicar configuración</button>
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="btn secondary" id="resetBtn" type="button" style="width:100%;">Restaurar filtros</button>
          </div>
        </div>
      </details>
    </section>

    <section class="panel">
      <div class="section-meta">
        <div class="stats" id="statsLine">Cargando...</div>
        <div class="hint" id="hintLine">Pedidos es la vista principal. La cobertura queda plegada para consultar solo cuando haga falta.</div>
      </div>
      <div id="contentMount"></div>
    </section>
  </main>

  <script type="application/json" id="initial-data">${serialized}</script>
  <script>
    const INITIAL = JSON.parse(document.getElementById("initial-data").textContent || "{}");
    const STORAGE_KEY = "desarrolloeg_pedidos_admin_state";
    const DEFAULT_FACTURADOR_ID = "xwDqa6Mt6a42iqKHzJG9L6";

    const ORDER_STATUS_TABS = [
      { id: "all", label: "Todos" },
      { id: "sin-liberacion", label: "Sin liberación" },
      { id: "liberados", label: "Liberados" },
      { id: "pendientes-pago", label: "Pendientes de pago" },
    ];
    const ORDER_TYPE_TABS = [
      { id: "all", label: "Todos" },
      { id: "estatal", label: "Estatales" },
      { id: "municipal", label: "Municipales" },
    ];
    const els = {
      yearInput: document.getElementById("yearInput"),
      facturadorInput: document.getElementById("facturadorInput"),
      estatalMinInput: document.getElementById("estatalMinInput"),
      municipalMinInput: document.getElementById("municipalMinInput"),
      searchInput: document.getElementById("searchInput"),
      applyBtn: document.getElementById("applyBtn"),
      resetBtn: document.getElementById("resetBtn"),
      statsLine: document.getElementById("statsLine"),
      hintLine: document.getElementById("hintLine"),
      headerYearPill: document.getElementById("headerYearPill"),
      contentMount: document.getElementById("contentMount"),
    };

    function esc(value) {
      return String(value == null ? "" : value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function money(value) {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return "Sin importe";
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 2,
      }).format(amount);
    }

    function formatDate(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      }
      return text;
    }

    function normalizeText(value) {
      return String(value == null ? "" : value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();
    }

    function truthy(value) {
      const text = normalizeText(value);
      return ["SI", "S", "YES", "Y", "TRUE", "1", "ENVIADO", "PAGADO", "PAGO", "LIBERADO", "FACTURADO", "CHEQUE"].includes(text);
    }

    function classifyByDescription(description) {
      const text = normalizeText(description);
      if (!text) return null;
      const hasEstatal = text.includes("ESTATAL");
      const hasMunicipal = text.includes("MUNICIPAL");
      if (hasEstatal && !hasMunicipal) return "estatal";
      if (hasMunicipal && !hasEstatal) return "municipal";
      return null;
    }

    function classifyByImport(amount, estatalMin, municipalMin) {
      if (!Number.isFinite(amount)) return "sin-clasificar";
      if (amount >= estatalMin) return "estatal";
      if (amount >= municipalMin) return "municipal";
      return "sin-clasificar";
    }

    function parseUrlState() {
      const params = new URLSearchParams(window.location.search);
      return {
        year: Number.parseInt(params.get("year") || "", 10),
        estatalMin: Number.parseFloat(params.get("estatalMin") || ""),
        municipalMin: Number.parseFloat(params.get("municipalMin") || ""),
        facturadorId: String(params.get("facturadorId") || params.get("facturador") || "").trim(),
        section: String(params.get("view") || "").trim(),
        orderStatus: String(params.get("status") || "").trim(),
        orderType: String(params.get("type") || "").trim(),
        search: String(params.get("search") || "").trim(),
      };
    }

    function loadStoredState() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }

    function saveStoredState(state) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        year: state.year,
        estatalMin: state.estatalMin,
        municipalMin: state.municipalMin,
        facturadorId: state.facturadorId,
      }));
    }

    function buildInitialState() {
      const defaults = {
        year: Number(INITIAL.year || new Date().getFullYear()),
        estatalMin: Number(INITIAL.thresholds?.estatalMin || 32000),
        municipalMin: Number(INITIAL.thresholds?.municipalMin || 9794.98),
      };
      const stored = loadStoredState();
      const url = parseUrlState();
      return {
        year: Number.isFinite(url.year) ? url.year : Number.isFinite(Number(stored.year)) ? Number(stored.year) : defaults.year,
        estatalMin: Number.isFinite(url.estatalMin) ? url.estatalMin : Number.isFinite(Number(stored.estatalMin)) ? Number(stored.estatalMin) : defaults.estatalMin,
        municipalMin: Number.isFinite(url.municipalMin) ? url.municipalMin : Number.isFinite(Number(stored.municipalMin)) ? Number(stored.municipalMin) : defaults.municipalMin,
        facturadorId: String(url.facturadorId || stored.facturadorId || INITIAL.facturadorId || DEFAULT_FACTURADOR_ID).trim(),
        section: url.section === "cobertura" ? "cobertura" : "pedidos",
        orderStatus: ["all", "sin-liberacion", "liberados", "pendientes-pago"].includes(url.orderStatus) ? url.orderStatus : "sin-liberacion",
        orderType: ["all", "estatal", "municipal"].includes(url.orderType) ? url.orderType : "all",
        search: url.search || "",
      };
    }

    const state = {
      ...buildInitialState(),
      rows: Array.isArray(INITIAL.rows) ? INITIAL.rows.slice() : [],
      sucursales: Array.isArray(INITIAL.catalogs?.sucursales) ? INITIAL.catalogs.sucursales.slice() : [],
    };
    state.coverageOpen = state.section === "cobertura";

    function buildModel() {
      const branchByKey = new Map();
      const branchByLabel = new Map();
      const branches = state.sucursales
        .map((row) => ({ ...row }))
        .filter((row) => {
          const status = normalizeText(row.status);
          const trabajos = normalizeText(row.trabajos);
          return normalizeText(row.empresaId) === "1"
            && status.includes("ACTIVA")
            && (trabajos.includes("ESTATAL") || trabajos.includes("MUNICIPAL"));
        });

      for (const row of branches) {
        const key = normalizeText(row.key || row.id || row.tienda || "");
        const label = normalizeText(row.displayLabel || row.label || row.label2 || row.tienda || row.key || "");
        if (key) branchByKey.set(key, row);
        if (label) branchByLabel.set(label, row);
      }

      const orders = state.rows
        .map((row) => {
          const amount = Number(row.importeNumber);
          const estatalMin = Number(state.estatalMin || 32000);
          const municipalMin = Number(state.municipalMin || 9794.98);
          const tipo = row.tipoClasificacion
            || classifyByDescription(row.descripcion)
            || classifyByImport(amount, estatalMin, municipalMin);
          const statusText = normalizeText(row.status);
          const branch = findBranchForOrder(row, { branchByKey, branchByLabel });
          const order = {
            ...row,
            _branch: branch,
            _flags: {
              tipo,
              liberado: statusText.includes("LIBERADO") || statusText.includes("LIBERACION") || statusText.includes("LIBERADO PENDIENTE"),
              facturaLey: statusText.includes("LEY"),
              pago: statusText.includes("PAGO"),
              noLiberado: statusText.includes("SIN LIBERACION")
                || statusText.includes("NO LIBERADO")
                || (statusText.includes("PENDIENTE") && !statusText.includes("PAGO")),
              liberadoPendLey: statusText.includes("LIBERADO") && !statusText.includes("LEY"),
              pendientePago: statusText.includes("PENDIENTE") && statusText.includes("PAGO"),
              estatal: tipo === "estatal",
              municipal: tipo === "municipal",
            },
            _searchText: [
              row.pedido,
              row.establecimiento,
              row.tiendaKey,
              row.tiendaLabel,
              row.tienda?.label,
              branch?.displayLabel,
              branch?.label,
              branch?.municipioNombre || branch?.municipioLabel,
              branch?.estadoNombre || branch?.estadoLabel,
              row.facturadorNombre,
              row.status,
              row.descripcion,
              row.uuid,
              row.folioClubFactura,
              row.ultimoPipcEstatal,
              row.ultimoPipcMunicipal,
            ].map((item) => normalizeText(item)).join(" "),
          };
          return order;
        })
        .filter((row) => row._branch || row.tiendaKey || row.establecimiento);

      const ordersByBranch = new Map();
      for (const row of orders) {
        const branch = row._branch;
        if (!branch) continue;
        const key = normalizeText(branch.key || branch.id || branch.tienda || "");
        if (!key) continue;
        let bucket = ordersByBranch.get(key);
        if (!bucket) {
          bucket = { all: [], estatal: [], municipal: [] };
          ordersByBranch.set(key, bucket);
        }
        bucket.all.push(row);
        if (row._flags.estatal) bucket.estatal.push(row);
        if (row._flags.municipal) bucket.municipal.push(row);
      }

      return {
        branchByKey,
        branchByLabel,
        branches,
        orders,
        ordersByBranch,
      };
    }

    let model = buildModel();
    let modelSignature = JSON.stringify({
      rows: state.rows.length,
      sucursales: state.sucursales.length,
      estatalMin: state.estatalMin,
      municipalMin: state.municipalMin,
      rowSample: state.rows.slice(0, 20).map((row) => String(row.rowId || row.pedido || row.uuid || row.fecha || "")).join("|"),
      branchSample: state.sucursales.slice(0, 20).map((row) => String(row.key || row.id || row.displayLabel || row.label || "")).join("|"),
    });

    function ensureModel() {
      const signature = JSON.stringify({
        rows: state.rows.length,
        sucursales: state.sucursales.length,
        estatalMin: state.estatalMin,
        municipalMin: state.municipalMin,
        rowSample: state.rows.slice(0, 20).map((row) => String(row.rowId || row.pedido || row.uuid || row.fecha || "")).join("|"),
        branchSample: state.sucursales.slice(0, 20).map((row) => String(row.key || row.id || row.displayLabel || row.label || "")).join("|"),
      });
      if (signature === modelSignature) return;
      modelSignature = signature;
      model = buildModel();
    }

    function branchKey(row = {}) {
      return normalizeText(row.key || row.id || row.tienda || row.displayLabel || row.label || "");
    }

    function branchLabel(row = {}) {
      return String(row.displayLabel || row.label || row.label2 || row.tienda || row.key || "").trim();
    }

    function findBranchForOrder(order, index = model) {
      const key = normalizeText(order.tiendaKey || order.establecimiento || "");
      const label = normalizeText(order.tiendaLabel || order.tienda?.label || order.establecimiento || "");
      return index.branchByKey.get(key) || index.branchByLabel.get(label) || null;
    }

    function visibleOrderRows() {
      const query = normalizeText(state.search);
      const selectedYear = Number(state.year || INITIAL.year || new Date().getFullYear());
      return model.orders
        .filter((row) => !state.facturadorId || normalizeText(row.facturadorId) === normalizeText(state.facturadorId))
        .filter((row) => !Number.isFinite(selectedYear) || !row.fechaYear || Number(row.fechaYear) === selectedYear)
        .filter((row) => {
          const flags = row._flags;
          if (state.orderStatus === "sin-liberacion" && !flags.noLiberado) return false;
          if (state.orderStatus === "liberados" && !flags.liberadoPendLey) return false;
          if (state.orderStatus === "pendientes-pago" && !flags.pendientePago) return false;
          if (state.orderType === "estatal" && !flags.estatal) return false;
          if (state.orderType === "municipal" && !flags.municipal) return false;
          if (query && !row._searchText.includes(query)) return false;
          return true;
        })
        .sort((a, b) => Number(b.fechaYear || 0) - Number(a.fechaYear || 0));
    }

    function allowedBranch(row) {
      return normalizeText(row.empresaId) === "1"
        && normalizeText(row.status).includes("ACTIVA")
        && (normalizeText(row.trabajos).includes("ESTATAL") || normalizeText(row.trabajos).includes("MUNICIPAL"));
    }

    function expectedKinds(row) {
      const work = normalizeText(row.trabajos);
      const kinds = [];
      if (work.includes("ESTATAL")) kinds.push("estatal");
      if (work.includes("MUNICIPAL")) kinds.push("municipal");
      return kinds;
    }

    function isCuliacanMunicipalBranch(branch) {
      const municipio = normalizeText(branch.municipioNombre || branch.municipioLabel || branch.municipio?.displayLabel || "");
      return municipio.includes("CULIACAN");
    }

    function ordersForBranchAndKind(branch, kind) {
      const bucket = model.ordersByBranch.get(branchKey(branch));
      const rows = bucket ? (kind === "estatal" ? bucket.estatal : kind === "municipal" ? bucket.municipal : bucket.all) : [];
      const selectedFacturadorId = normalizeText(state.facturadorId);
      return rows
        .filter((row) => !selectedFacturadorId || normalizeText(row.facturadorId) === selectedFacturadorId)
        .filter((row) => !state.year || !row.fechaYear || Number(row.fechaYear) === Number(state.year))
        .slice()
        .sort((a, b) => Number(b.fechaYear || 0) - Number(a.fechaYear || 0));
    }

    function getCoverageEntries(kind) {
      const branches = model.branches
        .filter(allowedBranch)
        .filter((row) => expectedKinds(row).includes(kind));
      return branches.flatMap((branch) => {
        const culiacanMunicipal = kind === "municipal" && isCuliacanMunicipalBranch(branch);
        const selectedFacturadorId = normalizeText(state.facturadorId);
        if (culiacanMunicipal && selectedFacturadorId === normalizeText(DEFAULT_FACTURADOR_ID)) {
          return [];
        }
        const orders = ordersForBranchAndKind(branch, kind);
        const order = orders[0] || null;
        return [{ branch, kind, culiacanMunicipal, order }];
      });
    }

    function chip(text, tone) {
      return '<span class="chip ' + tone + '">' + esc(text) + '</span>';
    }

    function renderTabs(container, defs, activeId, onChange) {
      container.innerHTML = defs.map((tab) => (
        '<button class="tab ' + (tab.id === activeId ? "active" : "") + '" data-tab="' + esc(tab.id) + '" type="button">' + esc(tab.label) + '</button>'
      )).join("");
      container.querySelectorAll("[data-tab]").forEach((button) => {
        button.addEventListener("click", () => onChange(button.getAttribute("data-tab") || "all"));
      });
    }

    function renderHeader() {
      els.headerYearPill.textContent = "Año " + state.year;
      els.yearInput.value = state.year;
      if (els.facturadorInput) els.facturadorInput.value = state.facturadorId;
      els.estatalMinInput.value = state.estatalMin;
      els.municipalMinInput.value = state.municipalMin;
      els.searchInput.value = state.search;
    }

    function renderPedidosSection(rows = visibleOrderRows()) {
      const totals = {
        total: rows.length,
        sinLiberacion: rows.filter((row) => row._flags.noLiberado).length,
        liberados: rows.filter((row) => row._flags.liberadoPendLey).length,
        pendientesPago: rows.filter((row) => row._flags.pendientePago).length,
      };
      return ''
        + '<div class="overview-grid">'
        + '<article class="summary-card"><div class="eyebrow">Pedidos visibles</div><div class="value">' + esc(totals.total) + '</div><div class="detail">Con el año, proveedor y filtros activos.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">Sin liberación</div><div class="value">' + esc(totals.sinLiberacion) + '</div><div class="detail">Coinciden por status.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">Liberados</div><div class="value">' + esc(totals.liberados) + '</div><div class="detail">Pendientes de subir a ley.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">Pendientes de pago</div><div class="value">' + esc(totals.pendientesPago) + '</div><div class="detail">Status aún abierto.</div></article>'
        + '</div>'
        + '<div class="tabs" id="orderStatusTabs"></div>'
        + '<div class="tabs" id="orderTypeTabs" style="padding-top:10px;"></div>'
        + '<div class="stats" style="padding:12px 16px 0;">Mostrando ' + esc(rows.length) + ' de ' + esc(state.rows.length) + ' pedidos del año ' + esc(state.year) + '</div>'
        + '<div class="table-shell">'
        + '<table>'
        + '<thead>'
        + '<tr>'
        + '<th>Pedido</th>'
        + '<th>Sucursal</th>'
        + '<th>Municipio</th>'
        + '<th>Estado</th>'
        + '<th>Fecha</th>'
        + '<th>Importe</th>'
        + '<th>Tipo</th>'
        + '<th>Status</th>'
        + '</tr>'
        + '</thead>'
        + '<tbody>'
        + (rows.length ? rows.map((row) => {
          const flags = row._flags;
          const municipioLabel = row.tienda?.municipioNombre || row.tienda?.municipioLabel || row.municipio?.nombre || row.municipio?.displayLabel || "";
          const estadoLabel = row.tienda?.estadoNombre || row.tienda?.estadoLabel || row.estado?.nombre || row.estado?.displayLabel || "";
          return ''
            + '<tr>'
            + '<td><div class="stack"><strong>' + esc(row.pedido || "") + '</strong><span class="muted">' + esc(row.descripcion || "") + '</span></div></td>'
            + '<td><div class="stack"><strong>' + esc(row._branch ? branchLabel(row._branch) : (row.tiendaLabel || row.establecimiento || "")) + '</strong><span class="muted">' + esc(row._branch ? branchKey(row._branch) : (row.tiendaKey || row.establecimiento || "")) + '</span></div></td>'
            + '<td><strong>' + esc(municipioLabel) + '</strong></td>'
            + '<td><strong>' + esc(estadoLabel) + '</strong></td>'
            + '<td>' + esc(formatDate(row.fecha || row["fecha(DATE)"] || "")) + '</td>'
            + '<td><div class="stack"><strong>' + esc(money(row.importeNumber)) + '</strong><span class="muted">' + esc(row.facturadorNombre || "") + '</span></div></td>'
            + '<td><div class="stack">' + chip(row.clasificacionLabel || (flags.estatal ? "Estatal" : flags.municipal ? "Municipal" : "Sin clasificar"), row.clasificacionLabel && normalizeText(row.clasificacionLabel).includes("CULIACAN") ? "warn" : flags.estatal ? "ok" : flags.municipal ? "blue" : "") + '<span class="muted">' + esc(row.clasificacionDetalle || "") + '</span></div></td>'
            + '<td>' + esc(row.status || "Sin status") + '</td>'
            + '</tr>';
        }).join("") : '<tr><td colspan="8" class="empty">No hay pedidos con estos filtros.</td></tr>')
        + '</tbody>'
        + '</table>'
        + '</div>'
        + '<details class="coverage-fold"' + (state.coverageOpen ? ' open' : '') + '>'
        + '<summary>Ver cobertura de sucursales</summary>'
        + '<div class="coverage-fold-body">'
        + renderCoverageSection()
        + '</div>'
        + '</details>';
    }

    function renderCoverageSection() {
      const query = normalizeText(state.search);
      const renderCoverageBlock = (kind, title) => {
        const entries = getCoverageEntries(kind).filter((item) => {
          if (query) {
            const haystack = [
              item.branch.key,
              item.branch.label,
              item.branch.municipioNombre || item.branch.municipioLabel,
              item.branch.estadoNombre || item.branch.estadoLabel,
              item.branch.trabajos,
              item.order?.pedido,
              item.order?.status,
            ].map((value) => normalizeText(value)).join(" ");
            if (!haystack.includes(query)) return false;
          }
          return true;
        });
      const withOrder = entries.filter((item) => item.order);
      const withoutOrder = entries.filter((item) => !item.order);
      const culiacanRows = entries.filter((item) => item.culiacanMunicipal);
        const rowMarkup = (item, missing = false) => ''
          + '<tr>'
          + '<td><div class="stack"><strong>' + esc(branchLabel(item.branch)) + '</strong><span class="muted">' + esc(branchKey(item.branch)) + '</span></div></td>'
          + '<td>' + esc(item.branch.municipioNombre || item.branch.municipioLabel || item.branch.municipio?.displayLabel || "") + '</td>'
          + '<td>' + esc(item.branch.estadoNombre || item.branch.estadoLabel || item.branch.estado?.displayLabel || "") + '</td>'
          + '<td>' + (missing ? chip("Sin pedido", "fail") : chip("Con pedido", "ok")) + '</td>'
          + '<td>' + (item.order ? esc(item.order.pedido || "") : "—") + '</td>'
          + '<td>' + (item.order ? esc(item.order.status || "Sin status") : "Debe tener pedido " + title.toLowerCase()) + '</td>'
          + '<td>' + (item.order ? esc(money(item.order.importeNumber)) : "—") + '</td>'
          + '<td>' + (item.culiacanMunicipal ? chip("Municipal Culiacán", "warn") : chip("Normal", "ok")) + '</td>'
          + '</tr>';
        const tableMarkup = (rows, emptyMessage, missing = false) => ''
          + '<div class="table-shell" style="padding-left:0;padding-right:0;margin-top:14px;">'
          + '<table style="min-width:1200px;">'
          + '<thead><tr><th>Sucursal</th><th>Municipio</th><th>Estado</th><th>Condición</th><th>Pedido</th><th>Status</th><th>Importe</th><th>Observación</th></tr></thead>'
          + '<tbody>'
          + (rows.length ? rows.map((item) => rowMarkup(item, missing)).join("") : '<tr><td colspan="8" class="empty">' + esc(emptyMessage) + '</td></tr>')
          + '</tbody>'
          + '</table>'
          + '</div>';
        return ''
          + '<section class="panel" style="margin-top:18px;padding:18px;">'
          + '<div class="section-head" style="padding:0 0 12px;">'
          + '<div>'
          + '<h2>' + esc(title) + '</h2>'
          + '<p>' + esc(entries.length) + ' sucursales con trabajo ' + esc(title.toLowerCase()) + '. Separadas entre las que tienen pedido y las que deberían tenerlo.</p>'
          + '</div>'
          + '</div>'
          + '<div class="summary-grid" style="grid-template-columns:repeat(3, minmax(0, 1fr));margin-top:0;">'
          + '<article class="summary-card"><div class="eyebrow">Con pedido</div><div class="value">' + esc(withOrder.length) + '</div><div class="detail">Sí cumplen</div></article>'
          + '<article class="summary-card"><div class="eyebrow">Sin pedido</div><div class="value">' + esc(withoutOrder.length) + '</div><div class="detail">Deberían tenerlo</div></article>'
          + '<article class="summary-card"><div class="eyebrow">Culiacán municipal</div><div class="value">' + esc(culiacanRows.length) + '</div><div class="detail">Asignado a Sergio Gonzalez Castillo</div></article>'
          + '</div>'
          + '<h3 style="margin:18px 0 0;font-size:15px;">Con pedido</h3>'
          + tableMarkup(withOrder, 'No hay sucursales con pedido ' + title.toLowerCase() + '.')
          + '<h3 style="margin:18px 0 0;font-size:15px;">Sin pedido</h3>'
          + tableMarkup(withoutOrder, 'No hay sucursales pendientes en ' + title.toLowerCase() + '.', true)
          + '</section>';
      };
      return ''
        + renderCoverageBlock("estatal", "Estatal")
        + renderCoverageBlock("municipal", "Municipal");
    }

    function renderSectionTabs() {
      if (state.section === "pedidos") {
        const statusMount = document.getElementById("orderStatusTabs");
        const typeMount = document.getElementById("orderTypeTabs");
        if (statusMount) {
          renderTabs(statusMount, ORDER_STATUS_TABS, state.orderStatus, (tabId) => {
            state.orderStatus = tabId;
            render();
          });
        }
        if (typeMount) {
          renderTabs(typeMount, ORDER_TYPE_TABS, state.orderType, (tabId) => {
            state.orderType = tabId;
            render();
          });
        }
      }
    }

    function renderContent() {
      ensureModel();
      const selectedYear = Number(state.year || INITIAL.year || new Date().getFullYear());
      const baseRows = model.orders
        .filter((row) => !state.facturadorId || normalizeText(row.facturadorId) === normalizeText(state.facturadorId))
        .filter((row) => !Number.isFinite(selectedYear) || !row.fechaYear || Number(row.fechaYear) === selectedYear);
      const visibleRows = visibleOrderRows();
      els.contentMount.innerHTML = renderPedidosSection(visibleRows);
      const visibleCount = visibleRows.length;
      els.statsLine.textContent = "Mostrando " + visibleCount + " de " + baseRows.length + " pedidos del año " + state.year;
      els.hintLine.textContent = state.coverageOpen
        ? "La cobertura está abierta para revisar sucursales con y sin pedido."
        : "Los filtros de estado y tipo se basan primero en Status; si no hay coincidencia explícita, se clasifica por importe.";
      const coverageFold = els.contentMount.querySelector(".coverage-fold");
      if (coverageFold && !coverageFold.dataset.bound) {
        coverageFold.dataset.bound = "true";
        coverageFold.addEventListener("toggle", () => {
          state.coverageOpen = coverageFold.open;
        });
      }
    }

    function render() {
      renderHeader();
      renderContent();
    }

    function reloadWithCurrentConfig() {
      const url = new URL(window.location.href);
      url.searchParams.set("year", String(state.year));
      url.searchParams.set("estatalMin", String(state.estatalMin));
      url.searchParams.set("municipalMin", String(state.municipalMin));
      if (state.facturadorId) {
        url.searchParams.set("facturadorId", state.facturadorId);
      } else {
        url.searchParams.delete("facturadorId");
      }
      if (state.coverageOpen) {
        url.searchParams.set("view", "cobertura");
      } else {
        url.searchParams.delete("view");
      }
      if (state.orderStatus && state.orderStatus !== "all") {
        url.searchParams.set("status", state.orderStatus);
      }
      if (state.orderType && state.orderType !== "all") {
        url.searchParams.set("type", state.orderType);
      }
      if (state.search) {
        url.searchParams.set("search", state.search);
      } else {
        url.searchParams.delete("search");
      }
      window.location.assign(url.toString());
    }

    render();

    els.searchInput.addEventListener("input", (event) => {
      state.search = String(event.target.value || "");
      render();
    });
    els.yearInput.addEventListener("change", (event) => {
      const next = Number.parseInt(event.target.value || "", 10);
      if (Number.isFinite(next)) {
        state.year = next;
        render();
      }
    });
    els.facturadorInput?.addEventListener("change", (event) => {
      state.facturadorId = String(event.target.value || "").trim();
      render();
    });
    els.estatalMinInput.addEventListener("change", (event) => {
      const next = Number.parseFloat(event.target.value || "");
      if (Number.isFinite(next)) state.estatalMin = next;
      saveStoredState(state);
      ensureModel();
      render();
    });
    els.municipalMinInput.addEventListener("change", (event) => {
      const next = Number.parseFloat(event.target.value || "");
      if (Number.isFinite(next)) state.municipalMin = next;
      saveStoredState(state);
      ensureModel();
      render();
    });
    els.applyBtn.addEventListener("click", () => {
      saveStoredState(state);
      reloadWithCurrentConfig();
    });
    els.resetBtn.addEventListener("click", () => {
      state.section = "pedidos";
      state.coverageOpen = false;
      state.orderStatus = "sin-liberacion";
      state.orderType = "all";
      state.search = "";
      state.year = Number(INITIAL.year || new Date().getFullYear());
      state.estatalMin = Number(INITIAL.thresholds?.estatalMin || 32000);
      state.municipalMin = Number(INITIAL.thresholds?.municipalMin || 9794.98);
      state.facturadorId = String(INITIAL.facturadorId || DEFAULT_FACTURADOR_ID).trim();
      localStorage.removeItem(STORAGE_KEY);
      render();
    });
  </script>
</body>
</html>`;
}








