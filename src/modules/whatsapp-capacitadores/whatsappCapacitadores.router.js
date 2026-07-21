import express from "express";
import {
  getWhatsAppCapacitadoresQrScreenshot,
  getWhatsAppCapacitadoresStatus,
} from "./whatsappCapacitadores.service.js";

export const whatsappCapacitadoresRouter = express.Router();

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

whatsappCapacitadoresRouter.get("/qr", (_req, res) => {
  const status = getWhatsAppCapacitadoresStatus();
  const qrAvailable = Boolean(status.qrAvailable);
  const title = "WhatsApp Capacitadores QR";
  const refreshNotice = qrAvailable ? "Actualiza cada 10 segundos." : "No hay QR disponible en este momento.";

  res.type("html");
  res.send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png" />
    <link rel="shortcut icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png" />
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 0;
        padding: 24px;
        background: #f4f4f1;
        color: #171717;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
      }
      .card {
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 16px;
        padding: 20px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
      }
      img {
        width: 100%;
        height: auto;
        border-radius: 12px;
        border: 1px solid #ddd;
        background: #fff;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #111;
        color: #f5f5f5;
        padding: 14px;
        border-radius: 12px;
        overflow: auto;
      }
      .muted {
        color: #555;
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
        background: #111827;
        color: #fff;
        font-weight: 700;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>${title}</h1>
        <p class="muted">${qrAvailable ? "Escanea este QR sin recargar la pagina. Si expira, usa Actualizar QR." : refreshNotice}</p>
        <div class="actions">
          <a class="button" href="/whatsapp-capacitadores/qr">Actualizar QR</a>
        </div>
        <p><strong>Estado:</strong> ${status.status}</p>
        <p><strong>Conectado:</strong> ${status.connected ? "si" : "no"}</p>
        <p><strong>QR generado:</strong> ${status.qrGeneratedAt || "no"}</p>
        ${qrAvailable ? `<img src="/whatsapp-capacitadores/qr.png?t=${Date.now()}" alt="QR de WhatsApp" />` : ""}
        <h2>Health</h2>
        <pre>${JSON.stringify(status, null, 2)}</pre>
      </div>
    </main>
  </body>
</html>`);
});
