import express from "express";

export const homeRouter = express.Router();

const quickGroups = [
  {
    title: "Operación y soporte",
    intro: "Accesos a la salud del monolito, el panel de estado y los procesos de control.",
    cards: [
      {
        tone: "status",
        label: "Panel operativo",
        title: "Estado de servicios",
        description: "Monitoreo de servicios públicos, jobs, PM2 y WhatsApp. El panel que antes estaba en la raíz.",
        href: "/status",
        route: "/status",
      },
      {
        tone: "emerald",
        label: "Salud",
        title: "Health general",
        description: "Respuesta básica del monolito y componentes principales.",
        href: "/health",
        route: "/health",
      },
      {
        tone: "slate",
        label: "Automatización",
        title: "Jobs",
        description: "Ejecución manual y estado del scheduler centralizado.",
        href: "/jobs",
        route: "/jobs",
      },
      {
        tone: "amber",
        label: "Mensajería",
        title: "WhatsApp Capacitadores",
        description: "Estado de la sesión de WhatsApp Web y el QR de acceso cuando aplica.",
        href: "/whatsapp-capacitadores",
        route: "/whatsapp-capacitadores",
      },
    ],
  },
  {
    title: "Documentos y reportes",
    intro: "Herramientas de consulta, exportación y generación documental.",
    cards: [
      {
        tone: "blue",
        label: "Facturación",
        title: "Cotizaciones",
        description: "Generador y consulta de cotizaciones y PDFs de facturación.",
        href: "/facturacion/cotizacion/html",
        route: "/facturacion/cotizacion/html",
      },
      {
        tone: "violet",
        label: "Documentos",
        title: "Sucursales Docs",
        description: "Emisión de documentos y constancias por sucursal.",
        href: "/SUCURSALES-DOCS/",
        route: "/SUCURSALES-DOCS/",
      },
      {
        tone: "rose",
        label: "Control",
        title: "Faltantes Ley",
        description: "Consulta de sucursales con documentación pendiente.",
        href: "/FALTANTES-LEY/",
        route: "/FALTANTES-LEY/",
      },
      {
        tone: "teal",
        label: "Reporte",
        title: "Solventaciones",
        description: "Tablero de visitas, incidencias y solventaciones por sucursal.",
        href: "/SOLVENTACIONES/html",
        route: "/SOLVENTACIONES/html",
      },
    ],
  },
  {
    title: "Herramientas internas",
    intro: "Aplicaciones de apoyo para operación diaria y generación de material.",
    cards: [
      {
        tone: "green",
        label: "Planeación",
        title: "Planeación Ley",
        description: "Vista de planeación mensual dentro del monolito.",
        href: "/Planeacion-ley/",
        route: "/Planeacion-ley/",
      },
      {
        tone: "orange",
        label: "Constancias",
        title: "Constancias V2",
        description: "Generación y consulta de constancias con compatibilidad pública.",
        href: "/CONSTANCIAS/",
        route: "/CONSTANCIAS/",
      },
      {
        tone: "indigo",
        label: "PDF",
        title: "Separar PIPC",
        description: "Herramienta para analizar y dividir archivos PIPC en documentos separados.",
        href: "/SEPARAR-PIPC/",
        route: "/SEPARAR-PIPC/",
      },
      {
        tone: "slate",
        label: "Contabilidad",
        title: "Módulo contable",
        description: "API interna del módulo contable dentro del monolito.",
        href: "/contabilidad",
        route: "/contabilidad",
      },
    ],
  },
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCard(card) {
  return `
    <a class="portal-card tone-${escapeHtml(card.tone)}" href="${escapeHtml(card.href)}">
      <div class="portal-card-head">
        <span class="portal-chip">${escapeHtml(card.label)}</span>
        <span class="portal-route">${escapeHtml(card.route)}</span>
      </div>
      <h3>${escapeHtml(card.title)}</h3>
      <p>${escapeHtml(card.description)}</p>
      <span class="portal-link">Abrir aplicación</span>
    </a>
  `;
}

function renderGroup(group) {
  return `
    <section class="portal-group">
      <div class="section-head">
        <div>
          <h2>${escapeHtml(group.title)}</h2>
          <p>${escapeHtml(group.intro)}</p>
        </div>
      </div>
      <div class="portal-grid">
        ${group.cards.map(renderCard).join("\n")}
      </div>
    </section>
  `;
}

export function renderHomeHtml() {
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Apps | Desarrollo EG</title>
  <style>
    :root {
      --bg: #f3efe7;
      --surface: rgba(255, 252, 247, 0.88);
      --surface-strong: rgba(255, 255, 255, 0.96);
      --ink: #14202b;
      --muted: #607080;
      --line: rgba(24, 36, 49, 0.12);
      --shadow: 0 20px 60px rgba(20, 32, 43, 0.08);
      --accent: #0f4c5c;
      --accent-soft: #d8eef2;
      --blue: #1d4ed8;
      --blue-soft: #dbeafe;
      --emerald: #0f766e;
      --emerald-soft: #d1fae5;
      --amber: #b45309;
      --amber-soft: #fef3c7;
      --violet: #6d28d9;
      --violet-soft: #ede9fe;
      --rose: #be123c;
      --rose-soft: #ffe4e6;
      --teal: #0f766e;
      --teal-soft: #ccfbf1;
      --green: #166534;
      --green-soft: #dcfce7;
      --orange: #c2410c;
      --orange-soft: #ffedd5;
      --indigo: #4338ca;
      --indigo-soft: #e0e7ff;
      --slate: #475569;
      --slate-soft: #e2e8f0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15, 76, 92, 0.16), transparent 24%),
        radial-gradient(circle at top right, rgba(196, 138, 48, 0.16), transparent 26%),
        linear-gradient(180deg, #f4efe7 0%, #fbf8f3 46%, #efe7db 100%);
      font-family: Bahnschrift, Aptos, "Segoe UI", sans-serif;
    }
    a { color: inherit; }
    main {
      max-width: 1320px;
      margin: 0 auto;
      padding: 28px 18px 56px;
    }
    .hero {
      position: relative;
      overflow: hidden;
      border-radius: 30px;
      background: linear-gradient(135deg, rgba(15, 76, 92, 0.94), rgba(18, 30, 42, 0.96));
      color: #f7f9fb;
      box-shadow: var(--shadow);
      border: 1px solid rgba(255,255,255,0.08);
      padding: 30px;
    }
    .hero::after {
      content: "";
      position: absolute;
      inset: auto -4% -34% auto;
      width: 360px;
      height: 360px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(244, 193, 93, 0.28), transparent 68%);
      pointer-events: none;
    }
    .hero-grid {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.85fr);
      gap: 22px;
    }
    .hero h1 {
      margin: 0;
      font-size: clamp(2.1rem, 4.4vw, 3.8rem);
      line-height: 0.94;
      letter-spacing: -0.04em;
    }
    .hero p {
      margin: 14px 0 0;
      max-width: 720px;
      color: rgba(247, 249, 251, 0.82);
      font-size: 1rem;
      line-height: 1.55;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 22px;
    }
    .button {
      appearance: none;
      border: 0;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 11px 16px;
      border-radius: 999px;
      font-weight: 800;
      font-size: 0.95rem;
      transition: transform 180ms ease, background 180ms ease;
    }
    .button:hover { transform: translateY(-1px); }
    .button.primary { background: #f4c15d; color: #1a1b1d; }
    .button.ghost {
      background: rgba(255,255,255,0.08);
      color: #f7f9fb;
      border: 1px solid rgba(255,255,255,0.14);
    }
    .hero-side {
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .hero-note {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 18px;
      padding: 16px;
    }
    .hero-note strong {
      display: block;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: rgba(247, 249, 251, 0.7);
    }
    .hero-note p {
      margin: 6px 0 0;
      font-size: 0.95rem;
      color: rgba(247, 249, 251, 0.92);
    }
    .hero-callout {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.06));
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 22px;
      padding: 18px;
    }
    .hero-callout .label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border-radius: 999px;
      background: rgba(244, 193, 93, 0.18);
      color: #fff3c4;
      font-size: 0.77rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .hero-callout h2 {
      margin: 14px 0 0;
      font-size: 1.2rem;
    }
    .hero-callout p {
      margin-top: 10px;
      color: rgba(247, 249, 251, 0.84);
    }
    .portal-group { margin-top: 28px; }
    .section-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: end;
      gap: 12px;
      margin-bottom: 14px;
    }
    .section-head h2 {
      margin: 0;
      font-size: clamp(1.35rem, 2.2vw, 1.85rem);
      letter-spacing: -0.02em;
    }
    .section-head p {
      margin: 6px 0 0;
      max-width: 820px;
      color: var(--muted);
      line-height: 1.5;
    }
    .portal-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }
    .portal-card {
      --card-accent: var(--accent);
      --card-soft: rgba(15, 76, 92, 0.06);
      display: flex;
      flex-direction: column;
      min-height: 208px;
      padding: 18px;
      border-radius: 24px;
      border-top: 5px solid var(--card-accent);
      background:
        linear-gradient(180deg, var(--card-soft), rgba(255, 255, 255, 0.92)),
        var(--surface-strong);
      border-left: 1px solid var(--line);
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      text-decoration: none;
      box-shadow: var(--shadow);
      transition: transform 180ms ease, box-shadow 180ms ease;
    }
    .portal-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 24px 70px rgba(20, 32, 43, 0.12);
    }
    .portal-card-head {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 12px;
      margin-bottom: 14px;
    }
    .portal-chip {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.75);
      font-size: 0.72rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .portal-route {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 0.8rem;
      color: var(--muted);
      word-break: break-all;
      text-align: right;
    }
    .portal-card h3 {
      margin: 0;
      font-size: 1.18rem;
      letter-spacing: -0.02em;
    }
    .portal-card p {
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.5;
      flex: 1;
    }
    .portal-link {
      margin-top: 18px;
      font-weight: 800;
      color: var(--card-accent);
    }
    .tone-status { --card-accent: var(--accent); --card-soft: var(--accent-soft); }
    .tone-emerald { --card-accent: var(--emerald); --card-soft: var(--emerald-soft); }
    .tone-amber { --card-accent: var(--amber); --card-soft: var(--amber-soft); }
    .tone-blue { --card-accent: var(--blue); --card-soft: var(--blue-soft); }
    .tone-violet { --card-accent: var(--violet); --card-soft: var(--violet-soft); }
    .tone-rose { --card-accent: var(--rose); --card-soft: var(--rose-soft); }
    .tone-teal { --card-accent: var(--teal); --card-soft: var(--teal-soft); }
    .tone-green { --card-accent: var(--green); --card-soft: var(--green-soft); }
    .tone-orange { --card-accent: var(--orange); --card-soft: var(--orange-soft); }
    .tone-indigo { --card-accent: var(--indigo); --card-soft: var(--indigo-soft); }
    .tone-slate { --card-accent: var(--slate); --card-soft: var(--slate-soft); }
    .footer-note {
      margin-top: 18px;
      color: var(--muted);
      font-size: 0.92rem;
      text-align: center;
    }
    @media (max-width: 900px) {
      .hero-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="hero-grid">
        <div>
          <h1>Portal principal de Desarrollo EG</h1>
          <p>Esta es la nueva pantalla de entrada de <strong>apps.desarrolloeg.com</strong>. El panel operativo que antes estaba en la raíz ahora vive en <strong>/status</strong> para separar mejor la navegación principal del monitoreo.</p>
          <div class="hero-actions">
            <a class="button primary" href="/status">Abrir panel de estado</a>
            <a class="button ghost" href="/health">Health</a>
            <a class="button ghost" href="/facturacion/cotizacion/html">Ir a facturación</a>
          </div>
        </div>
        <div class="hero-side">
          <div class="hero-callout">
            <span class="label">Nueva ruta principal</span>
            <h2>Todo el acceso empieza aquí</h2>
            <p>Desde esta portada puedes entrar a los módulos más usados sin tener que recordar rutas largas.</p>
          </div>
          <div class="hero-note">
            <strong>Panel operativo</strong>
            <p>/status</p>
          </div>
          <div class="hero-note">
            <strong>Salud del monolito</strong>
            <p>/health</p>
          </div>
          <div class="hero-note">
            <strong>Aplicaciones activas</strong>
            <p>Facturación, planeación, constancias, documentos, reportes y automatización.</p>
          </div>
        </div>
      </div>
    </section>

    ${quickGroups.map(renderGroup).join("\n")}

    <p class="footer-note">Desarrollo EG © ${year} · La vista de estado anterior ahora está disponible en <strong>/status</strong>.</p>
  </main>
</body>
</html>`;
}

homeRouter.get("/", (_req, res) => {
  res.type("html").send(renderHomeHtml());
});

