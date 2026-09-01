import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getFacturasEnLeyLocalRows,
  getPagadosLeyLocalRows,
  markCasaLeyRowsSyncState,
  mirrorCasaLeyTablesToSyncDb,
  replaceCasaLeyLocalRows,
} from "../src/modules/jobs/services/localAppsheetDb.js";
import { loadReplica } from "../src/modules/jobs/services/localReplica.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(
  process.env.CASALEY_REPLICA_DIR
    || path.join(rootDir, "src", "modules", "jobs", "native", "casaley", "data")
);

function replicaRows(name) {
  const replica = loadReplica(path.join(dataDir, `${name}_replica.json`));
  return Object.values(replica.rows || {}).map((entry) => entry.row).filter(Boolean);
}

const before = {
  relacionados: getPagadosLeyLocalRows().length,
  facturas: getFacturasEnLeyLocalRows().length,
};
const replicas = {
  pagos: replicaRows("pagos"),
  relacionados: replicaRows("relacionados"),
  facturas: replicaRows("facturas"),
};
// Las replicas son el snapshot autoritativo del job. Reemplazar evita conservar
// filas mal formadas creadas por versiones antiguas del sincronizador.
const result = replaceCasaLeyLocalRows({
  pagosRows: replicas.pagos,
  relacionadosRows: replicas.relacionados,
  facturasRows: replicas.facturas,
});
const synchronized = {
  pagos: markCasaLeyRowsSyncState("pagos", replicas.pagos.map((row) => row["Referencia de pago"] || row.referencia_pago), { origin: "REPLICA_LOCAL" }),
  relacionados: markCasaLeyRowsSyncState("relacionados", replicas.relacionados.map((row) => row.Referencia || row.referencia), { origin: "REPLICA_LOCAL" }),
  facturas: markCasaLeyRowsSyncState("facturas", replicas.facturas.map((row) => row["Folio Uuid"] || row.folio_uuid), { origin: "REPLICA_LOCAL" }),
};
const mirror = mirrorCasaLeyTablesToSyncDb();
const after = {
  relacionados: getPagadosLeyLocalRows().length,
  facturas: getFacturasEnLeyLocalRows().length,
};

console.log(JSON.stringify({ ok: true, dataDir, before, after, result, synchronized, mirror }, null, 2));
