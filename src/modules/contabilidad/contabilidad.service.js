function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getContabilidadOverview() {
  return {
    module: "contabilidad",
    status: "ok",
    features: [
      {
        id: "ocr-libre",
        name: "OCR sin costo",
        description: "Analiza tickets en el navegador sin usar una API de pago.",
      },
      {
        id: "captura-movil",
        name: "Captura movil",
        description: "Abre la camara del telefono y muestra el resultado en la misma pantalla.",
      },
      {
        id: "precision",
        name: "Lectura mejorada",
        description: "Hace varias lecturas del ticket y escoge la mejor antes de llenar los campos.",
      },
    ],
  };
}

export function normalizeTicketScanPayload(body = {}) {
  const filename = String(body.filename ?? "").trim() || "ticket.jpg";
  const mimeType = String(body.mimeType ?? "").trim().toLowerCase();
  const imageBase64 = String(body.imageBase64 ?? "").trim();
  const source = String(body.source ?? "camera").trim().toLowerCase() || "camera";

  if (!mimeType.startsWith("image/")) {
    return { ok: false, status: 400, error: "El archivo debe ser una imagen valida." };
  }

  if (!imageBase64) {
    return { ok: false, status: 400, error: "No se recibio ninguna imagen del ticket." };
  }

  let buffer;
  try {
    buffer = Buffer.from(imageBase64, "base64");
  } catch {
    return {
      ok: false,
      status: 400,
      error: "La imagen del ticket no se pudo decodificar.",
    };
  }

  if (!buffer.length) {
    return { ok: false, status: 400, error: "La imagen del ticket llego vacia." };
  }

  return {
    ok: true,
    payload: {
      ticketId: `TCK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      filename,
      mimeType,
      source,
      sizeBytes: buffer.length,
      receivedAt: new Date().toISOString(),
    },
  };
}

export function renderContabilidadHtml(_data) {
  const featureCards = _data.features
    .map(
      (feature) => `
        <article class="mini-card">
          <span class="pill pill--soft">${escapeHtml(feature.id)}</span>
          <h3>${escapeHtml(feature.name)}</h3>
          <p>${escapeHtml(feature.description)}</p>
        </article>
      `,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Contabilidad | DESARROLLOEG</title>
  <style>
    :root{--surface:#ffffffec;--line:#d7ccb8;--text:#1f2937;--muted:#667085;--ok:#0b6e4f;--ok2:#114b5f;--okbg:#dff5eb;--gold:#8d5b00;--goldbg:#fff0c8;--danger:#b42318;--dangerbg:#fee4e2;--shadow:0 20px 50px rgba(20,33,61,.08)}
    *{box-sizing:border-box}
    body{margin:0;font-family:"Segoe UI",sans-serif;color:var(--text);background:radial-gradient(circle at top left,rgba(11,110,79,.12),transparent 22%),radial-gradient(circle at top right,rgba(185,140,47,.14),transparent 22%),linear-gradient(180deg,#f8f3ea,#ede5d8)}
    main{width:min(1180px,calc(100% - 28px));margin:0 auto;padding:24px 0 48px}
    .hero,.card,.mini-card,.result{background:var(--surface);border:1px solid rgba(255,255,255,.72);border-radius:26px;box-shadow:var(--shadow);backdrop-filter:blur(12px)}
    .hero{padding:28px;color:#fff;background:radial-gradient(circle at top right,rgba(255,255,255,.12),transparent 24%),linear-gradient(135deg,var(--ok),var(--ok2))}
    .hero h1{margin:10px 0 8px;font-size:clamp(2.2rem,6vw,4.4rem);line-height:.95;max-width:11ch;letter-spacing:-.05em}
    .hero p{max-width:62ch;line-height:1.6;color:#ffffffe0}
    .layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.85fr);gap:18px;margin-top:22px}
    .stack{display:grid;gap:18px}
    .card{padding:22px}
    .mini-card,.result{padding:18px}
    .controls,.feature-grid,.results,.meta{display:grid;gap:12px}
    .controls{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:16px}
    .feature-grid,.results,.meta{grid-template-columns:repeat(2,minmax(0,1fr))}
    .pill{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border-radius:999px;font-size:.76rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .pill--hero{background:#ffffff1f;color:#f8e7b5}
    .pill--soft{background:#0b6e4f14;color:var(--ok)}
    .status{display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border-radius:999px;background:var(--okbg);color:var(--ok);font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
    .button,.file-button{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:50px;padding:0 14px;border-radius:16px;border:1px solid transparent;text-decoration:none;cursor:pointer;font-weight:800;font-size:.96rem;transition:transform .16s ease}
    .button:hover,.file-button:hover{transform:translateY(-1px)}
    .button:disabled{opacity:.6;cursor:not-allowed;transform:none}
    .button--primary,.file-button--primary{background:linear-gradient(135deg,var(--ok),var(--ok2));color:#fff}
    .button--gold{background:linear-gradient(135deg,#b98c2f,#8d5b00);color:#fff}
    .button--ghost,.file-button--ghost{background:#fff;border-color:var(--line);color:var(--text)}
    .button--danger{background:var(--dangerbg);color:var(--danger);border-color:#b4231829}
    .inputs{display:none}
    .preview{margin-top:16px;padding:14px;border:1px dashed var(--line);border-radius:22px;min-height:320px;background:linear-gradient(180deg,#ffffffeb,#f4efe6ea)}
    .preview--ready{border-style:solid;border-color:#0b6e4f2b}
    .placeholder,.preview img{width:100%;min-height:280px;border-radius:18px}
    .placeholder{display:grid;place-items:center;padding:24px;text-align:center;color:var(--muted);background:radial-gradient(circle at top,rgba(11,110,79,.07),transparent 30%),linear-gradient(180deg,#ffffffcc,#f6f1e8)}
    .placeholder strong{display:block;margin-bottom:6px;color:var(--text)}
    .preview img{display:none;object-fit:contain;background:#fff}
    .meta-item,.result{border:1px solid #d7ccb8cc}
    .meta-item{padding:14px;border-radius:18px;background:#fffffff0}
    .label{display:block;font-size:.78rem;font-weight:800;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}
    .value{display:block;margin-top:8px;font-weight:800;word-break:break-word}
    .feedback{margin-top:16px;padding:14px 16px;border-radius:16px;border:1px solid #0b6e4f24;background:#fff;color:var(--muted)}
    .feedback--ok{background:var(--okbg);color:var(--ok);border-color:#0b6e4f2b}
    .feedback--warning{background:var(--goldbg);color:var(--gold);border-color:#8d5b0029}
    .feedback--error{background:var(--dangerbg);color:var(--danger);border-color:#b4231829}
    .progress{height:10px;margin-top:12px;border-radius:999px;overflow:hidden;background:#114b5f14}
    .progress__fill{width:0;height:100%;background:linear-gradient(90deg,var(--ok),#b98c2f);transition:width .2s ease}
    .notes,.tips{margin:0;padding-left:18px}
    .ocr-text{margin-top:14px;padding:14px;border-radius:18px;border:1px solid #d7ccb8cc;background:#fff;font-family:Consolas,monospace;font-size:.9rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto}
    p{line-height:1.6;color:var(--muted)} h2,h3{margin:10px 0 8px;color:var(--text)}
    .note{margin-top:10px;font-size:.92rem}
    @media (max-width:980px){.layout,.controls,.feature-grid,.results,.meta{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <span class="pill pill--hero">Contabilidad movil</span>
      <h1>Escanear ticket y ver la informacion aqui mismo</h1>
      <p>Este flujo usa OCR gratuito en tu navegador. No hay costo de API. Ahora hace varias lecturas del ticket y escoge la mejor antes de llenar los campos.</p>
      <div class="status">Estado del modulo: ${escapeHtml(_data.status)}</div>
    </section>

    <section class="layout">
      <div class="stack">
        <article class="card">
          <span class="pill pill--soft">Captura</span>
          <h2>Escaner de tickets</h2>
          <p>Toma la foto con tu celular y toca <strong>Extraer informacion</strong>. El resultado se mostrara en esta misma pantalla.</p>
          <div class="inputs">
            <input id="ticket-camera-input" type="file" accept="image/*" capture="environment" />
            <input id="ticket-gallery-input" type="file" accept="image/*" />
          </div>
          <div class="controls">
            <label for="ticket-camera-input" class="file-button file-button--primary">Usar camara</label>
            <label for="ticket-gallery-input" class="file-button file-button--ghost">Elegir imagen</label>
            <button id="analyze-ticket-button" class="button button--gold" type="button" disabled>Extraer informacion</button>
            <button id="clear-ticket-button" class="button button--danger" type="button">Limpiar</button>
          </div>
          <div class="feedback feedback--warning" id="ticket-feedback">Selecciona un ticket para activar la extraccion en esta misma pantalla.</div>
          <div class="progress" aria-hidden="true"><div class="progress__fill" id="ocr-progress-fill"></div></div>
          <section class="preview" id="ticket-preview-shell">
            <div class="placeholder" id="ticket-preview-placeholder"><div><strong>Tu ticket aparecera aqui</strong>Toma la foto de frente, con buena luz y procurando incluir encabezado, cuerpo y total.</div></div>
            <img id="ticket-preview-image" alt="Vista previa del ticket" />
          </section>
          <div class="meta">
            <article class="meta-item"><span class="label">Archivo</span><strong class="value" id="ticket-file-name">Sin archivo</strong></article>
            <article class="meta-item"><span class="label">Tamano</span><strong class="value" id="ticket-file-size">Pendiente</strong></article>
            <article class="meta-item"><span class="label">Ticket ID</span><strong class="value" id="ticket-id-value">Pendiente</strong></article>
            <article class="meta-item"><span class="label">Estado OCR</span><strong class="value" id="ocr-status-value">Esperando imagen</strong></article>
          </div>
          <p class="note">Si el OCR no carga, normalmente es porque el telefono no pudo descargar el motor OCR gratuito desde internet.</p>
        </article>

        <article class="card">
          <span class="pill pill--soft">Resultado</span>
          <h2>Informacion extraida del ticket</h2>
          <p>Estos campos se llenan despues del OCR. Si algo no coincide, la siguiente mejora sera agregar correccion manual.</p>
          <div class="results">
            <article class="result"><span class="label">Proveedor</span><strong class="value" id="result-proveedor">Pendiente</strong></article>
            <article class="result"><span class="label">RFC</span><strong class="value" id="result-rfc">Pendiente</strong></article>
            <article class="result"><span class="label">Fecha</span><strong class="value" id="result-fecha">Pendiente</strong></article>
            <article class="result"><span class="label">Hora</span><strong class="value" id="result-hora">Pendiente</strong></article>
            <article class="result"><span class="label">Folio</span><strong class="value" id="result-folio">Pendiente</strong></article>
            <article class="result"><span class="label">Subtotal</span><strong class="value" id="result-subtotal">Pendiente</strong></article>
            <article class="result"><span class="label">IVA</span><strong class="value" id="result-iva">Pendiente</strong></article>
            <article class="result"><span class="label">Total</span><strong class="value" id="result-total">Pendiente</strong></article>
          </div>
          <article class="result" style="margin-top:12px;">
            <span class="label">Observaciones</span>
            <ul class="notes" id="result-notes"><li>Aun no se ha analizado ningun ticket.</li></ul>
          </article>
          <details style="margin-top:14px;">
            <summary style="cursor:pointer;font-weight:800;">Texto OCR detectado</summary>
            <pre class="ocr-text" id="ocr-text-output">Aun no se ha procesado ningun ticket.</pre>
          </details>
        </article>
      </div>

      <div class="stack">
        <article class="card">
          <span class="pill pill--soft">Consejos</span>
          <h2>Como mejorar la lectura</h2>
          <ul class="tips">
            <li>Acerca la camara hasta que el ticket ocupe la mayor parte de la pantalla.</li>
            <li>Evita reflejos y sombras, sobre todo en la parte donde esta el total.</li>
            <li>No recortes el pie del ticket porque ahi suelen venir folio e impuestos.</li>
          </ul>
        </article>
        <div class="feature-grid">${featureCards}</div>
      </div>
    </section>
  </main>
  <script src="/contabilidad/client.js"></script>
</body>
</html>`;
}
