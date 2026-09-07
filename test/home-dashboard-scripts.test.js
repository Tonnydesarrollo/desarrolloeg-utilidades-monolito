import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderDashboardPage } from "../src/modules/home/home.router.js";

const user = {
  rowId: "qa-test",
  correo: "qa@example.com",
  nombre: "QA Test",
  puesto: "MEJORA CONTINUA",
  role: "admin",
  initials: "QT",
};

test("dashboard entrega JavaScript ejecutable sin errores de sintaxis", async () => {
  const html = await renderDashboardPage({
    user,
    employees: [user],
    pedidosData: {},
    dashboardData: {
      visible: [],
      programadas: [],
      finalizadasSinDiplomas: [],
      birthdayEvents: [],
      calendarCapacitaciones: [],
      calendarNotes: [],
    },
  });

  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  const executableScripts = scripts.filter(([, attributes]) => {
    if (/\bsrc\s*=/i.test(attributes)) return false;
    return !/\btype\s*=\s*["']application\/json["']/i.test(attributes);
  });

  assert.ok(executableScripts.length > 0);
  assert.match(
    html,
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/fullcalendar@6\.1\.20\/index\.global\.min\.js" defer><\/script>/,
  );
  for (const [index, script] of executableScripts.entries()) {
    assert.doesNotThrow(
      () => new vm.Script(script[2], { filename: "dashboard-inline-" + index + ".js" }),
      "El script inline " + index + " debe compilar",
    );
  }
  assert.match(html, /data-dashboard-tab-panel="solventaciones"/);
  assert.match(html, /data-solventaciones-frame/);
  assert.match(html, /Sistema de Proteccion Civil/);
});

test("perfil de empresa muestra detalle territorial y carga todos los expandibles contraidos", async () => {
  const html = await renderDashboardPage({
    user,
    employees: [user],
    selectedEmpresaId: "empresa-1",
    initialTabId: "sucursales",
    empresas: [{
      key: "empresa-1",
      nombreComercial: "Empresa Demo",
      razonSocial: "Empresa Demo SA de CV",
      logo: "logo.png",
    }],
    sucursales: [{
      key: "sucursal-1",
      name: "Sucursal Centro",
      tienda: "101",
      displayLabel: "101 Sucursal Centro",
      raw: {
        empresa_id: "empresa-1",
        estado_id: "25",
        estado_nombre: "Sinaloa",
        estado_escudo: "https://example.com/estado.svg",
        municipio_id: "1890",
        municipio_nombre: "Culiacan",
        municipio_escudo: "https://example.com/municipio.svg",
        DIRECCION: "Av. Principal 100",
        DRIVE: JSON.stringify({ Url: "https://drive.google.com/example" }),
        capacitadores: "Capacitador Demo",
        mes_planeacion: 4,
        planeacion_status: "ACTIVA",
        trabajos: "ESTATAL, MUNICIPAL",
        ultimo_pipc_estatal: "2026",
        estatus_pipc_estatal: "ENTREGADO",
        ultimo_municipal: "2025",
        estatus_municipal: "IMPRESO",
        status_capacitacion: "FINALIZADA",
        fecha_ultima_capacitacion: "04/10/2026",
        nivel_riesgo: "ALTO",
        precio_estatal: 9250,
        precio_municipal: 3100,
        pedido_estatal: "6001234567",
        pedido_municipal: "6007654321",
      },
    }],
    pedidosData: {},
    dashboardData: {
      visible: [],
      programadas: [],
      finalizadasSinDiplomas: [],
      birthdayEvents: [],
      calendarCapacitaciones: [],
      calendarNotes: [],
    },
  });

  assert.match(html, /Empresa Demo SA de CV/);
  assert.match(html, /Av\. Principal 100/);
  assert.match(html, /dashboard\/territorios\/estado\/25\/escudo/);
  assert.match(html, /dashboard\/territorios\/municipio\/1890\/escudo/);
  assert.match(html, /Abril · ACTIVA/);
  assert.match(html, /2026 · ENTREGADO/);
  assert.match(html, /FINALIZADA · 04\/10\/2026/);
  assert.match(html, /Pedido estatal<\/dt><dd>6001234567/);
  assert.match(html, /Pedido municipal<\/dt><dd>6007654321/);
  assert.match(html, /<span>Pedido<\/span><input data-sucursales-filter="pedido"/);
  assert.doesNotMatch(html, /data-sucursales-filter="pedido-estatal"/);
  assert.match(html, /data-estatal-year="2026"/);
  assert.match(html, /data-municipal-year="2025"/);
  assert.match(html, /data-territory-state-count aria-live="polite"/);
  assert.match(html, /data-territory-municipality-count aria-live="polite"/);
  assert.match(html, /data-sucursales-filter="capacitador"><option value="">Todos<\/option>/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/i);
});

test("directorio de empresas incluye búsqueda local", async () => {
  const html = await renderDashboardPage({
    user,
    employees: [user],
    empresas: [{ key: "empresa-1", nombreComercial: "Empresa Demo", razonSocial: "Empresa Demo SA" }],
    sucursales: [],
    pedidosData: {},
    dashboardData: { visible: [], programadas: [], finalizadasSinDiplomas: [], birthdayEvents: [], calendarCapacitaciones: [], calendarNotes: [] },
  });
  assert.match(html, /data-company-directory-search/);
  assert.match(html, /data-company-directory-card/);
});

test("reporte Casa Ley usa trabajos vigentes y fallback de PC Estatal", async () => {
  const html = await renderDashboardPage({
    user,
    employees: [user],
    initialTabId: "reporte-ley",
    sucursales: [{
      key: "ley-1",
      displayLabel: "1176 SUPER LEY LA CANTERA",
      raw: {
        empresa_id: "1",
        trabajos: "ESTATAL, MUNICIPAL",
        municipio_nombre: "Tepic",
        estado_nombre: "Nayarit",
        ultimo_pipc_estatal: "2026",
        estatus_pipc_estatal: "ENTREGADO",
        ultimo_municipal: "2025",
        estatus_municipal: "IMPRESO",
        status_capacitacion: "FINALIZADA",
        capacitadores: "Carmen Maria Salazar Villa",
        id_pc: "14350",
      },
    }],
    pedidosData: {},
    dashboardData: { visible: [], programadas: [], finalizadasSinDiplomas: [], birthdayEvents: [], calendarCapacitaciones: [], calendarNotes: [] },
  });
  assert.match(html, /data-dashboard-tab-panel="reporte-ley"/);
  assert.match(html, /1176 SUPER LEY LA CANTERA/);
  assert.match(html, /Carmen Maria Salazar Villa/);
  assert.match(html, /ID 14350/);
  assert.match(html, />PENDIENTE</);
  assert.match(html, /data-casa-ley-search/);
});

test("constancias integra controles y generador en un mismo workbench", async () => {
  const capacitacion = {
    id: "cap-1",
    rowId: "row-cap-1",
    cede: "sucursal-1",
    cedeLabel: "Sucursal Centro",
    dateRaw: "08/28/2026",
    dateLabel: "28/8/2026",
    hasDiplomas: false,
    capacitadores: [{ key: "qa-test", nombre: "QA Test" }],
    sucursales: [{ key: "sucursal-1", label: "Sucursal Centro" }],
  };
  const html = await renderDashboardPage({
    user,
    employees: [user],
    pedidosData: {},
    dashboardData: {
      visible: [capacitacion],
      programadas: [capacitacion],
      finalizadasSinDiplomas: [capacitacion],
      birthdayEvents: [],
      calendarCapacitaciones: [capacitacion],
      calendarNotes: [],
    },
  });
  assert.match(html, /<div class="constancias-workbench">\s*<aside class="constancias-workbench__controls">/);
  assert.match(html, /<\/aside>\s*<div class="constancias-workbench__canvas">/);
  assert.match(html, /data-integrated-url="\/CONSTANCIAS\/capacitaciones\/cap-1\/HTML\?embed=1"/);
});

test("capacitaciones muestra el detalle dentro de la tarjeta sin cambiar de ruta", async () => {
  const capacitacion = {
    id: "cap-1",
    rowId: "row-cap-1",
    cede: "sucursal-1",
    cedeLabel: "Sucursal Centro",
    dateRaw: "08/28/2026",
    dateLabel: "28/8/2026",
    horaInicio: "09:00:00",
    horaFin: "13:00:00",
    notas: "Llevar material",
    hasDiplomas: false,
    statusSuffix: "PROGRAMADA",
    statusLabel: "QT - PROGRAMADA",
    capacitadores: [{ key: "qa-test", nombre: "QA Test" }],
    sucursales: [{ key: "sucursal-1", label: "Sucursal Centro" }],
  };
  const html = await renderDashboardPage({
    user,
    employees: [user],
    pedidosData: {},
    dashboardData: {
      visible: [capacitacion],
      programadas: [capacitacion],
      finalizadasSinDiplomas: [],
      birthdayEvents: [],
      calendarCapacitaciones: [capacitacion],
      calendarNotes: [],
    },
  });
  const start = html.indexOf('data-capacitaciones-studio');
  const end = html.indexOf('data-constancias-studio', start);
  const panel = html.slice(start, end > start ? end : undefined);

  assert.match(panel, /<details class="capacitacion-card capacitacion-card--expandable is-programada" data-keep-after-diplomas>/);
  assert.match(panel, /<details class="accordion-card capacitaciones-group" data-capacitacion-group/);
  assert.match(panel, /class="capacitaciones-filter-bar"/);
  assert.match(panel, /data-capacitaciones-filter-reset/);
  assert.match(panel, /class="capacitacion-card__section capacitacion-card__branches"/);
  assert.match(panel, /class="capacitacion-card__section capacitacion-card__notes"/);
  assert.match(panel, /class="capacitacion-note-compose"/);
  assert.doesNotMatch(panel, /<details class="capacitacion-note-compose" open/);
  assert.doesNotMatch(panel, /<strong>Horario<\/strong>/);
  assert.doesNotMatch(panel, /<strong>Capacitadores<\/strong>/);
  assert.match(panel, /Llevar material/);
  assert.match(panel, /09:00 - 13:00/);
  assert.doesNotMatch(panel, /09:00:00|13:00:00/);
  assert.match(panel, /<span class="status-chip is-programada">PROGRAMADA<\/span>/);
  assert.doesNotMatch(panel, /\[object Object\]/);
  assert.match(panel, /returnTo" value="\/dashboard\?tab=capacitaciones"/);
  assert.doesNotMatch(panel, /\/dashboard\/capacitacion\/row-cap-1/);
  assert.doesNotMatch(panel, /<details[^>]*\sopen(?:\s|>)/i);
});
