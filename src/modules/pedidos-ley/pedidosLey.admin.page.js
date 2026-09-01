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
      estatalMin: Number(data.thresholds?.estatalMin || 32967.49),
      municipalMin: Number(data.thresholds?.municipalMin || 11000),
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
    <link rel="stylesheet" href="/ui/portal-shell.css?v=20260828a">
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
    .pending-summary {
      margin:16px 16px 0;
      padding:18px;
      border:1px solid rgba(15,23,42,.10);
      border-radius:22px;
      background:
        radial-gradient(circle at 92% 12%, rgba(196,55,45,.12), transparent 34%),
        linear-gradient(135deg, rgba(255,255,255,.96), rgba(242,247,251,.92));
      box-shadow:var(--shadow);
      display:grid;
      grid-template-columns:minmax(220px, 1fr) repeat(2, minmax(180px, .65fr));
      gap:12px;
      align-items:stretch;
    }
    .pending-summary-copy { padding:4px 8px; align-self:center; }
    .pending-summary-copy .eyebrow {
      color:#c4372d;
      font-size:10px;
      font-weight:900;
      letter-spacing:.1em;
      text-transform:uppercase;
    }
    .pending-summary-copy strong {
      display:block;
      margin-top:5px;
      font-size:22px;
      letter-spacing:-.03em;
    }
    .pending-summary-copy p { margin:5px 0 0; color:var(--muted); font-size:12px; line-height:1.4; }
    .pending-type-card {
      appearance:none;
      border:1px solid rgba(15,23,42,.10);
      border-radius:17px;
      background:rgba(255,255,255,.78);
      color:var(--ink);
      padding:14px 16px;
      text-align:left;
      cursor:pointer;
      transition:transform .18s ease, border-color .18s ease, box-shadow .18s ease;
    }
    .pending-type-card:hover,
    .pending-type-card:focus-visible {
      transform:translateY(-2px);
      border-color:rgba(196,55,45,.42);
      box-shadow:0 12px 24px rgba(15,23,42,.09);
      outline:none;
    }
    .pending-type-card[aria-pressed="true"] { border-color:#c4372d; box-shadow:0 0 0 3px rgba(196,55,45,.10); }
    .pending-type-card span { display:block; color:var(--muted); font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
    .pending-type-card strong { display:block; margin-top:4px; font-size:30px; line-height:1; letter-spacing:-.04em; }
    .pending-type-card small { display:block; margin-top:7px; color:var(--muted); font-size:11px; }
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
    .sendbar {
      display:grid;
      grid-template-columns:minmax(220px, .8fr) minmax(280px, 1.2fr) auto;
      gap:12px;
      align-items:end;
      margin:16px;
      padding:14px;
      border:1px solid rgba(15,23,42,.10);
      border-radius:20px;
      background:rgba(247,250,252,.86);
    }
    .send-status {
      grid-column:1 / -1;
      color:var(--muted);
      font-size:12px;
      font-weight:800;
    }
    .send-status.ok { color:var(--ok); }
    .send-status.err { color:var(--danger); }
    .row-actions { display:grid; gap:8px; min-width:150px; }
    .detail-row[hidden] { display:none !important; }
    .detail-row td { background:rgba(239,246,255,.72); border-top:0; }
    .files-panel {
      display:grid;
      gap:12px;
      padding:14px;
      border:1px solid rgba(15,23,42,.10);
      border-radius:18px;
      background:rgba(255,255,255,.88);
    }
    .files-head {
      display:flex;
      justify-content:space-between;
      gap:12px;
      align-items:center;
      flex-wrap:wrap;
    }
    .files-list { display:grid; gap:8px; }
    .file-item {
      display:grid;
      grid-template-columns:20px minmax(0, 1fr) auto;
      gap:10px;
      align-items:start;
      padding:10px 12px;
      border-radius:14px;
      border:1px solid rgba(15,23,42,.10);
      background:rgba(248,250,252,.9);
    }
    .file-item strong { display:block; }
    .file-item small { display:block; color:var(--muted); margin-top:2px; }
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
      .sendbar { grid-template-columns:1fr; }
      .pending-summary { grid-template-columns:1fr 1fr; }
      .pending-summary-copy { grid-column:1 / -1; }
    }
    @media (max-width: 640px) {
      .summary-grid { grid-template-columns:1fr; }
      .overview-grid { grid-template-columns:1fr; }
      .pending-summary { grid-template-columns:1fr; margin-left:12px; margin-right:12px; }
      .pending-summary-copy { grid-column:auto; }
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
      { id: "sin-liberacion", label: "No liberados" },
      { id: "sin-liberacion-sin-trabajo", label: "Sin trabajo" },
      { id: "sin-liberacion-no-enviados", label: "No enviados" },
      { id: "sin-liberacion-enviados", label: "Enviados" },
      { id: "liberados", label: "Liberados" },
      { id: "pendientes-pago", label: "No pagados" },
      { id: "pagados", label: "Pagados" },
    ];
    const ORDER_TYPE_TABS = [
      { id: "all", label: "Todos" },
      { id: "estatal", label: "Estatales" },
      { id: "municipal", label: "Municipales" },
    ];
    const ORDER_STATUS_LABELS = {
      "sin-liberacion": "No liberado",
      "sin-liberacion-sin-trabajo": "No liberado · Sin trabajo",
      "sin-liberacion-no-enviados": "No liberado · No enviado",
      "sin-liberacion-enviados": "No liberado · Enviado",
      liberados: "Liberado",
      "pendientes-pago": "No pagado",
      pagados: "Pagado",
    };
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

    function extractYear(value) {
      const text = String(value || "").trim();
      if (!text) return null;
      const directYear = text.match(/\b(20\d{2})\b/);
      if (directYear?.[1]) return Number(directYear[1]);
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed.getFullYear();
      return null;
    }

    function trabajosDelYear(row, year) {
      const targetYear = Number(year);
      const trabajos = [];
      if (Number.isFinite(targetYear) && extractYear(row.ultimoPipcEstatal || row.tienda?.ultimoPipcEstatal) === targetYear) {
        trabajos.push("Estatal");
      }
      if (Number.isFinite(targetYear) && extractYear(row.ultimoPipcMunicipal || row.tienda?.ultimoPipcMunicipal) === targetYear) {
        trabajos.push("Municipal");
      }
      return trabajos.length ? trabajos.join(" + ") : "Sin trabajo del año";
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

    function isSent(row) {
      return Boolean(row?.enviadoBool) || ["SI", "S", "Y", "YES", "TRUE", "1", "ENVIADO", "SENT"].includes(normalizeText(row?.enviado));
    }

    function orderStatusBucket(row) {
      const flags = row?._flags || {};
      const business = row?.business || {};
      if (business.status === "sin-liberacion" && business.deliveryStatus) return business.deliveryStatus;
      if (business.status) return business.status;
      if (business.sinLiberacionEnviado) return "sin-liberacion-enviados";
      if (business.sinLiberacionListo) return "sin-liberacion-no-enviados";
      if (business.sinLiberacionSinTrabajo) return "sin-liberacion-sin-trabajo";
      if (business.pagado) return "pagados";
      if (business.noPagado) return "pendientes-pago";
      if (business.liberadoPendienteFactura) return "liberados";
      if (flags.noLiberado) return isSent(row) ? "sin-liberacion-enviados" : "sin-liberacion-no-enviados";
      if (flags.pendientePago) return "pendientes-pago";
      if (flags.liberadoPendLey) return "liberados";
      if (flags.pago) return "pagados";
      return "otros";
    }

    function statusMatches(bucket, filter) {
      if (filter === "all") return true;
      if (filter === "sin-liberacion") {
        return bucket === "sin-liberacion-sin-trabajo";
      }
      return bucket === filter;
    }

    function rowStatusMatches(row, filter) {
      const business = row?.business || {};
      if (filter === "all") return true;
      if (filter === "sin-liberacion") {
        return business.status ? business.status === "sin-liberacion" : Boolean(row?._flags?.noLiberado);
      }
      const flags = {
        "sin-liberacion-no-enviados": "sinLiberacionListo",
        "sin-liberacion-enviados": "sinLiberacionEnviado",
        "sin-liberacion-sin-trabajo": "sinLiberacionSinTrabajo",
        liberados: "liberadoPendienteFactura",
        "pendientes-pago": "noPagado",
        pagados: "pagado",
      };
      return Boolean((flags[filter] && business[flags[filter]]) || business.status === filter || orderStatusBucket(row) === filter);
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
      return String(value || "").replace(/["\\\\]/g, "\\\\$&");
    }

    function fileKey(file) {
      return String(file?.id || file?.relativePath || file?.path || file?.openUrl || file?.downloadUrl || file?.name || "").trim();
    }

    async function apiJson(url, options = {}) {
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: {
          "X-Requested-With": "fetch",
          ...(options.headers || {}),
        },
        ...options,
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("El backend no devolvio JSON valido.");
      }
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "HTTP " + response.status);
      }
      return data;
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
      }));
    }

    function buildInitialState() {
      const defaults = {
        year: Number(INITIAL.year || new Date().getFullYear()),
        estatalMin: Number(INITIAL.thresholds?.estatalMin || 32967.49),
        municipalMin: Number(INITIAL.thresholds?.municipalMin || 11000),
      };
      const stored = loadStoredState();
      const url = parseUrlState();
      return {
        year: Number.isFinite(url.year) ? url.year : Number.isFinite(Number(stored.year)) ? Number(stored.year) : defaults.year,
        estatalMin: Number.isFinite(url.estatalMin) ? url.estatalMin : Number.isFinite(Number(stored.estatalMin)) ? Number(stored.estatalMin) : defaults.estatalMin,
        municipalMin: Number.isFinite(url.municipalMin) ? url.municipalMin : Number.isFinite(Number(stored.municipalMin)) ? Number(stored.municipalMin) : defaults.municipalMin,
        facturadorId: String(url.facturadorId || INITIAL.facturadorId || "").trim(),
        section: url.section === "cobertura" ? "cobertura" : "pedidos",
        orderStatus: ["all", "sin-liberacion", "sin-liberacion-sin-trabajo", "sin-liberacion-no-enviados", "sin-liberacion-enviados", "liberados", "pendientes-pago", "pagados"].includes(url.orderStatus) ? url.orderStatus : "all",
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
        .filter(allowedBranch);

      for (const row of branches) {
        const keyAliases = [
          row.key,
          row.id,
          row.rowId,
          row.row_id,
          row.tienda,
          row.raw?.id,
          row.raw?.ID,
          row.raw?.["Row ID"],
          row.raw?.row_id,
        ];
        const labelAliases = [
          row.displayLabel,
          row.label,
          row.label2,
          row.tienda,
          row.raw?.LABEL,
          row.raw?.Label,
          row.raw?.LABEL2,
        ];
        for (const alias of keyAliases) {
          const key = normalizeText(alias);
          if (key) branchByKey.set(key, row);
        }
        for (const alias of labelAliases) {
          const label = normalizeText(alias);
          if (label) branchByLabel.set(label, row);
        }
      }

      const orders = state.rows
        .map((row) => {
          const amount = Number(row.importeNumber);
          const estatalMin = Number(state.estatalMin || 32967.49);
          const municipalMin = Number(state.municipalMin || 11000);
          const tipo = row.tipoClasificacion
            || classifyByDescription(row.descripcion)
            || classifyByImport(amount, estatalMin, municipalMin);
          const statusText = normalizeText(row.status);
          const business = row.business || {};
          const branch = findBranchForOrder(row, { branchByKey, branchByLabel });
          const order = {
            ...row,
            _branch: branch,
            _flags: {
              tipo,
              liberado: business.hasLiberacion ?? (statusText.includes("LIBERADO") || statusText.includes("LIBERACION") || statusText.includes("LIBERADO PENDIENTE")),
              facturaLey: business.hasFacturaLey ?? statusText.includes("LEY"),
              pago: business.pagado ?? statusText.includes("PAGO"),
              noLiberado: business.hasLiberacion === false || statusText.includes("SIN LIBERACION")
                || statusText.includes("NO LIBERADO")
                || (statusText.includes("PENDIENTE") && !statusText.includes("PAGO")),
              liberadoPendLey: business.liberadoPendienteFactura ?? (statusText.includes("LIBERADO") && !statusText.includes("LEY")),
              pendientePago: business.noPagado ?? (statusText.includes("PENDIENTE") && statusText.includes("PAGO")),
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
      const keyAliases = [
        order.tiendaKey,
        order.establecimiento,
        order.tienda?.id,
        order.tienda?.key,
        order.raw?.TIENDA,
        order.raw?.ESTABLECIMIENTO,
      ];
      for (const alias of keyAliases) {
        const branch = index.branchByKey.get(normalizeText(alias));
        if (branch) return branch;
      }

      const labelAliases = [order.tiendaLabel, order.tienda?.label, order.establecimiento];
      for (const alias of labelAliases) {
        const branch = index.branchByLabel.get(normalizeText(alias));
        if (branch) return branch;
      }
      return null;
    }

    function visibleOrderRows() {
      const query = normalizeText(state.search);
      const selectedYear = Number(state.year || INITIAL.year || new Date().getFullYear());
      return model.orders
        .filter((row) => !state.facturadorId || normalizeText(row.facturadorId) === normalizeText(state.facturadorId))
        .filter((row) => !Number.isFinite(selectedYear) || !row.fechaYear || Number(row.fechaYear) === selectedYear)
        .filter((row) => {
          const flags = row._flags;
          const bucket = orderStatusBucket(row);
          if (!rowStatusMatches(row, state.orderStatus)) return false;
          if (state.orderType === "estatal" && !flags.estatal) return false;
          if (state.orderType === "municipal" && !flags.municipal) return false;
          if (query && !row._searchText.includes(query)) return false;
          return true;
        })
        .sort((a, b) => Number(b.fechaYear || 0) - Number(a.fechaYear || 0));
    }

    function allowedBranch(row) {
      const status = normalizeText(row.status || row.planeacionStatus || row.raw?.planeacion_status || "");
      const blocked = ["INACTIVA", "INACTIVO", "BAJA", "CANCELADA", "CANCELADO"].some((word) => status.includes(word));
      return normalizeText(row.empresaId) === "1"
        && !blocked
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
        .filter((row) => !state.year || Number(row.fechaYear) === Number(state.year))
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
      const missingEstatal = missingCoverageEntries("estatal");
      const missingMunicipal = missingCoverageEntries("municipal");
      const missingTotal = missingEstatal.length + missingMunicipal.length;
      const totals = {
        total: rows.length,
        sinLiberacion: rows.filter((row) => row.business?.status === "sin-liberacion" || (!row.business?.status && row._flags.noLiberado)).length,
        sinLiberacionSinTrabajo: rows.filter((row) => orderStatusBucket(row) === "sin-liberacion-sin-trabajo").length,
        liberados: rows.filter((row) => orderStatusBucket(row) === "liberados").length,
        pendientesPago: rows.filter((row) => orderStatusBucket(row) === "pendientes-pago").length,
        pagados: rows.filter((row) => orderStatusBucket(row) === "pagados").length,
        sinLiberacionNoEnviados: rows.filter((row) => orderStatusBucket(row) === "sin-liberacion-no-enviados").length,
        sinLiberacionEnviados: rows.filter((row) => orderStatusBucket(row) === "sin-liberacion-enviados").length,
      };
      return ''
        + '<section class="pending-summary" aria-label="Sucursales sin el pedido requerido">'
        + '<div class="pending-summary-copy"><div class="eyebrow">Pedidos faltantes por cobertura</div><strong>' + esc(missingTotal) + ' pedidos requeridos sin registrar</strong><p>Sucursales con trabajo configurado que todavía no tienen el pedido municipal o estatal del año seleccionado.</p></div>'
        + '<button class="pending-type-card" type="button" data-missing-kind="estatal"><span>Estatales faltantes</span><strong>' + esc(missingEstatal.length) + '</strong><small>Ver sucursales sin pedido estatal</small></button>'
        + '<button class="pending-type-card" type="button" data-missing-kind="municipal"><span>Municipales faltantes</span><strong>' + esc(missingMunicipal.length) + '</strong><small>Ver sucursales sin pedido municipal</small></button>'
        + '</section>'
        + '<div class="overview-grid">'
        + '<article class="summary-card"><div class="eyebrow">Pedidos visibles</div><div class="value">' + esc(totals.total) + '</div><div class="detail">Con el año, proveedor y filtros activos.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">No liberados</div><div class="value">' + esc(totals.sinLiberacion) + '</div><div class="detail">Incluye sin trabajo, no enviados y enviados.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">Sin trabajo</div><div class="value">' + esc(totals.sinLiberacionSinTrabajo) + '</div><div class="detail">Sin liberación ni trabajo listo.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">No enviados</div><div class="value">' + esc(totals.sinLiberacionNoEnviados) + '</div><div class="detail">Trabajo listo; correo pendiente.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">Enviados</div><div class="value">' + esc(totals.sinLiberacionEnviados) + '</div><div class="detail">Correo enviado; liberación pendiente.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">Liberados</div><div class="value">' + esc(totals.liberados) + '</div><div class="detail">Pendientes de subir a ley.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">No pagados</div><div class="value">' + esc(totals.pendientesPago) + '</div><div class="detail">En Casa Ley; cheque pendiente.</div></article>'
        + '<article class="summary-card"><div class="eyebrow">Pagados</div><div class="value">' + esc(totals.pagados) + '</div><div class="detail">Pago relacionado localizado.</div></article>'
        + '</div>'
        + '<div class="tabs" id="orderStatusTabs"></div>'
        + '<div class="tabs" id="orderTypeTabs" style="padding-top:10px;"></div>'
        + '<div class="sendbar">'
        + '<div class="field"><label for="senderSelect">Remitente</label><select id="senderSelect"><option value="">Cargando remitentes...</option></select></div>'
        + '<div class="field"><label for="toInput">Destino</label><input id="toInput" type="text" placeholder="correo@dominio.com"></div>'
        + '<button class="btn secondary" id="configRefreshBtn" type="button">Actualizar remitente</button>'
        + '<div class="send-status" id="sendStatus">Listo para cargar archivos bajo demanda.</div>'
        + '</div>'
        + '<div class="stats" style="padding:12px 16px 0;">Mostrando ' + esc(rows.length) + ' de ' + esc(state.rows.length) + ' pedidos del año ' + esc(state.year) + '</div>'
        + '<div class="table-shell">'
        + '<table>'
        + '<thead>'
        + '<tr>'
        + '<th>Pedido</th>'
        + '<th>Tipo</th>'
        + '<th>Sucursal</th>'
        + '<th>Municipio</th>'
        + '<th>Importe</th>'
        + '<th>Trabajos</th>'
        + '<th>Acciones</th>'
        + '</tr>'
        + '</thead>'
        + '<tbody>'
        + (rows.length ? rows.map((row) => {
          const flags = row._flags;
          const municipioLabel = row.tienda?.municipioNombre || row.tienda?.municipioLabel || row.municipio?.nombre || row.municipio?.displayLabel || "";
          const estadoLabel = row.tienda?.estadoNombre || row.tienda?.estadoLabel || row.estado?.nombre || row.estado?.displayLabel || "";
          const bucket = orderStatusBucket(row);
          const canSend = Boolean(row.pedido) && Boolean(row.business?.sinLiberacionListo || row.business?.sinLiberacionEnviado);
          const sendLabel = bucket === "sin-liberacion-enviados" ? "Reenviar" : "Enviar";
          const sentLabel = bucket === "sin-liberacion-enviados" ? chip("Enviado", "ok") : bucket === "sin-liberacion-no-enviados" ? chip("No enviado", "warn") : "";
          const tipoLabel = row.clasificacionLabel || (flags.estatal ? "Estatal" : flags.municipal ? "Municipal" : "Otro");
          const trabajosYear = trabajosDelYear(row, state.year);
          return ''
            + '<tr data-order-row="' + esc(row.pedido || "") + '">'
            + '<td><strong>' + esc(row.pedido || "") + '</strong></td>'
            + '<td>' + chip(tipoLabel, row.clasificacionLabel && normalizeText(row.clasificacionLabel).includes("CULIACAN") ? "warn" : flags.estatal ? "ok" : flags.municipal ? "blue" : "") + '</td>'
            + '<td><strong>' + esc(row._branch ? branchLabel(row._branch) : (row.tiendaLabel || row.establecimiento || "")) + '</strong></td>'
            + '<td><strong>' + esc(municipioLabel) + '</strong></td>'
            + '<td><strong>' + esc(money(row.importeNumber)) + '</strong></td>'
            + '<td>' + chip(trabajosYear, trabajosYear === "Sin trabajo del año" ? "warn" : "ok") + '</td>'
            + '<td><div class="row-actions">' + (canSend ? sentLabel + '<button class="btn secondary" type="button" data-toggle-files="' + esc(row.pedido || "") + '">Ver archivos</button><button class="btn primary" type="button" data-send="' + esc(row.pedido || "") + '">' + esc(sendLabel) + '</button>' : (sentLabel || chip(ORDER_STATUS_LABELS[bucket] || "Sin clasificar", bucket === "pagados" ? "ok" : bucket === "pendientes-pago" ? "warn" : ""))) + '</div></td>'
            + '</tr>'
            + '<tr class="detail-row" data-detail-row="' + esc(row.pedido || "") + '" hidden><td colspan="7"><div class="files-panel"><div class="files-head"><strong>Archivos del pedido ' + esc(row.pedido || "") + '</strong><span class="muted" data-files-state="' + esc(row.pedido || "") + '">Selecciona "Ver archivos" para cargar Drive solo para este pedido.</span></div><div class="files-list" data-files-list="' + esc(row.pedido || "") + '"></div></div></td></tr>';
        }).join("") : '<tr><td colspan="7" class="empty">No hay pedidos con estos filtros.</td></tr>')
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
        const entries = getCoverageEntries(kind).filter((item) => coverageEntryMatchesSearch(item, query));
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
          + '<section class="panel" data-coverage-kind="' + esc(kind) + '" style="margin-top:18px;padding:18px;">'
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
          + '<h3 style="margin:18px 0 0;font-size:15px;">' + esc(title) + 'es faltantes</h3>'
          + tableMarkup(withoutOrder, 'No hay sucursales pendientes en ' + title.toLowerCase() + '.', true)
          + '<details class="advanced-filters" style="margin-top:18px;">'
          + '<summary>Ver sucursales con pedido ' + esc(title.toLowerCase()) + '</summary>'
          + '<div style="padding:0 16px 16px;">' + tableMarkup(withOrder, 'No hay sucursales con pedido ' + title.toLowerCase() + '.') + '</div>'
          + '</details>'
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
        document.querySelectorAll("[data-missing-kind]").forEach((button) => {
          button.addEventListener("click", () => {
            const kind = button.getAttribute("data-missing-kind") || "";
            state.coverageOpen = true;
            render();
            requestAnimationFrame(() => {
              document.querySelector('[data-coverage-kind="' + cssEscape(kind) + '"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          });
        });
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
      renderSectionTabs();
      bindSendControls();
    }

    function render() {
      renderHeader();
      renderContent();
    }

    const filesByPedido = new Map();
    const selectedFilesByPedido = new Map();

    function setSendStatus(message, kind = "") {
      const node = document.getElementById("sendStatus");
      if (!node) return;
      node.textContent = message || "";
      node.classList.toggle("ok", kind === "ok");
      node.classList.toggle("err", kind === "err");
    }

    function markRowSentInView(row) {
      if (!row) return;
      row.enviado = "SI";
      row.enviadoBool = true;
      row.business = {
        ...(row.business || {}),
        status: "sin-liberacion",
        deliveryStatus: "sin-liberacion-enviados",
        sinLiberacionEnviado: true,
        sinLiberacionListo: false,
        sinLiberacionSinTrabajo: false,
      };
    }

    function renderFiles(pedido, files) {
      const list = document.querySelector('[data-files-list="' + cssEscape(pedido) + '"]');
      const stateNode = document.querySelector('[data-files-state="' + cssEscape(pedido) + '"]');
      if (!list) return;
      if (!files.length) {
        list.innerHTML = '<div class="empty">No se encontraron archivos para este pedido.</div>';
        if (stateNode) stateNode.textContent = "Sin archivos encontrados.";
        return;
      }
      selectedFilesByPedido.set(pedido, new Set(files.map(fileKey).filter(Boolean)));
      list.innerHTML = files.map((file) => {
        const key = fileKey(file);
        const label = file.name || file.relativePath || key;
        const meta = [file.mimeType, file.size ? (Math.round(Number(file.size) / 1024) + " KB") : ""].filter(Boolean).join(" · ");
        const link = file.openUrl || file.downloadUrl || "";
        return '<label class="file-item">'
          + '<input type="checkbox" data-file="' + esc(pedido) + '" value="' + esc(key) + '" checked>'
          + '<span><strong>' + esc(label) + '</strong><small>' + esc(meta || "Archivo disponible") + '</small></span>'
          + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Abrir</a>' : '<span></span>')
          + '</label>';
      }).join("");
      if (stateNode) stateNode.textContent = files.length + " archivo(s) cargado(s).";
      list.querySelectorAll("[data-file]").forEach((input) => {
        input.addEventListener("change", () => {
          selectedFilesByPedido.set(pedido, new Set(Array.from(list.querySelectorAll("[data-file]:checked")).map((item) => String(item.value || "").trim()).filter(Boolean)));
        });
      });
    }

    function coverageEntryMatchesSearch(item, query = normalizeText(state.search)) {
      if (!query) return true;
      const haystack = [
        item.branch.key,
        item.branch.label,
        item.branch.displayLabel,
        item.branch.municipioNombre || item.branch.municipioLabel,
        item.branch.estadoNombre || item.branch.estadoLabel,
        item.branch.trabajos,
        item.order?.pedido,
        item.order?.status,
      ].map((value) => normalizeText(value)).join(" ");
      return haystack.includes(query);
    }

    function missingCoverageEntries(kind) {
      return getCoverageEntries(kind)
        .filter((item) => coverageEntryMatchesSearch(item))
        .filter((item) => !item.order);
    }

    async function loadFilesForPedido(pedido, { open = true } = {}) {
      const safePedido = String(pedido || "").trim();
      if (!safePedido) throw new Error("Falta pedido.");
      const detail = document.querySelector('[data-detail-row="' + cssEscape(safePedido) + '"]');
      const stateNode = document.querySelector('[data-files-state="' + cssEscape(safePedido) + '"]');
      if (open && detail) detail.hidden = false;
      if (filesByPedido.has(safePedido)) return filesByPedido.get(safePedido);
      if (stateNode) stateNode.textContent = "Cargando archivos de Drive...";
      const data = await apiJson("/api/pedidos-ley/pedido/" + encodeURIComponent(safePedido) + "/files");
      const files = Array.isArray(data.matchedFiles) ? data.matchedFiles : [];
      filesByPedido.set(safePedido, files);
      renderFiles(safePedido, files);
      return files;
    }

    async function loadSendConfig() {
      const senderSelect = document.getElementById("senderSelect");
      const toInput = document.getElementById("toInput");
      if (!senderSelect && !toInput) return;
      try {
        const [config, senderStatus] = await Promise.all([
          apiJson("/api/pedidos-ley/config"),
          apiJson("/api/pedidos-ley/sender/status"),
        ]);
        const recipients = Array.isArray(config.defaultRecipients) ? config.defaultRecipients : ["SGIIREGION1@casaley.com.mx"];
        if (toInput && !String(toInput.value || "").trim()) toInput.value = recipients.join(", ");
        const accounts = Array.isArray(senderStatus.accounts) ? senderStatus.accounts : [];
        if (senderSelect) {
          senderSelect.innerHTML = '<option value="">-- Seleccionar remitente --</option>' + accounts.map((account) => {
            const email = String(account.email || "").trim();
            return '<option value="' + esc(email) + '"' + (email === senderStatus.activeEmail ? " selected" : "") + '>' + esc(email) + '</option>';
          }).join("");
        }
        setSendStatus(accounts.length ? "Remitente listo." : "No hay remitentes configurados.", accounts.length ? "ok" : "err");
      } catch (error) {
        setSendStatus(error instanceof Error ? error.message : "No se pudo cargar remitente.", "err");
      }
    }

    function bindSendControls() {
      const senderSelect = document.getElementById("senderSelect");
      const toInput = document.getElementById("toInput");
      const refreshBtn = document.getElementById("configRefreshBtn");
      refreshBtn?.addEventListener("click", loadSendConfig);
      senderSelect?.addEventListener("change", async () => {
        const email = String(senderSelect.value || "").trim();
        if (!email) return;
        try {
          await apiJson("/api/pedidos-ley/sender/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          setSendStatus("Remitente activo: " + email, "ok");
        } catch (error) {
          setSendStatus(error instanceof Error ? error.message : "No se pudo seleccionar remitente.", "err");
        }
      });
      document.querySelectorAll("[data-toggle-files]").forEach((button) => {
        button.addEventListener("click", async () => {
          const pedido = String(button.getAttribute("data-toggle-files") || "").trim();
          const detail = document.querySelector('[data-detail-row="' + cssEscape(pedido) + '"]');
          if (!detail) return;
          const shouldOpen = detail.hidden;
          detail.hidden = !shouldOpen;
          button.textContent = shouldOpen ? "Ocultar archivos" : "Ver archivos";
          if (shouldOpen) {
            try {
              await loadFilesForPedido(pedido);
            } catch (error) {
              setSendStatus(error instanceof Error ? error.message : "No se pudieron cargar archivos.", "err");
            }
          }
        });
      });
      document.querySelectorAll("[data-send]").forEach((button) => {
        button.addEventListener("click", async () => {
          const pedido = String(button.getAttribute("data-send") || "").trim();
          const row = state.rows.find((item) => String(item.pedido || "").trim() === pedido);
          const to = String(toInput?.value || "").trim();
          const fromEmail = String(senderSelect?.value || "").trim();
          if (!to) {
            setSendStatus("Agrega al menos un correo destino.", "err");
            return;
          }
          try {
            button.disabled = true;
            setSendStatus("Cargando archivos del pedido " + pedido + "...", "");
            const files = await loadFilesForPedido(pedido);
            const selected = selectedFilesByPedido.get(pedido) || new Set(files.map(fileKey).filter(Boolean));
            const selectedFiles = files.filter((file) => selected.has(fileKey(file)));
            if (!selectedFiles.length) {
              setSendStatus("Selecciona al menos un archivo para enviar.", "err");
              return;
            }
            setSendStatus("Enviando pedido " + pedido + "...", "");
            await apiJson("/api/pedidos-ley/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pedido,
                to,
                fromEmail,
                facturadorNombre: row?.facturadorNombre || "",
                files: selectedFiles,
                textBody: "Le informamos que el trabajo correspondiente al pedido " + pedido + " ya esta listo. Adjuntamos el documento final para su revision.",
                htmlBody: "<p>Le informamos que el trabajo correspondiente al pedido <strong>" + esc(pedido) + "</strong> ya esta listo.</p><p>Adjuntamos el documento final para su revision.</p>",
              }),
            });
            markRowSentInView(row);
            render();
            setSendStatus("Pedido " + pedido + " enviado correctamente.", "ok");
          } catch (error) {
            setSendStatus(error instanceof Error ? error.message : "No se pudo enviar el pedido.", "err");
          } finally {
            button.disabled = false;
          }
        });
      });
      void loadSendConfig();
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
        state.orderStatus = "all";
      state.orderType = "all";
      state.search = "";
      state.year = Number(INITIAL.year || new Date().getFullYear());
      state.estatalMin = Number(INITIAL.thresholds?.estatalMin || 32967.49);
      state.municipalMin = Number(INITIAL.thresholds?.municipalMin || 11000);
      state.facturadorId = "";
      localStorage.removeItem(STORAGE_KEY);
      render();
    });
  </script>
  <script src="/ui/portal-shell.js?v=20260901b" defer></script>
</body>
</html>`;
}








