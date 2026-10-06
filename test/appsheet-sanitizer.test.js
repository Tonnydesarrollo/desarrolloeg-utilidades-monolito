import test from "node:test";
import assert from "node:assert/strict";
import {
  formatEnumListValue,
  isVirtualOrCalculatedColumn,
  sanitizeAppsheetRow,
  sanitizeAppsheetRows,
} from "../src/services/appsheetSanitizer.js";

test("appsheetSanitizer: detecta columnas virtuales, calculadas y de sincronizacion interna", () => {
  assert.equal(isVirtualOrCalculatedColumn("Related PAGADOS_LEYs"), true);
  assert.equal(isVirtualOrCalculatedColumn("Related CONCEPTOS_VARIOS_CTs"), true);
  assert.equal(isVirtualOrCalculatedColumn("STATUS CAPACITACION"), true);
  assert.equal(isVirtualOrCalculatedColumn("DIAS RESTANTES"), true);
  assert.equal(isVirtualOrCalculatedColumn("LABEL"), true);
  assert.equal(isVirtualOrCalculatedColumn("LABEL2"), true);
  assert.equal(isVirtualOrCalculatedColumn("FACTURADOR"), true);
  assert.equal(isVirtualOrCalculatedColumn("CHEQUES POR MES"), true);
  assert.equal(isVirtualOrCalculatedColumn("sync_appsheet_estado"), true);
  assert.equal(isVirtualOrCalculatedColumn("sync_appsheet_fecha"), true);
  assert.equal(isVirtualOrCalculatedColumn("sync_origen_ultimo"), true);
  assert.equal(isVirtualOrCalculatedColumn("pdf_extraido"), true);
  assert.equal(isVirtualOrCalculatedColumn("data_json"), true);

  // Columnas reales permitidas
  assert.equal(isVirtualOrCalculatedColumn("ID"), false);
  assert.equal(isVirtualOrCalculatedColumn("PEDIDO"), false);
  assert.equal(isVirtualOrCalculatedColumn("LIBERACION"), false);
  assert.equal(isVirtualOrCalculatedColumn("RAZON SOCIAL"), false);
  assert.equal(isVirtualOrCalculatedColumn("ESTADOS"), false);
  assert.equal(isVirtualOrCalculatedColumn("MUNICIPIOS"), false);
  assert.equal(isVirtualOrCalculatedColumn("CENTROS_DE_TRABAJO"), false);
});

test("appsheetSanitizer: normaliza delimitador EnumList con espacio coma espacio", () => {
  assert.equal(formatEnumListValue(["Sinaloa", "Sonora"]), "Sinaloa , Sonora");
  assert.equal(formatEnumListValue(["1", "", "2", "  "]), "1 , 2");
  assert.equal(formatEnumListValue("1,2, 3"), "1 , 2 , 3");
  assert.equal(formatEnumListValue(""), "");
  assert.equal(formatEnumListValue(null), "");
});

test("appsheetSanitizer: omite Row ID sintetico en Add para tablas con clave autogenerada", () => {
  const row = {
    "Row ID": "synthetic_123",
    "RAZON SOCIAL": "Casa Ley",
    "ESTADOS": ["Sinaloa"],
    "MUNICIPIOS": ["Culiacán"],
    "CENTROS_DE_TRABAJO": ["101"],
    "CONCEPTOS": ["C1"],
    "PROVEEDOR": "P1",
    "FECHA": "2026-10-06",
    "Related CONCEPTOS_VARIOS_CTs": ["dummy"],
    "sync_appsheet_estado": "PENDIENTE",
  };

  const sanitized = sanitizeAppsheetRow("COTIZACIONES_VARIOS_CT", "Add", row);
  assert.equal(sanitized["Row ID"], undefined);
  assert.equal(sanitized["RAZON SOCIAL"], "Casa Ley");
  assert.equal(sanitized.ESTADOS, "Sinaloa");
  assert.equal(sanitized.MUNICIPIOS, "Culiacán");
  assert.equal(sanitized.CENTROS_DE_TRABAJO, "101");
  // En Add para cotizaciones, CONCEPTOS se deja vacio para que los hijos creen los conceptos
  assert.equal(sanitized.CONCEPTOS, "");
  assert.equal(sanitized["Related CONCEPTOS_VARIOS_CTs"], undefined);
  assert.equal(sanitized.sync_appsheet_estado, undefined);
});

test("appsheetSanitizer: conserva clave primaria en Edit y descarta campos virtuales", () => {
  const row = {
    "Row ID": "row_abc",
    "Referencia de pago": "REF123",
    "Importe": 5000,
    "STATUS CAPACITACION": "FINALIZADA",
    "FACTURADOR": "SERGIO",
    "CHEQUES POR MES": "12",
    "Related PAGADOS_LEYs": ["p1"],
    "sync_appsheet_estado": "PENDIENTE",
  };

  const sanitized = sanitizeAppsheetRow("CHEQUES_LEY", "Edit", row);
  assert.equal(sanitized["Referencia de pago"], "REF123");
  assert.equal(sanitized["Importe"], 5000);
  assert.equal(sanitized["STATUS CAPACITACION"], undefined);
  assert.equal(sanitized["FACTURADOR"], undefined);
  assert.equal(sanitized["CHEQUES POR MES"], undefined);
  assert.equal(sanitized["Related PAGADOS_LEYs"], undefined);
  assert.equal(sanitized["sync_appsheet_estado"], undefined);
});

test("appsheetSanitizer: sanitizeAppsheetRows procesa listas completas", () => {
  const rows = [
    { PEDIDO: "6001234567", PROVEEDOR: "GONZALEZ", sync_appsheet_estado: "PENDIENTE" },
    { PEDIDO: "6001234568", PROVEEDOR: "GAMEZ", "Related PEDIDOS_LEYs": [] },
  ];

  const sanitized = sanitizeAppsheetRows("PEDIDOS_LEY", "Edit", rows);
  assert.equal(sanitized.length, 2);
  assert.equal(sanitized[0].PEDIDO, "6001234567");
  assert.equal(sanitized[0].PROVEEDOR, "GONZALEZ");
  assert.equal(sanitized[0].sync_appsheet_estado, undefined);
  assert.equal(sanitized[1].PEDIDO, "6001234568");
  assert.equal(sanitized[1]["Related PEDIDOS_LEYs"], undefined);
});

