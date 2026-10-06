/**
 * appsheetSanitizer.js
 *
 * Central sanitizer and validator for all AppSheet API calls across all modules.
 * Ensures:
 * 1. Calculated, virtual, and internal SQLite/sync columns are NEVER sent to AppSheet.
 * 2. Proper primary key conventions (Row ID vs ID vs PEDIDO vs LIBERACION).
 * 3. Valid_If compliance: EnumList fields formatted with standard delimiter " , " without empty items.
 * 4. Preservation of table-specific business rules (e.g. CONCEPTOS="" on quote headers during Add).
 */

export const APPSHEET_TABLE_KEYS = Object.freeze({
  EMPRESAS: "ID",
  SUCURSALES: "ID",
  EMPLEADOS: "Row ID",
  CAPACITACIONES: "ID",
  CALENDARIO: "ID",
  PEDIDOS_LEY: "PEDIDO",
  LIBERACIONES: "LIBERACION",
  COTIZACIONES: "Row ID",
  COTIZACIONES_VARIOS_CT: "Row ID",
  CONCEPTOS_COTIZACION: "Row ID",
  CONCEPTOS_VARIOS_CT: "Row ID",
  CATALOGO: "Row ID",
  PROVEEDORES: "Row ID",
  ESTATALES: "Row ID",
  MUNICIPALES: "Row ID",
  CHEQUES_LEY: "Referencia de pago",
  PAGADOS_LEY: "Referencia",
  FACTURAS_EN_LEY: "Folio Uuid",
  CFDIS: "id",
});

// Tables where AppSheet automatically generates "Row ID" upon Add
export const AUTO_GENERATED_KEY_TABLES = new Set([
  "COTIZACIONES_VARIOS_CT",
  "COTIZACIONES",
  "CONCEPTOS_VARIOS_CT",
  "CONCEPTOS_COTIZACION",
  "EMPLEADOS",
  "CATALOGO",
  "PROVEEDORES",
]);

// Known EnumList fields in AppSheet tables
export const ENUMLIST_FIELDS = new Set([
  "ESTADOS",
  "MUNICIPIOS",
  "CENTROS_DE_TRABAJO",
  "CENTROS_TRABAJO",
  "CONCEPTOS",
  "EMPLEADOS",
  "SUCURSALES",
  "CAPACITADORES",
  "DOCUMENTACION",
]);

// Known read-only, virtual, or calculated columns in AppSheet tables
const KNOWN_VIRTUAL_COLUMNS = new Set([
  "STATUS CAPACITACION",
  "STATUS_CAPACITACION",
  "DIAS RESTANTES",
  "DIAS_RESTANTES",
  "DIAS DE VENCIMIENTO",
  "LABEL",
  "LABEL2",
  "Label",
  "Label2",
  "FACTURADOR",
  "CHEQUES POR MES",
  "CHEQUES_POR_MES",
  "REMANENTE",
  "SALDO",
  "TOTAL_CALCULADO",
  "IMPORTE_CALCULADO",
  "FALTANTES_TEXTO",
  "SISTEMA PC",
  "VENCIMIENTO",
  "Related PAGADOS_LEYs",
  "Related PEDIDOS_LEYs",
  "Related CONCEPTOS_VARIOS_CTs",
  "Related COTIZACIONES_VARIOS_CTs",
  "Related CAPACITACIONESs",
  "Related SUCURSALESs",
]);

// Internal local sync / engine columns that must never be sent to AppSheet
const INTERNAL_SYNC_COLUMNS = new Set([
  "sync_appsheet_estado",
  "sync_appsheet_fecha",
  "sync_appsheet_operacion",
  "sync_origen_ultimo",
  "pdf_extraido",
  "pdf_extraido_fecha",
  "pdf_extraido_error",
  "data_json",
  "hash",
  "row",
  "score",
  "content_hash",
  "updated_at",
]);

export function isVirtualOrCalculatedColumn(columnName = "") {
  const name = String(columnName || "").trim();
  if (!name) return true;
  if (/^Related\s+/i.test(name)) return true;
  if (/_CALCULAD[OA]$/i.test(name) || /CALCULAD[OA]$/i.test(name)) return true;
  if (KNOWN_VIRTUAL_COLUMNS.has(name)) return true;
  if (INTERNAL_SYNC_COLUMNS.has(name)) return true;
  return false;
}

export function formatEnumListValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    const cleanItems = value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
    return cleanItems.join(" , ");
  }
  const str = String(value).trim();
  if (!str) return "";
  const parts = str
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.join(" , ");
}

export function sanitizeAppsheetRow(tableName, action, row) {
  if (!row || typeof row !== "object") return row;

  const normalizedTable = String(tableName || "").trim().toUpperCase();
  const normalizedAction = String(action || "Edit").trim();
  const isAdd = normalizedAction.toLowerCase() === "add";
  const output = {};

  for (const [key, value] of Object.entries(row)) {
    if (isVirtualOrCalculatedColumn(key)) {
      continue;
    }

    // For tables where AppSheet generates Row ID on Add, do not send synthetic Row ID
    if (isAdd && AUTO_GENERATED_KEY_TABLES.has(normalizedTable) && (key === "Row ID" || key === "ROW ID")) {
      continue;
    }

    // Format EnumList fields properly with standard " , " delimiter
    const upperKey = key.toUpperCase();
    if (ENUMLIST_FIELDS.has(upperKey) && value !== undefined && value !== null) {
      // Special rule: On quote creation, CONCEPTOS must be empty to let child CONCEPTOS_VARIOS_CT manage them
      if (isAdd && normalizedTable === "COTIZACIONES_VARIOS_CT" && upperKey === "CONCEPTOS") {
        output[key] = "";
      } else {
        output[key] = formatEnumListValue(value);
      }
      continue;
    }

    // Don't include undefined
    if (value !== undefined) {
      output[key] = value;
    }
  }

  // Ensure table primary key is properly present for Edit
  if (!isAdd) {
    const primaryKeyField = APPSHEET_TABLE_KEYS[normalizedTable];
    if (primaryKeyField && output[primaryKeyField] === undefined) {
      // Look for candidate key in input row
      const candidate = row[primaryKeyField] ?? row[primaryKeyField.toLowerCase()] ?? row["Row ID"] ?? row.id ?? row.ID;
      if (candidate !== undefined && candidate !== null && String(candidate).trim() !== "") {
        output[primaryKeyField] = candidate;
      }
    }
  }

  return output;
}

export function sanitizeAppsheetRows(tableName, action, rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => sanitizeAppsheetRow(tableName, action, row));
}

