import express from "express";
import { getAppShellManifest } from "../../services/appShellManifest.js";

export const appShellRouter = express.Router();

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderModuleCard(module) {
  return `
    <a class="module-card" href="${escapeHtml(module.path)}">
      <div class="module-card__head">
        <span class="module-card__eyebrow">Modulo</span>
        ${module.priority ? `<span class="module-card__priority">${escapeHtml(module.priority)}</span>` : ""}
      </div>
      <strong>${escapeHtml(module.title)}</strong>
      <p>${escapeHtml(module.description)}</p>
      <span class="module-card__link">Abrir</span>
    </a>
  `;
}

function renderShellHtml(manifest) {
  const cacheLayersHtml = manifest.cacheLayers
    .map(
      (layer) => `
        <article class="panel">
          <span class="eyebrow">${escapeHtml(layer.title)}</span>
          <p>${escapeHtml(layer.description)}</p>
        </article>
      `,
    )
    .join("");

  const moduleGroupsHtml = manifest.moduleGroups
    .map(
      (group) => `
        <section class="group">
          <div class="group__head">
            <h2>${escapeHtml(group.title)}</h2>
            <span>${group.modules.length} modulos</span>
          </div>
          <div class="group__grid">
            ${group.modules.map(renderModuleCard).join("")}
          </div>
        </section>
      `,
    )
    .join("");

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(manifest.brand.name)} Shell</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #f5f7fa;
          --surface: #ffffff;
          --surface-soft: #f8fafc;
          --text: #15202b;
          --muted: #5f6d7a;
          --line: rgba(21, 32, 43, 0.1);
          --accent: ${escapeHtml(manifest.brand.accent)};
          --secondary: ${escapeHtml(manifest.brand.secondary)};
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Inter, Arial, sans-serif;
          background: radial-gradient(circle at top, rgba(29, 78, 216, 0.08), transparent 32%), var(--bg);
          color: var(--text);
        }
        a { color: inherit; text-decoration: none; }
        .shell {
          max-width: 1320px;
          margin: 0 auto;
          padding: 24px;
        }
        .hero {
          display: grid;
          grid-template-columns: 1.4fr 0.9fr;
          gap: 20px;
          align-items: stretch;
          margin-bottom: 24px;
        }
        .hero__main, .panel, .module-card, .hero__side {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 24px;
          box-shadow: 0 16px 50px rgba(15, 23, 42, 0.08);
        }
        .hero__main {
          padding: 28px;
        }
        .hero__side {
          padding: 24px;
          display: grid;
          gap: 12px;
        }
        .eyebrow {
          display: inline-flex;
          gap: 8px;
          align-items: center;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.75rem;
          color: var(--secondary);
          font-weight: 700;
        }
        h1, h2, h3, p { margin: 0; }
        h1 {
          margin-top: 12px;
          font-size: clamp(2rem, 4vw, 3.5rem);
          line-height: 1.05;
        }
        .hero__main p, .panel p, .module-card p {
          color: var(--muted);
          line-height: 1.5;
        }
        .hero__actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 20px;
        }
        .button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 44px;
          padding: 0 18px;
          border-radius: 999px;
          border: 1px solid var(--line);
          font-weight: 700;
          background: var(--surface-soft);
        }
        .button--primary {
          background: linear-gradient(135deg, var(--accent), var(--secondary));
          color: white;
          border-color: transparent;
        }
        .stats {
          display: grid;
          gap: 10px;
        }
        .stats strong {
          font-size: 1.9rem;
        }
        .cache-grid, .group__grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }
        .section {
          margin-top: 24px;
        }
        .section h2 {
          margin-bottom: 14px;
          font-size: 1.2rem;
        }
        .panel, .module-card {
          padding: 18px;
        }
        .module-card {
          display: grid;
          gap: 10px;
          min-height: 150px;
        }
        .module-card__head {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: center;
        }
        .module-card__eyebrow, .module-card__link, .module-card__priority {
          font-size: 0.8rem;
          color: var(--secondary);
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .module-card__priority {
          color: var(--accent);
        }
        .module-card strong {
          font-size: 1.05rem;
        }
        .group {
          margin-top: 24px;
        }
        .group__head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: end;
          margin-bottom: 12px;
        }
        .group__head span {
          color: var(--muted);
          font-size: 0.92rem;
        }
        .meta {
          display: grid;
          gap: 10px;
          font-size: 0.95rem;
          color: var(--muted);
        }
        @media (max-width: 960px) {
          .hero {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <main class="shell">
        <section class="hero">
          <div class="hero__main">
            <span class="eyebrow">${escapeHtml(manifest.brand.subtitle)}</span>
            <h1>${escapeHtml(manifest.brand.name)}</h1>
            <p>Base principal en AppSheet, cache persistente en backend y frontend por AJAX. Esta pagina es el punto de partida para adaptar la experiencia visual y la estructura de modulo.</p>
            <div class="hero__actions">
              <a class="button button--primary" href="${escapeHtml(manifest.layout.homePath)}">Ir al portal</a>
              <a class="button" href="${escapeHtml(manifest.layout.apiManifestPath)}">Ver manifiesto JSON</a>
            </div>
          </div>
          <aside class="hero__side">
            <div class="stats">
              <span class="eyebrow">Runtime</span>
              <strong>${escapeHtml(manifest.runtime.release?.version || "local")}</strong>
              <p>${escapeHtml(manifest.runtime.cluster?.status || "cluster no reportado")}</p>
            </div>
            <div class="meta">
              <span>Background: ${escapeHtml(manifest.runtime.background?.status || "unknown")}</span>
              <span>Cache API: ${escapeHtml(manifest.layout.apiManifestPath)}</span>
              <span>Home: ${escapeHtml(manifest.layout.homePath)}</span>
            </div>
          </aside>
        </section>

        <section class="section">
          <h2>Capas de cache</h2>
          <div class="cache-grid">
            ${cacheLayersHtml}
          </div>
        </section>

        ${moduleGroupsHtml}
      </main>
    </body>
  </html>`;
}

appShellRouter.get("/manifest", (_req, res) => {
  res.json(getAppShellManifest());
});

appShellRouter.get("/", (_req, res) => {
  const manifest = getAppShellManifest();
  res.type("html").send(renderShellHtml(manifest));
});
