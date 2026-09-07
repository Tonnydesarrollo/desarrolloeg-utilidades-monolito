import crypto from "node:crypto";
import { openDesarrolloegSyncDb } from "../../services/desarrolloegLocalDb.js";
import { getTrabajoTableName } from "./trabajos.service.js";

function env(names) { return names.map((name) => String(process.env[name] || "").trim()).find(Boolean) || ""; }

async function appsheetAction(table, action, rows) {
  const appId = env(["WHATSAPP_CAP_APPSHEET_APP_ID", "DESARROLLOEG_APPSHEET_APP_ID", "APPSHEET_APP_ID"]);
  const accessKey = env(["WHATSAPP_CAP_APPSHEET_ACCESS_KEY", "WHATSAPP_CAP_APPSHEET_API_KEY", "DESARROLLOEG_APPSHEET_ACCESS_KEY", "APPSHEET_API_KEY", "APPSHEET_ACCESS_KEY"]);
  if (!appId || !accessKey) throw new Error("AppSheet no esta configurado para editar trabajos.");
  const response = await fetch(`https://www.appsheet.com/api/v2/apps/${appId}/tables/${encodeURIComponent(table)}/Action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ApplicationAccessKey: accessKey },
    body: JSON.stringify({ Action: action, Properties: { Locale: "es-MX", Timezone: "America/Chihuahua" }, Rows: rows }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`AppSheet respondio ${response.status}: ${body}`);
}

function updateLocalMirror(table, rowId, changes) {
  const db = openDesarrolloegSyncDb();
  if (!db) return;
  const current = db.prepare("SELECT data_json FROM operational_rows WHERE source = 'desarrolloeg' AND table_name = ? AND row_id = ?").get(table, rowId);
  if (!current) return;
  const data = { ...JSON.parse(current.data_json || "{}"), ...changes, "Row ID": rowId };
  const json = JSON.stringify(data);
  db.prepare("UPDATE operational_rows SET data_json = ?, content_hash = ?, updated_at = ? WHERE source = 'desarrolloeg' AND table_name = ? AND row_id = ?")
    .run(json, crypto.createHash("sha256").update(json).digest("hex"), new Date().toISOString(), table, rowId);
  const sqlTable = table === "ESTATALES" ? "estatales" : "municipales";
  const column = table === "ESTATALES" ? "pipc" : "plan_de_contingencia";
  const statusKey = table === "ESTATALES" ? "PIPC" : "PLAN DE CONTINGENCIA";
  db.prepare(`UPDATE ${sqlTable} SET ${column} = ?, documentacion = ?, data_json = ? WHERE row_id = ?`)
    .run(data[statusKey] || null, data.DOCUMENTACION || null, json, rowId);
}

export async function updateTrabajo(tipo, rowId, { status, documents } = {}) {
  const table = getTrabajoTableName(tipo);
  if (!table || !rowId) throw new Error("No se pudo identificar el expediente.");
  const statusColumn = table === "ESTATALES" ? "PIPC" : "PLAN DE CONTINGENCIA";
  const allowedStatuses = new Set(["PENDIENTE", "EN DRIVE", "IMPRESO", "ENTREGADO"]);
  const changes = { "Row ID": rowId };
  if (status !== undefined) {
    const normalizedStatus = String(status || "").trim().toUpperCase();
    if (!allowedStatuses.has(normalizedStatus)) throw new Error("El estatus seleccionado no es valido.");
    changes[statusColumn] = normalizedStatus;
  }
  if (documents !== undefined) {
    const values = Array.isArray(documents) ? documents : [documents];
    changes.DOCUMENTACION = [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))].join(" , ");
  }
  if (Object.keys(changes).length === 1) throw new Error("No hay cambios para guardar.");
  await appsheetAction(table, "Edit", [changes]);
  updateLocalMirror(table, rowId, changes);
  return { ok: true };
}
