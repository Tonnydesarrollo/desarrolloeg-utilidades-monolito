/*****************************************************
 * CONSTRUIR DATA PARA HTML / PDF
 *****************************************************/
import { numeroALetraMX } from "../utils/numeroALetraMX.js";

// ðŸ”¢ Normalizador numÃ©rico a prueba de AppSheet
function toNumber(v) {
  if (v === null || v === undefined) return 0;
  return Number(String(v).replace(/[^0-9.-]/g, ""));
}

function wrapDriveUrl(url) {
  if (!url) return "";
  const str = String(url);
  if (!/(?:drive\.google\.com|appsheet\.com)/i.test(str)) return str;
  const encoded = encodeURIComponent(str);
  return `/cotizaciones/img-proxy?url=${encoded}`;
}

function wrapEscudo(obj) {
  if (!obj || typeof obj !== "object") return obj || {};
  const escudo = obj.escudo ? wrapDriveUrl(obj.escudo) : obj.escudo;
  return { ...obj, escudo };
}

function normalizarFormaPago(valor) {
  const texto = String(valor || "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!texto) return "dos_pagos";
  if (
    texto === "una exhibicion" ||
    texto === "una sola exhibicion" ||
    texto === "un pago" ||
    texto === "un solo pago" ||
    texto === "single" ||
    texto === "1" ||
    texto === "contado"
  ) {
    return "una_exhibicion";
  }

  return "dos_pagos";
}

export function construirDataHTML(json) {
  if (!json) throw new Error("JSON vacÃ­o");

  // ðŸ›¡ï¸ DEFENSA CRÃTICA
  json.empresa = json.empresa || {};

  const centros = [];
  let subTotalGlobal = 0;
  let ivaGlobal = 0;
  let totalGlobal = 0;

  const porCentro = json.conceptos_por_centro || {};

  Object.keys(porCentro).forEach(ctId => {
    const bloque = porCentro[ctId];
    if (!bloque) return;

    const lineas = [];

    (bloque.conceptos || []).forEach(c => {
      const sub = toNumber(c.subtotal);
      const iva = toNumber(c.iva);
      const tot = toNumber(c.total);
      const codigo = String(c.catalogo_codigo || c.concepto_id || "").trim();
      const descripcionCatalogo = String(c.descripcion_catalogo || "").trim();

      subTotalGlobal += sub;
      ivaGlobal += iva;
      totalGlobal += tot;

      lineas.push({
        descripcion: c.concepto_nombre || "",
        tipo: c.tipo || "",
        codigo,
        catalogoDescripcion: descripcionCatalogo,
        cantidad: toNumber(c.cantidad),
        precioUnit: toNumber(c.precio),
        subLinea: sub,
        ivaLinea: iva,
        totalLinea: tot,
        raw: { TIPO: c.tipo || "" }
      });
    });

    centros.push({
      sucursal: bloque.centro_nombre || "",
      tienda: bloque.tienda || "",
      domicilio: bloque.domicilio || "",
      municipio: wrapEscudo(bloque.municipio),
      estado: wrapEscudo(bloque.estado),
      precioMunicipal: toNumber(bloque.precioMunicipal),
      precioEstatal: toNumber(bloque.precioEstatal),
      lineas
    });
  });

  // ðŸ§® ConversiÃ³n a letra segura
  const totalEnLetra = numeroALetraMX(totalGlobal);

  // ðŸ¢ LOGO FIJO (TU EMPRESA)
  const logoEmisor = wrapDriveUrl(
    "https://drive.google.com/thumbnail?id=15YmFa3PwCXcZCdgzrtlFGcdIGXXF0XvL"
  );

  // ðŸ¬ LOGO DEL CLIENTE
  // AppSheet guarda la mayoria de los logos como rutas de archivo, no como URLs publicas.
  const logoClienteRaw = String(json.empresa.logoUrl || json.empresa.logo || "").trim();
  const empresaId = String(json.empresa.id || json.empresaId || "").trim();
  const logoCliente = /^https?:\/\//i.test(logoClienteRaw)
    ? wrapDriveUrl(logoClienteRaw)
    : logoClienteRaw && empresaId
      ? `/dashboard/empresas/${encodeURIComponent(empresaId)}/logo`
      : "";

  const firma = json.firma ? { ...json.firma } : null;
  if (firma?.firmaUrl) {
    firma.firmaUrl = wrapDriveUrl(firma.firmaUrl);
  }

  return {
    logoEmisor,
    logoCliente,
    empresaId,

    empresa: {
      nombreComercial: json.empresa.nombreComercial || "",
      razonSocial: json.empresa.razonSocial || "",
      logo: json.empresa.logo || "",
      logoUrl: json.empresa.logoUrl || ""
    },

    cotizacion: {
      FOLIO: json.cotizacion?.id || "",
      FECHA: json.cotizacion?.fecha || "",
      proveedor: json.cotizacion?.proveedor || null,
      TITULO: json.cotizacion?.titulo || "",
      centroNombre: json.cotizacion?.centroNombre || "",
      centroDeTrabajoCount: json.cotizacion?.centroDeTrabajoCount || 0,
      formaPago: normalizarFormaPago(
        json.cotizacion?.formaPago ||
        json.cotizacion?.["Forma pago"] ||
        json.cotizacion?.["Forma Pago"] ||
        json.cotizacion?.["FORMA PAGO"] ||
        json.cotizacion?.paymentTerms
      )
    },

    centros,

    totales: {
      subTotalGlobal,
      ivaGlobal,
      totalGlobal,
      totalEnLetra
    },

    firma
  };
}
