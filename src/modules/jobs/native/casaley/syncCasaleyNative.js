import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import * as cheerio from "cheerio";
import { diffRowsAgainstReplica, loadReplica, saveReplicaRows } from "../../services/localReplica.js";
import { loadJobState, saveJobState } from "../../services/jobState.js";

const VALID_UPLOAD_TARGETS = new Set(["none", "all", "pagos", "relacionados", "facturas", "secuencial"]);

let isRunning = false;
const FORCE_RESYNC = String(process.env.CASALEY_FORCE_RESYNC || "").trim() === "1";
const INCREMENTAL_SYNC = String(process.env.CASALEY_INCREMENTAL_SYNC || "1").trim() !== "0";
const SYNC_LOOKBACK_DAYS = Math.max(0, Number(process.env.CASALEY_SYNC_LOOKBACK_DAYS || "2"));
const APPSHEET_REGION = process.env.CASALEY_APPSHEET_REGION || "www.appsheet.com";

function readEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return fallback;
}

function readNumber(names, fallback) {
  const value = readEnv(names, "");
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(names, fallback = false) {
  const value = readEnv(names, "");
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function getCurrentMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { ini: formatDateDMY(first), fin: formatDateDMY(last) };
}

function computeIncrementalRange(defaultRange, lastSyncDateText, lookbackDays) {
  const defaultStart = parseDMYToDate(defaultRange.ini) || new Date();
  const defaultEnd = parseDMYToDate(defaultRange.fin) || new Date();
  if (!lastSyncDateText) {
    return { ...defaultRange };
  }

  const lastSyncDate = parseDMYToDate(lastSyncDateText);
  if (!lastSyncDate) {
    return { ...defaultRange };
  }

  const candidateStart = addDays(lastSyncDate, -Math.max(0, lookbackDays));
  const start = candidateStart.getTime() > defaultStart.getTime() ? candidateStart : defaultStart;
  const end = defaultEnd.getTime() >= start.getTime() ? defaultEnd : new Date();
  return {
    ini: formatDateDMY(start),
    fin: formatDateDMY(end),
  };
}

function decodeLatin1(data) {
  return new TextDecoder("latin1").decode(new Uint8Array(data));
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateDMY(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function parseDMYToDate(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function maxDateDMY(a, b) {
  const da = parseDMYToDate(a);
  const db = parseDMYToDate(b);
  if (!da) return b || "";
  if (!db) return a || "";
  return da.getTime() >= db.getTime() ? a : b;
}

function getMaxDateFromRows(rows, columns) {
  let max = "";
  for (const row of rows || []) {
    for (const column of columns) {
      const value = cleanText(row?.[column] ?? "");
      if (!value) continue;
      if (!max) {
        max = value;
        continue;
      }
      max = maxDateDMY(max, value);
    }
  }
  return max;
}

const CASA_LEY_FACTURA_HEADER_NAMES = new Set([
  "Emisor",
  "Receptor",
  "Serie",
  "Folio",
  "Fecha factura",
  "Fecha registro",
  "Importe",
  "Iva",
  "Total",
  "Estatus",
  "Proveedor Sec",
  "Num ent",
  "Tienda",
  "No Remision",
  "Razón social",
  "Folio Uuid",
]);

function looksLikeCasaLeyFacturaHeaderRow(cells) {
  if (!Array.isArray(cells) || cells.length < 8) return false;
  let matches = 0;
  for (const cell of cells) {
    const text = cleanText(cell);
    if (CASA_LEY_FACTURA_HEADER_NAMES.has(text)) matches += 1;
  }
  return matches >= 8;
}

function looksLikeLoginPage(html) {
  const text = String(html ?? "").toLowerCase();
  return (
    text.includes("txtlogin_us") ||
    text.includes("btnlogin") ||
    text.includes("reestablecer contraseña") ||
    text.includes("capture el usuario")
  );
}

function looksLikeServerErrorPage(html) {
  const text = String(html ?? "").toLowerCase();
  return (
    text.includes("execution timeout expired") ||
    text.includes("soapexception") ||
    text.includes("unhandled exception") ||
    text.includes("error 525") ||
    text.includes("cloudflare")
  );
}

function assertValidCasaLeyHtml(html, context, artifactPath = "") {
  if (!looksLikeLoginPage(html) && !looksLikeServerErrorPage(html)) return;

  if (artifactPath) {
    fs.writeFileSync(artifactPath, html, "utf8");
  }

  throw new Error(`[casaley] ${context}: la respuesta parece una pagina de login o error.`);
}

function parseHiddenFields(html) {
  const $ = cheerio.load(html);
  const fields = {};
  $("input[type='hidden']").each((_, element) => {
    const name = $(element).attr("name");
    const value = $(element).attr("value") ?? "";
    if (name) fields[name] = value;
  });
  return fields;
}

function toFormUrlEncoded(objectValue) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(objectValue)) {
    params.append(key, value == null ? "" : String(value));
  }
  return params.toString();
}

function extractTable(html) {
  const $ = cheerio.load(html);

  let table = $("#ContentPlaceHolder1_grvConsultaFac").first();
  if (!table.length) {
    table = $("table")
      .filter((_, element) => {
        const id = ($(element).attr("id") || "").toLowerCase();
        const cls = ($(element).attr("class") || "").toLowerCase();
        return (
          id.includes("grv") ||
          id.includes("grid") ||
          id.includes("consulta") ||
          cls.includes("tablesorter") ||
          cls.includes("datatable")
        );
      })
      .first();
  }

  if (!table.length) return { headers: [], rows: [] };

  const headers = [];
  table.find("thead tr th").each((_, th) => headers.push(cleanText($(th).text())));
  const firstRow = table.find("tr").first();
  const firstRowCells = firstRow
    .find("th,td")
    .toArray()
    .map((cell) => cleanText($(cell).text()));
  const firstRowHasHeaderCells = firstRow.find("th").length > 0;
  if (headers.length === 0 && (firstRowHasHeaderCells || looksLikeCasaLeyFacturaHeaderRow(firstRowCells))) {
    firstRowCells.forEach((cell) => headers.push(cell));
  }

  const rows = [];
  const trList = table.find("tr").toArray();
  const startIndex = headers.length > 0 ? 1 : 0;

  for (let index = startIndex; index < trList.length; index += 1) {
    const $$ = cheerio.load(trList[index]);
    const cells = $$("th,td").toArray().map((td) => cleanText($$(td).text()));
    if (cells.every((cell) => !cell)) continue;

    const rowObject = {};
    if (headers.length && cells.length === headers.length) {
      headers.forEach((header, cellIndex) => {
        rowObject[header || `col_${cellIndex + 1}`] = cells[cellIndex];
      });
    } else {
      cells.forEach((cell, cellIndex) => {
        rowObject[`col_${cellIndex + 1}`] = cell;
      });
    }
    rows.push(rowObject);
  }

  return { headers, rows };
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\r\n]/.test(stringValue)) return `"${stringValue.replace(/"/g, '""')}"`;
  return stringValue;
}

function writeCsv(rows, outputPath) {
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row?.[header])).join(","));
  }
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
}

function resolveReplicaFile(config, label) {
  return path.join(config.outputDir, `${label}_replica.json`);
}

function applyRowLimit(rows, maxRows) {
  if (!Number.isFinite(maxRows) || maxRows <= 0) return rows;
  return rows.slice(0, maxRows);
}

function computeStableKey(row, keyColumnName) {
  const entries = Object.entries(row || {})
    .filter(([key]) => key !== keyColumnName)
    .map(([key, value]) => [String(key), typeof value === "string" ? cleanText(value) : (value == null ? "" : value)]);

  entries.sort((a, b) => a[0].localeCompare(b[0], "es"));
  return crypto.createHash("sha1").update(JSON.stringify(entries)).digest("hex");
}

function ensureKey(rows, keyColumnName) {
  return rows.map((row) => {
    const output = { ...row };
    const existing = cleanText(output[keyColumnName] ?? "");
    if (!existing) output[keyColumnName] = computeStableKey(output, keyColumnName);
    return output;
  });
}

function sanitizeRowValuesOnly(row) {
  const output = {};
  for (const [key, value] of Object.entries(row || {})) {
    output[key] = typeof value === "string" ? cleanText(value) : (value == null ? "" : value);
  }
  return output;
}

function parseCasaLeyDateValue(value) {
  const text = cleanText(value);
  if (!text) return null;

  const dmyMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (dmyMatch) {
    return {
      year: Number(dmyMatch[3]),
      month: Number(dmyMatch[2]),
      day: Number(dmyMatch[1]),
      hour: Number(dmyMatch[4] || 0),
      minute: Number(dmyMatch[5] || 0),
      second: Number(dmyMatch[6] || 0),
      hasTime: Boolean(dmyMatch[4]),
    };
  }

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
      hour: Number(isoMatch[4] || 0),
      minute: Number(isoMatch[5] || 0),
      second: Number(isoMatch[6] || 0),
      hasTime: Boolean(isoMatch[4]),
    };
  }

  return null;
}

function stripCasaLeyDiacritics(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseAppSheetSpanishDateValue(value) {
  const text = cleanText(value);
  if (!text) return null;

  const normalized = stripCasaLeyDiacritics(text.toLowerCase());
  const match = normalized.match(/^(?:[a-z]+,\s*)?(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i);
  if (!match) return null;

  const monthMap = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };

  const month = monthMap[match[2]];
  if (!month) return null;

  return {
    year: Number(match[3]),
    month,
    day: Number(match[1]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0),
  };
}

function getRangeDateBounds(range = {}) {
  const start = parseDMYToDate(range.fechaIni || range.ini || "");
  const end = parseDMYToDate(range.fechaFin || range.fin || "");
  return { start, end };
}

function isParsedDateWithinRange(parsed, range = {}) {
  if (!parsed) return false;
  const { start, end } = getRangeDateBounds(range);
  const current = new Date(parsed.year, parsed.month - 1, parsed.day, parsed.hour || 0, parsed.minute || 0, parsed.second || 0);
  if (start && current.getTime() < start.getTime()) return false;
  if (end && current.getTime() > end.getTime()) return false;
  return true;
}

function getAppSheetChequeDateRange(row, tipoCobroFlag) {
  const preferredDate = row?.["Fecha cobro"] ?? row?.["Fecha pago"] ?? row?.["Fecha de carga"] ?? "";
  const parsed = parseAppSheetSpanishDateValue(preferredDate) || parseAppSheetSpanishDateValue(row?.["Fecha cobro"]) || parseAppSheetSpanishDateValue(row?.["Fecha pago"]);
  if (!parsed) return null;
  const formatted = `${String(parsed.day).padStart(2, "0")}/${String(parsed.month).padStart(2, "0")}/${String(parsed.year)}`;
  return { fechaIni: formatted, fechaFin: formatted };
}

function getCasaLeyMonthKeyFromValue(value) {
  const parsed = parseCasaLeyDateValue(value);
  if (!parsed) return "";
  return `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}`;
}

function getCasaLeyMonthKeyFromRow(row, candidateColumns = []) {
  for (const column of candidateColumns) {
    const monthKey = getCasaLeyMonthKeyFromValue(row?.[column]);
    if (monthKey) return monthKey;
  }
  return "";
}

function groupRowsByMonth(rows, monthResolver) {
  const buckets = new Map();
  for (const row of rows || []) {
    const monthKey = cleanText(monthResolver?.(row) || "") || "unknown";
    if (!buckets.has(monthKey)) buckets.set(monthKey, []);
    buckets.get(monthKey).push(row);
  }
  return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b, "es"));
}

function formatCasaLeyDateForAppSheet(value, { dateOnly = false } = {}) {
  const parsed = parseCasaLeyDateValue(value);
  if (!parsed) return value;

  const pad = (n) => String(n).padStart(2, "0");
  const date = `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}`;
  if (dateOnly) return date;
  return `${date} ${pad(parsed.hour)}:${pad(parsed.minute)}:${pad(parsed.second)}`;
}

function normalizeCasaLeyUploadRow(row) {
  const output = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (/^col_\d+$/i.test(key)) continue;
    const cleaned = typeof value === "string" ? cleanText(value) : (value == null ? "" : value);
    if (typeof cleaned === "string" && key.toLowerCase().includes("fecha")) {
      const isFacturaDate = key.toLowerCase().includes("factura") && !key.toLowerCase().includes("registro");
      output[key] = formatCasaLeyDateForAppSheet(cleaned, { dateOnly: isFacturaDate });
    } else {
      output[key] = cleaned;
    }
  }
  delete output.CLUBFACTURA;
  delete output["FACTURA CLUBFACTURA"];
  return output;
}

function getCasaLeyCobroFlag(tipoPago) {
  return String(tipoPago) === "1" ? "Y" : "N";
}

function getCasaLeyCobroDisplayValue(tipoPago) {
  return String(tipoPago) === "1" ? "COBRADO" : "NO COBRADO";
}

function normalizeCasaLeyCobroValue(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";
  if (["y", "yes", "true", "1", "cobrado"].includes(text)) return "Y";
  if (["n", "no", "false", "0", "no cobrado"].includes(text)) return "N";
  return text.toUpperCase();
}

function isCasaLeyCobroFlagYes(value) {
  return normalizeCasaLeyCobroValue(value) === "Y";
}

function annotateCasaLeyPagos(rows, tipoPago) {
  const flag = getCasaLeyCobroDisplayValue(tipoPago);
  return (rows || []).map((row) => ({
    ...row,
    COBRADO: flag,
  }));
}

async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 504;
}

function createCasaLeyClient(config) {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 60000,
      maxRedirects: 10,
      validateStatus: () => true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
        Connection: "keep-alive",
      },
    })
  );
}

async function loginCasaLey(client, config, user, password) {
  const getResponse = await client.get(config.loginUrl, { responseType: "arraybuffer" });
  const loginHtml = decodeLatin1(getResponse.data);
  const hidden = parseHiddenFields(loginHtml);

  const payload = {
    ...hidden,
    scriptManagerGlobal_HiddenField: hidden.scriptManagerGlobal_HiddenField || "",
    __EVENTTARGET: "btnLogin",
    __EVENTARGUMENT: "",
    txtLogin_us: user,
    txtLogin_pa: password,
    hdnus: "",
    hdnAux_modal: "",
  };

  await client.post(config.loginUrl, toFormUrlEncoded(payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: config.loginUrl,
      Origin: config.base,
    },
    responseType: "arraybuffer",
  });

  const homeResponse = await client.get(config.homeUrl, {
    headers: { Referer: config.loginUrl },
    responseType: "arraybuffer",
  });
  const homeHtmlRaw = decodeLatin1(homeResponse.data);
  const homeHtml = homeHtmlRaw.toLowerCase();
  assertValidCasaLeyHtml(homeHtmlRaw, `login para ${user}`, path.join(config.outputDir, `debug_home_${user}.html`));

  const ok =
    homeHtml.includes("inicio") ||
    homeHtml.includes("salir") ||
    homeHtml.includes("logout") ||
    homeHtml.includes("bienvenido");

  if (!ok) {
    fs.writeFileSync(path.join(config.outputDir, `debug_home_${user}.html`), decodeLatin1(homeResponse.data), "utf8");
    throw new Error(`No pude confirmar login para ${user}.`);
  }
}

async function consultarPagos(client, config, range = {}, tipoPago = "1") {
  const fechaIni = range.fechaIni || config.fechaIni;
  const fechaFin = range.fechaFin || config.fechaFin;
  const getResponse = await client.get(config.pagosUrl, {
    headers: { Referer: config.homeUrl },
    responseType: "arraybuffer",
  });
  const html = decodeLatin1(getResponse.data);
  const hidden = parseHiddenFields(html);

  const payload = {
    ...hidden,
    "ContentPlaceHolder1_scrMgr_ConsultaFacturas_HiddenField": "",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    "ctl00$ContentPlaceHolder1$TxBxReferencia": "",
    "ctl00$ContentPlaceHolder1$TxBxOperacion": "",
    "ctl00$ContentPlaceHolder1$fechaIni": fechaIni,
    "ctl00$ContentPlaceHolder1$fechaFin": fechaFin,
    "ctl00$ContentPlaceHolder1$cboTipoPago": String(tipoPago),
    "ctl00$ContentPlaceHolder1$cboEstatus": "T",
    "ctl00$ContentPlaceHolder1$btnBuscar": "Buscar",
    "ctl00$ContentPlaceHolder1$TotalRelacionados": "",
    "ctl00$ContentPlaceHolder1$TotalDescontado": "",
    "ctl00$ContentPlaceHolder1$hdnReferencia": "",
    "ctl00$ContentPlaceHolder1$hdnTipo": "",
    "ctl00$ContentPlaceHolder1$hdnSociedad": "",
    "ctl00$ContentPlaceHolder1$hdnAnio": "",
    "ctl00$HdnUsuario": "",
  };

  const postResponse = await client.post(config.pagosUrl, toFormUrlEncoded(payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: config.pagosUrl,
      Origin: config.base,
    },
    responseType: "arraybuffer",
  });

  const resultHtml = decodeLatin1(postResponse.data);
  assertValidCasaLeyHtml(resultHtml, "consulta de pagos", path.join(config.outputDir, "debug_pagos_result.html"));
  const { rows } = extractTable(resultHtml);

  if (!rows.length) {
    fs.writeFileSync(path.join(config.outputDir, "debug_pagos_result.html"), resultHtml, "utf8");
    console.warn("Sin filas de Pagos.");
    return [];
  }
  return annotateCasaLeyPagos(rows, tipoPago);
}

async function consultaDoctosRelacionados(client, config, referenciaPago, tipo = config.relTipo || "1", range = {}) {
  const tipoPago = String(tipo || "1");
  const fechaIni = range.fechaIni || config.fechaIni;
  const fechaFin = range.fechaFin || config.fechaFin;
  const response = await client.post(
    config.relUrl,
    {
      filtro: String(referenciaPago),
      tipo: tipoPago,
      tipoPago: tipoPago,
      cboTipoPago: tipoPago,
      fechaIni,
      fechaFin,
    },
    {
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: config.base,
        Referer: config.pagosUrl,
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
      responseType: "arraybuffer",
    }
  );

  const text = decodeLatin1(response.data);
  if (looksLikeLoginPage(text) || looksLikeServerErrorPage(text)) {
    throw new Error("[casaley] consulta de doctos relacionados: la respuesta parece una pagina de login o error.");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  if (data && typeof data === "object" && "d" in data) {
    const nested = data.d;
    if (typeof nested === "string") {
      try {
        return JSON.parse(nested);
      } catch {
        return [];
      }
    }
    return nested;
  }

  return data;
}

async function consultaDoctosRelacionadosConFallback(client, config, referenciaPago, tipo, range = {}) {
  const primaryTipo = String(tipo || "1");
  const secondaryTipo = primaryTipo === "1" ? "0" : "1";

  const primary = await consultaDoctosRelacionados(client, config, referenciaPago, primaryTipo, range);
  const primaryItems = Array.isArray(primary) ? primary : (primary ? [primary] : []);
  if (primaryItems.length > 0 || secondaryTipo === primaryTipo) return primaryItems;

  const secondary = await consultaDoctosRelacionados(client, config, referenciaPago, secondaryTipo, range);
  const secondaryItems = Array.isArray(secondary) ? secondary : (secondary ? [secondary] : []);
  return secondaryItems.length > 0 ? secondaryItems : primaryItems;
}

async function consultarRelacionadosDesdePagos(client, config, pagos) {
  const cache = new Map();
  const relacionados = [];

  for (let index = 0; index < pagos.length; index += 1) {
    const referenciaPago = cleanText(pagos[index]?.["Referencia de pago"] ?? "");
    if (!referenciaPago) continue;

    const tipoRelacionados = isCasaLeyCobroFlagYes(pagos[index]?.COBRADO) ? "1" : "0";
    const cacheKey = `${referenciaPago}|${tipoRelacionados}`;
    const fechaRelacionados = cleanText(pagos[index]?.["Fecha cobro"] ?? pagos[index]?.["Fecha pago"] ?? pagos[index]?.["Fecha de carga"] ?? "") || config.pagosRange;
    const relacionadosRange = fechaRelacionados && typeof fechaRelacionados === "string"
      ? { fechaIni: fechaRelacionados, fechaFin: fechaRelacionados }
      : config.pagosRange;

    let rel = cache.get(cacheKey);
    if (!rel) {
      rel = await consultaDoctosRelacionadosConFallback(client, config, referenciaPago, tipoRelacionados, relacionadosRange);
      cache.set(cacheKey, rel);
    }

    const items = Array.isArray(rel) ? rel : (rel ? [rel] : []);
    for (const item of items) {
      if (item && typeof item === "object") relacionados.push({ referencia_pago: referenciaPago, ...item });
      else relacionados.push({ referencia_pago: referenciaPago, relacionado_raw: String(item) });
    }
  }

  return relacionados;
}

async function backfillRelacionadosFromAppSheet(client, config, portalPagos, relaciondosActuales = []) {
  if (!config.shouldUpload.relacionados || !config.tablaPagos) return relaciondosActuales;

  const portalRefs = new Set(
    (portalPagos || [])
      .map((row) => cleanText(row?.["Referencia de pago"] ?? ""))
      .filter(Boolean)
  );

  const existingRows = await loadAppSheetRows(config, config.tablaPagos);
  const backfillCandidates = existingRows.filter((row) => {
    const referenciaPago = cleanText(row?.["Referencia de pago"] ?? row?.Referencia ?? "");
    if (!referenciaPago || portalRefs.has(referenciaPago)) return false;

    const cobrado = isCasaLeyCobroFlagYes(row?.COBRADO);
    const dateText = row?.["Fecha cobro"] ?? row?.["Fecha pago"] ?? row?.["Fecha de carga"] ?? "";
    const parsedDate = parseAppSheetSpanishDateValue(dateText);
    return isParsedDateWithinRange(parsedDate, config.pagosRange);
  });

  if (!backfillCandidates.length) return relaciondosActuales;

  console.log(`[casaley] relacionados: backfill desde AppSheet ${backfillCandidates.length} filas`);

  const cache = new Map();
  const adicionales = [];
  for (const row of backfillCandidates) {
    const referenciaPago = cleanText(row?.["Referencia de pago"] ?? row?.Referencia ?? "");
    if (!referenciaPago) continue;

    const tipoRelacionados = isCasaLeyCobroFlagYes(row?.COBRADO) ? "1" : "0";
    const cacheKey = `${referenciaPago}|${tipoRelacionados}`;
    const relatedRange = getAppSheetChequeDateRange(row, tipoRelacionados === "1" ? "Y" : "N") || config.pagosRange;

    let rel = cache.get(cacheKey);
    if (!rel) {
      rel = await consultaDoctosRelacionadosConFallback(client, config, referenciaPago, tipoRelacionados, relatedRange);
      cache.set(cacheKey, rel);
    }

    if (referenciaPago === "R100120262073144122") {
      const debugItems = Array.isArray(rel) ? rel : (rel ? [rel] : []);
      console.log(
        `[casaley] debug relacionados target=${referenciaPago} tipo=${tipoRelacionados} rango=${JSON.stringify(relatedRange)} filas=${debugItems.length} refs=${debugItems.map((item) => String(item?.Referencia ?? "")).join("|")}`
      );
    }

    const items = Array.isArray(rel) ? rel : (rel ? [rel] : []);
    for (const item of items) {
      if (item && typeof item === "object") adicionales.push({ referencia_pago: referenciaPago, ...item });
      else adicionales.push({ referencia_pago: referenciaPago, relacionado_raw: String(item) });
    }
  }

  if (!adicionales.length) return relaciondosActuales;
  relaciondosActuales.push(...adicionales);

  return relaciondosActuales;
}

async function consultarFacturas(client, config, user, range = {}) {
  const fechaIni = range.fechaIni || config.fechaIni;
  const fechaFin = range.fechaFin || config.fechaFin;
  const getResponse = await client.get(config.facturasUrl, {
    headers: { Referer: config.homeUrl },
    responseType: "arraybuffer",
  });
  const html = decodeLatin1(getResponse.data);
  const hidden = parseHiddenFields(html);

  const payload = {
    ...hidden,
    "ContentPlaceHolder1_scrMgr_ConsultaFacturas_HiddenField": "",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    "ctl00$ContentPlaceHolder1$TxBxSerie": "",
    "ctl00$ContentPlaceHolder1$TxBxFolio": "",
    "ctl00$ContentPlaceHolder1$DrLiStatus": "ALL",
    "ctl00$ContentPlaceHolder1$fechaIniFac": "",
    "ctl00$ContentPlaceHolder1$fechaFinFac": "",
    "ctl00$ContentPlaceHolder1$fechaIniReg": fechaIni,
    "ctl00$ContentPlaceHolder1$fechaFinReg": fechaFin,
    "ctl00$ContentPlaceHolder1$btnBuscar": "Buscar",
    "ctl00$ContentPlaceHolder1$hdnRFC": user,
    "ctl00$ContentPlaceHolder1$hdnConsultas": "",
    "ctl00$HdnUsuario": "",
  };

  const postResponse = await client.post(config.facturasUrl, toFormUrlEncoded(payload), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: config.facturasUrl,
      Origin: config.base,
    },
    responseType: "arraybuffer",
  });

  const resultHtml = decodeLatin1(postResponse.data);
  assertValidCasaLeyHtml(resultHtml, "consulta de facturas", path.join(config.outputDir, "debug_facturas_result.html"));
  const { rows } = extractTable(resultHtml);

  if (!rows.length) {
    fs.writeFileSync(path.join(config.outputDir, "debug_facturas_result.html"), resultHtml, "utf8");
    console.warn("Sin filas de Facturas.");
    return [];
  }
  return rows;
}

async function appsheetAction(config, tableName, action, rows) {
  const url = `https://${APPSHEET_REGION}/api/v2/apps/${config.appsheetAppId}/tables/${encodeURIComponent(tableName)}/Action`;
  const response = await axios.post(
    url,
    {
      Action: action,
      Properties: {
        Locale: "es-MX",
        Timezone: "America/Mazatlan",
      },
      Rows: rows,
    },
    {
      headers: {
        ApplicationAccessKey: config.appsheetApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: config.appsheetTimeoutMs,
      validateStatus: () => true,
    }
  );

  return { status: response.status, data: response.data };
}

async function appsheetActionWithRetry(config, tableName, action, rows) {
  let attempt = 0;
  while (true) {
    const response = await appsheetAction(config, tableName, action, rows);
    if (!isRetryableStatus(response.status)) return response;
    if (attempt >= config.appsheetMaxRetries) return response;

    const backoff = config.appsheetBaseDelayMs * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 250);
    await sleep(Math.min(60000, backoff + jitter));
    attempt += 1;
  }
}

function responseLooksLikeNotFound(errorText) {
  const text = String(errorText || "").toLowerCase();
  return text.includes("cannot find") || text.includes("not found") || text.includes("notfound");
}

function createCasaLeyRowId() {
  return crypto.randomBytes(16).toString("base64url").replace(/[^A-Za-z0-9_]/g, "").slice(0, 22);
}

function buildExistingRowIndex(rows, keyColumn) {
  const index = new Map();
  for (const row of rows || []) {
    const keyValue = row?.[keyColumn];
    if (keyValue === null || keyValue === undefined || String(keyValue).trim() === "") continue;
    index.set(String(keyValue), row);
  }
  return index;
}

function buildKnownKeySet(rows, keyColumn) {
  const keys = new Set();
  const iterable = Array.isArray(rows) ? rows : Object.values(rows || {});
  for (const row of iterable) {
    const keyValue = row?.[keyColumn] ?? row?.row?.[keyColumn];
    if (keyValue === null || keyValue === undefined || String(keyValue).trim() === "") continue;
    keys.add(String(keyValue));
  }
  return keys;
}

async function loadAppSheetRows(config, tableName) {
  const response = await appsheetActionWithRetry(config, tableName, "Find", []);
  if (response.status < 200 || response.status >= 300) {
    const errorText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    throw new Error(`No pude leer AppSheet (${tableName}): ${errorText}`);
  }

  return Array.isArray(response.data) ? response.data : (response.data?.Rows || response.data?.rows || []);
}

async function verifyAppSheetKeyPresent(config, tableName, keyColumn, keyValue, attempts = 3) {
  const key = String(keyValue ?? "");
  if (!key) return false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rows = await loadAppSheetRows(config, tableName);
    const knownKeys = buildKnownKeySet(rows, keyColumn);
    if (knownKeys.has(key)) return true;

    if (attempt < attempts - 1) {
      await sleep(1000 * (attempt + 1));
    }
  }

  return false;
}

async function upsertOne(config, tableName, row, keyColumn, lookup) {
  if (config.dryRun) return { ok: true, mode: "dry_run" };

  const key = String(row?.[keyColumn] ?? "");
  const existingRow = lookup instanceof Map ? lookup.get(key) : null;
  const keyExists = Boolean(existingRow) || Boolean(lookup?.has?.(key));
  const desiredCobrado = normalizeCasaLeyCobroValue(row?.COBRADO ?? "");
  const currentCobrado = normalizeCasaLeyCobroValue(existingRow?.COBRADO ?? "");

  if (existingRow) {
    if (desiredCobrado === "Y" && currentCobrado !== "Y") {
      const editRow = {
        [keyColumn]: key,
        COBRADO: getCasaLeyCobroDisplayValue("1"),
      };
      const editResponse = await appsheetActionWithRetry(config, tableName, "Edit", [editRow]);
      if (editResponse.status >= 200 && editResponse.status < 300) {
        return { ok: true, mode: "edit" };
      }

      const editErrorText = typeof editResponse.data === "string" ? editResponse.data : JSON.stringify(editResponse.data);
      return { ok: false, mode: "edit_failed", error: editErrorText };
    }

    return { ok: true, mode: "skip_existing" };
  }

  if (keyExists) {
    return { ok: true, mode: "skip_existing" };
  }

  const addRow = { ...row };
  const addResponse = await appsheetActionWithRetry(config, tableName, "Add", [addRow]);
  if (addResponse.status >= 200 && addResponse.status < 300) {
    const verified = await verifyAppSheetKeyPresent(config, tableName, keyColumn, key);
    if (!verified) {
      return { ok: false, mode: "add_not_persisted", error: `AppSheet acepto el Add, pero no encontre la llave ${keyColumn}=${key} despues de verificar.` };
    }
    return { ok: true, mode: "add" };
  }

  const addErrorText = typeof addResponse.data === "string" ? addResponse.data : JSON.stringify(addResponse.data);
  return { ok: false, mode: "add_failed", error: addErrorText };
}

async function upsertMany(config, tableName, rows, keyColumn, label, lookup = new Map()) {
  const queue = rows.slice();
  let ok = 0;
  let added = 0;
  let edited = 0;
  let skippedExisting = 0;
  let failed = 0;
  let processed = 0;

  console.log(`[casaley] ${label}: uploadando ${rows.length} filas`);

  const workers = Array.from({ length: 1 }, async () => {
    while (queue.length) {
      const row = queue.shift();
      processed += 1;
      const current = processed;
      console.log(`[casaley] ${label}: fila ${current}/${rows.length} key=${row?.[keyColumn] ?? ""}`);
      const result = await upsertOne(config, tableName, row, keyColumn, lookup);
      if (result.ok) {
        ok += 1;
        if (result.mode === "add") added += 1;
        if (result.mode === "edit") edited += 1;
        if (result.mode === "skip_existing") skippedExisting += 1;
        console.log(`[casaley] ${label}: fila ${current}/${rows.length} ok=${result.mode}`);
        continue;
      }

      failed += 1;
      console.log(`[casaley] ${label}: fila ${current}/${rows.length} fallo=${result.mode}`);
      fs.appendFileSync(
        path.join(config.outputDir, `appsheet_errors_${label}.log`),
        `\n[${new Date().toISOString()}] table=${tableName} key=${row?.[keyColumn]} mode=${result.mode}\n${result.error}\n`,
        "utf8"
      );
    }
  });

  await Promise.all(workers);
  return { total: rows.length, ok, edited, added, skippedExisting, failed };
}

async function upsertManyByMonth(config, tableName, rows, keyColumn, label, lookup, monthResolver) {
  const monthGroups = groupRowsByMonth(rows, monthResolver);
  const summary = { total: 0, ok: 0, edited: 0, added: 0, skippedExisting: 0, failed: 0, batches: [] };

  for (const [monthKey, monthRows] of monthGroups) {
    if (!monthRows.length) continue;
    console.log(`[casaley] ${label}: lote ${monthKey} con ${monthRows.length} filas`);
    const result = await upsertMany({ ...config, concurrency: 1 }, tableName, monthRows, keyColumn, `${label}:${monthKey}`, lookup);
    summary.total += result.total;
    summary.ok += result.ok;
    summary.edited += result.edited;
    summary.added += result.added;
    summary.skippedExisting += result.skippedExisting || 0;
    summary.failed += result.failed;
    summary.batches.push({ month: monthKey, ...result });
    if (result.failed > 0) break;
  }

  return summary;
}

async function runForUser(config, label, user, password) {
  const client = createCasaLeyClient(config);

  console.log(`[casaley] ${label}: login`);
  await loginCasaLey(client, config, user, password);

  console.log(`[casaley] ${label}: pagos cobrados`);
  const pagosCobrados = await consultarPagos(client, config, config.pagosRange, "1");

  console.log(`[casaley] ${label}: pagos no cobrados`);
  const pagosNoCobrados = await consultarPagos(client, config, config.pagosRange, "0");

  const pagos = [...pagosCobrados, ...pagosNoCobrados];
  console.log(
    `[casaley] ${label}: pagos detectados cobrados=${pagosCobrados.length} no_cobrados=${pagosNoCobrados.length} total=${pagos.length}`
  );

  console.log(`[casaley] ${label}: relacionados`);
  const relacionados = await consultarRelacionadosDesdePagos(client, config, pagos);
  const relacionadosBackfilled = await backfillRelacionadosFromAppSheet(client, config, pagos, relacionados);

  console.log(`[casaley] ${label}: facturas`);
  const facturas = await consultarFacturas(client, config, user, config.facturasRange);

  writeCsv(pagos, path.join(config.outputDir, `pagos_${label}.csv`));
  writeCsv(relacionadosBackfilled, path.join(config.outputDir, `relacionados_${label}.csv`));
  writeCsv(facturas, path.join(config.outputDir, `facturas_${label}.csv`));

  return { pagos, relacionados: relacionadosBackfilled, facturas };
}

function requireEnv(config) {
  if (!config.users.length) {
    throw new Error("Faltan credenciales CasaLey.");
  }

  if (config.uploadTarget === "none") return;

  const missing = [];
  const required = [
    ["CASALEY_APPSHEET_APP_ID", config.appsheetAppId],
    ["CASALEY_APPSHEET_API_KEY", config.appsheetApiKey],
  ];

  if (config.shouldUpload.pagos) {
    required.push(["CASALEY_TABLA_PAGOS", config.tablaPagos], ["CASALEY_PAGOS_KEY", config.pagosKey]);
  }
  if (config.shouldUpload.relacionados) {
    required.push(["CASALEY_TABLA_RELACIONADOS", config.tablaRelacionados], ["CASALEY_RELACIONADOS_KEY", config.relacionadosKey]);
  }
  if (config.shouldUpload.facturas) {
    required.push(["CASALEY_TABLA_FACTURAS", config.tablaFacturas], ["CASALEY_FACTURAS_KEY", config.facturasKey]);
  }

  for (const [name, value] of required) {
    if (!String(value || "").trim()) missing.push(name);
  }

  if (missing.length) {
    throw new Error(`Faltan variables .env: ${missing.join(", ")}`);
  }
}

function buildConfig(options = {}) {
  const { ini: defaultFechaIni, fin: defaultFechaFin } = getCurrentMonthRange();
  const uploadTarget = String(options.uploadTarget || readEnv(["CASALEY_UPLOAD_TARGET"], "all")).toLowerCase().trim();
  if (!VALID_UPLOAD_TARGETS.has(uploadTarget)) {
    throw new Error("CASALEY_UPLOAD_TARGET invalido. Usa none, all, pagos, relacionados, facturas o secuencial.");
  }

  const isSequential = uploadTarget === "secuencial";
  const shouldUpload = {
    pagos: uploadTarget === "all" || uploadTarget === "pagos" || isSequential,
    relacionados: uploadTarget === "all" || uploadTarget === "relacionados" || isSequential,
    facturas: uploadTarget === "all" || uploadTarget === "facturas" || isSequential,
  };

  const outputDir = readEnv(
    ["CASALEY_OUTPUT_DIR"],
    path.resolve(process.cwd(), "src", "modules", "jobs", "native", "casaley", "data")
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const user1 = readEnv(["CASALEY_USER"], "");
  const password1 = readEnv(["CASALEY_PASSWORD"], "");
  const user2 = readEnv(["CASALEY_USER2"], "");
  const password2 = readEnv(["CASALEY_PASSWORD2"], "");
  const users = [];

  if (user1 || password1) {
    if (!user1 || !password1) {
      throw new Error("CASALEY_USER y CASALEY_PASSWORD deben configurarse juntos.");
    }
    users.push({ label: "U1", user: user1, password: password1 });
  }

  if (user2 || password2) {
    if (!user2 || !password2) {
      throw new Error("CASALEY_USER2 y CASALEY_PASSWORD2 deben configurarse juntos.");
    }
    users.push({ label: "U2", user: user2, password: password2 });
  }

  const base = readEnv(["CASALEY_BASE"], "https://aplicaciones.casaley.com.mx").replace(/\/+$/, "");
  const maxRowsPerTable = Math.max(0, readNumber(["CASALEY_MAX_ROWS_PER_TABLE"], 0));

  return {
    base,
    loginUrl: `${base}/CFacturaWeb/Default.aspx`,
    homeUrl: `${base}/CFacturaWeb/Inicio.aspx`,
    pagosUrl: `${base}/CFacturaWeb/Pagos/ConsultaCP.aspx`,
    relUrl: `${base}/CFacturaWeb/Pagos/ConsultaCP.aspx/ConsultaDoctosRelacionados`,
    facturasUrl: `${base}/CFacturaWeb/Facturas/ConsultaFacturas.aspx`,
    fechaIni: readEnv(["CASALEY_FECHA_INI", "FECHA_INI"], defaultFechaIni),
    fechaFin: readEnv(["CASALEY_FECHA_FIN", "FECHA_FIN"], defaultFechaFin),
    relTipo: readEnv(["CASALEY_REL_TIPO", "REL_TIPO"], "1"),
    appsheetAppId: readEnv(["CASALEY_APPSHEET_APP_ID", "APPSHEETID"], ""),
    appsheetApiKey: readEnv(["CASALEY_APPSHEET_API_KEY", "APPSHEETKEY"], ""),
    tablaPagos: readEnv(["CASALEY_TABLA_PAGOS", "TABLA_PAGOS"], ""),
    pagosKey: readEnv(["CASALEY_PAGOS_KEY", "PAGOS_KEY"], ""),
    tablaRelacionados: readEnv(["CASALEY_TABLA_RELACIONADOS", "TABLA_RELACIONADOS"], ""),
    relacionadosKey: readEnv(["CASALEY_RELACIONADOS_KEY", "RELACIONADOS_KEY"], ""),
    tablaFacturas: readEnv(["CASALEY_TABLA_FACTURAS", "TABLA_FACTURAS"], ""),
    facturasKey: readEnv(["CASALEY_FACTURAS_KEY", "FACTURAS_KEY"], ""),
    concurrency: Math.max(1, readNumber(["CASALEY_CONCURRENCY", "CONCURRENCY"], 6)),
    dryRun: readBoolean(["CASALEY_DRY_RUN", "DRY_RUN"], false),
    incrementalSync: readBoolean(["CASALEY_INCREMENTAL_SYNC"], true),
    uploadByMonth: readBoolean(["CASALEY_UPLOAD_BY_MONTH"], false),
    appsheetMaxRetries: Math.max(0, readNumber(["CASALEY_APPSHEET_MAX_RETRIES", "APPSHEET_MAX_RETRIES"], 5)),
    appsheetBaseDelayMs: Math.max(250, readNumber(["CASALEY_APPSHEET_BASE_DELAY_MS", "APPSHEET_BASE_DELAY_MS"], 1000)),
    appsheetTimeoutMs: Math.max(60000, readNumber(["CASALEY_APPSHEET_TIMEOUT_MS"], 120000)),
    uploadTarget,
    isSequential,
    shouldUpload,
    delayBetweenUploadsMs: Math.max(
      0,
      readNumber(["CASALEY_DELAY_BETWEEN_UPLOADS_MS", "DELAY_BETWEEN_UPLOADS_MS"], 0)
    ),
    maxUsers: Math.max(0, readNumber(["CASALEY_MAX_USERS"], 0)),
    maxRowsPerTable,
    maxPagosRows: Math.max(0, readNumber(["CASALEY_MAX_PAGOS_ROWS"], maxRowsPerTable)),
    maxRelacionadosRows: Math.max(0, readNumber(["CASALEY_MAX_RELACIONADOS_ROWS"], maxRowsPerTable)),
    maxFacturasRows: Math.max(0, readNumber(["CASALEY_MAX_FACTURAS_ROWS"], maxRowsPerTable)),
    outputDir,
    users,
  };
}

async function runCasaleyJob(options = {}) {
  const config = buildConfig(options);
  requireEnv(config);
  const state = loadJobState("casaley-sync-appsheet");

  fs.writeFileSync(path.join(config.outputDir, "appsheet_errors_pagos.log"), "", "utf8");
  fs.writeFileSync(path.join(config.outputDir, "appsheet_errors_relacionados.log"), "", "utf8");
  fs.writeFileSync(path.join(config.outputDir, "appsheet_errors_facturas.log"), "", "utf8");

  const defaultPagosRange = { ini: config.fechaIni, fin: config.fechaFin };
  const defaultFacturasRange = { ini: config.fechaIni, fin: config.fechaFin };
  config.pagosRange = config.incrementalSync && !FORCE_RESYNC
    ? computeIncrementalRange(defaultPagosRange, state.data?.pagos?.lastDate || "", SYNC_LOOKBACK_DAYS)
    : defaultPagosRange;
  config.facturasRange = config.incrementalSync && !FORCE_RESYNC
    ? computeIncrementalRange(defaultFacturasRange, state.data?.facturas?.lastDate || "", SYNC_LOOKBACK_DAYS)
    : defaultFacturasRange;

  const results = [];
  const usersToProcess = config.maxUsers > 0 ? config.users.slice(0, config.maxUsers) : config.users;
  for (const account of usersToProcess) {
    results.push(await runForUser(config, account.label, account.user, account.password));
  }

  const allPagos = results.flatMap((result) => result.pagos);
  const allRelacionados = results.flatMap((result) => result.relacionados);
  const allFacturas = results.flatMap((result) => result.facturas);

  const prepareUploadRows = (rows) => rows.map((row) => normalizeCasaLeyUploadRow(sanitizeRowValuesOnly(row)));

  const pagosPrepared = config.pagosKey ? ensureKey(prepareUploadRows(allPagos), config.pagosKey) : prepareUploadRows(allPagos);
  const facturasPrepared = config.facturasKey
    ? ensureKey(prepareUploadRows(allFacturas), config.facturasKey)
    : prepareUploadRows(allFacturas);

  const pagosReplicaPath = resolveReplicaFile(config, "pagos");
  const relacionadosReplicaPath = resolveReplicaFile(config, "relacionados");
  const facturasReplicaPath = resolveReplicaFile(config, "facturas");
  const [pagosExistingRows, relacionadosExistingRows, facturasExistingRows] = !config.incrementalSync || FORCE_RESYNC
    ? (config.shouldUpload.pagos || config.shouldUpload.relacionados || config.shouldUpload.facturas
      ? await Promise.all([
          config.shouldUpload.pagos ? loadAppSheetRows(config, config.tablaPagos) : [],
          config.shouldUpload.relacionados ? loadAppSheetRows(config, config.tablaRelacionados) : [],
          config.shouldUpload.facturas ? loadAppSheetRows(config, config.tablaFacturas) : [],
        ])
      : [[], [], []])
    : [[], [], []];
  const pagosExistingRowsForLookup = config.shouldUpload.pagos
    ? (pagosExistingRows.length ? pagosExistingRows : await loadAppSheetRows(config, config.tablaPagos))
    : [];
  const relacionadosPrepared = config.relacionadosKey
    ? ensureKey(prepareUploadRows(allRelacionados), config.relacionadosKey)
    : prepareUploadRows(allRelacionados);
  const pagosSelected = applyRowLimit(pagosPrepared, config.maxPagosRows);
  const relacionadosSelected = applyRowLimit(relacionadosPrepared, config.maxRelacionadosRows);
  const facturasSelected = applyRowLimit(facturasPrepared, config.maxFacturasRows);

  writeCsv(pagosPrepared, path.join(config.outputDir, "pagos_ALL.csv"));
  writeCsv(relacionadosPrepared, path.join(config.outputDir, "relacionados_ALL.csv"));
  writeCsv(facturasPrepared, path.join(config.outputDir, "facturas_ALL.csv"));
  const pagosKnownLookup = buildExistingRowIndex(pagosExistingRowsForLookup, config.pagosKey);
  const relacionadosKnownLookup = config.incrementalSync && !FORCE_RESYNC
    ? buildKnownKeySet(loadReplica(relacionadosReplicaPath).rows, config.relacionadosKey)
    : buildExistingRowIndex(relacionadosExistingRows, config.relacionadosKey);
  const facturasKnownLookup = config.incrementalSync && !FORCE_RESYNC
    ? buildKnownKeySet(loadReplica(facturasReplicaPath).rows, config.facturasKey)
    : buildExistingRowIndex(facturasExistingRows, config.facturasKey);

  const pagosDiff = FORCE_RESYNC || !config.pagosKey
    ? { changedRows: pagosSelected, unchangedRows: [], rowsWithoutKey: [] }
    : diffRowsAgainstReplica(pagosSelected, config.pagosKey, loadReplica(pagosReplicaPath).rows);
  const relacionadosDiff = FORCE_RESYNC || !config.relacionadosKey
    ? { changedRows: relacionadosSelected, unchangedRows: [], rowsWithoutKey: [] }
    : diffRowsAgainstReplica(relacionadosSelected, config.relacionadosKey, loadReplica(relacionadosReplicaPath).rows);
  const facturasDiff = FORCE_RESYNC || !config.facturasKey
    ? { changedRows: facturasSelected, unchangedRows: [], rowsWithoutKey: [] }
    : diffRowsAgainstReplica(facturasSelected, config.facturasKey, loadReplica(facturasReplicaPath).rows);

  writeCsv(pagosDiff.changedRows, path.join(config.outputDir, "pagos_to_upload.csv"));
  writeCsv(relacionadosDiff.changedRows, path.join(config.outputDir, "relacionados_to_upload.csv"));
  writeCsv(facturasDiff.changedRows, path.join(config.outputDir, "facturas_to_upload.csv"));

  const summary = {
    ok: true,
    users: usersToProcess.length,
    uploadTarget: config.uploadTarget,
    dryRun: config.dryRun,
    uploadByMonth: config.uploadByMonth,
    pagos: pagosPrepared.length,
    relacionados: relacionadosPrepared.length,
    facturas: facturasPrepared.length,
    selected: {
      pagos: pagosSelected.length,
      relacionados: relacionadosSelected.length,
      facturas: facturasSelected.length,
    },
    uploads: {},
    replica: {
      pagos: { changed: pagosDiff.changedRows.length, unchanged: pagosDiff.unchangedRows.length },
      relacionados: { changed: relacionadosDiff.changedRows.length, unchanged: relacionadosDiff.unchangedRows.length },
      facturas: { changed: facturasDiff.changedRows.length, unchanged: facturasDiff.unchangedRows.length },
    },
    limits: {
      maxUsers: config.maxUsers || null,
      maxRowsPerTable: config.maxRowsPerTable || null,
      maxPagosRows: config.maxPagosRows || null,
      maxRelacionadosRows: config.maxRelacionadosRows || null,
      maxFacturasRows: config.maxFacturasRows || null,
    },
    forceResync: FORCE_RESYNC,
    outputDir: config.outputDir,
  };

  if (config.uploadTarget === "none" || config.dryRun) {
    return summary;
  }

  if (config.shouldUpload.pagos) {
    if (pagosDiff.changedRows.length === 0) {
      summary.uploads.pagos = { total: 0, ok: 0, edited: 0, added: 0, failed: 0, skippedUnchanged: pagosDiff.unchangedRows.length };
      saveReplicaRows(pagosReplicaPath, pagosSelected, config.pagosKey, { mergeWithExisting: true });
    } else {
      summary.uploads.pagos = config.uploadByMonth
        ? await upsertManyByMonth(
            config,
            config.tablaPagos,
            pagosDiff.changedRows,
            config.pagosKey,
            "pagos",
            pagosKnownLookup,
            (row) => getCasaLeyMonthKeyFromRow(row, ["Fecha pago", "Fecha cobro", "Fecha de carga"])
          )
        : await upsertMany(
            config,
            config.tablaPagos,
            pagosDiff.changedRows,
            config.pagosKey,
            "pagos",
            pagosKnownLookup
          );
      if (summary.uploads.pagos.failed === 0) {
        saveReplicaRows(pagosReplicaPath, pagosSelected, config.pagosKey, { mergeWithExisting: true });
      }
    }
    if (config.isSequential) await sleep(config.delayBetweenUploadsMs);
  }

  if (config.shouldUpload.relacionados) {
    if (relacionadosDiff.changedRows.length === 0) {
      summary.uploads.relacionados = {
        total: 0,
        ok: 0,
        edited: 0,
        added: 0,
        failed: 0,
        skippedUnchanged: relacionadosDiff.unchangedRows.length,
      };
      saveReplicaRows(relacionadosReplicaPath, relacionadosSelected, config.relacionadosKey, { mergeWithExisting: true });
    } else {
      const pagosMonthByKey = new Map(
        pagosPrepared.map((row) => {
          const keyValue = row?.[config.pagosKey];
          return [String(keyValue ?? ""), getCasaLeyMonthKeyFromRow(row, ["Fecha pago", "Fecha cobro", "Fecha de carga"])];
        })
      );
      summary.uploads.relacionados = config.uploadByMonth
        ? await upsertManyByMonth(
            config,
            config.tablaRelacionados,
            relacionadosDiff.changedRows,
            config.relacionadosKey,
            "relacionados",
            relacionadosKnownLookup,
            (row) => {
              const pagoKey = cleanText(row?.referencia_pago ?? row?.["referencia_pago"] ?? row?.["Referencia de pago"] ?? "");
              if (pagoKey && pagosMonthByKey.has(pagoKey)) return pagosMonthByKey.get(pagoKey);
              return getCasaLeyMonthKeyFromRow(row, ["Fecha pago", "Fecha cobro", "Fecha de carga"]);
            }
          )
        : await upsertMany(
            config,
            config.tablaRelacionados,
            relacionadosDiff.changedRows,
            config.relacionadosKey,
            "relacionados",
            relacionadosKnownLookup
          );
      if (summary.uploads.relacionados.failed === 0) {
        saveReplicaRows(relacionadosReplicaPath, relacionadosSelected, config.relacionadosKey, { mergeWithExisting: true });
      }
    }
    if (config.isSequential) await sleep(config.delayBetweenUploadsMs);
  }

  if (config.shouldUpload.facturas) {
    if (facturasDiff.changedRows.length === 0) {
      summary.uploads.facturas = {
        total: 0,
        ok: 0,
        edited: 0,
        added: 0,
        failed: 0,
        skippedUnchanged: facturasDiff.unchangedRows.length,
      };
      saveReplicaRows(facturasReplicaPath, facturasSelected, config.facturasKey, { mergeWithExisting: true });
    } else {
      summary.uploads.facturas = config.uploadByMonth
        ? await upsertManyByMonth(
            config,
            config.tablaFacturas,
            facturasDiff.changedRows,
            config.facturasKey,
            "facturas",
            facturasKnownLookup,
            (row) => getCasaLeyMonthKeyFromRow(row, ["Fecha registro", "Fecha factura"])
          )
        : await upsertMany(
            config,
            config.tablaFacturas,
            facturasDiff.changedRows,
            config.facturasKey,
            "facturas",
            facturasKnownLookup
          );
      if (summary.uploads.facturas.failed === 0) {
        saveReplicaRows(facturasReplicaPath, facturasSelected, config.facturasKey, { mergeWithExisting: true });
      }
    }
  }

  if (config.incrementalSync && !FORCE_RESYNC) {
    const nextState = {
      ...(state.data || {}),
      pagos: { ...(state.data?.pagos || {}) },
      facturas: { ...(state.data?.facturas || {}) },
    };
    const pagosLastDate = getMaxDateFromRows(pagosSelected, ["Fecha pago", "Fecha cobro", "Fecha de carga"]);
    const facturasLastDate = getMaxDateFromRows(facturasSelected, ["Fecha registro", "Fecha factura"]);
    if (pagosLastDate) nextState.pagos.lastDate = pagosLastDate;
    if (facturasLastDate) nextState.facturas.lastDate = facturasLastDate;

    const uploadsFailed =
      (summary.uploads.pagos?.failed || 0) +
      (summary.uploads.relacionados?.failed || 0) +
      (summary.uploads.facturas?.failed || 0);
    if (uploadsFailed === 0) {
      saveJobState("casaley-sync-appsheet", nextState);
    }
  }

  return summary;
}

export async function syncCasaleyNative(options = {}) {
  if (isRunning) {
    return {
      ok: true,
      skipped: true,
      message: "Sync de CasaLey ya en ejecucion, se omite una nueva corrida.",
    };
  }

  isRunning = true;
  try {
    return await runCasaleyJob(options);
  } finally {
    isRunning = false;
  }
}

export async function exportCasaleyAllNative() {
  return syncCasaleyNative({ uploadTarget: "none" });
}
