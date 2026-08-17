import express from "express";
import {
  getWhatsAppCapacitadoresQrScreenshot,
  getWhatsAppCapacitadoresStatus,
  restartWhatsAppCapacitadoresForQr,
} from "./whatsappCapacitadores.service.js";

export const whatsappCapacitadoresRouter = express.Router();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildWhatsAppCapacitadoresLandingHtml(status) {
  const qrAvailable = Boolean(status?.qrAvailable);
  const title = "WhatsApp Capacitadores";
  const subtitle = qrAvailable
    ? "El bot está listo para abrir el QR y revisar su estado operativo."
    : "El bot está disponible, pero aún no hay QR generado.";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png" />
    <link rel="shortcut icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png" />
    <link rel="stylesheet" href="/ui/portal-shell.css?v=20260727" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: var(--portal-font-body);
        color: var(--portal-ink);
        background: transparent;
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 24px 16px 56px;
      }
      .hero {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 20px;
        align-items: stretch;
      }
      .panel {
        background: var(--portal-surface);
        border: 1px solid var(--portal-line);
        border-radius: 24px;
        padding: 24px;
        box-shadow: var(--portal-shadow);
        backdrop-filter: blur(14px);
      }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 12px;
        color: var(--portal-accent-3);
        font-weight: 800;
        margin: 0 0 14px;
        font-family: var(--portal-font-ui);
      }
      h1 {
        margin: 0;
        font-family: var(--portal-font-display);
        text-transform: uppercase;
        letter-spacing: -0.03em;
        font-size: clamp(32px, 6vw, 58px);
        line-height: 0.98;
        color: var(--portal-ink);
      }
      .lead {
        margin: 16px 0 0;
        color: var(--portal-muted);
        font-size: 16px;
        line-height: 1.7;
        max-width: 60ch;
        font-family: var(--portal-font-ui);
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .metric {
        border-radius: 18px;
        padding: 16px;
        background: rgba(15, 23, 42, 0.03);
        border: 1px solid rgba(33, 49, 63, 0.08);
      }
      .metric span {
        display: block;
        color: var(--portal-muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        margin-bottom: 8px;
        font-family: var(--portal-font-ui);
      }
      .metric strong {
        font-size: 18px;
        line-height: 1.3;
        font-family: var(--portal-font-ui);
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 24px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 999px;
        text-decoration: none;
        font-weight: 800;
        font-family: var(--portal-font-ui);
        transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      }
      .button:hover {
        transform: translateY(-1px);
      }
      .button.primary {
        background: linear-gradient(135deg, var(--portal-accent-3) 0%, var(--portal-accent) 100%);
        color: #fff;
        box-shadow: 0 14px 30px rgba(15, 76, 92, 0.16);
      }
      .button.secondary {
        background: rgba(15, 23, 42, 0.04);
        color: var(--portal-ink);
        border: 1px solid var(--portal-line);
      }
      .stack {
        display: grid;
        gap: 14px;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 10px 14px;
        background: rgba(15, 23, 42, 0.04);
        border: 1px solid var(--portal-line);
        font-size: 13px;
        width: fit-content;
        font-family: var(--portal-font-ui);
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: ${status?.connected ? "#16a34a" : "#c0392b"};
        box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.55);
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(15, 23, 42, 0.95);
        color: #e2e8f0;
        padding: 16px;
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        overflow: auto;
        font-size: 12px;
        line-height: 1.5;
      }
      .links {
        display: grid;
        gap: 10px;
        margin-top: 12px;
      }
      .link-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 16px;
        text-decoration: none;
        color: var(--portal-ink);
        background: rgba(255, 255, 255, 0.84);
        border: 1px solid var(--portal-line);
        box-shadow: 0 10px 24px rgba(21, 32, 43, 0.05);
        font-family: var(--portal-font-ui);
      }
      .link-card strong {
        display: block;
      }
      .link-card span {
        color: var(--portal-muted);
        font-size: 13px;
      }
      @media (max-width: 900px) {
        .hero {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body class="portal-shell portal-whatsapp">
    <a class="skip-link" href="#whatsapp-main">Saltar al contenido principal</a>
    <main id="whatsapp-main" role="main" aria-label="WhatsApp Capacitadores">
      <section class="hero">
        <article class="panel">
          <p class="eyebrow">Modulo operativo</p>
          <h1>WhatsApp Capacitadores</h1>
          <p class="lead">${escapeHtml(subtitle)}</p>
          <div class="actions">
            <a class="button primary" href="/whatsapp-capacitadores/qr">Abrir QR</a>
            <a class="button secondary" href="/whatsapp-capacitadores/health">Ver health</a>
          </div>
          <div class="meta">
            <div class="metric">
              <span>Estado</span>
              <strong>${escapeHtml(status?.status || "desconocido")}</strong>
            </div>
            <div class="metric">
              <span>Conexión</span>
              <strong>${status?.connected ? "Conectado" : "No conectado"}</strong>
            </div>
            <div class="metric">
              <span>QR disponible</span>
              <strong>${status?.qrAvailable ? "Si" : "No"}</strong>
            </div>
            <div class="metric">
              <span>Última señal</span>
              <strong>${escapeHtml(status?.lastError || "Sin errores")}</strong>
            </div>
          </div>
        </article>
        <aside class="panel stack">
          <div class="status-pill">
            <span class="dot"></span>
            <span>${status?.connected ? "Sesión activa" : "Sesión no activa"}</span>
          </div>
          <div class="links">
            <a class="link-card" href="/whatsapp-capacitadores/qr">
              <div>
                <strong>QR de acceso</strong>
                <span>Abre el QR o la vista de impresión.</span>
              </div>
              <span>→</span>
            </a>
            <a class="link-card" href="/whatsapp-capacitadores/health">
              <div>
                <strong>Health del bot</strong>
                <span>Revisa estado, errores y timestamps.</span>
              </div>
              <span>→</span>
            </a>
            <a class="link-card" href="/status">
              <div>
                <strong>Volver al portal</strong>
                <span>Regresa al estado general del monolito.</span>
              </div>
              <span>→</span>
            </a>
          </div>
          <pre>${escapeHtml(JSON.stringify(status, null, 2))}</pre>
        </aside>
      </section>
    </main>
  </body>
</html>`;
}

whatsappCapacitadoresRouter.get("/", (_req, res) => {
  res.type("html").send(buildWhatsAppCapacitadoresLandingHtml(getWhatsAppCapacitadoresStatus()));
});

whatsappCapacitadoresRouter.get("/health", (_req, res) => {
  res.json({
    service: "whatsapp-capacitadores",
    ...getWhatsAppCapacitadoresStatus(),
  });
});

whatsappCapacitadoresRouter.get("/qr.png", async (_req, res) => {
  const screenshot = await getWhatsAppCapacitadoresQrScreenshot();
  if (!screenshot) {
    return res.status(404).json({
      error: "qr_not_available",
      ...getWhatsAppCapacitadoresStatus(),
    });
  }

  res.type("png");
  return res.send(screenshot);
});

whatsappCapacitadoresRouter.get("/qr", async (_req, res) => {
  const status = getWhatsAppCapacitadoresStatus();
  const qrAvailable = Boolean(status.qrAvailable);
  const title = "WhatsApp Capacitadores QR";
  const refreshNotice = qrAvailable ? "Actualiza cada 10 segundos." : "No hay QR disponible en este momento.";
  const screenshot = qrAvailable ? await getWhatsAppCapacitadoresQrScreenshot() : null;
  const qrImageHtml = qrAvailable && screenshot
    ? `<img src="data:image/png;base64,${screenshot.toString("base64")}" alt="QR de WhatsApp" />`
    : `
      <div class="qr-empty">
        <div class="qr-empty-badge">Esperando QR</div>
        <p>Cuando el bot emita un nuevo código de reconexión, aparecerá aquí sin pasos extra.</p>
        <p class="muted">Mientras tanto, puedes volver a cargar la pantalla o revisar el health del bot.</p>
      </div>`;

  res.type("html");
  res.send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
    <link rel="icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png" />
    <link rel="shortcut icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png" />
    <link rel="stylesheet" href="/ui/portal-shell.css?v=20260727" />
    <style>
      body {
        margin: 0;
        font-family: var(--portal-font-body);
        color: var(--portal-ink);
        background: transparent;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
        padding: 24px 16px 56px;
      }
      .card {
        background: var(--portal-surface);
        border: 1px solid var(--portal-line);
        border-radius: 24px;
        padding: 22px;
        box-shadow: var(--portal-shadow);
      }
      img {
        width: 100%;
        height: auto;
        border-radius: 16px;
        border: 1px solid var(--portal-line);
        background: #fff;
      }
      .qr-empty {
        display: grid;
        place-items: center;
        min-height: 360px;
        border-radius: 18px;
        border: 1px dashed rgba(33, 49, 63, 0.18);
        background:
          radial-gradient(circle at top, rgba(15, 76, 92, 0.04), transparent 42%),
          #fff;
        text-align: center;
        padding: 24px;
      }
      .qr-empty-badge {
        display: inline-flex;
        align-items: center;
        padding: 8px 12px;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--portal-accent-3), var(--portal-accent));
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 12px;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #111827;
        color: #f5f5f5;
        padding: 14px;
        border-radius: 12px;
        overflow: auto;
      }
      .muted {
        color: var(--portal-muted);
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin: 16px 0;
      }
      a.button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        padding: 0 16px;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--portal-accent-3), var(--portal-accent));
        color: #fff;
        font-weight: 700;
        text-decoration: none;
      }
    </style>
  </head>
  <body class="portal-shell portal-whatsapp">
    <a class="skip-link" href="#whatsapp-qr-main">Saltar al contenido principal</a>
    <main id="whatsapp-qr-main" role="main" aria-label="WhatsApp Capacitadores QR">
      <div class="card">
        <h1>${title}</h1>
        <p class="muted">${qrAvailable ? "Escanea este QR sin recargar la página. Si expira, usa Actualizar QR." : refreshNotice}</p>
        <div class="actions">
          <a class="button" href="/whatsapp-capacitadores/qr">Actualizar QR</a>
          <a class="button" href="/whatsapp-capacitadores">Volver al inicio</a>
          <a class="button" href="/whatsapp-capacitadores/health">Ver health</a>
          <form method="post" action="/whatsapp-capacitadores/qr/restart" style="display:inline;">
            <button class="button" type="submit">Reiniciar sesión</button>
          </form>
          ${qrAvailable ? `<a class="button" href="/whatsapp-capacitadores/qr.png?t=${Date.now()}" target="_blank" rel="noreferrer">Abrir PNG</a>` : ""}
        </div>
        <p><strong>Estado:</strong> ${status.status}</p>
        <p><strong>Conectado:</strong> ${status.connected ? "sí" : "no"}</p>
        <p><strong>QR generado:</strong> ${status.qrGeneratedAt || "no"}</p>
        ${qrImageHtml}
        <h2>Health</h2>
        <pre>${JSON.stringify(status, null, 2)}</pre>
      </div>
    </main>
  </body>
</html>`);
});

whatsappCapacitadoresRouter.post("/qr/restart", async (_req, res) => {
  try {
    await restartWhatsAppCapacitadoresForQr();
    res.redirect("/whatsapp-capacitadores/qr");
  } catch (error) {
    console.error("ERROR EN /whatsapp-capacitadores/qr/restart:", error);
    res.status(500).type("html").send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WhatsApp Capacitadores QR</title>
  </head>
  <body>
    <main style="font-family:system-ui,sans-serif;padding:24px;max-width:900px;margin:0 auto;">
      <h1>No se pudo reiniciar la sesión QR</h1>
      <p>Intenta de nuevo en unos segundos o revisa el health del bot.</p>
      <pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>
      <p><a href="/whatsapp-capacitadores/qr">Volver al QR</a></p>
    </main>
  </body>
</html>`);
  }
});
