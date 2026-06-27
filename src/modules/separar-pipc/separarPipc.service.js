import path from "path";
import { createRequire } from "module";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

const require = createRequire(import.meta.url);
const pdfjsLib = require("pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js");
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

const INDEX_SCAN_LIMIT = 4;

const TARGETS = [
  { key: "analisis_riesgo", outputName: "ANALISIS DE RIESGO.pdf", label: "Análisis de Riesgo", indexAliases: ["V.4 ANÁLISIS DE LOS RIESGOS ENCONTRADOS"], endIndexAliases: ["VI. CROQUIS INTERNOS Y EXTERNOS."], headings: ["V.4 ANÁLISIS DE LOS RIESGOS ENCONTRADOS"] },
  { key: "acta_uipc", outputName: "ACTA UNIDAD INTERNA.pdf", label: "Acta Unidad Interna", indexAliases: ["III.5 ACTA CONSTITUTIVA"], endBodyAliases: ["Funciones del comité Interno de Protección Civil."], headings: ["III.5 ACTA CONSTITUTIVA"] },
  { key: "croquis_emergencia", outputName: "CROQUIS.pdf", label: "Croquis", indexAliases: ["VI. CROQUIS INTERNOS Y EXTERNOS."], endIndexAliases: ["VII. DIRECTORIOS INTERNO Y EXTERNOS"], headings: ["VI. CROQUIS INTERNOS Y EXTERNOS."] },
  { key: "evidencia_capacitacion", outputName: "EVIDENCIA DE CAPACITACION.pdf", label: "Evidencia de Capacitación", indexAliases: ["XII.3 LISTAS DE ASISTENCIA"], endBodyAliases: ["XII.5 FORMATO DC3 HABILIDADES LABORALES"], headings: ["XII.3 LISTAS DE ASISTENCIA"] },
  { key: "bitacoras_mantenimiento", outputName: "BITACORAS DE MANTENIMIENTO.pdf", label: "Bitácoras", indexAliases: ["X.4 COPIA DE BITACORAS"], endIndexAliases: ["XI. NORMAS DE SEGURIDAD", "XI.1 LEYES"], headings: ["X.4 COPIA DE BITACORAS"] },
  { key: "certificado_fumigacion", outputName: "CERTIFICADO DE FUMIGACION.pdf", label: "Certificado de Fumigación", headings: ["CERTIFICADO DE FUMIGACION", "fumigacion"], fallbackMaxPages: 1 },
  { key: "inventario_bomberos", outputName: "INVENTARIO DE BOMBEROS o inventario de epp.pdf", label: "Inventario de Equipo de Bomberos", indexAliases: ["VIII.1 INVENTARIO DE BOMBEROS"], endIndexAliases: ["IX. SEÑALIZACIÓN", "IX. SEÑALIZACION"], headings: ["VIII.1 INVENTARIO DE BOMBEROS"] },
  { key: "seguro_danos_terceros", outputName: "SEGURO DE DANOS A TERCEROS.pdf", label: "Seguro de Daños a Terceros", indexAliases: ["XI.6 SEGURO DE DAÑOS A TERCEROS"], endIndexAliases: ["XII. CAPACITACIÓN", "XII. CAPACITACION"], headings: ["XI.6 SEGURO DE DAÑOS A TERCEROS"] },
  { key: "simulacro", outputName: "SIMULACRO.pdf", label: "Simulacro", indexAliases: ["XIV. SIMULACROS"], endIndexAliases: ["I. PROCEDIMIENTOS A IMPLEMENTAR EN LA FASE DE ALERTAMIENTO.", "SUBPROGRAMA DE AUXILI O"], headings: ["XIV. SIMULACROS"] },
];

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeSearch(value) {
  return stripAccents(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeNoSpaces(value) {
  return normalizeSearch(value).replace(/\s+/g, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeFileName(value) {
  return String(value || "documento").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

function isLikelyMatch(pageText, alias) {
  const haystack = normalizeSearch(pageText);
  const needle = normalizeSearch(alias);
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  return normalizeNoSpaces(pageText).includes(normalizeNoSpaces(alias));
}

function extractFooterPageNumber(pageText) {
  const tokens = String(pageText || "").match(/\b\d{1,3}\b/g) || [];
  if (!tokens.length) return null;

  const counts = new Map();
  const lastIndex = new Map();
  tokens.forEach((token, index) => {
    counts.set(token, (counts.get(token) || 0) + 1);
    lastIndex.set(token, index);
  });

  const candidates = [...counts.entries()].map(([token, count]) => ({
    token,
    count,
    lastIndex: lastIndex.get(token) || 0,
  }));

  candidates.sort((a, b) => b.count - a.count || b.lastIndex - a.lastIndex || Number(b.token) - Number(a.token));
  return Number.parseInt(candidates[0].token, 10);
}

function parseIndexPageNumber(pageText, alias) {
  const haystack = normalizeSearch(pageText);
  const needle = normalizeSearch(alias);
  if (!needle) return null;
  let hitIndex = haystack.indexOf(needle);
  let tailSource = haystack;
  let needleLength = needle.length;
  if (hitIndex === -1) {
    const hayNoSpaces = haystack.replace(/\s+/g, "");
    const needleNoSpaces = needle.replace(/\s+/g, "");
    hitIndex = hayNoSpaces.indexOf(needleNoSpaces);
    if (hitIndex === -1) return null;
    tailSource = hayNoSpaces;
    needleLength = needleNoSpaces.length;
  }

  const tail = tailSource.slice(hitIndex + needleLength);
  const match = tail.match(/^\s*(\d{1,3})/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

async function readPdfPageTexts(buffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const text = content.items.map((item) => item.str).join(" ");
    pages.push({
      pageNumber,
      text,
      normalizedText: normalizeSearch(text),
      footerPageNumber: extractFooterPageNumber(text),
    });
  }
  return pages;
}

function findTargetStartFromIndex(pages, target) {
  const indexPages = pages.slice(0, INDEX_SCAN_LIMIT);
  for (const alias of target.indexAliases || []) {
    for (const page of indexPages) {
      const displayedPage = parseIndexPageNumber(page.text, alias);
      if (Number.isFinite(displayedPage)) {
        return { displayedPage, matchedAlias: alias };
      }
    }
  }

  return { displayedPage: null, matchedAlias: null };
}

function findTargetStartFromBody(pages, target) {
  const headings = target.headings || [];
  for (const page of pages.slice(INDEX_SCAN_LIMIT)) {
    const matchedAlias = headings.find((alias) => isLikelyMatch(page.text, alias));
    if (!matchedAlias) {
      continue;
    }

    const exactFooterMatch = Number.isFinite(page.footerPageNumber) && Number.isFinite(page.footerPageNumber)
      ? page.footerPageNumber
      : null;
    return {
      pageNumber: page.pageNumber,
      matchedAlias,
      footerPageNumber: exactFooterMatch,
    };
  }

  return { pageNumber: null, matchedAlias: null, footerPageNumber: null };
}

function findPageByFooterNumber(pages, footerPageNumber) {
  if (!Number.isFinite(footerPageNumber)) return null;
  return pages.slice(INDEX_SCAN_LIMIT).find((page) => page.footerPageNumber === footerPageNumber)?.pageNumber ?? null;
}

function findPageByBodyHeading(pages, aliases) {
  for (const page of pages.slice(INDEX_SCAN_LIMIT)) {
    const matchedAlias = (aliases || []).find((alias) => isLikelyMatch(page.text, alias));
    if (matchedAlias) {
      return { pageNumber: page.pageNumber, matchedAlias };
    }
  }
  return { pageNumber: null, matchedAlias: null };
}

function findTargetStart(pages, target, indexFound) {
  const bodyFound = findTargetStartFromBody(pages, target);
  if (Number.isFinite(bodyFound.pageNumber)) {
    if (!Number.isFinite(indexFound.displayedPage) || bodyFound.footerPageNumber === indexFound.displayedPage) {
      return bodyFound;
    }
  }

  const footerFallback = findPageByFooterNumber(pages, indexFound.displayedPage);
  if (Number.isFinite(footerFallback)) {
    return {
      pageNumber: footerFallback,
      matchedAlias: bodyFound.matchedAlias || indexFound.matchedAlias,
      footerPageNumber: indexFound.displayedPage,
    };
  }

  return bodyFound;
}

function buildDetections(pages) {
  const detections = TARGETS.map((target, index) => {
    const indexFound = findTargetStartFromIndex(pages, target);
    const bodyFound = findTargetStart(pages, target, indexFound);
    const fallbackIndexPage = findPageByFooterNumber(pages, indexFound.displayedPage);
    const startPage = Number.isFinite(bodyFound.pageNumber) ? bodyFound.pageNumber : fallbackIndexPage;
    return {
      index,
      ...target,
      startPage,
      matchedAlias: bodyFound.matchedAlias || indexFound.matchedAlias,
      indexDisplayedPage: Number.isFinite(indexFound.displayedPage) ? indexFound.displayedPage : null,
      bodyFooterPageNumber: Number.isFinite(bodyFound.footerPageNumber) ? bodyFound.footerPageNumber : null,
      found: Boolean(startPage),
      endPage: null,
    };
  });

  const ordered = [...detections].sort((a, b) => {
    const aStart = Number.isFinite(a.startPage) ? a.startPage : Number.POSITIVE_INFINITY;
    const bStart = Number.isFinite(b.startPage) ? b.startPage : Number.POSITIVE_INFINITY;
    return aStart - bStart || a.index - b.index;
  });

  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];
    if (!Number.isFinite(current.startPage)) {
      current.endPage = null;
      continue;
    }

    const next = ordered.slice(i + 1).find((item) => Number.isFinite(item.indexDisplayedPage) || Number.isFinite(item.startPage));
    const indexEnd = (current.endIndexAliases || [])
      .map((alias) => {
        for (const page of pages.slice(0, INDEX_SCAN_LIMIT)) {
          const displayed = parseIndexPageNumber(page.text, alias);
          if (Number.isFinite(displayed)) return displayed;
        }
        return null;
      })
      .find((value) => Number.isFinite(value));
    const bodyEnd = findPageByBodyHeading(pages, current.endBodyAliases);

    const maxPages = Number.isFinite(current.fallbackMaxPages) ? current.fallbackMaxPages : pages.length;
    const spanEnd = current.startPage + maxPages - 1;
    const nextStartPage = Number.isFinite(next?.startPage) ? next.startPage : null;
    const bodyEndPage = Number.isFinite(bodyEnd.pageNumber) ? bodyEnd.pageNumber : null;
    const indexEndStartPage = Number.isFinite(indexEnd) ? findPageByFooterNumber(pages, indexEnd) : null;
    const inferredEnd = Number.isFinite(bodyEndPage)
      ? Math.max(current.startPage, bodyEndPage - 1)
      : Number.isFinite(indexEndStartPage)
      ? Math.max(current.startPage, indexEndStartPage - 1)
      : Number.isFinite(nextStartPage)
        ? Math.max(current.startPage, nextStartPage - 1)
        : pages.length;
    current.endPage = Math.max(current.startPage, Math.min(spanEnd, inferredEnd, pages.length));
  }

  return detections;
}

async function extractPdfRange(buffer, startPage, endPage) {
  const sourcePdf = await PDFDocument.load(buffer);
  const targetPdf = await PDFDocument.create();

  if (!Number.isFinite(startPage) || !Number.isFinite(endPage) || endPage < startPage) {
    targetPdf.addPage([612, 792]);
    return Buffer.from(await targetPdf.save());
  }

  const safeStart = Math.max(1, Math.min(startPage, sourcePdf.getPageCount()));
  const safeEnd = Math.max(safeStart, Math.min(endPage, sourcePdf.getPageCount()));
  const copiedPages = await targetPdf.copyPages(sourcePdf, Array.from({ length: safeEnd - safeStart + 1 }, (_v, idx) => safeStart - 1 + idx));
  copiedPages.forEach((page) => targetPdf.addPage(page));
  return Buffer.from(await targetPdf.save());
}

function buildReport(detections, sourceName, totalPages) {
  return {
    sourceName,
    totalPages,
    generatedAt: new Date().toISOString(),
    documents: detections.map((item) => ({
      key: item.key,
      label: item.label,
      outputName: item.outputName,
      found: item.found,
      startPage: item.startPage,
      endPage: item.endPage,
      matchedAlias: item.matchedAlias,
    })),
    missing: detections.filter((item) => !item.found).map((item) => item.label),
  };
}

async function analyzePipcPdf(file) {
  if (!file?.buffer) throw new Error("Debes subir un archivo PDF.");
  const pages = await readPdfPageTexts(file.buffer);
  const detections = buildDetections(pages);
  return { pages, detections, report: buildReport(detections, file.originalname || "documento.pdf", pages.length) };
}

async function splitPipcPdfToZip(file) {
  const analysis = await analyzePipcPdf(file);
  const zip = new JSZip();
  const sourceBaseName = safeFileName(path.parse(file.originalname || "separar-pipc").name || "separar-pipc");

  for (const item of analysis.detections) {
    const pdfBuffer = await extractPdfRange(file.buffer, item.startPage, item.endPage);
    const resolvedName = item.outputName
      ? `${sourceBaseName} - ${safeFileName(item.outputName).replace(/\.pdf$/i, "")}.pdf`
      : `${sourceBaseName} - ${String(item.index + 1).padStart(2, "0")} - ${safeFileName(item.label)}.pdf`;
    zip.file(resolvedName, pdfBuffer);
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { analysis, zipBuffer, fileBaseName: sourceBaseName };
}

function renderSplitPipcHtml() {
  const targetsHtml = TARGETS.map((target, index) => {
    const hints = target.headings.length ? target.headings.slice(0, 2) : ["Sin coincidencia exacta"];
    return `
      <li>
        <strong>${String(index + 1).padStart(2, "0")}. ${escapeHtml(target.label)}</strong>
        <span>${hints.map((alias) => `<code>${escapeHtml(alias)}</code>`).join(" ")}</span>
      </li>`;
  }).join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Separar PIPC</title>
  <link rel="icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png" />
  <link rel="shortcut icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png" />
  <style>
    body { margin:0; font-family: Inter, system-ui, sans-serif; background: linear-gradient(180deg,#f9f5ef,#eef2f4); color:#17212b; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 56px; }
    .hero,.panel { background: rgba(255,255,255,.96); border:1px solid #d8d2c5; border-radius:24px; box-shadow:0 18px 50px rgba(23,33,43,.12); }
    .hero { padding: 24px; margin-bottom: 18px; }
    .eyebrow { margin:0 0 10px; color:#b45309; text-transform:uppercase; letter-spacing:.22em; font-weight:900; font-size:.74rem; }
    h1 { margin:0; font-size: clamp(2rem, 5vw, 4rem); line-height:.95; font-family: Georgia, serif; }
    .lead { margin: 12px 0 0; color:#5d6872; line-height:1.7; }
    .grid { display:grid; grid-template-columns: minmax(0,1.05fr) minmax(0,.95fr); gap:18px; }
    .panel { padding:20px; }
    label { display:block; margin-bottom:8px; font-size:.8rem; text-transform:uppercase; letter-spacing:.08em; font-weight:800; }
    input[type=file] { width:100%; padding:18px; border-radius:18px; border:1px dashed #c8c0b3; background:#fbfaf7; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:14px; }
    button { border:0; border-radius:999px; padding:12px 18px; font-weight:800; cursor:pointer; }
    .primary { background:#0f766e; color:#fff; }
    .secondary { background:#e9ecef; color:#17212b; }
    .status { margin-top:14px; color:#5d6872; line-height:1.6; }
    .targets { list-style:none; margin:0; padding:0; display:grid; gap:10px; }
    .targets li { padding:12px 14px; border:1px solid #e2ddd2; border-radius:16px; background:#fff; }
    .targets strong { display:block; margin-bottom:6px; }
    .targets span { display:flex; flex-wrap:wrap; gap:6px; }
    code { background:#f3f4f6; border-radius:999px; padding:2px 8px; color:#374151; }
    pre { margin:0; white-space:pre-wrap; word-break:break-word; background:#0f172a; color:#e5e7eb; padding:16px; border-radius:18px; overflow:auto; }
    @media (max-width: 900px) { .grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <p class="eyebrow">Separar PIPC</p>
      <h1>Divide un PIPC en PDFs individuales</h1>
      <p class="lead">Este modo sigue el patrón del ejemplo correcto: genera sólo los archivos clave, en ese mismo estilo, y deja en blanco los que no aparecen con claridad.</p>
    </section>
    <section class="grid">
      <div class="panel">
        <label for="pdfFile">Archivo PIPC</label>
        <input id="pdfFile" type="file" accept="application/pdf,.pdf" />
        <div class="actions">
          <button class="secondary" id="previewBtn" type="button">Analizar</button>
          <button class="primary" id="splitBtn" type="button">Separar y descargar ZIP</button>
        </div>
        <div class="status" id="status">Listo para recibir el PDF.</div>
        <div class="status" id="downloadArea"></div>
        <pre id="report" style="display:none; margin-top:16px;"></pre>
      </div>
      <div class="panel">
        <label>Archivos de salida</label>
        <ul class="targets">${targetsHtml}</ul>
      </div>
    </section>
  </main>
  <script>
    const pdfFile = document.getElementById('pdfFile');
    const previewBtn = document.getElementById('previewBtn');
    const splitBtn = document.getElementById('splitBtn');
    const status = document.getElementById('status');
    const downloadArea = document.getElementById('downloadArea');
    const report = document.getElementById('report');
    const routeBase = window.location.pathname.endsWith('/') ? window.location.pathname.slice(0, -1) : window.location.pathname;
    const apiUrl = (segment) => routeBase + segment;

    async function postForm(endpoint) {
      const file = pdfFile.files && pdfFile.files[0];
      if (!file) throw new Error('Selecciona primero un PDF.');
      const form = new FormData();
      form.append('sourceDocument', file);
      const response = await fetch(endpoint, { method: 'POST', body: form });
      if (!response.ok) throw new Error(await response.text() || 'Error al procesar el PDF.');
      return response;
    }

    previewBtn.addEventListener('click', async () => {
      status.textContent = 'Analizando PDF...';
      downloadArea.textContent = '';
      report.style.display = 'none';
      try {
        const response = await postForm(apiUrl('/api/preview'));
        const data = await response.json();
        report.textContent = JSON.stringify(data, null, 2);
        report.style.display = 'block';
        status.textContent = 'Análisis listo. Revisa el reporte.';
      } catch (error) {
        status.textContent = error.message || 'No se pudo analizar el archivo.';
      }
    });

    splitBtn.addEventListener('click', async () => {
      status.textContent = 'Separando PDFs...';
      downloadArea.textContent = '';
      try {
        const response = await postForm(apiUrl('/api/split'));
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'separar-pipc.zip';
        link.textContent = 'Descargar ZIP generado';
        link.style.fontWeight = '800';
        downloadArea.innerHTML = '';
        downloadArea.appendChild(link);
        status.textContent = 'Listo. El ZIP incluye los PDFs separados y un reporte JSON.';
      } catch (error) {
        status.textContent = error.message || 'No se pudo generar el ZIP.';
      }
    });
  </script>
</body>
</html>`;
}

export { analyzePipcPdf, splitPipcPdfToZip, renderSplitPipcHtml };
