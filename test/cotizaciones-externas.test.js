import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  externalCentersMap,
  getExternalConceptRows,
  getExternalQuote,
  listExternalQuotes,
  saveExternalQuote,
} from "../src/modules/facturacion/services/cotizacionesExternas.js";
import { construirDataHTML } from "../src/modules/facturacion/services/construirDataHTML.js";
import { extractQuoteOptionsFromQuery, seleccionarPlantillaCotizacion, CASTILLO_COMPANY_ADDRESS } from "../src/modules/facturacion/facturacion.router.js";

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

test("guarda una cotizacion externa sin referencias de AppSheet", () => {
  const db = memoryDb();
  const result = saveExternalQuote({
    destinatario: "Cliente de mostrador",
    fecha: "2026-09-22",
    proveedorId: "PROV-1",
    centrosTrabajo: ["Obra norte", "Obra sur"],
    conceptos: [{ id: "CON-1", cantidad: 2, precio: 100, iva: 0.16 }],
  }, "", db);

  assert.match(result.id, /^EXT-/);
  assert.equal(result.created, true);
  assert.equal(result.conceptos, 2);
  assert.equal(result.lineas[0].centroTrabajoId, "Obra norte");
  assert.equal(getExternalQuote(result.id, db)["RAZON SOCIAL"], "Cliente de mostrador");
  assert.deepEqual(Object.values(externalCentersMap(result.id, db)).map((item) => item.nombre), ["Obra norte", "Obra sur"]);
  assert.equal(getExternalConceptRows(result.id, db)[0].TOTAL, 232);
  assert.equal(listExternalQuotes(db).length, 1);
  db.close();
});

test("edita cabecera, centros y conceptos externos en una transaccion", () => {
  const db = memoryDb();
  const created = saveExternalQuote({
    destinatario: "Cliente inicial",
    fecha: "2026-09-22",
    proveedorId: "PROV-1",
    centrosTrabajo: ["Sucursal temporal"],
    conceptos: [{ id: "CON-1", cantidad: 1, precio: 50, iva: 0.16 }],
  }, "", db);
  const center = Object.values(externalCentersMap(created.id, db))[0];
  const line = getExternalConceptRows(created.id, db)[0];

  const updated = saveExternalQuote({
    destinatario: "Cliente definitivo",
    fecha: "2026-09-23",
    proveedorId: "PROV-2",
    centrosTrabajo: [center.nombre],
    lineas: [{ id: line["Row ID"], centroTrabajoId: center.id, centroTrabajoNombre: center.nombre,
      conceptoId: "CON-2", cantidad: 3, precio: 80, iva: 8 }],
  }, created.id, db);

  assert.equal(updated.created, false);
  assert.equal(getExternalQuote(created.id, db)["RAZON SOCIAL"], "Cliente definitivo");
  const savedLine = getExternalConceptRows(created.id, db)[0];
  assert.equal(savedLine.CONCEPTO, "CON-2");
  assert.equal(savedLine.IVA, 0.08);
  assert.equal(savedLine.TOTAL, 259.2);
  db.close();
});

test("separa la tasa de IVA de su importe en el documento", () => {
  const data = construirDataHTML({
    empresa: {}, cotizacion: {}, conceptos_por_centro: {
      centro: { centro_nombre: "Centro", conceptos: [{
        concepto_nombre: "Servicio", cantidad: 1, precio: 20000,
        subtotal: 20000, iva: 0.16, ivaImporte: 3200, total: 23200,
      }] },
    },
  });
  assert.equal(data.centros[0].lineas[0].ivaPorcentaje, 16);
  assert.equal(data.centros[0].lineas[0].ivaLinea, 3200);
  assert.equal(data.totales.ivaGlobal, 3200);
  assert.equal(data.totales.totalGlobal, 23200);
});

test("sanea tasas historicas contaminadas con el importe del IVA", () => {
  const db = memoryDb();
  const created = saveExternalQuote({
    destinatario: "Cliente", fecha: "2026-09-22", proveedorId: "PROV-1",
    centrosTrabajo: ["Centro"], conceptos: [{ id: "CON-1", cantidad: 1, precio: 2500, iva: 16 }],
  }, "", db);
  db.prepare("UPDATE conceptos_cotizacion_externa SET iva = 1000000 WHERE cotizacion_id = ?").run(created.id);
  const line = getExternalConceptRows(created.id, db)[0];
  assert.equal(line.IVA, 0.16);
  assert.equal(line["TOTAL IVA"], 400);
  assert.equal(line.TOTAL, 2900);
  db.close();
});


test("construirDataHTML permite generar cotizacion completa o cotizacion filtrada por sucursal recalculando totales", () => {
  const jsonMock = {
    empresa: { razonSocial: "Mi Empresa SA" },
    cotizacion: { id: "COT-101", titulo: "Seguridad y PIPC", centroDeTrabajoCount: 2 },
    conceptos_por_centro: {
      "CT-1": {
        centro_id: "CT-1",
        centro_nombre: "Sucursal Norte",
        tienda: "01",
        conceptos: [{ concepto_nombre: "PIPC", cantidad: 1, precio: 10000, subtotal: 10000, iva: 0.16, ivaImporte: 1600, total: 11600 }]
      },
      "CT-2": {
        centro_id: "CT-2",
        centro_nombre: "Sucursal Sur",
        tienda: "02",
        conceptos: [{ concepto_nombre: "Capacitacion", cantidad: 1, precio: 5000, subtotal: 5000, iva: 0.16, ivaImporte: 800, total: 5800 }]
      }
    }
  };
  const completa = construirDataHTML(jsonMock);
  assert.equal(completa.centros.length, 2);
  assert.equal(completa.todosLosCentros.length, 2);
  assert.equal(completa.isSingleCenterFiltered, false);
  assert.equal(completa.totales.subTotalGlobal, 15000);
  assert.equal(completa.totales.totalGlobal, 17400);

  const filtradaCT1 = construirDataHTML(jsonMock, { centroId: "CT-1" });
  assert.equal(filtradaCT1.centros.length, 1);
  assert.equal(filtradaCT1.isSingleCenterFiltered, true);
  assert.equal(filtradaCT1.selectedCentroId, "CT-1");
  assert.equal(filtradaCT1.selectedCentroNombre, "Sucursal Norte");
  assert.equal(filtradaCT1.cotizacion.centroNombre, "Sucursal Norte");
  assert.equal(filtradaCT1.cotizacion.centroDeTrabajoCount, 1);
  assert.equal(filtradaCT1.totales.subTotalGlobal, 10000);
  assert.equal(filtradaCT1.totales.totalGlobal, 11600);

  const filtradaPorNombre = construirDataHTML(jsonMock, { centroId: "Sucursal Sur" });
  assert.equal(filtradaPorNombre.centros.length, 1);
  assert.equal(filtradaPorNombre.isSingleCenterFiltered, true);
  assert.equal(filtradaPorNombre.selectedCentroNombre, "Sucursal Sur");
  assert.equal(filtradaPorNombre.totales.totalGlobal, 5800);
});

test("prepararCotizacionDataParaPdf convierte imagenes a Data URI y no rompe con parametros", async () => {
  const { prepararCotizacionDataParaPdf } = await import("../src/modules/facturacion/services/cotizacionPdfImages.js");
  const dataMock = {
    logoEmisor: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    logoCliente: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    firma: {
      firmaUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      nombre: "Firma Test",
      puesto: "Director"
    },
    centros: []
  };

  const pdfData = await prepararCotizacionDataParaPdf(dataMock);
  assert.ok(pdfData.isPdfExport);
  assert.ok(pdfData.logoEmisor.startsWith("data:image/"));
  assert.ok(pdfData.logoCliente.startsWith("data:image/"));
  assert.ok(pdfData.firma.firmaUrl.startsWith("data:image/"));
});

test("plantillas de cotizacion no renderizan skip-link cuando isPdfExport es true", async () => {
  const ejs = (await import("ejs")).default;
  const fs = (await import("node:fs")).default;
  const path = (await import("node:path")).default;

  const templateCot = fs.readFileSync(path.resolve("src/modules/facturacion/views/cotizacion.ejs"), "utf8");
  const templateLey = fs.readFileSync(path.resolve("src/modules/facturacion/views/cotizacion_ley.ejs"), "utf8");

  const mockData = {
    isPdfExport: true,
    logoCliente: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    logoEmisor: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    firma: {
      firmaUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      nombre: "Firma",
      puesto: "Puesto"
    },
    cotizacion: { FOLIO: "TEST-1", FECHA: "2026-01-01" },
    centros: [],
    todosLosCentros: [],
    totales: { subTotalGlobal: 0, ivaGlobal: 0, totalGlobal: 0, totalEnLetra: "" }
  };

  const htmlCot = ejs.render(templateCot, { data: mockData, companyAddress: "Dir", autoprint: false });
  assert.ok(!htmlCot.includes("Saltar al contenido principal"), "cotizacion.ejs no debe contener skip link en exportacion PDF");
  assert.ok(!htmlCot.includes("portal-shell.js"), "cotizacion.ejs no debe incluir portal-shell.js en exportacion PDF");

  const htmlLey = ejs.render(templateLey, { data: mockData, companyAddress: "Dir", autoprint: false });
  assert.ok(!htmlLey.includes("Saltar al contenido principal"), "cotizacion_ley.ejs no debe contener skip link en exportacion PDF");
  assert.ok(!htmlLey.includes("portal-shell.js"), "cotizacion_ley.ejs no debe incluir portal-shell.js en exportacion PDF");
});

test("extractQuoteOptionsFromQuery procesa correctamente parametros de formaPago, desglose y visuales", () => {
  const q1 = extractQuoteOptionsFromQuery({ formaPago: "una_exhibicion" });
  assert.equal(q1.formaPago, "una_exhibicion");

  const q2 = extractQuoteOptionsFromQuery({ fp: "1", desglose: "pipc,capacitaciones", codigo: "1", descripcion: "0", direccion: "1" });
  assert.equal(q2.formaPago, "1");
  assert.deepEqual(q2.desglose.sort(), ["capacitaciones", "pipc"]);
  assert.equal(q2.mostrarCodigo, true);
  assert.equal(q2.mostrarDescripcion, false);
  assert.equal(q2.mostrarDireccion, true);

  const q3 = extractQuoteOptionsFromQuery({ pipc: "1" });
  assert.deepEqual(q3.desglose, ["pipc"]);
});

test("plantillas de cotizacion reflejan forma de pago una sola exhibicion y desglose seleccionado", async () => {
  const ejs = (await import("ejs")).default;
  const fs = await import("node:fs");
  const path = await import("node:path");

  const viewsDir = path.resolve("src/modules/facturacion/views");
  const templateCot = fs.readFileSync(path.join(viewsDir, "cotizacion.ejs"), "utf8");
  const templateLey = fs.readFileSync(path.join(viewsDir, "cotizacion_ley.ejs"), "utf8");

  const baseJson = {
    cotizacion: {
      id: "TEST-FP-1",
      fecha: "2026-10-01",
      titulo: "Propuesta de Seguridad",
      formaPago: "dos_pagos" // DB guarda dos pagos
    },
    empresa: { razonSocial: "Cliente Demo SA de CV" },
    conceptos_por_centro: {
      c1: {
        centro_id: "c1",
        centro_nombre: "Matriz",
        conceptos: [{ concepto_nombre: "PIPC Anual", subtotal: 1000, iva: 0.16, total: 1160, precio: 1000, cantidad: 1 }]
      }
    }
  };

  // Construir data con query option formaPago = una_exhibicion y desglose
  const dataWithOptions = construirDataHTML(baseJson, {
    formaPago: "una_exhibicion",
    desglose: ["pipc", "capacitaciones"],
    mostrarCodigo: true,
    mostrarDescripcion: true,
    mostrarDireccion: true,
  });
  dataWithOptions.isPdfExport = true;

  // Render cotizacion.ejs
  const htmlCot = ejs.render(templateCot, { data: dataWithOptions, companyAddress: "Dir", autoprint: false });
  assert.ok(htmlCot.includes("Pago total al inicio del trabajo"), "cotizacion.ejs debe contener 'Pago total al inicio del trabajo'");
  assert.ok(!htmlCot.includes("50 % de anticipo"), "cotizacion.ejs NO debe contener '50 % de anticipo' cuando es una_exhibicion");
  assert.ok(htmlCot.includes("PIPC (Programa Interno de Protección Civil)"), "cotizacion.ejs debe renderizar desglose PIPC server-side");
  assert.ok(htmlCot.includes("Capacitación de Brigadas"), "cotizacion.ejs debe renderizar desglose Capacitacion server-side");

  // Render cotizacion_ley.ejs
  const htmlLey = ejs.render(templateLey, { data: dataWithOptions, companyAddress: "Dir", autoprint: false });
  assert.ok(htmlLey.includes("Pago total al inicio del trabajo"), "cotizacion_ley.ejs debe contener 'Pago total al inicio del trabajo'");
  assert.ok(!htmlLey.includes("50 % de anticipo"), "cotizacion_ley.ejs NO debe contener '50 % de anticipo' cuando es una_exhibicion");
  assert.ok(htmlLey.includes("PIPC (Programa Interno de Protección Civil)"), "cotizacion_ley.ejs debe renderizar desglose PIPC server-side");
  assert.ok(htmlLey.includes("Capacitación de Brigadas"), "cotizacion_ley.ejs debe renderizar desglose Capacitacion server-side");
});

test("codigo de catalogo se oculta por defecto y solo se muestra si se solicita explicitamente", async () => {
  const ejs = (await import("ejs")).default;
  const fs = await import("node:fs");
  const path = await import("node:path");

  const viewsDir = path.resolve("src/modules/facturacion/views");
  const templateCot = fs.readFileSync(path.join(viewsDir, "cotizacion.ejs"), "utf8");
  const templateLey = fs.readFileSync(path.join(viewsDir, "cotizacion_ley.ejs"), "utf8");

  const baseJson = {
    cotizacion: { id: "TEST-COD-1", fecha: "2026-10-01", titulo: "Cotizacion Sin Codigo" },
    empresa: { razonSocial: "Cliente Demo" },
    conceptos_por_centro: {
      c1: {
        centro_id: "c1",
        centro_nombre: "Matriz",
        conceptos: [{ concepto_nombre: "Servicio 1", subtotal: 100, iva: 0.16, total: 116, catalogo_codigo: "COD-99" }]
      }
    }
  };

  // Sin marcar codigo (default)
  const dataSinCodigo = construirDataHTML(baseJson);
  dataSinCodigo.isPdfExport = true;
  assert.equal(dataSinCodigo.mostrarCodigo, false, "mostrarCodigo debe ser false por defecto");

  const htmlCotSin = ejs.render(templateCot, { data: dataSinCodigo, companyAddress: "Dir", autoprint: false });
  assert.ok(htmlCotSin.includes(".catalogo-codigo { display: none !important; }"), "cotizacion.ejs debe ocultar catalogo-codigo por defecto");

  const htmlLeySin = ejs.render(templateLey, { data: dataSinCodigo, companyAddress: "Dir", autoprint: false });
  assert.ok(htmlLeySin.includes(".catalogo-codigo { display: none !important; }"), "cotizacion_ley.ejs debe ocultar catalogo-codigo por defecto");

  // Marcando codigo explicitamente
  const dataConCodigo = construirDataHTML(baseJson, { mostrarCodigo: true });
  dataConCodigo.isPdfExport = true;
  assert.equal(dataConCodigo.mostrarCodigo, true);

  const htmlCotCon = ejs.render(templateCot, { data: dataConCodigo, companyAddress: "Dir", autoprint: false });
  assert.ok(htmlCotCon.includes(".catalogo-codigo { display: block !important; }"), "cotizacion.ejs debe mostrar catalogo-codigo cuando mostrarCodigo es true");

  const htmlLeyCon = ejs.render(templateLey, { data: dataConCodigo, companyAddress: "Dir", autoprint: false });
  assert.ok(htmlLeyCon.includes(".catalogo-codigo { display: block !important; }"), "cotizacion_ley.ejs debe mostrar catalogo-codigo cuando mostrarCodigo es true");
});

test("formato Sergio Gonzalez Castillo: seleccion de plantilla, datos y renderizado HTML/PDF", async () => {
  const jsonCastilloProvId = {
    cotizacion: { id: "COT-CASTILLO-1", fecha: "2026-10-07", titulo: "Cotizacion Castillo", proveedorId: "EiHiUQ9YHf4mA-C7L_ziyc" },
    empresa: { razonSocial: "Empresa Cliente S.A." },
    conceptos_por_centro: {
      c1: {
        centro_id: "c1",
        centro_nombre: "Sucursal Centro",
        tienda: "1001",
        conceptos: [{ concepto_nombre: "Elaboracion de PIPC", subtotal: 15000, iva: 0.16, total: 17400 }]
      }
    }
  };

  // 1. Deteccion de plantilla
  assert.equal(seleccionarPlantillaCotizacion(jsonCastilloProvId), "cotizacion_castillo");
  assert.equal(seleccionarPlantillaCotizacion({}, { formato: "castillo" }), "cotizacion_castillo");
  assert.equal(seleccionarPlantillaCotizacion({ firma: { nombre: "DR. SERGIO GONZALEZ CASTILLO" } }), "cotizacion_castillo");

  // 2. Construccion de data
  const dataCastillo = construirDataHTML(jsonCastilloProvId);
  assert.equal(dataCastillo.esCastillo, true);
  assert.equal(dataCastillo.logoEmisor, "/img/logo_sergio_castillo.png");
  assert.equal(dataCastillo.firma.nombre, "DR. SERGIO GONZALEZ CASTILLO");
  assert.equal(dataCastillo.firma.puesto, "DIRECTOR GENERAL");
  assert.equal(dataCastillo.firma.firmaUrl, "/img/firma_sergio_castillo.png");
  assert.ok(dataCastillo.direccionEmisor.includes("MISION DE CARMELO"));
  assert.ok(dataCastillo.direccionEmisor.includes("desarrolloeg@gmail.com"));

  // 3. Renderizado de plantilla cotizacion_castillo.ejs
  const fs = (await import("node:fs")).default;
  const path = (await import("node:path")).default;
  const ejs = (await import("ejs")).default;
  const templatePath = path.resolve("src/modules/facturacion/views/cotizacion_castillo.ejs");
  const templateCastillo = fs.readFileSync(templatePath, "utf8");

  dataCastillo.isPdfExport = true;
  const htmlRenderizado = ejs.render(templateCastillo, {
    data: dataCastillo,
    companyAddress: CASTILLO_COMPANY_ADDRESS,
    autoprint: false
  });

  // Verificaciones de contenido exacto
  assert.ok(htmlRenderizado.includes("CONDICIONES"), "Debe incluir banner CONDICIONES");
  assert.ok(htmlRenderizado.includes("GARANTIAS"), "Debe incluir banner GARANTIAS");
  assert.ok(htmlRenderizado.includes("Se Requiere Pago De Anticipo Del 50% Antes De Iniciar Los Trabajos Y El Resto Al Entregar en Tienda"), "Debe incluir condicion de 50% anticipo");
  assert.ok(htmlRenderizado.includes("COMPLETA,</b>") || htmlRenderizado.includes("COMPLETA,</strong>"), "Debe incluir garantia COMPLETA");
  assert.ok(htmlRenderizado.includes("CONFIDENCIALIDAD DE LA INFORMACION"), "Debe incluir CONFIDENCIALIDAD DE LA INFORMACION");
  assert.ok(htmlRenderizado.includes("ATENTAMENTE"), "Debe incluir seccion ATENTAMENTE");
  assert.ok(htmlRenderizado.includes("DR. SERGIO GONZALEZ CASTILLO"), "Debe incluir nombre DR. SERGIO GONZALEZ CASTILLO");
  assert.ok(htmlRenderizado.includes("DIRECTOR GENERAL"), "Debe incluir puesto DIRECTOR GENERAL");
  assert.ok(htmlRenderizado.includes("MISION DE CARMELO N° 2602"), "Debe incluir direccion en el footer");
  assert.ok(htmlRenderizado.includes("6673403135"), "Debe incluir telefono en el footer");
  assert.ok(htmlRenderizado.includes("desarrolloeg@gmail.com"), "Debe incluir correo en el footer");
  assert.ok(!htmlRenderizado.includes("Saltar al contenido principal"), "En modo isPdfExport no debe tener skip link");
});



