import assert from "node:assert/strict";
import test from "node:test";
import { resolvePcEstatalBySucursal } from "../src/modules/home/pcEstatal.service.js";

test("resuelve el estatus PC Estatal vigente por sucursal, tienda e ID_PC", () => {
  const result = resolvePcEstatalBySucursal({
    year: 2026,
    sucursales: [
      { id: "110", tienda: "1374", id_pc: "3610" },
      { id: "101", tienda: "1365", id_pc: "4265" },
      { id: "70", tienda: "1300", id_pc: "3797" },
    ],
    pcRows: [
      { solicitud_id: "17000", SUCURSAL: "110", estatus: "En captura", registro_fecha: "06/04/2026" },
      { solicitud_id: "17855", SUCURSAL: "110", estatus: "Revision campo", registro_fecha: "08/19/2026" },
      { solicitud_id: "17852", TIENDA: "1365", estatus: "VISITADA", registro_fecha: "08/19/2026" },
      { solicitud_id: "17849", sucursal_id: "3797", estatus: "RECHAZADA", MOTIVO: "RECHAZADA: señalamiento", registro_fecha: "08/19/2026" },
      { solicitud_id: "14728", SUCURSAL: "110", estatus: "Firmada", registro_fecha: "12/05/2025" },
    ],
  });

  assert.equal(result.get("110")?.status, "Revision campo");
  assert.equal(result.get("101")?.status, "VISITADA");
  assert.equal(result.get("70")?.status, "RECHAZADA");
  assert.equal(result.get("70")?.motivo, "RECHAZADA: señalamiento");
  assert.equal(result.size, 3);
});
