const cameraInput = document.getElementById("ticket-camera-input");
const galleryInput = document.getElementById("ticket-gallery-input");
const analyzeButton = document.getElementById("analyze-ticket-button");
const clearButton = document.getElementById("clear-ticket-button");
const previewShell = document.getElementById("ticket-preview-shell");
const previewPlaceholder = document.getElementById("ticket-preview-placeholder");
const previewImage = document.getElementById("ticket-preview-image");
const feedbackNode = document.getElementById("ticket-feedback");
const progressFill = document.getElementById("ocr-progress-fill");
const ocrStatusNode = document.getElementById("ocr-status-value");
const fileNameNode = document.getElementById("ticket-file-name");
const fileSizeNode = document.getElementById("ticket-file-size");
const ticketIdNode = document.getElementById("ticket-id-value");
const ocrTextNode = document.getElementById("ocr-text-output");
const notesNode = document.getElementById("result-notes");
const resultNodes = {
  proveedor: document.getElementById("result-proveedor"),
  rfc: document.getElementById("result-rfc"),
  fecha: document.getElementById("result-fecha"),
  hora: document.getElementById("result-hora"),
  folio: document.getElementById("result-folio"),
  subtotal: document.getElementById("result-subtotal"),
  iva: document.getElementById("result-iva"),
  total: document.getElementById("result-total"),
};

let currentFile = null;
let currentObjectUrl = "";
let ocrEnginePromise = null;

function formatBytes(bytes) {
  if (!bytes || Number.isNaN(bytes)) return "Pendiente";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return (value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)) + " " + units[unitIndex];
}

function formatCurrency(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "No detectado";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}

function setFeedback(message, type) {
  feedbackNode.className = "feedback";
  if (type === "ok") feedbackNode.classList.add("feedback--ok");
  if (type === "warning") feedbackNode.classList.add("feedback--warning");
  if (type === "error") feedbackNode.classList.add("feedback--error");
  feedbackNode.innerHTML = message;
}

function setProgress(value) {
  progressFill.style.width = Math.max(0, Math.min(100, Number(value) || 0)) + "%";
}

function setResultValue(key, value) {
  resultNodes[key].textContent = value || "No detectado";
}

function setNotes(items) {
  notesNode.innerHTML = "";
  const values = items && items.length ? items : ["Sin observaciones relevantes."];
  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    notesNode.appendChild(li);
  });
}

function resetResults() {
  ["proveedor", "rfc", "fecha", "hora", "folio", "subtotal", "iva", "total"].forEach((key) => {
    setResultValue(key, "Pendiente");
  });
  ticketIdNode.textContent = "Pendiente";
  ocrStatusNode.textContent = "Esperando imagen";
  ocrTextNode.textContent = "Aun no se ha procesado ningun ticket.";
  setNotes(["Aun no se ha analizado ningun ticket."]);
  setProgress(0);
}

function resetPreview() {
  currentFile = null;
  analyzeButton.disabled = true;
  fileNameNode.textContent = "Sin archivo";
  fileSizeNode.textContent = "Pendiente";
  previewImage.style.display = "none";
  previewImage.removeAttribute("src");
  previewPlaceholder.style.display = "grid";
  previewShell.classList.remove("preview--ready");
  cameraInput.value = "";
  galleryInput.value = "";
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = "";
  }
  resetResults();
  setFeedback("Selecciona un ticket para activar la extraccion en esta misma pantalla.", "warning");
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeForMatching(value) {
  return normalizeSearch(value)
    .replace(/[|]/g, "I")
    .replace(/T0TAL/g, "TOTAL")
    .replace(/SUBT0TAL/g, "SUBTOTAL")
    .replace(/F0LIO/g, "FOLIO")
    .replace(/IMP0RTE/g, "IMPORTE")
    .replace(/PR0VEED0R/g, "PROVEEDOR");
}

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
    .map((line) => ({
      raw: line,
      normalized: normalizeSearch(line),
      matching: normalizeForMatching(line),
    }));
}

function normalizeAmountText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[OQDB]/g, "0")
    .replace(/[|I]/g, "1")
    .replace(/\s+/g, " ");
}

function parseMoney(raw) {
  let value = String(raw || "").replace(/[^\d,.-]/g, "");
  if (!value) return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  const sep = lastComma > lastDot ? "," : lastDot > -1 ? "." : "";
  if (sep) {
    const integerPart = value.slice(0, value.lastIndexOf(sep)).replace(/[.,]/g, "");
    const decimalPart = value.slice(value.lastIndexOf(sep) + 1).replace(/[.,]/g, "");
    value = integerPart + "." + decimalPart;
  } else {
    value = value.replace(/[.,]/g, "");
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function extractAmountsFromLine(line) {
  const normalizedLine = normalizeAmountText(line).replace(/(\d)\s+(?=\d{2}\b)/g, "$1");
  const matches =
    normalizedLine.match(/\$?\s*-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})|\$?\s*-?\d+[.,]\d{2}/g) || [];
  return matches
    .map(parseMoney)
    .filter((amount) => typeof amount === "number" && Number.isFinite(amount));
}

function scoreAmountCandidate(candidate, options) {
  let score = 0;
  const matching = candidate.line.matching;
  if (options.include.some((pattern) => pattern.test(matching))) score += 28;
  if (options.exclude.some((pattern) => pattern.test(matching))) score -= 26;
  if (options.preferBottom) score += Math.max(0, 8 - candidate.fromBottom);
  if (candidate.amountIndex === candidate.totalAmounts - 1) score += 2;
  if (options.minAmount && candidate.amount >= options.minAmount) score += 3;
  if (/CAMBIO|AHORRO|DESCUENTO|PAGADO|PAGO/.test(matching)) score -= 8;
  if (/TOTAL A PAGAR|TOTAL\b|IMPORTE TOTAL/.test(matching)) score += 8;
  return score;
}

function findAmountByScore(lines, options) {
  const candidates = [];
  lines.forEach((line, index) => {
    const amounts = extractAmountsFromLine(line.raw);
    if (!amounts.length) return;
    amounts.forEach((amount, amountIndex) => {
      candidates.push({
        amount,
        amountIndex,
        totalAmounts: amounts.length,
        line,
        fromBottom: lines.length - index,
      });
    });
  });
  if (!candidates.length) return null;
  candidates.sort((left, right) => {
    const leftScore = scoreAmountCandidate(left, options);
    const rightScore = scoreAmountCandidate(right, options);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return right.amount - left.amount;
  });
  const best = candidates[0];
  return scoreAmountCandidate(best, options) > 0 ? best.amount : null;
}

function extractProvider(lines) {
  const blocked = [/^RFC\b/, /^FECHA\b/, /^HORA\b/, /^TOTAL\b/, /^SUB ?TOTAL\b/, /^IVA\b/, /^CAJA\b/, /^CLIENTE\b/, /^FOLIO\b/, /^TICKET\b/, /^REFERENCIA\b/, /^PAGADO\b/, /^CAMBIO\b/, /^EFECTIVO\b/, /^TARJETA\b/, /^AUT\b/, /^NO\b/, /^SUC\b/, /^CODIGO\b/, /^GRACIAS\b/, /^WWW\b/];
  let best = "";
  let bestScore = -Infinity;
  lines.slice(0, 12).forEach((line, index) => {
    if (blocked.some((pattern) => pattern.test(line.matching))) return;
    const letters = (line.matching.match(/[A-Z&]/g) || []).length;
    const digits = (line.matching.match(/\d/g) || []).length;
    const words = line.raw.split(/\s+/).filter(Boolean).length;
    if (letters < 5 || letters < digits) return;
    let score = letters - digits * 2 - index;
    if (words >= 1 && words <= 6) score += 3;
    if (/S\.?A\.?|DE C\.?V\.?|LEY|OXXO|FARMACIA|SUPERMERCADO|TIENDA|MERCADO|ABARROTES|MINISUPER|RESTAURANT|CAFETERIA/.test(line.matching)) {
      score += 10;
    }
    if (index <= 2) score += 4;
    if (score > bestScore) {
      bestScore = score;
      best = line.raw;
    }
  });
  return best;
}

function combineOcrTexts(texts) {
  const seen = Object.create(null);
  const lines = [];
  texts.forEach((text) => {
    splitLines(text).forEach((line) => {
      const signature = line.matching.replace(/[^A-Z0-9]/g, "");
      if (!signature || seen[signature]) return;
      seen[signature] = true;
      lines.push(line.raw);
    });
  });
  return lines.join("\n");
}

function scoreExtraction(result, text) {
  let score = 0;
  if (result.proveedor) score += 15;
  if (result.rfc) score += 14;
  if (result.fecha) score += 12;
  if (result.hora) score += 8;
  if (result.folio) score += 10;
  if (typeof result.subtotal === "number") score += 8;
  if (typeof result.iva === "number") score += 7;
  if (typeof result.total === "number") score += 24;
  if (typeof result.total === "number" && typeof result.subtotal === "number" && typeof result.iva === "number") {
    const diff = Math.abs((result.subtotal + result.iva) - result.total);
    score += diff <= 0.05 ? 12 : -6;
  }
  score += Math.min(10, Math.floor(cleanLine(text).length / 80));
  score -= result.notes.length * 2;
  return score;
}

function buildExtractionResult(text) {
  const lines = splitLines(text);
  const normalized = normalizeForMatching(text);
  const rfcMatch = normalized.match(/\b([A-Z&]{3,4}\d{6}[A-Z0-9]{3})\b/);
  const fechaMatch =
    normalized.match(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/) ||
    normalized.match(/\b(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/);
  const horaMatch = normalized.match(/\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/);
  const folioMatch = normalized.match(/(?:FOLIO|TICKET|TRANSACCION|OPERACION|REFERENCIA|AUT(?:ORIZACION)?|APROBACION|NO\.?\s*TICKET)\s*[:#-]?\s*([A-Z0-9-]{3,})/);

  let subtotal = findAmountByScore(lines, {
    include: [/SUB ?TOTAL/, /SUBTOTAL/],
    exclude: [/TOTAL A PAGAR/],
    preferBottom: false,
    minAmount: 1,
  });
  let iva = findAmountByScore(lines, {
    include: [/\bIVA\b/, /I\.?V\.?A\.?/, /IMPUESTO/, /16\s*%/],
    exclude: [/TOTAL A PAGAR/],
    preferBottom: false,
    minAmount: 0.01,
  });
  let total = findAmountByScore(lines, {
    include: [/TOTAL A PAGAR/, /IMPORTE TOTAL/, /\bTOTAL\b/, /TOTAL MXN/, /PAGO TOTAL/],
    exclude: [/SUB ?TOTAL/, /TOTAL ARTICULOS/, /AHORRO/],
    preferBottom: true,
    minAmount: 1,
  });

  if (total == null) {
    const fallback = [];
    lines.slice(-12).forEach((line) => extractAmountsFromLine(line.raw).forEach((amount) => fallback.push(amount)));
    if (fallback.length) total = Math.max.apply(null, fallback);
  }

  if (subtotal == null && total != null && iva != null && total >= iva) {
    subtotal = Number((total - iva).toFixed(2));
  }
  if (iva == null && total != null && subtotal != null && total >= subtotal) {
    iva = Number((total - subtotal).toFixed(2));
  }

  const proveedor = extractProvider(lines);
  const notes = [];
  if (!proveedor) notes.push("No se detecto claramente el proveedor.");
  if (!fechaMatch) notes.push("No se encontro una fecha confiable.");
  if (total == null) notes.push("No se encontro un total claro.");
  if (!folioMatch) notes.push("No se detecto folio o numero de ticket.");
  if (!rfcMatch) notes.push("No se detecto RFC.");
  if (!notes.length) notes.push("Lectura completada. Revisa que los importes coincidan con el ticket.");

  return {
    proveedor,
    rfc: rfcMatch ? rfcMatch[1] : "",
    fecha: fechaMatch ? fechaMatch[1].replace(/\./g, "/").replace(/-/g, "/") : "",
    hora: horaMatch ? horaMatch[0] : "",
    folio: folioMatch ? folioMatch[1] : "",
    subtotal,
    iva,
    total,
    notes,
  };
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

async function fileToImage(file) {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    const localUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(localUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(localUrl);
      reject(new Error("No se pudo abrir la imagen del ticket."));
    };
    image.src = localUrl;
  });
}

async function canvasToJpegFile(canvas, name, quality) {
  const blob = await new Promise((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), "image/jpeg", quality);
  });
  if (!blob) throw new Error("No se pudo convertir la imagen del ticket.");
  return new File([blob], name, { type: "image/jpeg" });
}

function buildBaseCanvas(image, width, height) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la imagen en este navegador.");
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

function buildProcessedCanvas(baseCanvas, mode) {
  const canvas = document.createElement("canvas");
  canvas.width = baseCanvas.width;
  canvas.height = baseCanvas.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la imagen del ticket.");
  context.drawImage(baseCanvas, 0, 0);
  if (mode === "base") return canvas;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let sum = 0;
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    sum += luminance;
    count += 1;
  }

  const average = count ? sum / count : 180;
  const threshold = Math.max(132, Math.min(198, average * 0.94));

  for (let index = 0; index < data.length; index += 4) {
    const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    let nextValue = luminance;
    if (mode === "contrast") nextValue = (luminance - average) * 1.9 + 170;
    if (mode === "binary") nextValue = luminance > threshold ? 255 : 0;
    nextValue = Math.max(0, Math.min(255, Math.round(nextValue)));
    data[index] = nextValue;
    data[index + 1] = nextValue;
    data[index + 2] = nextValue;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

async function prepareTicketPayload(file) {
  const image = await fileToImage(file);
  const maxDimension = 2200;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const baseCanvas = buildBaseCanvas(image, width, height);
  const contrastCanvas = buildProcessedCanvas(baseCanvas, "contrast");
  const binaryCanvas = buildProcessedCanvas(baseCanvas, "binary");

  const preparedFile = await canvasToJpegFile(baseCanvas, "ticket-scan.jpg", 0.88);
  const contrastFile = await canvasToJpegFile(contrastCanvas, "ticket-contrast.jpg", 0.9);
  const binaryFile = await canvasToJpegFile(binaryCanvas, "ticket-binary.jpg", 0.9);
  const dataUrl = await readFileAsDataUrl(preparedFile);

  return {
    preparedFile,
    filename: file.name || "ticket.jpg",
    mimeType: "image/jpeg",
    imageBase64: dataUrl.split(",")[1] || "",
    source: "camera",
    ocrVariants: [
      { label: "lectura base", file: preparedFile, lang: "spa+eng" },
      { label: "lectura mejorada", file: contrastFile, lang: "spa+eng" },
      { label: "alto contraste", file: binaryFile, lang: "eng" },
    ],
  };
}

async function registerTicketCapture(payload) {
  const response = await fetch("/contabilidad/tickets/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: payload.filename,
      mimeType: payload.mimeType,
      imageBase64: payload.imageBase64,
      source: payload.source,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || !result.ok) {
    throw new Error((result && result.error) || "No se pudo registrar la captura del ticket.");
  }
  return result.ticket;
}

function ensureTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (ocrEnginePromise) return ocrEnginePromise;
  ocrEnginePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("El motor OCR no quedo disponible despues de cargarlo."));
    script.onerror = () => reject(new Error("No se pudo cargar el OCR gratuito. Revisa que tu telefono tenga internet para descargar el motor."));
    document.head.appendChild(script);
  });
  return ocrEnginePromise;
}

function createOcrLogger(label, variantIndex, totalVariants) {
  return function logger(packet) {
    const localProgress = packet && typeof packet.progress === "number" ? packet.progress : 0;
    const overall = Math.round(((variantIndex + localProgress) / totalVariants) * 100);
    if (packet && packet.status) ocrStatusNode.textContent = label + " - " + packet.status;
    setProgress(overall);
  };
}

function buildAttemptPack(label, text) {
  const extraction = buildExtractionResult(text);
  return { label, text, extraction, score: scoreExtraction(extraction, text) };
}

async function recognizeTicketData(variants) {
  const TesseractLib = await ensureTesseract();
  const attempts = [];

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const result = await TesseractLib.recognize(variant.file, variant.lang, {
      logger: createOcrLogger(variant.label, index, variants.length),
    });
    const text = result && result.data && result.data.text ? result.data.text : "";
    attempts.push(buildAttemptPack(variant.label, text));
    const bestSoFar = attempts.slice().sort((left, right) => right.score - left.score)[0];
    if (bestSoFar && bestSoFar.score >= 68) {
      return { best: bestSoFar, attempts };
    }
  }

  const combinedText = combineOcrTexts(attempts.map((attempt) => attempt.text).filter(Boolean));
  if (combinedText) attempts.push(buildAttemptPack("lectura combinada", combinedText));
  attempts.sort((left, right) => right.score - left.score);
  return { best: attempts[0], attempts };
}

function applyFile(file, sourceLabel) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setFeedback("Solo se admiten imagenes del ticket por ahora.", "error");
    return;
  }
  currentFile = file;
  analyzeButton.disabled = false;
  fileNameNode.textContent = file.name || "ticket.jpg";
  fileSizeNode.textContent = formatBytes(file.size);
  resetResults();
  ocrStatusNode.textContent = "Listo para analizar";
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(file);
  previewImage.src = currentObjectUrl;
  previewImage.style.display = "block";
  previewPlaceholder.style.display = "none";
  previewShell.classList.add("preview--ready");
  setFeedback("<strong>Ticket listo.</strong> Imagen recibida desde " + sourceLabel + ". Ahora toca <strong>Extraer informacion</strong>.", "ok");
}

async function analyzeCurrentTicket() {
  if (!currentFile) {
    setFeedback("Primero selecciona un ticket.", "warning");
    return;
  }

  analyzeButton.disabled = true;
  ocrStatusNode.textContent = "Preparando imagen";
  setProgress(8);
  setFeedback("<strong>Procesando...</strong> Preparando la imagen y ejecutando varias lecturas OCR.", "ok");

  try {
    const payload = await prepareTicketPayload(currentFile);
    const capturePromise = registerTicketCapture(payload).catch((error) => ({
      error: error instanceof Error ? error.message : "No se pudo registrar la captura.",
    }));

    const recognition = await recognizeTicketData(payload.ocrVariants);
    const extracted = recognition.best.extraction;
    if (recognition.attempts.length > 1) {
      extracted.notes.unshift("Se evaluaron " + recognition.attempts.length + " lecturas OCR y se tomo la mejor.");
    }

    setResultValue("proveedor", extracted.proveedor || "No detectado");
    setResultValue("rfc", extracted.rfc || "No detectado");
    setResultValue("fecha", extracted.fecha || "No detectado");
    setResultValue("hora", extracted.hora || "No detectado");
    setResultValue("folio", extracted.folio || "No detectado");
    setResultValue("subtotal", formatCurrency(extracted.subtotal));
    setResultValue("iva", formatCurrency(extracted.iva));
    setResultValue("total", formatCurrency(extracted.total));
    setNotes(extracted.notes);
    ocrTextNode.textContent = recognition.best.text && recognition.best.text.trim()
      ? recognition.best.text.trim()
      : "El OCR no detecto texto legible en el ticket.";

    const captureResult = await capturePromise;
    if (captureResult && !captureResult.error && captureResult.ticketId) {
      ticketIdNode.textContent = captureResult.ticketId;
    } else if (captureResult && captureResult.error) {
      ticketIdNode.textContent = "No registrado";
      extracted.notes.push("La captura no se pudo registrar en el servidor: " + captureResult.error);
      setNotes(extracted.notes);
    }

    ocrStatusNode.textContent = "OCR completado";
    setProgress(100);
    setFeedback("<strong>Extraccion completada.</strong> Ya puedes revisar la informacion detectada en esta misma pantalla.", "ok");
  } catch (error) {
    ocrStatusNode.textContent = "Error de OCR";
    setProgress(0);
    setFeedback(error instanceof Error ? error.message : "No se pudo extraer la informacion del ticket.", "error");
  } finally {
    analyzeButton.disabled = false;
  }
}

cameraInput.addEventListener("change", (event) => applyFile(event.target.files && event.target.files[0], "la camara"));
galleryInput.addEventListener("change", (event) => applyFile(event.target.files && event.target.files[0], "tu galeria"));
clearButton.addEventListener("click", resetPreview);
analyzeButton.addEventListener("click", () => {
  void analyzeCurrentTicket();
});

resetPreview();
