import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import * as cheerio from "cheerio";

const VALID_UPLOAD_TARGETS = new Set(["none", "all", "pagos", "relacionados", "facturas", "secuencial"]);

let isRunning = false;

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

function formatDateDMY(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function getLastMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { ini: formatDateDMY(first), fin: formatDateDMY(last) };
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
  if (headers.length === 0) {
    table.find("tr")
      .first()
      .find("th,td")
      .each((_, cell) => headers.push(cleanText($(cell).text())));
  }

  const rows = [];
  const trList = table.find("tr").toArray();
  const startIndex = trList.length > 0 ? 1 : 0;

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
  const homeHtml = decodeLatin1(homeResponse.data).toLowerCase();

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

async function consultarPagos(client, config) {
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
    "ctl00$ContentPlaceHolder1$fechaIni": config.fechaIni,
    "ctl00$ContentPlaceHolder1$fechaFin": config.fechaFin,
    "ctl00$ContentPlaceHolder1$cboTipoPago": "1",
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
  const { rows } = extractTable(resultHtml);

  if (!rows.length) {
    fs.writeFileSync(path.join(config.outputDir, "debug_pagos_result.html"), resultHtml, "utf8");
    console.warn("Sin filas de Pagos.");
    return [];
  }
  return rows;
}

async function consultaDoctosRelacionados(client, config, referenciaPago) {
  const response = await client.post(
    config.relUrl,
    { filtro: String(referenciaPago), tipo: String(config.relTipo) },
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

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { raw: text };
  }

  if (data && typeof data === "object" && "d" in data) {
    const nested = data.d;
    if (typeof nested === "string") {
      try {
        return JSON.parse(nested);
      } catch {
        return nested;
      }
    }
    return nested;
  }

  return data;
}

async function consultarRelacionadosDesdePagos(client, config, pagos) {
  const cache = new Map();
  const relacionados = [];

  for (let index = 0; index < pagos.length; index += 1) {
    const referenciaPago = cleanText(pagos[index]?.["Referencia de pago"] ?? "");
    if (!referenciaPago) continue;

    let rel = cache.get(referenciaPago);
    if (!rel) {
      rel = await consultaDoctosRelacionados(client, config, referenciaPago);
      cache.set(referenciaPago, rel);
    }

    const items = Array.isArray(rel) ? rel : (rel ? [rel] : []);
    for (const item of items) {
      if (item && typeof item === "object") relacionados.push({ referencia_pago: referenciaPago, ...item });
      else relacionados.push({ referencia_pago: referenciaPago, relacionado_raw: String(item) });
    }
  }

  return relacionados;
}

async function consultarFacturas(client, config, user) {
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
    "ctl00$ContentPlaceHolder1$fechaIniFac": config.fechaIni,
    "ctl00$ContentPlaceHolder1$fechaFinFac": config.fechaFin,
    "ctl00$ContentPlaceHolder1$fechaIniReg": "",
    "ctl00$ContentPlaceHolder1$fechaFinReg": "",
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
  const { rows } = extractTable(resultHtml);

  if (!rows.length) {
    fs.writeFileSync(path.join(config.outputDir, "debug_facturas_result.html"), resultHtml, "utf8");
    console.warn("Sin filas de Facturas.");
    return [];
  }
  return rows;
}

async function appsheetAction(config, tableName, action, rows) {
  const url = `https://api.appsheet.com/api/v2/apps/${config.appsheetAppId}/tables/${encodeURIComponent(tableName)}/Action`;
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
      timeout: 60000,
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

async function upsertOne(config, tableName, row, keyColumn) {
  if (config.dryRun) return { ok: true, mode: "dry_run" };

  const editResponse = await appsheetActionWithRetry(config, tableName, "Edit", [row]);
  if (editResponse.status >= 200 && editResponse.status < 300) {
    return { ok: true, mode: "edit" };
  }

  const editErrorText = typeof editResponse.data === "string" ? editResponse.data : JSON.stringify(editResponse.data);
  if (responseLooksLikeNotFound(editErrorText)) {
    const addResponse = await appsheetActionWithRetry(config, tableName, "Add", [row]);
    if (addResponse.status >= 200 && addResponse.status < 300) {
      return { ok: true, mode: "add" };
    }
    const addErrorText = typeof addResponse.data === "string" ? addResponse.data : JSON.stringify(addResponse.data);
    return { ok: false, mode: "add_failed", error: addErrorText };
  }

  return { ok: false, mode: "edit_failed", error: editErrorText };
}

async function upsertMany(config, tableName, rows, keyColumn, label) {
  const queue = rows.slice();
  let ok = 0;
  let added = 0;
  let edited = 0;
  let failed = 0;

  const workers = Array.from({ length: config.concurrency }, async () => {
    while (queue.length) {
      const row = queue.shift();
      const result = await upsertOne(config, tableName, row, keyColumn);
      if (result.ok) {
        ok += 1;
        if (result.mode === "add") added += 1;
        if (result.mode === "edit") edited += 1;
        continue;
      }

      failed += 1;
      fs.appendFileSync(
        path.join(config.outputDir, `appsheet_errors_${label}.log`),
        `\n[${new Date().toISOString()}] table=${tableName} key=${row?.[keyColumn]} mode=${result.mode}\n${result.error}\n`,
        "utf8"
      );
    }
  });

  await Promise.all(workers);
  return { total: rows.length, ok, edited, added, failed };
}

async function runForUser(config, label, user, password) {
  const client = createCasaLeyClient(config);

  console.log(`[casaley] ${label}: login`);
  await loginCasaLey(client, config, user, password);

  console.log(`[casaley] ${label}: pagos`);
  const pagos = await consultarPagos(client, config);

  console.log(`[casaley] ${label}: relacionados`);
  const relacionados = await consultarRelacionadosDesdePagos(client, config, pagos);

  console.log(`[casaley] ${label}: facturas`);
  const facturas = await consultarFacturas(client, config, user);

  writeCsv(pagos, path.join(config.outputDir, `pagos_${label}.csv`));
  writeCsv(relacionados, path.join(config.outputDir, `relacionados_${label}.csv`));
  writeCsv(facturas, path.join(config.outputDir, `facturas_${label}.csv`));

  return { pagos, relacionados, facturas };
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
  const { ini: defaultFechaIni, fin: defaultFechaFin } = getLastMonthRange();
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
    appsheetMaxRetries: Math.max(0, readNumber(["CASALEY_APPSHEET_MAX_RETRIES", "APPSHEET_MAX_RETRIES"], 5)),
    appsheetBaseDelayMs: Math.max(250, readNumber(["CASALEY_APPSHEET_BASE_DELAY_MS", "APPSHEET_BASE_DELAY_MS"], 1000)),
    uploadTarget,
    isSequential,
    shouldUpload,
    delayBetweenUploadsMs: Math.max(
      0,
      readNumber(["CASALEY_DELAY_BETWEEN_UPLOADS_MS", "DELAY_BETWEEN_UPLOADS_MS"], 0)
    ),
    outputDir,
    users,
  };
}

async function runCasaleyJob(options = {}) {
  const config = buildConfig(options);
  requireEnv(config);

  fs.writeFileSync(path.join(config.outputDir, "appsheet_errors_pagos.log"), "", "utf8");
  fs.writeFileSync(path.join(config.outputDir, "appsheet_errors_relacionados.log"), "", "utf8");
  fs.writeFileSync(path.join(config.outputDir, "appsheet_errors_facturas.log"), "", "utf8");

  const results = [];
  for (const account of config.users) {
    results.push(await runForUser(config, account.label, account.user, account.password));
  }

  const allPagos = results.flatMap((result) => result.pagos);
  const allRelacionados = results.flatMap((result) => result.relacionados);
  const allFacturas = results.flatMap((result) => result.facturas);

  const pagosPrepared = config.pagosKey ? ensureKey(allPagos.map(sanitizeRowValuesOnly), config.pagosKey) : allPagos;
  const relacionadosPrepared = config.relacionadosKey
    ? ensureKey(allRelacionados.map(sanitizeRowValuesOnly), config.relacionadosKey)
    : allRelacionados;
  const facturasPrepared = config.facturasKey
    ? ensureKey(allFacturas.map(sanitizeRowValuesOnly), config.facturasKey)
    : allFacturas;

  writeCsv(pagosPrepared, path.join(config.outputDir, "pagos_ALL.csv"));
  writeCsv(relacionadosPrepared, path.join(config.outputDir, "relacionados_ALL.csv"));
  writeCsv(facturasPrepared, path.join(config.outputDir, "facturas_ALL.csv"));

  const summary = {
    ok: true,
    users: config.users.length,
    uploadTarget: config.uploadTarget,
    dryRun: config.dryRun,
    pagos: pagosPrepared.length,
    relacionados: relacionadosPrepared.length,
    facturas: facturasPrepared.length,
    uploads: {},
    outputDir: config.outputDir,
  };

  if (config.uploadTarget === "none" || config.dryRun) {
    return summary;
  }

  if (config.shouldUpload.pagos) {
    summary.uploads.pagos = await upsertMany(config, config.tablaPagos, pagosPrepared, config.pagosKey, "pagos");
    if (config.isSequential) await sleep(config.delayBetweenUploadsMs);
  }

  if (config.shouldUpload.relacionados) {
    summary.uploads.relacionados = await upsertMany(
      config,
      config.tablaRelacionados,
      relacionadosPrepared,
      config.relacionadosKey,
      "relacionados"
    );
    if (config.isSequential) await sleep(config.delayBetweenUploadsMs);
  }

  if (config.shouldUpload.facturas) {
    summary.uploads.facturas = await upsertMany(
      config,
      config.tablaFacturas,
      facturasPrepared,
      config.facturasKey,
      "facturas"
    );
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
