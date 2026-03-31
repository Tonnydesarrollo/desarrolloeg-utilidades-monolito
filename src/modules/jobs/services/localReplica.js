import fs from "fs";
import path from "path";
import crypto from "crypto";

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b, "es"))) {
      output[key] = normalizeValue(value[key]);
    }
    return output;
  }

  if (typeof value === "string") {
    return value.replace(/\u00A0/g, " ").trim();
  }

  return value;
}

function normalizeKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function createReplicaHash(row) {
  return crypto.createHash("sha1").update(JSON.stringify(normalizeValue(row))).digest("hex");
}

function toReplicaEntry(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.hash || value.row) {
      return {
        hash: value.hash || (value.row ? createReplicaHash(value.row) : null),
        row: normalizeValue(value.row || {}),
      };
    }
    const normalizedRow = normalizeValue(value);
    return {
      hash: createReplicaHash(normalizedRow),
      row: normalizedRow,
    };
  }

  const normalizedRow = normalizeValue({ value });
  return {
    hash: createReplicaHash(normalizedRow),
    row: normalizedRow,
  };
}

export function loadReplica(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      updatedAt: null,
      keyField: null,
      rowCount: 0,
      rows: {},
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
      return {
        version: parsed.version || 1,
        updatedAt: parsed.updatedAt || null,
        keyField: parsed.keyField || null,
        rowCount: Number(parsed.rowCount || 0),
        rows: Object.fromEntries(
          Object.entries(parsed.rows).map(([key, value]) => [normalizeKey(key), toReplicaEntry(value)])
        ),
      };
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rows = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          normalizeKey(key),
          {
            hash: null,
            row: normalizeValue(value && typeof value === "object" && !Array.isArray(value) ? value : { value }),
          },
        ])
      );
      return {
        version: 0,
        updatedAt: null,
        keyField: null,
        rowCount: Object.keys(rows).length,
        rows,
      };
    }
  } catch {
    // Si el snapshot se corrompe, preferimos reconstruirlo en la siguiente corrida.
  }

  return {
    version: 1,
    updatedAt: null,
    keyField: null,
    rowCount: 0,
    rows: {},
  };
}

export function diffRowsAgainstReplica(rows, keyField, replicaRows = {}, options = {}) {
  const changedRows = [];
  const unchangedRows = [];
  const rowsWithoutKey = [];

  for (const originalRow of rows) {
    const key = normalizeKey(originalRow?.[keyField]);
    if (!key) {
      rowsWithoutKey.push(originalRow);
      changedRows.push(originalRow);
      continue;
    }

    const normalizedRow = normalizeValue(originalRow);
    const rowHash = createReplicaHash(normalizedRow);
    const entry = replicaRows[key];

    let matches = false;
    if (entry?.hash) {
      matches = entry.hash === rowHash;
    } else if (entry?.row) {
      matches = createReplicaHash(entry.row) === rowHash;
    }

    if (!matches && typeof options.entryMatchesRow === "function") {
      matches = Boolean(options.entryMatchesRow(entry, normalizedRow, rowHash, key));
    }

    if (matches) unchangedRows.push(originalRow);
    else changedRows.push(originalRow);
  }

  return {
    changedRows,
    unchangedRows,
    rowsWithoutKey,
  };
}

export function saveReplicaRows(filePath, rows, keyField, options = {}) {
  const mergeWithExisting = Boolean(options.mergeWithExisting);
  const entries = mergeWithExisting ? { ...loadReplica(filePath).rows } : {};

  for (const row of rows) {
    const key = normalizeKey(row?.[keyField]);
    if (!key) continue;
    const normalizedRow = normalizeValue(row);
    entries[key] = {
      hash: createReplicaHash(normalizedRow),
      row: normalizedRow,
    };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        keyField,
        rowCount: Object.keys(entries).length,
        rows: entries,
      },
      null,
      2
    ),
    "utf8"
  );
}
