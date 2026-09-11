import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";
import { getCompanyAddressLines } from "../../src/config/company.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

function readEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeTokenKey(value) {
  return stripAccents(value)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function normalizeSearch(value) {
  return stripAccents(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return (
    stripAccents(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "documento"
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toDisplayValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

function getConfig() {
  return {
    appsheetAppId: readEnv(
      [
        "DOCS_APPSHEET_APP_ID",
        "WHATSAPP_CAP_APPSHEET_APP_ID",
        "CONSTANCIAS_APPSHEET_APP_ID",
        "PLANEACION_APPSHEET_APP_ID",
        "APPSHEET_APP_ID",
      ],
      ""
    ),
    appsheetAccessKey: readEnv(
      [
        "DOCS_APPSHEET_ACCESS_KEY",
        "DOCS_APPSHEET_API_KEY",
        "WHATSAPP_CAP_APPSHEET_ACCESS_KEY",
        "CONSTANCIAS_APPSHEET_API_KEY",
        "PLANEACION_APPSHEET_API_KEY",
        "APPSHEET_API_KEY",
      ],
      ""
    ),
    appsheetRegion: readEnv(
      ["DOCS_APPSHEET_REGION", "WHATSAPP_CAP_APPSHEET_REGION", "APPSHEET_REGION"],
      "www.appsheet.com"
    ),
    appsheetLocale: readEnv(
      ["DOCS_APPSHEET_LOCALE", "WHATSAPP_CAP_APPSHEET_LOCALE", "APPSHEET_LOCALE"],
      "es-MX"
    ),
    appsheetTimezone: readEnv(
      ["DOCS_APPSHEET_TIMEZONE", "WHATSAPP_CAP_APPSHEET_TIMEZONE", "APPSHEET_TIMEZONE"],
      "America/Mexico_City"
    ),
    appsheetTableSucursales: readEnv(
      ["DOCS_TABLE_SUCURSALES", "WHATSAPP_CAP_TABLE_SUCURSALES"],
      "SUCURSALES"
    ),
    sucursalesIdCol: readEnv(
      ["DOCS_SUCURSALES_ID_COL", "WHATSAPP_CAP_SUCURSALES_KEY_COL"],
      "ID"
    ),
    sucursalesTiendaCol: readEnv(
      ["DOCS_SUCURSALES_TIENDA_COL", "WHATSAPP_CAP_SUCURSALES_TIENDA_COL"],
      "TIENDA"
    ),
    sucursalesNameCol: readEnv(
      ["DOCS_SUCURSALES_NAME_COL", "WHATSAPP_CAP_SUCURSALES_NAME_COL"],
      "LABEL2"
    ),
    chromePath: readEnv(["DOCS_CHROME_PATH", "WHATSAPP_CAP_CHROME_PATH", "CHROME_PATH"], ""),
  };
}

function parseArgs(argv) {
  const result = {
    list: false,
    help: false,
    id: "",
    tienda: "",
    query: "",
    title: "Documento",
    subtitle: "Formato generado desde AppSheet",
    body: path.join(__dirname, "templates", "cuerpo-base.html"),
    template: path.join(__dirname, "templates", "membrete-eg.html"),
    branding: path.join(__dirname, "config", "branding.default.json"),
    format: "both",
    out: "",
    first: false,
    chrome: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--list":
        result.list = true;
        break;
      case "--id":
        result.id = next || "";
        i += 1;
        break;
      case "--tienda":
        result.tienda = next || "";
        i += 1;
        break;
      case "--query":
        result.query = next || "";
        i += 1;
        break;
      case "--title":
        result.title = next || result.title;
        i += 1;
        break;
      case "--subtitle":
        result.subtitle = next || result.subtitle;
        i += 1;
        break;
      case "--body":
        result.body = path.resolve(process.cwd(), next || "");
        i += 1;
        break;
      case "--template":
        result.template = path.resolve(process.cwd(), next || "");
        i += 1;
        break;
      case "--branding":
        result.branding = path.resolve(process.cwd(), next || "");
        i += 1;
        break;
      case "--format":
        result.format = (next || result.format).toLowerCase();
        i += 1;
        break;
      case "--out":
        result.out = path.resolve(process.cwd(), next || "");
        i += 1;
        break;
      case "--first":
        result.first = true;
        break;
      case "--chrome":
        result.chrome = path.resolve(process.cwd(), next || "");
        i += 1;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Argumento no soportado: ${arg}`);
        }
        break;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
Uso:
  node standalone/sucursales-docs/generate.js --list
  node standalone/sucursales-docs/generate.js --tienda 1012
  node standalone/sucursales-docs/generate.js --id ABC123
  node standalone/sucursales-docs/generate.js --query "Culiacan"

Opciones:
  --list                 Lista sucursales disponibles
  --id <valor>           Busca por columna ID
  --tienda <valor>       Busca por columna TIENDA
  --query <texto>        Busca por texto en toda la fila
  --title <texto>        Titulo del documento
  --subtitle <texto>     Subtitulo del documento
  --body <archivo>       Archivo HTML para el cuerpo del documento
  --template <archivo>   Plantilla HTML principal
  --branding <archivo>   JSON de configuracion del membrete
  --format <html|pdf|both>
  --out <ruta>           Ruta base de salida
  --first                Usa el primer match cuando una busqueda arroja varios
  --chrome <ruta>        Ruta al ejecutable de Chrome
`);
}

async function ensureFile(filePath, label) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`No se encontro ${label}: ${filePath}`);
  }
}

async function loadJson(filePath, label) {
  await ensureFile(filePath, label);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function fileToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".svg"
          ? "image/svg+xml"
          : ext === ".webp"
            ? "image/webp"
            : "application/octet-stream";
  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function fetchSucursales(config) {
  if (!config.appsheetAppId) {
    throw new Error("No hay App ID configurado para AppSheet.");
  }
  if (!config.appsheetAccessKey) {
    throw new Error("No hay Access Key configurada para AppSheet.");
  }

  const url = `https://${config.appsheetRegion}/api/v2/apps/${config.appsheetAppId}/tables/${encodeURIComponent(config.appsheetTableSucursales)}/Action`;
  const payload = {
    Action: "Find",
    Properties: {
      Locale: config.appsheetLocale,
      Timezone: config.appsheetTimezone,
      Selector: `Filter(${config.appsheetTableSucursales}, true)`,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ApplicationAccessKey: config.appsheetAccessKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AppSheet devolvio ${response.status}: ${text}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data) ? data : Array.isArray(data?.Rows) ? data.Rows : [];

  return rows.sort((a, b) => {
    const aTienda = String(a?.[config.sucursalesTiendaCol] ?? "");
    const bTienda = String(b?.[config.sucursalesTiendaCol] ?? "");
    return aTienda.localeCompare(bTienda, "es-MX", { numeric: true, sensitivity: "base" });
  });
}

function stringifyRowForSearch(row) {
  return normalizeSearch(
    Object.entries(row || {})
      .map(([key, value]) => `${key} ${toDisplayValue(value)}`)
      .join(" ")
  );
}

function findMatches(rows, config, args) {
  if (args.id) {
    return rows.filter((row) => String(row?.[config.sucursalesIdCol] ?? "").trim() === String(args.id).trim());
  }

  if (args.tienda) {
    return rows.filter((row) => String(row?.[config.sucursalesTiendaCol] ?? "").trim() === String(args.tienda).trim());
  }

  if (args.query) {
    const query = normalizeSearch(args.query);
    return rows.filter((row) => stringifyRowForSearch(row).includes(query));
  }

  return [];
}

function buildAllFieldsRows(row) {
  return Object.entries(row || {})
    .map(([key, value]) => {
      const display = escapeHtml(toDisplayValue(value));
      const placeholder = escapeHtml(normalizeTokenKey(key));
      return `<tr><td><strong>${escapeHtml(key)}</strong><br><span style="color:#64748b;">&#123;&#123;${placeholder}&#125;&#125;</span></td><td>${display}</td></tr>`;
    })
    .join("\n");
}

function makeLookupMap(values) {
  const map = new Map();

  for (const [key, value] of Object.entries(values || {})) {
    if (!key) continue;
    const textValue = value === null || value === undefined ? "" : String(value);
    map.set(key, textValue);
    map.set(normalizeTokenKey(key), textValue);
    map.set(String(key).toLowerCase(), textValue);
    map.set(normalizeTokenKey(key).toLowerCase(), textValue);
  }

  return map;
}

function lookupToken(token, values) {
  const clean = String(token || "").trim();
  if (!clean) return "";
  const normalized = normalizeTokenKey(clean);

  return (
    values.get(clean) ??
    values.get(clean.toLowerCase()) ??
    values.get(normalized) ??
    values.get(normalized.toLowerCase()) ??
    ""
  );
}

function renderTemplate(source, values) {
  const rawRendered = source.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_match, token) => lookupToken(token, values));
  return rawRendered.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, token) => escapeHtml(lookupToken(token, values)));
}

function getSucursalLabel(row, config) {
  return toDisplayValue(
    row?.LABEL2 ?? row?.Label2 ?? row?.[config.sucursalesNameCol] ?? row?.LABEL ?? row?.Label ?? ""
  );
}

function getOutputBase(args, row, config) {
  if (args.out) return args.out;

  const label =
    getSucursalLabel(row, config) ||
    row?.[config.sucursalesTiendaCol] ||
    row?.[config.sucursalesIdCol] ||
    "sucursal";

  return path.join(__dirname, "output", `${slugify(args.title)}-${slugify(label)}`);
}

async function renderPdf(html, pdfPath, chromePath) {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: pdfPath,
      format: "Letter",
      printBackground: true,
      margin: {
        top: "0in",
        right: "0in",
        bottom: "0in",
        left: "0in",
      },
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allowedFormats = new Set(["html", "pdf", "both"]);

  if (args.help) {
    printHelp();
    return;
  }

  if (!allowedFormats.has(args.format)) {
    throw new Error(`Formato no soportado: ${args.format}. Usa html, pdf o both.`);
  }

  const config = getConfig();
  const rows = await fetchSucursales(config);

  if (args.list) {
    console.log(`Sucursales encontradas: ${rows.length}`);
    for (const row of rows.slice(0, 200)) {
      const id = row?.[config.sucursalesIdCol] ?? "";
      const tienda = row?.[config.sucursalesTiendaCol] ?? "";
      const label = getSucursalLabel(row, config);
      console.log(`${String(tienda).padEnd(8)} | ${String(id).padEnd(18)} | ${label}`);
    }
    if (rows.length > 200) {
      console.log(`... ${rows.length - 200} registros mas`);
    }
    return;
  }

  if (!args.id && !args.tienda && !args.query) {
    printHelp();
    throw new Error("Necesitas indicar --id, --tienda, --query o usar --list.");
  }

  const matches = findMatches(rows, config, args);

  if (matches.length === 0) {
    throw new Error("No se encontro ninguna sucursal con ese criterio.");
  }

  if (matches.length > 1 && !args.first) {
    console.log("Se encontraron varias sucursales. Usa un criterio mas especifico o agrega --first.");
    for (const row of matches.slice(0, 20)) {
      console.log(
        `${row?.[config.sucursalesTiendaCol] ?? ""} | ${row?.[config.sucursalesIdCol] ?? ""} | ${getSucursalLabel(row, config)}`
      );
    }
    if (matches.length > 20) {
      console.log(`... ${matches.length - 20} coincidencias mas`);
    }
    return;
  }

  const row = matches[0];
  const branding = await loadJson(args.branding, "branding");
  branding.footerLeftLines = getCompanyAddressLines();

  await ensureFile(args.template, "plantilla principal");
  await ensureFile(args.body, "cuerpo del documento");

  const mainTemplate = await fs.readFile(args.template, "utf8");
  const bodyTemplate = await fs.readFile(args.body, "utf8");

  const defaultLogoPath = path.join(__dirname, "assets", "logo.png");
  const resolvedLogoPath = branding.logoPath
    ? path.isAbsolute(branding.logoPath)
      ? branding.logoPath
      : path.resolve(path.dirname(args.branding), branding.logoPath)
    : defaultLogoPath;
  await ensureFile(resolvedLogoPath, "logo");
  const companyLogoDataUri = await fileToDataUri(resolvedLogoPath);

  const now = new Date();
  const generatedDate = new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    timeZone: "America/Mexico_City",
  }).format(now);
  const generatedDateTime = new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  }).format(now);

  const baseValues = {
    ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toDisplayValue(value)])),
    document_title: args.title,
    document_label: getSucursalLabel(row, config),
    document_subtitle: args.subtitle,
    generated_date: generatedDate,
    generated_datetime: generatedDateTime,
    company_name: branding.companyName || "DESARROLLO EG",
    company_subtitle: branding.companySubtitle || "",
    company_logo_data_uri: companyLogoDataUri,
    footer_left_html: (branding.footerLeftLines || []).map((line) => escapeHtml(line)).join("<br>"),
    footer_right_html: (branding.footerRightLines || []).map((line) => escapeHtml(line)).join("<br>"),
    all_fields_rows: buildAllFieldsRows(row),
  };

  const tokenMap = makeLookupMap(baseValues);
  const renderedBody = renderTemplate(bodyTemplate, tokenMap);
  tokenMap.set("body_html", renderedBody);
  tokenMap.set("BODY_HTML", renderedBody);

  const finalHtml = renderTemplate(mainTemplate, tokenMap);
  const outBase = getOutputBase(args, row, config);

  await fs.mkdir(path.dirname(outBase), { recursive: true });

  const htmlPath = `${outBase}.html`;
  const pdfPath = `${outBase}.pdf`;

  if (args.format === "html" || args.format === "both") {
    await fs.writeFile(htmlPath, finalHtml, "utf8");
    console.log(`HTML generado: ${htmlPath}`);
  }

  if (args.format === "pdf" || args.format === "both") {
    const chromePath = args.chrome || config.chromePath;
    if (!chromePath) {
      throw new Error("No hay ruta de Chrome configurada. Usa --chrome o DOCS_CHROME_PATH.");
    }
    await ensureFile(chromePath, "Chrome");
    await renderPdf(finalHtml, pdfPath, chromePath);
    console.log(`PDF generado: ${pdfPath}`);
  }

  console.log(`Sucursal usada: ${getSucursalLabel(row, config)}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
