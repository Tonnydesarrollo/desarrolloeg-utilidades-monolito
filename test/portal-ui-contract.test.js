import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { renderPedidosLeyAdminPage } from "../src/modules/pedidos-ley/pedidosLey.admin.page.js";

const shellSource = fs.readFileSync(new URL("../src/public/ui/portal-shell.js", import.meta.url), "utf8");
const shellCss = fs.readFileSync(new URL("../src/public/ui/portal-shell.css", import.meta.url), "utf8");
const homeSource = fs.readFileSync(new URL("../src/modules/home/home.router.js", import.meta.url), "utf8");
const appShellRouterSource = fs.readFileSync(new URL("../src/modules/app-shell/appShell.router.js", import.meta.url), "utf8");
const pedidosPageSource = fs.readFileSync(new URL("../src/modules/pedidos-ley/pedidosLey.admin.page.js", import.meta.url), "utf8");
const pedidosServiceSource = fs.readFileSync(new URL("../src/modules/pedidos-ley/services/pedidosLey.js", import.meta.url), "utf8");
const cotizacionSource = fs.readFileSync(new URL("../src/modules/facturacion/views/cotizacion.ejs", import.meta.url), "utf8");
const cotizacionLeySource = fs.readFileSync(new URL("../src/modules/facturacion/views/cotizacion_ley.ejs", import.meta.url), "utf8");
const cotizacionDataSource = fs.readFileSync(new URL("../src/modules/facturacion/services/construirDataHTML.js", import.meta.url), "utf8");
const sucursalesDocsSource = fs.readFileSync(new URL("../src/modules/sucursales-docs/public/index.html", import.meta.url), "utf8");
const constanciasSource = fs.readFileSync(new URL("../src/modules/constancias-v2/public/index.html", import.meta.url), "utf8");
const constanciasCss = fs.readFileSync(new URL("../src/modules/constancias-v2/public/tailwind.generated.css", import.meta.url), "utf8");

test("el calendario es la vista principal del shell", () => {
  assert.match(shellSource, /label:\s*"Calendario",\s*href:\s*"\/dashboard"/);
  assert.match(homeSource, /defaultView:\s*"calendario"/);
  assert.match(homeSource, /dashboardTabs\[0\]\?\.id\s*\|\|\s*"calendar"/);
  assert.match(homeSource, /<body class="portal-shell portal-dashboard">/);
  assert.match(homeSource, /portal-shell\.css\?v=20260903a/);
});

test("la navegacion compartida implementa estado por URL y drawer accesible", () => {
  assert.match(shellSource, /aria-current="page"/);
  assert.match(shellSource, /role="dialog" aria-modal="true"/);
  assert.match(shellSource, /event\.key === "Escape"/);
  assert.match(shellSource, /previousFocus\?\.focus/);
  assert.match(shellCss, /\.portal-app-topbar/);
  assert.match(shellCss, /prefers-reduced-motion/);
  assert.match(shellSource, /desarrolloeg:shell-ready/);
  assert.match(shellSource, /href:\s*"\/dashboard\?tab=solventaciones"/);
});

test("la pantalla de carga espera al shell y usa una sola composicion de marca", () => {
  assert.match(homeSource, /class="page-loader-brand"/);
  assert.match(homeSource, /class="page-loader-progress"/);
  assert.match(homeSource, /document\.addEventListener\("desarrolloeg:shell-ready", hide/);
  assert.doesNotMatch(homeSource, /class="page-loader-spinner"><\/div>/);
  assert.doesNotMatch(homeSource, /id="page-loader" aria-hidden="true"/);
});

test("el dashboard nunca renderiza limites numericos indefinidos", () => {
  assert.match(homeSource, /Number\.isFinite\(Number\(thresholds\?\.estatalMin\)\)/);
  assert.match(homeSource, /Number\.isFinite\(Number\(thresholds\?\.municipalMin\)\)/);
  assert.doesNotMatch(homeSource, /value="\$\{escapeAttr\(String\(thresholds\.(?:estatalMin|municipalMin)\)\)\}"/);
});

test("constancias usa Tailwind compilado localmente en produccion", () => {
  assert.match(constanciasSource, /href="\/constancias\/tailwind\.generated\.css\?v=[\w.-]+"/);
  assert.doesNotMatch(constanciasSource, /cdn\.tailwindcss\.com/);
  assert.ok(constanciasCss.length > 20_000);
  assert.match(constanciasCss, /tailwindcss v3\.4\.17/);
  assert.match(constanciasCss, /\.grid-cols-1/);
  assert.match(constanciasCss, /\.xl\\:grid-cols-12/);
  assert.match(constanciasCss, /\.bg-slate-50/);
  assert.match(constanciasCss, /\.rounded-\\\[2\\\.5rem\\\]/);
});

test("las cotizaciones mantienen visible y accesible el panel de opciones", () => {
  for (const source of [cotizacionSource, cotizacionLeySource]) {
    assert.match(source, /\.cotizacion-sidebar\[hidden\][\s\S]*display:none !important/);
    assert.match(source, /z-index:1510/);
    assert.match(source, /aria-controls="cotizacion-options" aria-expanded="false"/);
    assert.match(source, /drawer\.removeAttribute\('inert'\)/);
    assert.match(source, /drawer\.setAttribute\('inert', ''\)/);
  }
});

test("las cotizaciones aceptan logos de cliente guardados por AppSheet", () => {
  assert.match(cotizacionDataSource, /drive\\\.google\\\.com\|appsheet\\\.com/);
  assert.match(cotizacionDataSource, /json\.empresa\.logoUrl \|\| json\.empresa\.logo/);
});

test("la direccion de sucursal es opcional en pantalla e impresion", () => {
  for (const source of [cotizacionSource, cotizacionLeySource]) {
    assert.match(source, /id="mostrarDireccionSucursal"/);
    assert.match(source, /\.sucursal-domicilio\{display:none/);
    assert.match(source, /function toggleDireccionesSucursal\(\)/);
    assert.match(source, /visible \? 'block' : 'none'/);
  }
});

test("el indicador en vivo no aparece en impresiones", () => {
  assert.match(
    shellCss,
    /@media print\s*\{[\s\S]*?\.portal-refresh-fab,\s*body\.portal-shell \.portal-live-badge\s*\{\s*display:\s*none !important;/,
  );
  for (const source of [cotizacionSource, cotizacionLeySource]) {
    assert.match(source, /portal-shell\.css\?v=20260831b/);
  }
});

test("sucursales docs permite descargar una carta individual por sucursal seleccionada", () => {
  assert.match(sucursalesDocsSource, /id="branch-results" role="listbox" aria-multiselectable="true"/);
  assert.match(sucursalesDocsSource, /id="company-filter"/);
  assert.match(sucursalesDocsSource, /id="state-filter"/);
  assert.match(sucursalesDocsSource, /id="municipality-filter"/);
  assert.match(sucursalesDocsSource, /id="type-filter"/);
  assert.match(sucursalesDocsSource, /selectedBranchIds: new Set\(\)/);
  assert.match(sucursalesDocsSource, /async function toggleBranchSelection\(id\)/);
  assert.match(sucursalesDocsSource, /id="clear-selection-btn"/);
  assert.match(sucursalesDocsSource, /for \(let index = 0; index < selectedIds\.length; index \+= 1\)/);
  assert.match(sucursalesDocsSource, /await downloadPdfResponse\(res\)/);

  const scripts = [...sucursalesDocsSource.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !match[1].includes("src="))
    .map((match) => match[2])
    .filter(Boolean);
  scripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
});

test("el tiempo real publica cambios incrementales y calendario consume su API", () => {
  assert.match(shellSource, /new EventSource/);
  assert.match(shellSource, /desarrolloeg:data-changed/);
  assert.match(shellSource, /lastObservedRevision/);
  assert.match(appShellRouterSource, /revision:\s*Number\(appShellRevisionByScope/);
  assert.match(appShellRouterSource, /appShellEventRevision \+= 1/);
  assert.match(homeSource, /homeRouter\.get\("\/api\/portal\/calendar"/);
  assert.match(homeSource, /calendarInstance\.removeAllEvents\(\)/);
  assert.match(homeSource, /calendarInstance\.addEventSource\(getVisibleEvents\(\)\)/);
});

test("las rutas del portal consultan capacidades y separan lectura de mutacion global", () => {
  assert.match(homeSource, /hasPortalCapability\(user, "pedidos", "view"\)/);
  assert.match(homeSource, /hasPortalCapability\(user, "notas", noteAction\)/);
  assert.match(homeSource, /function canMutateGlobalScope/);
  assert.match(homeSource, /Solo el creador puede editar esta nota/);
  assert.match(homeSource, /Solo el creador de la nota puede eliminarla/);
});

test("pedidos usa una ruta dedicada y no bloquea la carga inicial del calendario", () => {
  assert.match(homeSource, /req\.query\.tab[\s\S]*=== "pedidos"/);
  assert.match(homeSource, /res\.redirect\(302, `\/dashboard\/pedidos/);
  assert.match(homeSource, /requestedTab === "pedidos"[\s\S]*window\.location\.assign\(portalUrl\("\/dashboard\/pedidos"\)\)/);
});

test("pedidos abre sin filtros silenciosos de estatus o facturador", () => {
  assert.match(pedidosServiceSource, /fetchPedidosLeyAdminDashboardData\(\{[\s\S]*facturadorId = ''/);
  assert.match(pedidosPageSource, /orderStatus:[\s\S]*\? url\.orderStatus : "all"/);
  assert.match(pedidosPageSource, /facturadorId: String\(url\.facturadorId \|\| INITIAL\.facturadorId \|\| ""\)/);
  assert.doesNotMatch(pedidosPageSource, /stored\.facturadorId/);
  assert.match(pedidosPageSource, /const displayedRows = visibleRows\.slice\(pageStart, pageStart \+ state\.pageSize\);/);
  assert.match(pedidosPageSource, /els\.contentMount\.innerHTML = renderPedidosSection\(visibleRows, displayedRows\);[\s\S]*renderSectionTabs\(\);/);
  assert.match(pedidosPageSource, /pageSize:\s*window\.matchMedia\("\(max-width: 640px\)"\)\.matches \? 10 : 50/);
});

test("pedidos genera JavaScript ejecutable y controles de estado unicos", () => {
  const html = renderPedidosLeyAdminPage({
    user: { email: "qa@desarrolloeg.com" },
    data: {
      year: 2026,
      rows: [],
      catalogs: {},
      thresholds: { estatalMin: 32967.49, municipalMin: 11000 },
    },
  });
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/type=["']application\/json["']/i.test(match[1]))
    .map((match) => match[2])
    .filter(Boolean);

  assert.ok(scripts.length > 0);
  scripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
  assert.equal((html.match(/id="sendStatus"/g) || []).length, 1);
  assert.match(html, /No liberados/);
  assert.match(html, /Sin trabajo/);
  assert.match(html, /No enviados/);
  assert.match(html, /Enviados/);
  assert.match(html, /<div class="eyebrow">Pagados<\/div>/);
  assert.match(html, /Pedidos faltantes por cobertura/);
  assert.match(html, /Estatales faltantes/);
  assert.match(html, /Municipales faltantes/);
  assert.match(html, /row\.raw\?\.\["Row ID"\]/);
  assert.match(html, /Number\(row\.fechaYear\) === Number\(state\.year\)/);
  assert.match(html, /\.filter\(allowedBranch\)/);
  assert.match(html, /data-missing-kind="estatal"/);
});
