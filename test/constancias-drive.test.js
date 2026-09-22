import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  extractDriveFolderId,
  resolveConstanciasDriveDestination,
  sanitizeCsvFileName,
  sanitizePdfFileName,
} from "../src/modules/constancias-v2/constanciasDrive.service.js";

test("extrae carpetas Drive desde valores AppSheet y URLs", () => {
  const id = "1KjF1zGZQZR34E1VWCk68CHlY2TkqTM3L";
  assert.equal(extractDriveFolderId(`https://drive.google.com/drive/folders/${id}`), id);
  assert.equal(extractDriveFolderId(JSON.stringify({ Url: `https://drive.google.com/drive/folders/${id}` })), id);
  assert.equal(extractDriveFolderId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(extractDriveFolderId(id), id);
});

test("resuelve la carpeta por sucursal o por sede de capacitacion", () => {
  const folderId = "1KjF1zGZQZR34E1VWCk68CHlY2TkqTM3L";
  const sucursales = [{ ID: "33", LABEL: "1176 LA CANTERA", DRIVE: `https://drive.google.com/drive/folders/${folderId}` }];
  const capacitaciones = [{ ID: "CAP-1", CEDE: "33" }];

  assert.deepEqual(
    resolveConstanciasDriveDestination({ capacitacionId: "CAP-1", sucursales, capacitaciones }),
    { folderId, sucursalId: "33", sucursalLabel: "1176 LA CANTERA" },
  );
  assert.equal(
    resolveConstanciasDriveDestination({ sucursalLabel: "1176 la cantera", sucursales, capacitaciones }).folderId,
    folderId,
  );
});

test("rechaza sucursales sin carpeta y limpia el nombre del PDF", () => {
  assert.throws(
    () => resolveConstanciasDriveDestination({ sucursalId: "33", sucursales: [{ ID: "33", LABEL: "LA CANTERA" }], capacitaciones: [] }),
    /no tiene una carpeta de Drive/i,
  );
  assert.equal(sanitizePdfFileName('1176: LA/CANTERA? DIP'), "1176 LACANTERA DIP.pdf");
  assert.equal(sanitizeCsvFileName('1176: LA/CANTERA? PARTICIPANTES'), "1176 LACANTERA PARTICIPANTES.csv");
});

test("todas las vistas React de constancias cargan la accion Drive", () => {
  const html = fs.readFileSync(new URL("../src/modules/constancias-v2/public/index.html", import.meta.url), "utf8");
  const script = fs.readFileSync(new URL("../src/modules/constancias-v2/public/drive-pdf.js", import.meta.url), "utf8");
  assert.match(html, /\/constancias\/drive-pdf\.js\?v=1\.2\.7/);
  assert.match(html, /img\[alt="Logo Cliente"\][\s\S]*max-height: 140px !important;[\s\S]*object-fit: contain !important;/);
  assert.match(script, /CREAR PDF Y GUARDAR EN DRIVE/);
  assert.match(script, /#print-capture-area \.sucursal-label/);
  assert.match(script, /\/constancias\/api\/pdf\/drive/);
  assert.match(script, /\.recipient-name/);
  assert.match(script, /\/constancias\/api\/csv\/drive/);
  assert.match(script, /PDF y CSV guardados en Drive/);
  assert.match(script, /await waitForPaint\(\);[\s\S]*await waitForImages\(captureArea\)/);
  assert.match(script, /restoreImages = await inlineCaptureImages\(captureArea\)/);
  assert.match(script, /dataUrls\.set\(source, await blobToDataUrl/);
  assert.match(script, /await waitForImages\(pages\[index\]\)/);
  assert.match(script, /`constancia-\$\{index \+ 1\}`/);
  assert.match(script, /installDownloadHandler\(original\)/);
});
