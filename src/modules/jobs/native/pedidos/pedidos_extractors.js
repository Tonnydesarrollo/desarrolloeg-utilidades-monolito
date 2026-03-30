export function normalizeText(text) {
  return text.replace(/\r/g, "").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

export function extractPedidoNumber(text) {
  const match1 = text.match(/PEDIDO\s*NUM\s*:?\s*(\d{10})/i);
  if (match1) return match1[1];
  const match2 = text.match(/PEDIDO\s*=\s*(\d{10})/i);
  if (match2) return match2[1];
  const match3 = text.match(/\b6\d{9}\b/);
  return match3 ? match3[0] : "";
}

export function extractProveedor(text) {
  const direct = text.match(/PROVEEDOR\s*:?\s*(\d{4,8})/i);
  if (direct) return direct[1];
  const near = text.match(/PROVEEDOR[\s\S]{0,120}?(\d{4,8})/i);
  if (near) return near[1];
  const lines = text.replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean);
  const idx = lines.findIndex(l => /PROVEEDOR/i.test(l));
  if (idx >= 0) {
    const sameLine = lines[idx];
    const sameDigits = sameLine.match(/\b(\d{4,})\b/);
    if (sameDigits) return sameDigits[1];
    for (let i = idx + 1; i < Math.min(lines.length, idx + 4); i++) {
      if (/DOMICILIO/i.test(lines[i])) continue;
      const m = lines[i].match(/\b(\d{4,})\b/);
      if (m) return m[1];
    }
  }
  const match2 = text.match(/\b(\d{4,})\s*-\s*[A-Zаимсзя]/);
  return match2 ? match2[1] : "";
}

export function extractEstablecimiento(text) {
  const match = text.match(/ESTABLECIMIENTO\s*:?\s*(\d+)/i);
  return match ? match[1] : "";
}

export function extractFecha(text) {
  const match = text.match(/FECHA\s*:?\s*(\d{2}[./]\d{2}[./]\d{4})/i);
  if (!match) return "";
  return match[1].replace(/\./g, "/");
}

export function extractImporte(text) {
  const match = text.match(/SUB-?TOTAL\s*:?\s*([\d,.]+)/i);
  if (match) return match[1];
  const match2 = text.match(/P\.U\.?\s*([\d,.]+)/i);
  return match2 ? match2[1] : "";
}

export function extractDescripcion(text) {
  const unitTokens = ["PZ", "PZA", "LOT", "UNID", "KG", "MT", "M2", "M3", "L", "LT", "HR", "HRS"];
  const unitGroup = unitTokens.join("|");
  const flat = normalizeText(text)
    .replace(/(\d)([A-Za-zаимсзя])/g, "$1 $2")
    .replace(/([A-Za-zаимсзя])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  const re = new RegExp(`(?:^|\\s)\\d+(?:[.,]\\d+)?\\s*(?:${unitGroup})\\s*([A-Za-zаимсзя].*?)(?=\\s\\d{1,3}(?:,\\d{3})*\\.\\d{2})`, "i");
  const m = flat.match(re);
  if (m && m[1]) {
    return m[1].replace(/\s+/g, " ").replace(/\bAPIPC\b/gi, "PIPC").replace(/(^|\s)A(?=[A-Zаимсзя])/g, "$1").trim();
  }
  return "";
}
