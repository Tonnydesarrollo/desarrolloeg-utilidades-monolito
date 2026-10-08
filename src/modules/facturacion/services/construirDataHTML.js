/*****************************************************
 * CONSTRUIR DATA PARA HTML / PDF
 *****************************************************/
import { numeroALetraMX } from "../utils/numeroALetraMX.js";

// Normalizador numérico a prueba de AppSheet
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

export function construirDataHTML(json, {
  centroId = "",
  formaPago = "",
  desglose = null,
  mostrarCodigo = false,
  mostrarDescripcion = false,
  mostrarDireccion = false,
  formato = "",
} = {}) {
  if (!json) throw new Error("JSON vacío");

  // DEFENSA CRÍTICA
  json.empresa = json.empresa || {};

  const porCentro = json.conceptos_por_centro || {};
  const todosLosCentros = Object.keys(porCentro).map(ctId => {
    const bloque = porCentro[ctId] || {};
    return {
      id: String(bloque.centro_id || ctId).trim(),
      key: ctId,
      nombre: String(bloque.centro_nombre || ctId).trim(),
      tienda: String(bloque.tienda || "").trim(),
      domicilio: String(bloque.domicilio || "").trim(),
      conceptosCount: Array.isArray(bloque.conceptos) ? bloque.conceptos.length : 0,
    };
  });

  const filterKey = String(centroId || "").trim().toLowerCase();
  let matchedKey = null;
  if (filterKey && !["todas", "completa", "all", "todas_las_sucursales", "0"].includes(filterKey)) {
    matchedKey = Object.keys(porCentro).find(k => {
      const b = porCentro[k] || {};
      const kId = String(k).trim().toLowerCase();
      const bId = String(b.centro_id || "").trim().toLowerCase();
      const bNom = String(b.centro_nombre || "").trim().toLowerCase();
      const bTienda = String(b.tienda || "").trim().toLowerCase();
      return kId === filterKey || bId === filterKey || bNom === filterKey || (bTienda && bTienda === filterKey);
    });
  }

  const isSingleCenterFiltered = Boolean(matchedKey);
  const selectedCentroId = matchedKey || "";
  const selectedCentroNombre = matchedKey ? (porCentro[matchedKey].centro_nombre || matchedKey) : "";
  const keysToProcess = matchedKey ? [matchedKey] : Object.keys(porCentro);

  const centros = [];
  let subTotalGlobal = 0;
  let ivaGlobal = 0;
  let totalGlobal = 0;

  keysToProcess.forEach(ctId => {
    const bloque = porCentro[ctId];
    if (!bloque) return;

    const lineas = [];

    (bloque.conceptos || []).forEach(c => {
      const sub = toNumber(c.subtotal);
      const ivaTasa = toNumber(c.iva);
      const iva = c.ivaImporte === null || c.ivaImporte === undefined
        ? sub * ivaTasa
        : toNumber(c.ivaImporte);
      const tot = c.total === null || c.total === undefined
        ? sub + iva
        : toNumber(c.total);
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
        ivaPorcentaje: ivaTasa * 100,
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

  // Conversión a letra segura
  const totalEnLetra = numeroALetraMX(totalGlobal);

  // DETECCIÓN FORMATO SERGIO GONZALEZ CASTILLO
  const provId = String(json.cotizacion?.proveedorId || json.cotizacion?.PROVEEDOR || "").trim();
  const provNombre = String(json.cotizacion?.proveedor?.nombre || json.cotizacion?.proveedor || "").toUpperCase();
  const rawFirmaNombre = String(json.firma?.nombre || "").toUpperCase();
  const formatoLower = String(formato || "").toLowerCase().trim();

  const esCastillo =
    formatoLower === "castillo" ||
    formatoLower === "sergio" ||
    formatoLower === "sergio_castillo" ||
    provId === "EiHiUQ9YHf4mA-C7L_ziyc" ||
    provNombre.includes("CASTILLO") ||
    rawFirmaNombre.includes("CASTILLO") ||
    rawFirmaNombre.includes("SERGIO GONZALEZ CASTILLO");

  const direccionCastillo = "CALLE: MISION DE CARMELO N° 2602, FRACC. CAPISTRANO, CULIACAN, SINALOA, C.P.80194 TEL: 6673403135 Email: desarrolloeg@gmail.com";

  // LOGO FIJO (TU EMPRESA)
  const logoEmisor = esCastillo
    ? "/img/logo_sergio_castillo.png"
    : wrapDriveUrl("https://drive.google.com/thumbnail?id=15YmFa3PwCXcZCdgzrtlFGcdIGXXF0XvL");

  // LOGO DEL CLIENTE
  // AppSheet guarda la mayoria de los logos como rutas de archivo, no como URLs publicas.
  const logoClienteRaw = String(json.empresa.logoUrl || json.empresa.logo || "").trim();
  const empresaId = String(json.empresa.id || json.empresaId || "").trim();
  const logoCliente = /^https?:\/\//i.test(logoClienteRaw)
    ? wrapDriveUrl(logoClienteRaw)
    : logoClienteRaw && empresaId
      ? `/dashboard/empresas/${encodeURIComponent(empresaId)}/logo`
      : "";

  let firma = json.firma ? { ...json.firma } : null;
  if (esCastillo) {
    firma = {
      nombre: "DR. SERGIO GONZALEZ CASTILLO",
      puesto: "DIRECTOR GENERAL",
      firmaUrl: "/img/firma_sergio_castillo.png",
    };
  } else if (firma?.firmaUrl) {
    firma.firmaUrl = wrapDriveUrl(firma.firmaUrl);
  }

  return {
    esCastillo,
    direccionEmisor: esCastillo ? direccionCastillo : "",
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
      centroNombre: isSingleCenterFiltered
        ? (selectedCentroNombre || json.cotizacion?.centroNombre || "")
        : (json.cotizacion?.centroNombre || ""),
      centroDeTrabajoCount: isSingleCenterFiltered
        ? 1
        : (json.cotizacion?.centroDeTrabajoCount || centros.length),
      formaPago: formaPago ? normalizarFormaPago(formaPago) : normalizarFormaPago(
        json.cotizacion?.formaPago ||
        json.cotizacion?.["Forma pago"] ||
        json.cotizacion?.["Forma Pago"] ||
        json.cotizacion?.["FORMA PAGO"] ||
        json.cotizacion?.paymentTerms
      ),
      desglose: Array.isArray(desglose)
        ? desglose
        : (typeof desglose === "string" && desglose.trim()
            ? desglose.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
            : (Array.isArray(json.cotizacion?.desglose) ? json.cotizacion.desglose : []))
    },

    mostrarCodigo: Boolean(mostrarCodigo),
    mostrarDescripcion: Boolean(mostrarDescripcion),
    mostrarDireccion: Boolean(mostrarDireccion),

    centros,
    todosLosCentros,
    selectedCentroId,
    selectedCentroNombre,
    isSingleCenterFiltered,

    totales: {
      subTotalGlobal,
      ivaGlobal,
      totalGlobal,
      totalEnLetra
    },

    firma
  };
}
