import express from "express";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const pdfjsDir = path.join(process.cwd(), "node_modules", "pdf-parse", "lib", "pdf.js", "v2.0.550", "build");
const pdfFileName = "POLIZA SEGURO Carta Ley Todas las tiendas 2026-2027.pdf";
const pdfPath = path.resolve(process.cwd(), pdfFileName);

export const polizaLeyRouter = express.Router();

const cache = {
  key: "",
  data: null,
  pending: null,
};

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFilePart(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSnippet(lines, tokens) {
  if (!lines.length) return "";
  const scored = lines.map((line) => {
    const normalizedLine = normalizeText(line);
    let score = 0;
    for (const token of tokens) {
      if (!token) continue;
      if (normalizedLine.includes(token)) score += 2;
    }
    return { line, score };
  });
  const best = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.line.length - b.line.length)[0];
  if (best) return best.line.trim();
  return lines.slice(0, 2).join(" | ").trim();
}

function getPdfDisposition(fileName, inline = true) {
  const fallback = sanitizeFilePart(fileName) || "poliza-ley.pdf";
  const encoded = encodeURIComponent(fallback);
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function createPageText(pagerender) {
  return async (pageData) => {
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });

    let lastY = null;
    let text = "";
    for (const item of textContent.items) {
      if (lastY == item.transform[5] || !lastY) {
        text += item.str;
      } else {
        text += "\n" + item.str;
      }
      lastY = item.transform[5];
    }
    return pagerender(text);
  };
}

async function loadPolizaLeyDocument() {
  const stat = fs.statSync(pdfPath);
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (cache.data && cache.key === key) {
    return cache.data;
  }
  if (cache.pending && cache.key === key) {
    return cache.pending;
  }

  const pending = (async () => {
    const buffer = fs.readFileSync(pdfPath);
    const pageTexts = [];
    let pageIndex = 0;

    const parsed = await pdfParse(buffer, {
      pagerender: createPageText((text) => {
        pageTexts[pageIndex++] = text || "";
        return text || "";
      }),
    });

    const pages = pageTexts.map((text, index) => {
      const rawLines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const normalizedText = normalizeText(text);
      return {
        pageNumber: index + 1,
        text: text || "",
        normalizedText,
        lines: rawLines,
      };
    });

    const data = {
      pdfFileName,
      pdfPath,
      updatedAt: stat.mtimeMs,
      pageCount: parsed.numpages || pages.length,
      pages,
    };

    cache.key = key;
    cache.data = data;
    return data;
  })();

  cache.pending = pending;
  try {
    return await pending;
  } finally {
    if (cache.pending === pending) {
      cache.pending = null;
    }
  }
}

function scorePage(page, query, tokens) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;
  let score = 0;

  if (page.normalizedText.includes(normalizedQuery)) {
    score += 20 + normalizedQuery.length;
  }

  let matchedTokens = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (page.normalizedText.includes(token)) {
      score += 8;
      matchedTokens += 1;
    }
  }

  if (!matchedTokens) {
    const line = page.lines.find((item) => normalizeText(item).includes(normalizedQuery)) || "";
    if (line) {
      score += 4;
    }
  }

  if (!score) return null;

  const snippet = extractSnippet(page.lines, tokens.length ? tokens : [normalizedQuery]);
  return {
    pageNumber: page.pageNumber,
    score,
    snippet,
    text: page.text,
  };
}

function getPdfFilenameHeader(fileName, inline = true) {
  return getPdfDisposition(fileName, inline);
}

function handleError(res, error, status = 500) {
  res.status(status).json({
    error: error?.message || "Error interno",
  });
}

polizaLeyRouter.get("/health", (_req, res) => {
  res.json({ service: "poliza-ley", status: "ok" });
});

polizaLeyRouter.get("/api/manifest", async (_req, res) => {
  try {
    const doc = await loadPolizaLeyDocument();
    res.json({
      ok: true,
      title: "Póliza Ley",
      fileName: doc.pdfFileName,
      pdfUrl: "/POLIZA_LEY/documento.pdf",
      pageCount: doc.pageCount,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    handleError(res, error);
  }
});

polizaLeyRouter.get("/api/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.json({ ok: true, query, results: [] });
    }

    const limit = Math.max(1, Math.min(25, Number(req.query.limit || 8) || 8));
    const doc = await loadPolizaLeyDocument();
    const tokens = normalizeText(query).split(" ").filter((token) => token.length >= 2);
    const results = doc.pages
      .map((page) => scorePage(page, query, tokens))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber)
      .slice(0, limit)
      .map((item) => ({
        pageNumber: item.pageNumber,
        score: item.score,
        snippet: item.snippet,
      }));

    res.json({
      ok: true,
      query,
      results,
    });
  } catch (error) {
    handleError(res, error);
  }
});

polizaLeyRouter.get("/api/pages/:pageNumber", async (req, res) => {
  try {
    const doc = await loadPolizaLeyDocument();
    const pageNumber = Number(req.params.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.pageCount) {
      return handleError(res, new Error("Página inválida."), 400);
    }

    const page = doc.pages[pageNumber - 1];
    res.json({
      ok: true,
      pageNumber,
      pageCount: doc.pageCount,
      text: page?.text || "",
      lines: page?.lines || [],
    });
  } catch (error) {
    handleError(res, error);
  }
});

polizaLeyRouter.get("/documento.pdf", async (_req, res) => {
  try {
    if (!fs.existsSync(pdfPath)) {
      return handleError(res, new Error(`No se encontró el PDF: ${pdfFileName}`), 404);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", getPdfFilenameHeader(pdfFileName, true));
    res.sendFile(pdfPath);
  } catch (error) {
    handleError(res, error);
  }
});

polizaLeyRouter.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
  },
}));

polizaLeyRouter.use("/vendor/pdfjs", express.static(pdfjsDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js")) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  },
}));

polizaLeyRouter.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
