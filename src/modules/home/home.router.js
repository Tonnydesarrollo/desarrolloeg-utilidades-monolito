import crypto from "crypto";
import express from "express";
import { getActivePortalBasePath, portalPath } from "./portalPath.js";
import {
  buildClearOAuthStateCookieHeader,
  buildClearCookieHeader,
  buildGoogleAuthUrl,
  buildCookieHeader,
  buildQaAccessEmployee,
  authenticateEmployeeByEmail,
  createSessionForEmployee,
  exchangeGoogleAuthCode,
  getCapacitacionesDashboardData,
  buildCalendarNoteEvent,
  getEmployeeSummary,
  getRouteCardsForRole,
  getOAuthStateCookieName,
  isGoogleOAuthConfigured,
  isQaAccessEnabled,
  isRequestSecure,
  listEmployeesForPortal,
  loadAuthenticatedEmployee,
  deleteCalendarNote,
  verifyQaAccessToken,
  upsertCalendarNote,
  updateCapacitacionDiplomas,
  updateCapacitacionStatus,
  updateCapacitacionNotas,
  warmPortalDashboardCaches,
} from "./portalAuth.service.js";
import { getFaltantesLeyData } from "../faltantes-ley/faltantesLey.service.js";
import { renderPedidosSinLiberacionPage } from "../pedidos-ley/pedidosLey.page.js";
import { fetchPedidosLeyAdminDashboardData } from "../pedidos-ley/services/pedidosLey.js";
import { renderPedidosLeyAdminPage } from "../pedidos-ley/pedidosLey.admin.page.js";

export const homeRouter = express.Router();

const HOME_FAVICON_PATH = "/img/Logo%20sin%20fondo%203D%20HD.png";
const BRAND_LOGO_PATH = `${HOME_FAVICON_PATH}?v=20260822`;

function getConstanciasBaseUrl() {
  const fallback = "https://api-constancias.desarrolloeg.com";
  const configured = String(process.env.PORTAL_CONSTANCIAS_BASE_URL || "").trim();
  return (configured || fallback).replace(/\/+$/, "");
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const cookies = {};
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.split("=");
    if (!key) continue;
    cookies[key.trim()] = decodeURIComponent(rest.join("=").trim() || "");
  }
  return cookies;
}

function getGoogleOAuthRedirectUri(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req.headers.host || "").trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  const portalBasePath = getActivePortalBasePath(req?.portalBasePath);
  if (!host) {
    return "";
  }
  return `${protocol}://${host}${portalBasePath}/auth/google/callback`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function renderCard(card, { minimal = false } = {}) {
  return `
    <a class="card tone-${escapeAttr(card.tone || "slate")}" href="${escapeAttr(card.href)}">
      <div class="card-top">
        <span class="chip">${escapeHtml(card.label || "")}</span>
      </div>
      <h3>${escapeHtml(card.title || "")}</h3>
      ${minimal ? "" : `<p>${escapeHtml(card.description || "")}</p>`}
      <span class="card-link">Abrir ruta</span>
    </a>
  `;
}

function renderEmployeeCard(employee, basePath = portalPath("/dashboard/capacitador")) {
  const summary = getEmployeeSummary(employee);
  const badge = summary.permiso || summary.puesto;
  return `
    <a class="employee-card" href="${escapeAttr(`${basePath}/${encodeURIComponent(summary.rowId)}`)}">
      <div class="employee-head">
        <div>
          <strong>${escapeHtml(summary.nombre)}</strong>
          <span>${escapeHtml(summary.puesto)}</span>
        </div>
        <span class="employee-role">${escapeHtml(summary.role)}</span>
      </div>
      <div class="employee-foot">
        <span class="badge">${escapeHtml(badge || "Sin permiso")}</span>
        <span class="employee-link">Ver como</span>
      </div>
    </a>
  `;
}

function renderRouteGrid(cards, options = {}) {
  return cards.map((card) => renderCard(card, options)).join("\n");
}

function groupAdminRouteCards(cards = []) {
  const primaryRoutes = new Set([
    "/jobs/view",
    "/whatsapp-capacitadores",
    "/pedidos-sin-liberacion",
    "/dashboard/pedidos",
    "/FALTANTES-LEY/",
  ]);

  const secondaryRoutes = new Set([
    "/Planeacion-ley/",
    "/SUCURSALES-DOCS/",
    "/SOLVENTACIONES/html",
    "/POLIZA_LEY/",
    "/CONSTANCIAS/",
    "/SEPARAR-PIPC/",
    "/cotizaciones/cotizacion/html",
    "/contabilidad",
  ]);

  const primary = [];
  const secondary = [];
  const fallback = [];

  for (const card of cards) {
    const href = String(card?.href || "").trim();
    if (primaryRoutes.has(href)) {
      primary.push(card);
      continue;
    }
    if (secondaryRoutes.has(href)) {
      secondary.push(card);
      continue;
    }
    fallback.push(card);
  }

  return { primary, secondary, fallback };
}

function renderEmployeeGrid(employees, basePath = portalPath("/dashboard/capacitador")) {
  if (!employees.length) {
    return `<div class="empty-state">No hay capacitadores registrados.</div>`;
  }
  return employees.map((employee) => renderEmployeeCard(employee, basePath)).join("\n");
}

function renderCalendarEmployeePicker(employees = [], selectedIds = []) {
  const safeEmployees = Array.isArray(employees) ? employees : [];
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : [selectedIds]).map((item) => String(item || "").trim()).filter(Boolean));
  if (!safeEmployees.length) {
    return `
      <div class="calendar-note-tags">
        <label class="calendar-note-tag calendar-note-tag--all" style="--tag-color:#b45309;--tag-text:#ffffff;">
          <input type="checkbox" name="empleados" value="TODOS" ${selected.has("TODOS") ? "checked" : ""} />
          <span>TODOS</span>
        </label>
      </div>
    `;
  }

  return `
    <div class="calendar-note-tags">
      <label class="calendar-note-tag calendar-note-tag--all" style="--tag-color:#b45309;--tag-text:#ffffff;">
        <input type="checkbox" name="empleados" value="TODOS" ${selected.has("TODOS") ? "checked" : ""} />
        <span>TODOS</span>
      </label>
      ${safeEmployees.map((employee) => {
        const rowId = String(employee?.rowId || "").trim();
        const color = String(employee?.calendarColor || employee?.color || "").trim() || "#1e3a8a";
        const textColor = String(employee?.textColor || getCalendarTextColor(color)).trim() || "#ffffff";
        return `
          <label class="calendar-note-tag" style="--tag-color:${escapeAttr(color)};--tag-text:${escapeAttr(textColor)};">
            <input type="checkbox" name="empleados" value="${escapeAttr(rowId)}" ${selected.has(rowId) ? "checked" : ""} />
            <span>${escapeHtml(employee?.nombre || rowId || "")}</span>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderCalendarNoteForm({
  note = null,
  employees = [],
  selectedEmployeeId = "",
  returnTo = portalPath("/dashboard"),
  canEditNotes = false,
  action = portalPath("/dashboard/calendario/notas"),
  submitLabel = "Guardar nota",
} = {}) {
  if (!canEditNotes) return "";

  const noteDate = String(note?.dateRaw || note?.start || note?.dateLabel || "").trim();
  const parsedNoteDate = parseDashboardDate(noteDate) || parseDashboardDate(note?.dateLabel || "") || parseDashboardDate(note?.start || "");
  const dateValue = parsedNoteDate ? toLocalDateKey(parsedNoteDate) : toLocalDateKey(new Date());
  const titleValue = String(note?.title || note?.noteTitle || "").trim();
  const notesValue = String(note?.notes || "").trim();
  const iconValue = String(note?.icon || note?.noteIcon || "").trim() || "📝";
  const selectedIds = Array.isArray(note?.employeeKeys) && note.employeeKeys.length > 0
    ? note.employeeKeys
    : note?.audienceAll
      ? ["TODOS", ...employees.map((employee) => String(employee?.rowId || "").trim()).filter(Boolean)]
      : Array.isArray(note?.employeeTokens) && note.employeeTokens.some((token) => ["TODOS", "ALL", "TODAS", "*"].includes(String(token || "").trim().toUpperCase()))
      ? ["TODOS"]
    : selectedEmployeeId
      ? [selectedEmployeeId]
      : [];
  const rowIdValue = String(note?.rowId || note?.id || "").trim();

  return `
    <form class="calendar-note-form js-async-calendar-note" method="post" action="${escapeAttr(action)}">
      ${rowIdValue ? `<input type="hidden" name="rowId" value="${escapeAttr(rowIdValue)}" />` : ""}
      <input type="hidden" name="returnTo" value="${escapeAttr(returnTo || portalPath("/dashboard"))}" />
      <div class="calendar-note-grid">
        <label class="calendar-note-field">
          <span>Fecha</span>
          <input type="date" name="fecha" value="${escapeAttr(dateValue)}" required />
        </label>
        <label class="calendar-note-field">
          <span>Icono</span>
          <select name="icono">
            ${[
              ["📝", "Nota"],
              ["📣", "Aviso"],
              ["🔔", "Recordatorio"],
              ["📌", "Fijado"],
              ["🎯", "Objetivo"],
              ["⭐", "Destacado"],
              ["🎉", "Celebración"],
              ["⚠️", "Urgente"],
            ].map(([value, label]) => `<option value="${escapeAttr(value)}"${iconValue === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
          </select>
        </label>
        <label class="calendar-note-field">
          <span>Mensaje</span>
          <input type="text" name="titulo" value="${escapeAttr(titleValue)}" placeholder="Ej. Recordatorio interno" />
        </label>
      </div>
      <label class="calendar-note-field calendar-note-field--wide">
        <span>Detalle opcional</span>
        <textarea name="notas" rows="4" class="notes-textarea" placeholder="Escribe un detalle opcional...">${escapeHtml(notesValue)}</textarea>
      </label>
      <div class="calendar-note-field">
        <span>Etiquetar empleados</span>
        ${renderCalendarEmployeePicker(employees, selectedIds)}
      </div>
      <div class="notes-actions">
        <button type="submit" class="status-button">${escapeHtml(submitLabel)}</button>
        ${rowIdValue ? `<button type="button" class="status-button secondary js-delete-calendar-note" data-calendar-note-id="${escapeAttr(rowIdValue)}">Eliminar nota</button>` : ""}
        <span class="notes-state">${rowIdValue ? "Nota lista para editar" : "Nota nueva"}</span>
      </div>
    </form>
  `;
}

function getCapacitacionConstanciasUrl(rowId, capacitadorNombre = "") {
  const baseUrl = getConstanciasBaseUrl();
  const name = String(capacitadorNombre || "").trim();
  return `${baseUrl}/CONSTANCIAS/capacitaciones/${encodeURIComponent(rowId)}/HTML`;
}

function getCapacitacionConstanciasUrlFromCapacitacion(capacitacion) {
  const capacitacionId = String(capacitacion?.id || capacitacion?.rowId || "").trim();
  return getCapacitacionConstanciasUrl(capacitacionId);
}

function normalizeCalendarView(value) {
  return String(value || "week").toLowerCase() === "month" ? "month" : "week";
}

function parseDashboardDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfWeekMonday(date) {
  const copy = startOfDay(date);
  const day = copy.getDay();
  const offset = (day + 6) % 7;
  return addDays(copy, -offset);
}

function endOfWeekMonday(date) {
  return addDays(startOfWeekMonday(date), 6);
}

function startOfMonth(date) {
  const copy = startOfDay(date);
  copy.setDate(1);
  return copy;
}

function endOfMonth(date) {
  const copy = startOfMonth(date);
  copy.setMonth(copy.getMonth() + 1);
  copy.setDate(0);
  return copy;
}

function formatCalendarMonthLabel(date) {
  return date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

function formatCalendarDayLabel(date) {
  return date.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit" });
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalDateTimeString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function parseTimeParts(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || "0");
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  return { hours, minutes, seconds };
}

function combineDateAndTime(date, timeValue) {
  const time = parseTimeParts(timeValue);
  if (!date || !time) return null;
  const copy = new Date(date);
  copy.setHours(time.hours, time.minutes, time.seconds, 0);
  return copy;
}

function buildDashboardQueryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    const stringValue = String(value).trim();
    if (!stringValue) continue;
    search.set(key, stringValue);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function serializeJsonForHtml(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function buildDashboardReturnHref(path, query = {}, calendarView = "week") {
  const safePath = portalPath(String(path || "/dashboard").trim() || "/dashboard");
  const safeQuery = { ...query };
  if (calendarView) {
    safeQuery.calendar = normalizeCalendarView(calendarView);
  }
  return `${safePath}${buildDashboardQueryString(safeQuery)}`;
}

function getCalendarAnchorDate(programadas, selectedCapacitacion = null) {
  const selectedDate = parseDashboardDate(selectedCapacitacion?.dateRaw || selectedCapacitacion?.dateLabel);
  if (selectedDate) return selectedDate;

  const today = startOfDay(new Date());
  const upcoming = programadas.find((item) => {
    const date = parseDashboardDate(item.dateRaw || item.dateLabel);
    return date && startOfDay(date).getTime() >= today.getTime();
  });
  return parseDashboardDate(upcoming?.dateRaw || upcoming?.dateLabel) || parseDashboardDate(programadas[0]?.dateRaw || programadas[0]?.dateLabel) || today;
}

function normalizeCalendarColor(value, fallback = "#1e3a8a") {
  const color = String(value || "").trim();
  if (!color) return fallback;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split("").map((char) => `${char}${char}`).join("")}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  return color;
}

function getCalendarTextColor(backgroundColor) {
  const hex = normalizeCalendarColor(backgroundColor, "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 160 ? "#1a2a3a" : "#ffffff";
}

function buildCapacitacionCalendarEvent(capacitacion, selectedEmployeeId, returnPath) {
  const date = parseDashboardDate(capacitacion.dateRaw || capacitacion.dateLabel);
  if (!date) return null;

  const colors = Array.isArray(capacitacion.capacitadores)
    ? capacitacion.capacitadores.map((item) => String(item?.color || "").trim()).filter(Boolean)
    : [];
  const primaryColor = normalizeCalendarColor(capacitacion.primaryCapacitadorColor || colors[0] || (capacitacion.statusSuffix === "FINALIZADA" ? "#166534" : "#1e3a8a"));
  const textColor = getCalendarTextColor(primaryColor);
  const sucursalesLabel = getCapacitacionSucursalesItems(capacitacion).join(" · ");
  const sedeLabel = capacitacion.cedeLabel || capacitacion.cede || "Sin sede";
  const capacitadoresLabel = capacitacion.capacitadores?.length
    ? capacitacion.capacitadores.map((item) => item.nombre || item.key || "").filter(Boolean).join(" · ")
    : "PENDIENTE";
  const capacitadorKeys = Array.isArray(capacitacion.capacitadores)
    ? capacitacion.capacitadores.map((item) => String(item?.key || "").trim()).filter(Boolean)
    : [];
  const startDateTime = combineDateAndTime(date, capacitacion.horaInicio);
  const endDateTime = combineDateAndTime(date, capacitacion.horaFin);
  const timedEvent = Boolean(startDateTime);

  return {
    id: capacitacion.rowId,
    capacitacionId: capacitacion.rowId,
    title: "Capacitación",
    start: timedEvent ? toLocalDateTimeString(startDateTime) : toLocalDateKey(startOfDay(date)),
    end: endDateTime ? toLocalDateTimeString(endDateTime) : undefined,
    allDay: !timedEvent,
    backgroundColor: "#ffffff",
    borderColor: "#d9e2ec",
    textColor: "#1a2a3a",
    hourLabel: getCapacitacionHoraLabel(capacitacion),
    classNames: [
      capacitacion.statusSuffix === "FINALIZADA" ? "fc-event-finalizada" : "fc-event-programada",
      "fc-event-capacitacion",
    ],
    extendedProps: {
      eventType: "capacitacion",
      statusLabel: capacitacion.statusLabel || "Sin estado",
      statusSuffix: capacitacion.statusSuffix || "",
      capacitadoresLabel,
      capacitadores: capacitacion.capacitadores || [],
      capacitadorKeys,
      sedeLabel,
      sucursalesLabel,
      dateLabel: capacitacion.dateLabel || "",
      notes: capacitacion.notas || "",
      detailHref: buildCapacitacionDetailUrl(capacitacion.rowId, {
        employeeId: selectedEmployeeId,
        returnPath,
      }),
      constanciasUrl: getCapacitacionConstanciasUrlFromCapacitacion(capacitacion),
      primaryColor,
      accentColor: primaryColor,
    },
  };
}

function getCapacitacionDashboardCalendarHref(capacitacion, selectedEmployeeId, returnPath) {
  return buildCapacitacionDetailUrl(capacitacion.rowId, {
    employeeId: selectedEmployeeId,
    returnPath,
  });
}

function renderCapacitacionesCalendar(calendarCapacitaciones, {
  calendarView = "week",
  calendarPath = "/dashboard",
  calendarQuery = {},
  selectedEmployeeId = "",
  selectedEmployeeRole = "",
  returnPath = "/dashboard",
  selectedCapacitacion = null,
  canEditNotes = false,
  birthdayEvents = [],
  calendarNotes = [],
  employees = [],
} = {}) {
  const view = normalizeCalendarView(calendarView);
  const queryBase = { ...calendarQuery };
  const birthdayEventsSorted = [...birthdayEvents].filter(Boolean).sort((a, b) => {
    const aDate = parseDashboardDate(a.start || a.dateRaw || a.dateLabel)?.getTime() || 0;
    const bDate = parseDashboardDate(b.start || b.dateRaw || b.dateLabel)?.getTime() || 0;
    return aDate - bDate;
  });
  const safePath = String(calendarPath || "/dashboard").trim() || "/dashboard";
  const buildViewHref = (nextView) => `${safePath}${buildDashboardQueryString({ ...queryBase, calendar: nextView })}`;
  const calendarNotesSorted = [...calendarNotes].filter(Boolean).sort((a, b) => {
    const aDate = parseDashboardDate(a.start || a.dateRaw || a.dateLabel)?.getTime() || 0;
    const bDate = parseDashboardDate(b.start || b.dateRaw || b.dateLabel)?.getTime() || 0;
    return aDate - bDate;
  });
  const defaultCapacitadorFilter = selectedEmployeeRole === "capacitador" ? selectedEmployeeId : "";
  const calendarNoteEvents = calendarNotesSorted
    .map((note) => buildCalendarNoteEvent(note, selectedEmployeeId, returnPath))
    .filter(Boolean);
  const calendarCapacitacionesSorted = [...calendarCapacitaciones].sort((a, b) => {
    const aDate = parseDashboardDate(a.dateRaw || a.dateLabel)?.getTime() || 0;
    const bDate = parseDashboardDate(b.dateRaw || b.dateLabel)?.getTime() || 0;
    return aDate - bDate;
  });
  const defaultFilteredCapacitacion = defaultCapacitadorFilter
    ? calendarCapacitacionesSorted.find((capacitacion) => Array.isArray(capacitacion.capacitadores)
        && capacitacion.capacitadores.some((item) => String(item?.key || "").trim() === defaultCapacitadorFilter))
    : null;
  const allEvents = [
    ...calendarCapacitacionesSorted.map((capacitacion) => buildCapacitacionCalendarEvent(capacitacion, selectedEmployeeId, returnPath)),
    ...birthdayEventsSorted,
    ...calendarNoteEvents,
  ].filter(Boolean);
  const anchorDate = getCalendarAnchorDate([...calendarCapacitacionesSorted, ...birthdayEventsSorted, ...calendarNotesSorted], selectedCapacitacion);
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = endOfMonth(anchorDate);
  const monthEvents = allEvents.filter((item) => {
    const date = parseDashboardDate(item.dateRaw || item.dateLabel);
    const start = parseDashboardDate(item.start || item.dateRaw || item.dateLabel);
    const targetDate = date || start;
    if (!targetDate) return false;
    const time = startOfDay(targetDate).getTime();
    return time >= monthStart.getTime() && time <= monthEnd.getTime();
  }).length;
  const monthCapacitaciones = calendarCapacitacionesSorted.filter((item) => {
    const date = parseDashboardDate(item.dateRaw || item.dateLabel);
    if (!date) return false;
    const time = startOfDay(date).getTime();
    return time >= monthStart.getTime() && time <= monthEnd.getTime();
  }).length;
  const monthCumpleanos = birthdayEventsSorted.filter((item) => {
    const date = parseDashboardDate(item.start || item.dateRaw || item.dateLabel);
    if (!date) return false;
    const time = startOfDay(date).getTime();
    return time >= monthStart.getTime() && time <= monthEnd.getTime();
  }).length;
  const monthNotas = calendarNotesSorted.filter((item) => {
    const date = parseDashboardDate(item.start || item.dateRaw || item.dateLabel);
    if (!date) return false;
    const time = startOfDay(date).getTime();
    return time >= monthStart.getTime() && time <= monthEnd.getTime();
  }).length;
  const capacitadorLegend = calendarCapacitacionesSorted
    .flatMap((capacitacion) => Array.isArray(capacitacion.capacitadores) ? capacitacion.capacitadores : [])
    .reduce((acc, item) => {
      const key = String(item?.key || item?.nombre || "").trim();
      if (!key || acc.some((entry) => entry.key === key)) return acc;
      acc.push({
        key,
        nombre: String(item?.nombre || item?.key || "").trim(),
        color: normalizeCalendarColor(item?.color || "#1e3a8a"),
        textColor: getCalendarTextColor(item?.color || "#1e3a8a"),
      });
      return acc;
    }, [])
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const legendItemsMarkup = capacitadorLegend
    .map((item) => `
      <button
        type="button"
        class="tag-pill calendar-filter-pill"
        data-capacitador-filter="${escapeAttr(item.key)}"
        style="background:linear-gradient(180deg, ${escapeHtml(item.color)} 0%, ${escapeHtml(item.color)} 100%);color:${escapeHtml(item.textColor)};border-color:${escapeHtml(item.color)};box-shadow:0 10px 18px ${escapeHtml(item.color)}33;"
      >
        <span class="calendar-filter-pill-dot" style="background:${escapeHtml(item.textColor)};"></span>
        <span>${escapeHtml(item.nombre)}</span>
      </button>
    `)
    .join("");

  const dashboardCalendarData = serializeJsonForHtml({
    initialView: "dayGridMonth",
    mobileInitialView: "listWeek",
    openDetailOnLoad: Boolean(selectedCapacitacion),
    events: allEvents,
    selectedId: selectedCapacitacion?.rowId || defaultFilteredCapacitacion?.rowId || calendarCapacitacionesSorted[0]?.id || birthdayEventsSorted[0]?.id || calendarNoteEvents[0]?.id || allEvents[0]?.id || "",
    canEditNotes,
    legendItems: capacitadorLegend,
    defaultCapacitadorFilter,
    selectedEmployeeId,
    returnTo: returnPath,
    employees,
  });
  const initialDetailMarkup = renderCapacitacionInlineDetailMarkup(selectedCapacitacion || defaultFilteredCapacitacion || calendarCapacitacionesSorted[0] || birthdayEventsSorted[0] || calendarNoteEvents[0] || null, {
    empty: !selectedCapacitacion && !defaultFilteredCapacitacion && calendarCapacitacionesSorted.length === 0 && birthdayEventsSorted.length === 0 && calendarNoteEvents.length === 0,
    canEditNotes,
    employees,
    selectedEmployeeId,
    returnTo: returnPath,
  });

  return `
    <div class="panel calendar-panel">
      <div class="calendar-header">
        <div class="calendar-header-copy">
          <span class="calendar-month">${formatCalendarMonthLabel(anchorDate)}</span>
          <h2>Calendario</h2>
          <p class="calendar-subtitle">Capacitaciones, cumpleaños y notas en una sola vista, con filtros por capacitador y detalle lateral.</p>
        </div>
      </div>
      <div class="calendar-split">
        <div class="calendar-frame">
          <div class="calendar-frame-top">
            <span class="calendar-frame-label">Vista mensual</span>
            <div class="calendar-frame-actions">
              <span class="calendar-frame-caption">Selecciona un evento para abrir su detalle</span>
              ${canEditNotes ? `
                <button type="button" class="button primary calendar-new-note-btn" data-open-calendar-note>
                  Nueva nota
                </button>
              ` : ""}
            </div>
          </div>
          <div id="dashboard-calendar" class="dashboard-calendar" data-initial-view="dayGridMonth"></div>
          <script type="application/json" id="dashboard-calendar-data">${dashboardCalendarData}</script>
        </div>
        <aside class="calendar-sidebar">
          <div class="calendar-sidebar-card">
            <div class="calendar-sidebar-head">
              <span class="calendar-legend-label">Capacitadores</span>
            </div>
            ${capacitadorLegend.length ? `
              <div class="calendar-legend">
                <div class="calendar-legend-items">
                  ${legendItemsMarkup}
                  <button type="button" class="calendar-filter-clear" data-capacitador-filter="__all">Ver todos</button>
                </div>
              </div>
            ` : `<div class="calendar-hint">Sin filtros disponibles.</div>`}
          </div>
        </aside>
      </div>
      <aside class="calendar-detail-overlay" id="dashboard-calendar-detail" aria-hidden="true">
        ${initialDetailMarkup}
      </aside>
    </div>
  `;
}

function buildCapacitacionDetailUrl(rowId, { employeeId = "", returnPath = "" } = {}) {
  const params = new URLSearchParams();
  const selectedEmployeeId = String(employeeId || "").trim();
  const safeReturnPath = String(returnPath || "").trim();
  if (selectedEmployeeId) params.set("employee", selectedEmployeeId);
  if (safeReturnPath) params.set("returnTo", safeReturnPath);
  const qs = params.toString();
  const baseUrl = portalPath(`/dashboard/capacitacion/${encodeURIComponent(rowId)}`);
  return qs ? `${baseUrl}?${qs}` : baseUrl;
}

function getCapacitacionConstanciasUrlWithPrefill(rowId) {
  return getCapacitacionConstanciasUrl(rowId);
}

function getCapacitacionSucursalesItems(capacitacion) {
  if (Array.isArray(capacitacion?.sucursalesLabels) && capacitacion.sucursalesLabels.length > 0) {
    return capacitacion.sucursalesLabels.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const fallback = String(capacitacion?.sucursales || "").trim();
  return fallback ? [fallback] : [];
}

function getCapacitacionHoraLabel(capacitacion) {
  const start = String(capacitacion?.horaInicio || "").trim();
  const end = String(capacitacion?.horaFin || "").trim();
  if (start && end) return `${start} - ${end}`;
  if (start) return `Inicio ${start}`;
  if (end) return `Fin ${end}`;
  return "Sin horario";
}

function renderCapacitacionInlineDetailMarkup(capacitacion, {
  empty = false,
  canEditNotes = false,
  employees = [],
  selectedEmployeeId = "",
  returnTo = portalPath("/dashboard"),
} = {}) {
  const eventType = String(capacitacion?.extendedProps?.eventType || capacitacion?.eventType || "capacitacion").toLowerCase();
  if (empty || !capacitacion) {
    return `
      <div class="calendar-detail-empty">
        <span class="detail-kicker">Calendario</span>
        <h3>Selecciona un evento</h3>
        <p>Toca una capacitación, cumpleaños o nota para ver su detalle sin salir de la pantalla.</p>
        ${canEditNotes ? renderCalendarNoteForm({
          employees,
          selectedEmployeeId,
          returnTo,
          canEditNotes,
          action: portalPath("/dashboard/calendario/notas"),
          submitLabel: "Crear nota",
        }) : ""}
      </div>
    `;
  }

  if (eventType === "birthday") {
    const employeeName = escapeHtml(capacitacion?.extendedProps?.employeeName || capacitacion?.title || "Cumpleaños");
    const dateLabel = escapeHtml(capacitacion?.extendedProps?.dateLabel || capacitacion?.dateLabel || capacitacion?.start || "");
    return `
      <div class="calendar-detail-card calendar-detail-card--birthday" data-calendar-event-id="${escapeAttr(capacitacion.id || capacitacion.rowId || "")}">
        <div class="calendar-detail-top">
          <div>
            <span class="detail-kicker">Cumpleaños</span>
            <h3>${employeeName}</h3>
          </div>
          <span class="status-chip is-programada">Anual</span>
        </div>
        <div class="calendar-detail-meta">
          <span class="chip">${dateLabel}</span>
        </div>
      </div>
    `;
  }

  if (eventType === "calendar-note" || eventType === "nota" || eventType === "note") {
    const noteData = {
      ...(capacitacion || {}),
      ...(capacitacion?.extendedProps || {}),
    };
    noteData.rowId = noteData.rowId || noteData.noteId || noteData.capacitacionId || noteData.id || "";
    noteData.dateRaw = noteData.dateRaw || noteData.start || noteData.dateLabel || "";
    noteData.title = noteData.title || noteData.noteTitle || capacitacion?.title || "Nota";
    noteData.notes = noteData.notes || "";
    const noteTitle = escapeHtml(noteData.title || "Nota");
    const noteBody = String(noteData.notes || "").trim();
    const noteDate = escapeHtml(noteData.dateRaw || noteData.start || noteData.dateLabel || "");
    const noteIcon = String(noteData.noteIcon || noteData.icon || "📝").trim() || "📝";
    const employeeSummaries = Array.isArray(noteData.employeeSummaries)
      ? noteData.employeeSummaries
      : [];
    return `
      <div class="calendar-detail-card calendar-detail-card--note" data-calendar-event-id="${escapeAttr(noteData.rowId || capacitacion.id || capacitacion.rowId || "")}">
        <div class="calendar-detail-top">
          <div>
            <span class="detail-kicker">Nota del calendario</span>
            <h3><span class="calendar-note-emoji">${escapeHtml(noteIcon)}</span> ${noteTitle}</h3>
          </div>
          <span class="status-chip is-programada">Nota</span>
        </div>
        <div class="calendar-detail-meta">
          <span class="chip">${noteDate}</span>
          <span class="chip">${escapeHtml(noteData.audienceAll ? "TODOS" : (employeeSummaries.length ? `${employeeSummaries.length} etiquetado(s)` : "Sin etiquetas"))}</span>
        </div>
        <div class="calendar-detail-section">
          <strong>Etiqueta a empleados</strong>
          <div class="tag-row">
            ${employeeSummaries.length
              ? employeeSummaries.map((item) => {
                  const color = String(item.color || "#1e3a8a").trim();
                  const textColor = String(item.textColor || getCalendarTextColor(color)).trim() || "#ffffff";
                  return `<span class="tag-pill" style="background:${escapeHtml(color)};color:${escapeHtml(textColor)};border-color:${escapeHtml(color)};">${escapeHtml(item.nombre || item.rowId || "")}</span>`;
                }).join("")
              : `<span class="calendar-empty">Sin etiquetas</span>`}
          </div>
        </div>
        <div class="calendar-detail-section">
          <strong>Nota</strong>
          ${canEditNotes ? renderCalendarNoteForm({
            note: noteData,
            employees,
            selectedEmployeeId,
            returnTo,
            canEditNotes,
            action: portalPath("/dashboard/calendario/notas"),
            submitLabel: "Guardar nota",
          }) : `<span>${escapeHtml(noteBody || "Sin nota")}</span>`}
        </div>
      </div>
    `;
  }

  const statusClass = capacitacion.statusSuffix === "FINALIZADA" ? "is-finalizada" : "is-programada";
  const dateLabel = escapeHtml(capacitacion.dateLabel || capacitacion.dateRaw || "");
  const hourLabel = escapeHtml(getCapacitacionHoraLabel(capacitacion));
  const sedeLabel = escapeHtml(capacitacion.cedeLabel || capacitacion.cede || "Sin sede");
  const capacitadoresMarkup = Array.isArray(capacitacion.capacitadores) && capacitacion.capacitadores.length
    ? capacitacion.capacitadores.map((item) => {
        const color = normalizeCalendarColor(item.color || capacitacion.primaryCapacitadorColor || "#1e3a8a");
        const textColor = getCalendarTextColor(color);
        return `<span class="tag-pill" style="background:${color};color:${textColor};border-color:${color};">${escapeHtml(item.nombre || item.key || "")}</span>`;
      }).join("")
    : `<span class="calendar-empty">PENDIENTE</span>`;
  const sucursalesItems = getCapacitacionSucursalesItems(capacitacion);
  const sucursalesMarkup = sucursalesItems.length
    ? sucursalesItems.map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`).join("")
    : `<span class="calendar-empty">Sin sucursales</span>`;
  const notas = String(capacitacion.notas || "").trim();
  const notasMarkup = canEditNotes
    ? `
        <form class="notes-form js-async-notes" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(capacitacion.rowId)}/notas">
          <input type="hidden" name="returnTo" value="/dashboard" />
          <textarea name="notas" rows="4" class="notes-textarea" placeholder="Escribe notas del evento...">${escapeHtml(notas)}</textarea>
          <div class="notes-actions">
            <button type="submit" class="status-button">Guardar notas</button>
            <span class="notes-state">${notas ? "Notas guardadas" : "Sin notas"}</span>
          </div>
        </form>
      `
    : `<span>${escapeHtml(notas || "Sin notas")}</span>`;

  return `
    <div class="calendar-detail-card" data-capacitacion-id="${escapeAttr(capacitacion.rowId || capacitacion.id || "")}">
      <div class="calendar-detail-top">
        <div>
          <span class="detail-kicker">Evento del calendario</span>
          <h3>${sedeLabel}</h3>
        </div>
        <span class="status-chip ${statusClass}">${escapeHtml(capacitacion.statusLabel || "Sin estado")}</span>
      </div>
      <div class="calendar-detail-meta">
        <span class="chip">${dateLabel}</span>
        <span class="chip">${hourLabel}</span>
        <span class="chip">${capacitacion.hasDiplomas ? "Diplomas: Sí" : "Diplomas: No"}</span>
      </div>
      <div class="calendar-detail-section">
        <strong>Capacitadores</strong>
        <div class="tag-row">${capacitadoresMarkup}</div>
      </div>
      <div class="calendar-detail-section">
        <strong>Sucursales a capacitar</strong>
        <div class="tag-row">${sucursalesMarkup}</div>
      </div>
      <div class="calendar-detail-section">
        <strong>Notas</strong>
        ${notasMarkup}
      </div>
      <div class="calendar-detail-actions">
        <a class="button primary" href="${escapeAttr(getCapacitacionConstanciasUrlFromCapacitacion(capacitacion))}" target="_blank" rel="noopener noreferrer">Crear constancias</a>
      </div>
    </div>
  `;
}

function renderCapacitacionCard(
  capacitacion,
  {
    canEditStatus = false,
    canEditDiplomas = false,
    returnPath = "/dashboard",
    href = "",
    linkLabel = "Crear constancias",
    detailsHref = "",
    detailsLabel = "Ver detalles",
  } = {}
) {
  const capacitadoresLabel = capacitacion.capacitadores?.length
    ? capacitacion.capacitadores.map((item) => escapeHtml(item.nombre || item.key || "")).join(" · ")
    : "PENDIENTE";
  const statusClass = capacitacion.statusSuffix === "FINALIZADA" ? "is-finalizada" : "is-programada";
  const returnValue = escapeAttr(returnPath);
  const linkHref = href || capacitacion.href || "";
  const linkText = linkLabel || capacitacion.linkLabel || "Crear constancias";
  const detailsLinkHref = detailsHref || capacitacion.detailsHref || "";
  const detailsLinkText = detailsLabel || capacitacion.detailsLabel || "Ver detalles";
  const sedeLabel = capacitacion.cedeLabel || capacitacion.cede || "Capacitación";
  const sucursalesItems = getCapacitacionSucursalesItems(capacitacion);
  const titleMarkup = detailsLinkHref
    ? `<a class="capacitacion-title-link" href="${escapeAttr(detailsLinkHref)}">${escapeHtml(sedeLabel)}</a>`
    : escapeHtml(sedeLabel);
  const sucursalesPreview = sucursalesItems.slice(0, 3);
  const sucursalesMore = Math.max(0, sucursalesItems.length - sucursalesPreview.length);
  const inner = `
      <div class="capacitacion-head">
        <span class="chip">${escapeHtml(capacitacion.dateLabel || "")}</span>
        <span class="status-chip ${statusClass}">${escapeHtml(capacitacion.statusLabel || "Sin estado")}</span>
      </div>
      <h3>${titleMarkup}</h3>
      <div class="capacitacion-meta">
        ${sucursalesPreview.length ? `
          <div>
            <strong>Sucursales a capacitar</strong>
            <div class="tag-row">
              ${sucursalesPreview.map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`).join("")}
              ${sucursalesMore > 0 ? `<span class="tag-pill tag-pill-muted">+${sucursalesMore} más</span>` : ""}
            </div>
          </div>
        ` : ""}
        <div><strong>Capacitadores</strong><span>${capacitadoresLabel}</span></div>
      </div>
      ${canEditStatus ? `
        <form class="status-actions" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(capacitacion.rowId)}/status">
          <input type="hidden" name="returnTo" value="${returnValue}" />
          <button type="submit" name="status" value="PROGRAMADA" class="status-button ${capacitacion.statusSuffix === "PROGRAMADA" ? "active" : ""}">Programada</button>
          <button type="submit" name="status" value="FINALIZADA" class="status-button ${capacitacion.statusSuffix === "FINALIZADA" ? "active" : ""}">Finalizada</button>
        </form>
      ` : ""}
      ${canEditDiplomas ? `
        <form class="status-actions js-async-diplomas" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(capacitacion.rowId)}/diplomas">
          <input type="hidden" name="returnTo" value="${returnValue}" />
          <button type="submit" name="diplomas" value="Y" class="status-button ${capacitacion.hasDiplomas ? "active" : ""}">${capacitacion.hasDiplomas ? "Diplomas: Sí" : "Marcar diplomas: Sí"}</button>
        </form>
      ` : ""}
      ${detailsLinkHref ? `<a class="capacitacion-link capacitacion-details-link" href="${escapeAttr(detailsLinkHref)}">${escapeHtml(detailsLinkText)}</a>` : ""}
    ${!canEditStatus && linkHref ? `<a class="capacitacion-link capacitacion-cta" href="${escapeAttr(linkHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkText)}</a>` : ""}
  `;

  return `
    <article class="capacitacion-card">
      ${inner}
    </article>
  `;
}

function renderFinalizadasSinDiplomasPanel({
  title = "Finalizadas sin diploma",
  description = "",
  finalizadasSinDiplomas = [],
  showStatusControls = false,
  selectedEmployeeId = "",
  detailReturnPath = "/dashboard",
  emptyMessage = "No hay capacitaciones finalizadas sin diploma.",
} = {}) {
  return `
    <div class="panel accolades-panel" style="margin-top:20px;">
      <div class="section-head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
      </div>
      ${renderCapacitacionesAccordion(finalizadasSinDiplomas, {
        emptyMessage,
        hrefBuilder: (capacitacion) => getCapacitacionConstanciasUrlFromCapacitacion(capacitacion),
        linkLabel: "Crear constancias",
        canEditDiplomas: showStatusControls,
        canEditNotes: showStatusControls,
        selectedEmployeeId,
        returnPath: detailReturnPath,
      })}
    </div>
  `;
}

function renderFaltantesLeyCompactPanel({
  title = "Faltantes Ley",
  description = "",
  rows = [],
  emptyMessage = "No hay faltantes para este capacitador.",
} = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return `
      <div class="panel accolades-panel" style="margin-top:20px;">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(title)}</h2>
            ${description ? `<p>${escapeHtml(description)}</p>` : ""}
          </div>
        </div>
        <div class="empty-state">${escapeHtml(emptyMessage)}</div>
      </div>
    `;
  }

  return `
    <div class="panel accolades-panel" style="margin-top:20px;">
      <div class="section-head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
      </div>
      <div class="faltantes-ley-grid">
        ${safeRows.map((row) => {
          const sucursal = String(row.SUCURSAL || row.sucursal || "").trim();
          const municipio = String(row.MUNICIPIO || row.municipio || "").trim();
          const estado = String(row.ESTADO || row.estadoFaltantes || "").trim();
          const pendientesDetalle = String(row.PENDIENTES_DETALLE || row.pendientesDetalle || "").trim();
          const pendientes = pendientesDetalle
            ? pendientesDetalle.split(",").map((item) => String(item || "").trim()).filter(Boolean)
            : Object.entries(row)
                .filter(([key, value]) => /^Pendiente \d+$/i.test(key) && String(value || "").trim())
                .sort((a, b) => Number(a[0].split(" ")[1] || 0) - Number(b[0].split(" ")[1] || 0))
                .map(([, value]) => String(value || "").trim())
                .filter(Boolean);
          const capacitadoresRaw = String(row.CAPACITADORES || row.capacitadores || "").trim();
          const capacitadores = capacitadoresRaw
            ? capacitadoresRaw.split(",").map((item) => String(item || "").trim()).filter(Boolean)
            : [];
          const pendientesMarkup = pendientes.length
            ? pendientes.map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`).join("")
            : `<span class="calendar-empty">Sin pendientes</span>`;
          const capacitadoresMarkup = capacitadores.length
            ? capacitadores.map((item) => `<span class="tag-pill tag-pill-muted">${escapeHtml(item)}</span>`).join("")
            : `<span class="calendar-empty">Sin capacitadores</span>`;
          return `
            <details class="accordion-card faltantes-ley-card">
              <summary class="accordion-summary">
                <div class="accordion-summary-main">
                  <strong>${escapeHtml(sucursal || "Sin sucursal")}</strong>
                  <span>${escapeHtml(`${pendientes.length} pendiente${pendientes.length === 1 ? "" : "s"}`)}</span>
                </div>
                <div class="accordion-summary-meta">
                  <span class="status-chip is-finalizada">${escapeHtml(estado || "FALTANTES")}</span>
                  <span class="chip">${escapeHtml(municipio || "Sin municipio")}</span>
                  <span class="accordion-chevron">+</span>
                </div>
              </summary>
              <div class="accordion-body">
                <div class="detail-grid">
                  <div class="detail-block detail-block-wide">
                    <strong>Municipio</strong>
                    <span>${escapeHtml(municipio || "Sin municipio")}</span>
                  </div>
                  <div class="detail-block detail-block-wide">
                    <strong>Capacitadores</strong>
                    <div class="tag-row">${capacitadoresMarkup}</div>
                  </div>
                  <div class="detail-block detail-block-wide">
                    <strong>Documentación faltante</strong>
                    <div class="tag-row">${pendientesMarkup}</div>
                  </div>
                </div>
              </div>
            </details>
          `;
        }).join("\n")}
      </div>
    </div>
  `;
}

function renderFaltantesLeyLoadingPanel({
  title = "Faltantes Ley",
  description = "",
  emptyMessage = "No hay faltantes para este capacitador.",
  url = "",
} = {}) {
  return `
    <div class="panel accolades-panel" style="margin-top:20px;" data-faltantes-ley-shell data-faltantes-ley-url="${escapeAttr(url)}">
      <div class="section-head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
      </div>
      <div class="empty-state" data-faltantes-ley-placeholder>
        ${escapeHtml("Cargando faltantes...")}
      </div>
      <div class="empty-state" style="display:none;" data-faltantes-ley-empty>
        ${escapeHtml(emptyMessage)}
      </div>
    </div>
  `;
}

function renderCapacitacionesGrid(capacitaciones, options = {}) {
  if (!capacitaciones.length) {
    return `<div class="empty-state">${escapeHtml(options.emptyMessage || "No hay capacitaciones programadas.")}</div>`;
  }

  const items = capacitaciones.map((capacitacion) => {
    if (typeof options.hrefBuilder === "function") {
      return {
        ...capacitacion,
        href: options.hrefBuilder(capacitacion),
        linkLabel: options.linkLabel || "Crear constancias",
      };
    }
    if (typeof options.detailsHrefBuilder === "function") {
      return {
        ...capacitacion,
        detailsHref: options.detailsHrefBuilder(capacitacion),
        detailsLabel: options.detailsLabel || "Ver detalles",
      };
    }
    return capacitacion;
  });

  return `
    <div class="capacitacion-grid">
      ${items.map((capacitacion) => renderCapacitacionCard(capacitacion, options)).join("\n")}
    </div>
  `;
}

function renderCapacitacionesAccordion(capacitaciones, options = {}) {
  if (!capacitaciones.length) {
    return `<div class="empty-state">${escapeHtml(options.emptyMessage || "No hay capacitaciones programadas.")}</div>`;
  }

  const items = capacitaciones.map((capacitacion, index) => {
    const capacitadoresLabel = capacitacion.capacitadores?.length
      ? capacitacion.capacitadores.map((item) => item.nombre || item.key || "").filter(Boolean).join(" · ")
      : "PENDIENTE";
    const isOpen = index === 0;
    const constanciasUrl = typeof options.hrefBuilder === "function"
      ? options.hrefBuilder(capacitacion)
      : getCapacitacionConstanciasUrlFromCapacitacion(capacitacion);
    const hourLabel = getCapacitacionHoraLabel(capacitacion);
    const notes = String(capacitacion.notas || "").trim();

    return `
      <details class="accordion-card" ${isOpen ? "open" : ""}>
        <summary class="accordion-summary">
          <div class="accordion-summary-main">
            <span class="chip">${escapeHtml(capacitacion.dateLabel || "")}</span>
            <strong>${escapeHtml(capacitacion.cedeLabel || capacitacion.cede || "Capacitación")}</strong>
            <span>${escapeHtml(hourLabel)}</span>
          </div>
          <div class="accordion-summary-meta">
            <span class="status-chip ${capacitacion.statusSuffix === "FINALIZADA" ? "is-finalizada" : "is-programada"}">${escapeHtml(capacitacion.statusLabel || "Sin estado")}</span>
            <span class="accordion-chevron">+</span>
          </div>
        </summary>
        <div class="accordion-body">
          <div class="detail-grid">
            <div class="detail-block detail-block-wide">
              <strong>Capacitadores</strong>
              <span>${escapeHtml(capacitadoresLabel)}</span>
            </div>
            <div class="detail-block detail-block-wide">
              <strong>Sucursales a capacitar</strong>
              <div class="tag-row">
                ${(getCapacitacionSucursalesItems(capacitacion).map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`).join("")) || `<span class="calendar-empty">Sin sucursales</span>`}
              </div>
            </div>
            <div class="detail-block detail-block-wide">
              <strong>Notas</strong>
              ${options.canEditNotes ? `
                <form class="notes-form js-async-notes" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(capacitacion.rowId)}/notas">
                  <input type="hidden" name="returnTo" value="${escapeAttr(options.returnPath || "/dashboard")}" />
                  <textarea name="notas" rows="4" class="notes-textarea" placeholder="Escribe notas del evento...">${escapeHtml(notes)}</textarea>
                  <div class="notes-actions">
                    <button type="submit" class="status-button">Guardar notas</button>
                    <span class="notes-state">${notes ? "Notas guardadas" : "Sin notas"}</span>
                  </div>
                </form>
              ` : `<span>${escapeHtml(notes || "Sin notas")}</span>`}
            </div>
          </div>
          <div class="accordion-actions">
            <a class="button primary" href="${escapeAttr(constanciasUrl)}" target="_blank" rel="noopener noreferrer">Crear constancias</a>
          </div>
        </div>
      </details>
    `;
  });

  return `<div class="accordion-list">${items.join("")}</div>`;
}

function renderCapacitacionDetailsPanel(capacitacion, { returnPath = portalPath("/dashboard"), canEditStatus = false, canEditDiplomas = false } = {}) {
  if (!capacitacion) return "";

  const backHref = escapeAttr(returnPath || portalPath("/dashboard"));
  const statusClass = capacitacion.statusSuffix === "FINALIZADA" ? "is-finalizada" : "is-programada";
  const capacitadoresLabel = capacitacion.capacitadores?.length
    ? capacitacion.capacitadores.map((item) => escapeHtml(item.nombre || item.key || "")).join(" · ")
    : "PENDIENTE";
  const sedeLabel = capacitacion.cedeLabel || capacitacion.cede || "Sin sede";
  const sucursalesItems = getCapacitacionSucursalesItems(capacitacion);
  const showSucursales = sucursalesItems.length > 0;
  const notas = String(capacitacion.notas || "").trim();

  return `
    <div class="panel capacitacion-detail-panel">
      <div class="detail-hero">
        <div class="detail-hero-copy">
          <span class="detail-kicker">Capacitación seleccionada</span>
          <h2>${escapeHtml(sedeLabel)}</h2>
          <div class="detail-hero-meta">
            <span class="status-chip ${statusClass}">${escapeHtml(capacitacion.statusLabel || "Sin estado")}</span>
            <span class="chip">${escapeHtml(capacitacion.dateLabel || capacitacion.dateRaw || "")}</span>
            ${capacitacion.hasDiplomas ? `<span class="chip">Diplomas: Sí</span>` : `<span class="chip">Diplomas: No</span>`}
          </div>
        </div>
        <a class="button ghost" href="${backHref}">Volver</a>
      </div>
      <div class="detail-grid">
        <div class="detail-block detail-block-wide">
          <strong>Capacitadores</strong>
          <span>${capacitadoresLabel}</span>
        </div>
        ${showSucursales ? `
        <div class="detail-block detail-block-wide">
          <strong>Sucursales a capacitar</strong>
          <div class="tag-row">
            ${sucursalesItems.map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`).join("")}
          </div>
        </div>
        ` : ""}
        <div class="detail-block detail-block-wide">
          <strong>Notas</strong>
          <span>${escapeHtml(notas || "Sin notas")}</span>
        </div>
      </div>
      ${canEditStatus || canEditDiplomas ? `
        <div class="detail-actions-surface">
          ${canEditStatus ? `
            <form class="status-actions" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(capacitacion.rowId)}/status">
              <input type="hidden" name="returnTo" value="${backHref}" />
              <button type="submit" name="status" value="PROGRAMADA" class="status-button ${capacitacion.statusSuffix === "PROGRAMADA" ? "active" : ""}">Programada</button>
              <button type="submit" name="status" value="FINALIZADA" class="status-button ${capacitacion.statusSuffix === "FINALIZADA" ? "active" : ""}">Finalizada</button>
            </form>
          ` : ""}
          ${canEditDiplomas ? `
            <form class="status-actions js-async-diplomas" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(capacitacion.rowId)}/diplomas">
              <input type="hidden" name="returnTo" value="${backHref}" />
              <button type="submit" name="diplomas" value="Y" class="status-button ${capacitacion.hasDiplomas ? "active" : ""}">${capacitacion.hasDiplomas ? "Diplomas: Sí" : "Marcar diplomas: Sí"}</button>
            </form>
          ` : ""}
        </div>
      ` : ""}
    </div>
  `;
}
function getHomeStyles() {
  return `
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Montserrat:wght@400;500;600;700;800;900&family=Playfair+Display:ital,wght@1,600&family=Inter:wght@300;400;500;600;700;800;900&display=swap");
      :root {
        --bg: #f7fafc;
        --surface: rgba(255, 255, 255, 0.96);
        --surface-strong: #ffffff;
        --ink: #1a2a3a;
        --muted: #556170;
        --line: rgba(26, 42, 58, 0.12);
        --shadow: 0 24px 60px rgba(26, 42, 58, 0.10);
        --navy: #1a2a3a;
        --navy-soft: #eef3f8;
        --crimson: #c0392b;
        --crimson-soft: #fbe9e7;
        --gold: #d6a43a;
        --gold-soft: #fbf2d8;
        --blue: #1e3a8a;
        --blue-soft: #dbeafe;
        --emerald: #0f766e;
        --emerald-soft: #d1fae5;
        --amber: #b45309;
        --amber-soft: #fef3c7;
        --violet: #6d28d9;
        --violet-soft: #ede9fe;
        --rose: #be123c;
        --rose-soft: #ffe4e6;
        --teal: #0f766e;
        --teal-soft: #ccfbf1;
        --green: #166534;
        --green-soft: #dcfce7;
        --orange: #c2410c;
        --orange-soft: #ffedd5;
        --indigo: #4338ca;
        --indigo-soft: #e0e7ff;
        --slate: #475569;
        --slate-soft: #e2e8f0;
      }
      * { box-sizing: border-box; }
      html, body {
        overflow-x: hidden;
        -webkit-text-size-adjust: 100%;
      }
      body {
        margin: 0;
        font-family: "Inter", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(192, 57, 43, 0.10), transparent 22%),
          radial-gradient(circle at top right, rgba(26, 42, 58, 0.09), transparent 26%),
          linear-gradient(180deg, #f8fafc 0%, #f2f6fa 48%, #ecf1f6 100%);
      }
      a { color: inherit; }
      main {
        max-width: 1480px;
        margin: 0 auto;
        padding: 26px 18px 56px;
      }
      .dashboard-main {
        max-width: 1600px;
      }
      .dashboard-main .hero {
        padding: 18px clamp(16px, 2vw, 26px) 16px;
        border-radius: 32px;
      }
      .dashboard-main .hero-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        align-items: center;
      }
      .dashboard-main .hero-grid > div:first-child {
        display: none;
      }
      .dashboard-main .hero-side {
        width: 100%;
      }
      .dashboard-main .hero p {
        display: block;
        max-width: 34ch;
        margin-top: 10px;
        color: var(--muted);
        font-size: 0.96rem;
        line-height: 1.45;
      }
      .dashboard-main .hero-actions {
        display: none;
      }
      .dashboard-main .hero-side {
        display: block;
      }
      .dashboard-main .hero-side-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
      }
      .dashboard-main .hero-session-card {
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        min-height: auto;
        padding: 10px 12px;
        border-radius: 20px;
        border: 1px solid rgba(26,42,58,0.10);
        background:
          linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,249,251,0.94));
        box-shadow: 0 12px 26px rgba(26,42,58,0.06);
      }
      .dashboard-main .hero-brand-card {
        width: 112px;
        grid-template-columns: 1fr;
        justify-items: center;
        padding: 10px;
      }
      .dashboard-main .hero-brand-card .hero-session-media {
        width: 56px;
        min-width: 56px;
        height: 56px;
        border-radius: 16px;
      }
      .dashboard-main .hero-session-card--user {
        display: none;
      }
      .dashboard-main .hero-session-media {
        display: grid;
        place-items: center;
        width: 64px;
        min-width: 64px;
        height: 64px;
        border-radius: 16px;
        background:
          radial-gradient(circle at 30% 30%, rgba(192,57,43,0.10), transparent 42%),
          linear-gradient(180deg, rgba(255,255,255,0.96), rgba(246,249,253,0.92));
        border: 1px solid rgba(26,42,58,0.08);
        overflow: hidden;
      }
      .dashboard-main .hero-logo-button {
        appearance: none;
        border: 0;
        background: transparent;
        padding: 0;
        cursor: pointer;
      }
      .dashboard-main .hero-logo-button:focus-visible {
        outline: 3px solid rgba(192,57,43,0.28);
        outline-offset: 4px;
      }
      .dashboard-main .hero-logo {
        width: 46px;
        height: 46px;
        object-fit: contain;
      }
      .dashboard-main .hero-session-body {
        display: grid;
        gap: 5px;
        align-content: start;
      }
      .dashboard-main .hero-session-body--user {
        gap: 4px;
      }
      .dashboard-main .hero-session-body h2 {
        margin: 0;
        font-size: clamp(1rem, 1.8vw, 1.3rem);
        line-height: 1.02;
        text-transform: uppercase;
      }
      .dashboard-main .hero-session-body p {
        display: block;
        margin: 0;
        color: var(--muted);
        line-height: 1.35;
      }
      .dashboard-main .hero-session-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 0;
      }
      .dashboard-main .hero-brand-card {
        grid-template-columns: 1fr;
      }
      .dashboard-main .hero-header-copy {
        display: grid;
        gap: 4px;
        align-content: center;
        align-self: center;
        padding: 0 4px;
      }
      .dashboard-main .hero-header-copy strong {
        color: var(--ink);
        font-size: clamp(1.15rem, 2vw, 1.55rem);
        line-height: 0.98;
        text-transform: uppercase;
        letter-spacing: -0.03em;
      }
      .dashboard-main .hero-header-copy p {
        margin: 0;
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
        font-size: 0.82rem;
        line-height: 1.2;
      }
      .dashboard-main .hero-header-copy .eyebrow {
        width: fit-content;
      }
      .dashboard-main .hero-session-inline {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        justify-self: end;
        width: 100%;
        min-width: 0;
      }
      .dashboard-main .hero-session-inline__meta {
        display: grid;
        gap: 3px;
        justify-items: end;
        min-width: 0;
      }
      .dashboard-main .hero-session-inline__meta strong {
        color: var(--ink);
        font-size: 1.02rem;
        line-height: 1.1;
        text-transform: uppercase;
      }
      .dashboard-main .hero-session-inline__meta p {
        margin: 0;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.2;
        text-align: right;
      }
      .dashboard-main .hero-session-inline__actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dashboard-main .hero-session-inline__actions .button.secondary {
        background: rgba(255,255,255,0.92);
        border-color: rgba(26,42,58,0.12);
      }
      .dashboard-main .hero-session-meta,
      .dashboard-main .hero-quick-actions,
      .dashboard-main .hero-role-card,
      .dashboard-main .hero-menu-toggle {
        display: none;
      }
      .dashboard-main .hero h1 {
        max-width: 11ch;
        font-size: clamp(2.6rem, 5vw, 4.25rem);
        line-height: 0.94;
        letter-spacing: -0.04em;
      }
      .dashboard-main .hero {
        padding: 16px 16px 12px;
        overflow: hidden;
      }
      .dashboard-main .hero::after {
        inset: auto -3% -34% auto;
        width: 220px;
        height: 220px;
      }
      .dashboard-main .hero::after {
        pointer-events: none;
      }
      .dashboard-main .hero-session-card {
        animation: dashboardHeroRise 520ms ease both;
      }
      @keyframes dashboardHeroRise {
        from {
          opacity: 0;
          transform: translateY(12px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .hero {
        overflow: hidden;
        position: relative;
        border-radius: 28px;
        background: linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
        color: var(--ink);
        padding: 20px 22px;
        box-shadow: var(--shadow);
        border: 1px solid rgba(26, 42, 58, 0.10);
        border-top: 4px solid var(--crimson);
      }
      .hero::after {
        content: "";
        position: absolute;
        inset: auto -4% -42% auto;
        width: 280px;
        height: 280px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(192, 57, 43, 0.12), transparent 70%);
        pointer-events: none;
      }
      .hero-grid {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 1.55fr) minmax(240px, 0.55fr);
        gap: 16px;
        align-items: center;
      }
      .eyebrow {
        display: inline-flex;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(192, 57, 43, 0.10);
        color: var(--crimson);
        font-size: 0.76rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        font-family: "Montserrat", sans-serif;
      }
      h1 {
        margin: 10px 0 0;
        font-size: clamp(1.8rem, 3.8vw, 3rem);
        line-height: 0.98;
        letter-spacing: -0.03em;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
      }
      .hero p {
        margin: 10px 0 0;
        max-width: 760px;
        color: var(--muted);
        line-height: 1.45;
        font-family: "Montserrat", sans-serif;
      }
      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
      }
      .button {
        appearance: none;
        border: 0;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 11px 16px;
        border-radius: 999px;
        font-weight: 800;
        font-size: 0.95rem;
        transition: transform 180ms ease, background 180ms ease, color 180ms ease;
        font-family: "Montserrat", sans-serif;
      }
      .button:hover { transform: translateY(-1px); }
      .button.primary { background: var(--navy); color: #ffffff; box-shadow: 0 10px 24px rgba(26,42,58,0.16); }
      .button.ghost {
        background: #ffffff;
        color: var(--navy);
        border: 1px solid rgba(26,42,58,0.14);
      }
      .hero-side {
        display: grid;
        gap: 10px;
      }
      .hero-callout, .hero-note {
        border-radius: 20px;
        padding: 14px 16px;
        background: #ffffff;
        border: 1px solid rgba(26,42,58,0.10);
        box-shadow: 0 10px 24px rgba(26,42,58,0.05);
      }
      .hero-logo {
        display: block;
        max-width: 120px;
        width: min(120px, 34vw);
        height: auto;
        margin: 0;
        object-fit: contain;
        filter: drop-shadow(0 12px 24px rgba(0,0,0,0.16));
      }
      .hero-callout {
        display: grid;
        gap: 10px;
      }
      .hero-callout-compact {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 12px;
        align-items: center;
      }
      .hero-callout h2, .section-head h2 {
        margin: 0;
        letter-spacing: -0.03em;
        font-family: "Cinzel", serif;
      }
      .hero-callout h2 {
        font-size: clamp(1.05rem, 2vw, 1.35rem);
      }
      .hero-callout p, .hero-note p {
        margin: 6px 0 0;
        color: var(--muted);
        line-height: 1.4;
        font-family: "Montserrat", sans-serif;
      }
      .hero-note strong {
        display: block;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--crimson);
        font-family: "Montserrat", sans-serif;
      }
      .hero-note p {
        margin-top: 6px;
        font-size: 0.88rem;
        word-break: break-word;
      }
      .portal-group {
        margin-top: 28px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 14px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .section-head h2 {
        font-size: clamp(1.25rem, 2.2vw, 1.7rem);
        text-transform: uppercase;
      }
      .section-head p {
        margin: 8px 0 0;
        color: var(--muted);
        line-height: 1.5;
        max-width: 840px;
        font-family: "Montserrat", sans-serif;
      }
      .portal-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 16px;
      }
      .card, .employee-card {
        display: flex;
        flex-direction: column;
        gap: 0;
        min-height: 210px;
        padding: 18px;
        border-radius: 24px;
        border: 1px solid var(--line);
        border-top: 5px solid var(--card-accent, var(--navy));
        background: linear-gradient(180deg, var(--card-soft, var(--navy-soft)), var(--surface-strong));
        text-decoration: none;
        box-shadow: var(--shadow);
        transition: transform 180ms ease, box-shadow 180ms ease;
        content-visibility: auto;
        contain-intrinsic-size: 280px;
      }
      .card:hover, .employee-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 26px 76px rgba(20, 32, 43, 0.12);
      }
      .card-top, .employee-head {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 12px;
      }
      .card-top { margin-bottom: 14px; }
      .chip, .badge, .employee-role {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: rgba(255,255,255,0.90);
        color: var(--ink);
        border: 1px solid rgba(26,42,58,0.08);
        font-family: "Montserrat", sans-serif;
      }
      .employee-role { background: rgba(192,57,43,0.08); color: var(--crimson); }
      .card h3 {
        margin: 0;
        font-size: 1.18rem;
        letter-spacing: -0.02em;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
      }
      .card p {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.5;
        flex: 1;
        font-family: "Montserrat", sans-serif;
      }
      .card-link, .employee-link {
        margin-top: 18px;
        font-weight: 800;
        color: var(--card-accent, var(--status));
        font-family: "Montserrat", sans-serif;
      }
      .tone-status { --card-accent: var(--navy); --card-soft: var(--navy-soft); }
      .tone-emerald { --card-accent: var(--emerald); --card-soft: var(--emerald-soft); }
      .tone-amber { --card-accent: var(--amber); --card-soft: var(--amber-soft); }
      .tone-blue { --card-accent: var(--blue); --card-soft: var(--blue-soft); }
      .tone-violet { --card-accent: var(--violet); --card-soft: var(--violet-soft); }
      .tone-rose { --card-accent: var(--rose); --card-soft: var(--rose-soft); }
      .tone-teal { --card-accent: var(--teal); --card-soft: var(--teal-soft); }
      .tone-green { --card-accent: var(--green); --card-soft: var(--green-soft); }
      .tone-orange { --card-accent: var(--orange); --card-soft: var(--orange-soft); }
      .tone-indigo { --card-accent: var(--indigo); --card-soft: var(--indigo-soft); }
      .tone-slate { --card-accent: var(--slate); --card-soft: var(--slate-soft); }
      .dashboard-tabs {
        margin-top: 18px;
        display: grid;
        gap: 18px;
      }
      .dashboard-shell {
        position: relative;
        display: grid;
        gap: 14px;
        margin-top: 10px;
      }
      .dashboard-fab {
        display: none;
        position: fixed;
        left: 14px;
        top: auto;
        right: auto;
        bottom: 14px;
        z-index: 26;
        min-height: 48px;
        padding-inline: 16px;
        border-radius: 999px;
        box-shadow: 0 16px 34px rgba(26,42,58,0.18);
      }
      .dashboard-mobile-dock {
        display: none;
      }
      .dashboard-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      .dashboard-sidebar {
        display: none;
      }
      .dashboard-content {
        min-width: 0;
      }
      .dashboard-sidebar__content {
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        min-height: 100%;
      }
      .dashboard-sidebar__header {
        display: grid;
        gap: 4px;
        padding: 20px 18px 16px;
        border-bottom: 1px solid rgba(26,42,58,0.08);
      }
      .dashboard-sidebar__user-card {
        display: grid;
        grid-template-columns: 68px minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        margin: 14px 14px 0;
        padding: 14px;
        border-radius: 20px;
        border: 1px solid rgba(26,42,58,0.10);
        background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,249,251,0.94));
        box-shadow: 0 14px 28px rgba(26,42,58,0.06);
      }
      .dashboard-sidebar__user-media {
        display: grid;
        place-items: center;
        width: 68px;
        height: 68px;
        border-radius: 18px;
        border: 1px solid rgba(26,42,58,0.08);
        background:
          radial-gradient(circle at 30% 30%, rgba(192,57,43,0.10), transparent 42%),
          linear-gradient(180deg, rgba(255,255,255,0.98), rgba(246,249,253,0.92));
      }
      .dashboard-sidebar__user-logo {
        width: 52px;
        height: 52px;
        object-fit: contain;
      }
      .dashboard-sidebar__user-body {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .dashboard-sidebar__user-body strong {
        color: var(--ink);
        font-size: 0.98rem;
        line-height: 1.15;
        text-transform: uppercase;
      }
      .dashboard-sidebar__user-body p {
        margin: 0;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dashboard-sidebar__user-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .dashboard-sidebar__user-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 4px;
      }
      .dashboard-sidebar__groups {
        display: grid;
        gap: 14px;
        padding: 6px 14px 18px;
        min-height: 0;
        overflow-y: auto;
      }
      .dashboard-nav-group {
        display: grid;
        gap: 8px;
      }
      .dashboard-nav-group h2 {
        padding-inline: 8px;
        color: var(--muted);
        font-family: var(--portal-font-ui);
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
      }
      .dashboard-nav-group__links {
        display: grid;
        gap: 6px;
      }
      .dashboard-nav-link {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 46px;
        padding: 0 14px;
        border-radius: 14px;
        border: 1px solid transparent;
        background: rgba(255,255,255,0.78);
        color: var(--ink);
        font-family: var(--portal-font-ui);
        font-weight: 850;
        text-decoration: none;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
      }
      .dashboard-nav-link:hover {
        transform: translateX(2px);
        border-color: rgba(26,42,58,0.10);
        background: rgba(255,255,255,0.96);
        box-shadow: 0 10px 22px rgba(26,42,58,0.08);
      }
      .dashboard-nav-link.active {
        color: #fff;
        border-color: rgba(192,57,43,0.24);
        background: linear-gradient(135deg, #18293e, #263a52);
        box-shadow: 0 14px 30px rgba(24,41,62,0.18);
      }
      .dashboard-nav-link__leading {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .dashboard-nav-link__icon {
        width: 1.35rem;
        flex: 0 0 auto;
        text-align: center;
      }
      .dashboard-nav-link__label {
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dashboard-nav-link__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 30px;
        height: 30px;
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(192,57,43,0.10);
        color: var(--crimson);
        font-size: 0.74rem;
        font-weight: 900;
      }
      .dashboard-nav-link.active .dashboard-nav-link__count {
        background: rgba(255,255,255,0.16);
        color: #fff;
      }
      .dashboard-nav-link--compact {
        justify-content: flex-start;
      }
      .dashboard-nav-link--drawer {
        min-height: 50px;
      }
      .dashboard-sidebar__footer {
        display: grid;
        gap: 10px;
        padding: 16px 14px 18px;
        border-top: 1px solid rgba(26,42,58,0.08);
      }
      .dashboard-sidebar__action {
        width: 100%;
      }
      .dashboard-drawer {
        position: fixed;
        inset: 0;
        z-index: 120;
        opacity: 0;
        pointer-events: none;
        transition: opacity 220ms ease;
      }
      .dashboard-drawer.is-open {
        opacity: 1;
        pointer-events: auto;
      }
      .dashboard-drawer__backdrop {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        background: rgba(8,20,46,0.34);
        backdrop-filter: blur(6px);
        opacity: 0;
        transition: opacity 220ms ease;
      }
      .dashboard-drawer.is-open .dashboard-drawer__backdrop {
        opacity: 1;
      }
      .dashboard-drawer__panel {
        position: absolute;
        inset: 10px auto 10px 10px;
        width: min(360px, calc(100vw - 20px));
        height: calc(100dvh - 20px);
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        overflow: hidden;
        border-radius: 24px;
        border: 1px solid rgba(26,42,58,0.12);
        background: rgba(255,255,255,0.88);
        backdrop-filter: blur(24px);
        box-shadow: 0 28px 80px rgba(0, 31, 84, 0.24);
        transform: translateX(-18px) scale(0.94);
        transform-origin: top left;
        opacity: 0;
        will-change: transform, opacity;
        transition: transform 220ms ease, opacity 220ms ease, background 220ms ease;
      }
      .dashboard-drawer.is-open .dashboard-drawer__panel {
        transform: translateX(0) scale(1);
        opacity: 1;
        background: rgba(255,255,255,0.95);
      }
      .dashboard-drawer__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 14px;
        border-bottom: 1px solid rgba(26,42,58,0.08);
      }
      .dashboard-drawer__top strong {
        color: var(--ink);
        font-family: var(--portal-font-ui);
        font-weight: 900;
        text-transform: uppercase;
      }
      .dashboard-drawer__panel .dashboard-sidebar__content {
        min-height: 0;
      }
      .dashboard-drawer__panel .dashboard-sidebar__groups {
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }
      .dashboard-tabs-nav {
        display: none;
      }
      .dashboard-mobile-bar {
        display: none;
      }
      .dashboard-mobile-chip {
        display: none;
      }
      .dashboard-tabs-nav::-webkit-scrollbar {
        display: none;
      }
      .dashboard-tab-btn {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 12px 18px;
        border-radius: 999px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--muted);
        font-weight: 800;
        font-size: 0.86rem;
        letter-spacing: 0.02em;
        font-family: "Montserrat", sans-serif;
        cursor: pointer;
        transition: transform 180ms ease, background 180ms ease, color 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
      }
      .dashboard-tab-btn:hover {
        transform: translateY(-1px);
      }
      .dashboard-tab-btn.active {
        background: linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
        color: var(--crimson);
        border-color: rgba(198, 59, 34, 0.14);
        box-shadow: 0 8px 18px rgba(26,42,58,0.09);
      }
      .dashboard-tab-label {
        white-space: nowrap;
      }
      .dashboard-tab-count {
        min-width: 1.9rem;
        height: 1.9rem;
        padding: 0 0.45rem;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(198, 59, 34, 0.10);
        color: var(--crimson);
        font-size: 0.78rem;
        font-weight: 900;
      }
      .dashboard-tab-btn.active .dashboard-tab-count {
        background: rgba(198, 59, 34, 0.14);
      }
      .dashboard-tab-panel {
        display: block;
      }
      .dashboard-tab-panel[hidden] {
        display: none !important;
      }
      .dashboard-tab-panel {
        display: block;
      }
      .dashboard-tab-panel-content {
        display: grid;
        gap: 18px;
      }
      .dashboard-route-families {
        display: grid;
        gap: 20px;
      }
      .dashboard-route-family {
        display: grid;
        gap: 14px;
      }
      .dashboard-route-family-head {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        justify-content: space-between;
        gap: 10px;
      }
      .dashboard-route-family-head h3 {
        margin: 0;
        font-size: 1rem;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
      }
      .dashboard-route-family-head p {
        margin: 0;
        color: var(--muted);
        line-height: 1.45;
        font-family: "Montserrat", sans-serif;
      }
      .dashboard-route-family--secondary .portal-grid {
        gap: 14px;
      }
      .dashboard-route-family--secondary .card {
        min-height: 176px;
      }
      .dashboard-tab-panel--management .panel + .panel {
        margin-top: 0;
      }
      @media (max-width: 1020px) {
        .dashboard-content {
          min-width: 0;
        }
      }
      @media (max-width: 560px) {
        .dashboard-shell {
          gap: 14px;
        }
        .dashboard-fab {
          display: none;
        }
        .dashboard-drawer__panel {
          inset: 8px auto 8px 8px;
          width: min(360px, calc(100vw - 16px));
        }
      }
      @media (min-width: 561px) {
        .dashboard-fab {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 44px;
          padding-inline: 14px;
        }
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 28px;
        padding: 22px;
        box-shadow: var(--shadow);
        border-top: 5px solid var(--crimson);
        content-visibility: auto;
        contain-intrinsic-size: 760px;
      }
      .panel h2 {
        margin: 0;
        font-size: 1.25rem;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
      }
      .panel p {
        color: var(--muted);
        line-height: 1.55;
        font-family: "Montserrat", sans-serif;
      }
      .pedidos-native {
        display: grid;
        gap: 16px;
        position: relative;
        overflow: hidden;
      }
      .pedidos-native::before {
        content: "";
        position: absolute;
        inset: -90px -120px auto auto;
        width: 280px;
        height: 280px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(29,78,216,0.08), transparent 68%);
        pointer-events: none;
      }
      .pedidos-native::after {
        content: "";
        position: absolute;
        inset: auto auto -120px -120px;
        width: 340px;
        height: 340px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(192,57,43,0.08), transparent 70%);
        pointer-events: none;
      }
      .pedidos-native .summary-grid {
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
      .pedidos-native .summary-card {
        position: relative;
        overflow: hidden;
        min-height: 104px;
        padding: 14px;
        border-radius: 18px;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,250,252,0.96)),
          var(--card-soft, rgba(255,255,255,1));
        border: 1px solid rgba(26,42,58,0.10);
        box-shadow: 0 12px 28px rgba(26,42,58,0.08);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .pedidos-native .summary-card::before {
        content: "";
        position: absolute;
        inset: 0 auto auto 0;
        width: 100%;
        height: 5px;
        background: var(--summary-accent, rgba(26,42,58,0.14));
      }
      .pedidos-native .summary-card[data-tone="blue"] {
        --summary-accent: linear-gradient(90deg, #1d4ed8, #0f766e);
      }
      .pedidos-native .summary-card[data-tone="fail"] {
        --summary-accent: linear-gradient(90deg, #be123c, #ef4444);
      }
      .pedidos-native .summary-card[data-tone="warn"] {
        --summary-accent: linear-gradient(90deg, #b45309, #f59e0b);
      }
      .pedidos-native .summary-card[data-tone="ok"] {
        --summary-accent: linear-gradient(90deg, #166534, #10b981);
      }
      .pedidos-native .summary-card .eyebrow {
        position: relative;
        z-index: 1;
        margin-bottom: 8px;
        color: var(--muted);
        font: 900 0.66rem/1 "Montserrat", sans-serif;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .pedidos-native .summary-card .value {
        position: relative;
        z-index: 1;
        font-size: clamp(1.75rem, 2.3vw, 2.2rem);
        line-height: 0.92;
        letter-spacing: -0.04em;
        font-family: "Cinzel", serif;
      }
      .pedidos-native .summary-card .detail {
        position: relative;
        z-index: 1;
        margin-top: 8px;
        color: var(--muted);
        line-height: 1.3;
        font-size: 0.80rem;
      }
      .pedidos-summary-panels {
        display: grid;
        gap: 12px;
      }
      .pedidos-summary-panel {
        display: grid;
        gap: 12px;
      }
      .pedidos-summary-panel[hidden] {
        display: none !important;
      }
      .pedidos-summary-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .pedidos-summary-head h3 {
        margin: 0;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: -0.03em;
        font-size: 1.05rem;
      }
      .pedidos-summary-head p {
        margin: 4px 0 0;
        color: var(--muted);
        line-height: 1.35;
      }
      .pedidos-summary-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pedidos-summary-chips .pill {
        background: rgba(255,255,255,0.78);
      }
      .pedidos-context {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 20px;
        border: 1px solid rgba(26,42,58,0.08);
        background: linear-gradient(180deg, rgba(247,250,252,0.92), rgba(255,255,255,0.92));
      }
      .pedidos-context-copy {
        display: grid;
        gap: 4px;
        max-width: 560px;
      }
      .pedidos-context-copy strong {
        font: 900 0.8rem/1 "Montserrat", sans-serif;
        letter-spacing: 0.10em;
        text-transform: uppercase;
        color: var(--ink);
      }
      .pedidos-context-copy span {
        color: var(--muted);
        line-height: 1.45;
      }
      .pedidos-context-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pedidos-native-shell {
        display: grid;
        gap: 16px;
        position: relative;
        z-index: 1;
      }
      .pedidos-native-shell--embedded {
        gap: 12px;
      }
      .pedidos-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-start;
        gap: 14px;
        padding: 2px 0 0;
      }
      .pedidos-header--compact {
        align-items: center;
      }
      .pedidos-native--embedded .pedidos-surface {
        padding: 14px;
        border-radius: 24px;
      }
      .pedidos-native--embedded .pedidos-header {
        gap: 10px;
      }
      .pedidos-header h2 {
        margin: 0;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: -0.03em;
        font-size: clamp(1.25rem, 2vw, 1.75rem);
        color: var(--ink);
      }
      .pedidos-header p {
        margin: 8px 0 0;
        max-width: 860px;
        font-size: 0.95rem;
        line-height: 1.5;
      }
      .pedidos-surface {
        background:
          linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96)),
          var(--surface);
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 30px;
        box-shadow: 0 26px 64px rgba(26,42,58,0.10);
        padding: 18px;
        backdrop-filter: blur(16px);
      }
      .pedidos-toolbar {
        display: grid;
        gap: 12px;
        margin-top: 14px;
      }
      .pedidos-filter-group {
        display: grid;
        gap: 8px;
      }
      .pedidos-toolbar-label {
        font: 900 0.68rem/1 "Montserrat", sans-serif;
        letter-spacing: 0.13em;
        text-transform: uppercase;
        color: var(--muted);
        padding-left: 2px;
      }
      .pedidos-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pedidos-tab-btn {
        appearance: none;
        border: 1px solid rgba(26,42,58,0.10);
        background: rgba(247,250,252,0.86);
        color: #4b5563;
        border-radius: 999px;
        padding: 11px 15px;
        font: 800 0.82rem/1 "Montserrat", sans-serif;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease, color 180ms ease, border-color 180ms ease;
      }
      .pedidos-tab-btn:hover {
        transform: translateY(-1px);
        border-color: rgba(29,78,216,0.18);
      }
      .pedidos-tab-btn.is-active {
        background: linear-gradient(135deg, var(--ink), #1d4ed8);
        color: #fff;
        box-shadow: 0 12px 26px rgba(15,23,42,0.18);
        border-color: transparent;
      }
      .pedidos-advanced {
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 22px;
        background: linear-gradient(180deg, rgba(247,250,252,0.92), rgba(241,245,249,0.88));
        overflow: hidden;
      }
      .pedidos-view {
        display: grid;
        gap: 16px;
        margin-top: 18px;
      }
      .pedidos-view[hidden] {
        display: none !important;
      }
      .pedidos-view-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .pedidos-view-header h3 {
        margin: 0;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: -0.03em;
        font-size: 1.05rem;
      }
      .pedidos-view-header p {
        margin: 6px 0 0;
        color: var(--muted);
        line-height: 1.45;
      }
      .pedidos-coverage-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pedidos-advanced > summary {
        list-style: none;
        cursor: pointer;
        padding: 14px 18px;
        font-weight: 900;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .pedidos-advanced > summary::-webkit-details-marker {
        display: none;
      }
      .pedidos-advanced > summary::after {
        content: "Mostrar filtros";
        color: var(--muted);
        font-size: 0.70rem;
        text-transform: uppercase;
        letter-spacing: 0.10em;
      }
      .pedidos-advanced[open] > summary::after {
        content: "Ocultar filtros";
      }
      .pedidos-advanced-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 12px;
        padding: 0 18px 18px;
      }
      .pedidos-field {
        display: grid;
        gap: 7px;
      }
      .pedidos-field label {
        font-size: 0.68rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.11em;
        color: var(--muted);
      }
      .pedidos-field input {
        width: 100%;
        border: 1px solid rgba(26,42,58,0.12);
        border-radius: 16px;
        background: rgba(255,255,255,0.96);
        padding: 12px 13px;
        font: inherit;
        color: var(--ink);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.65);
      }
      .pedidos-field input:focus {
        outline: none;
        border-color: rgba(29,78,216,0.42);
        box-shadow: 0 0 0 3px rgba(29,78,216,0.10);
      }
      .pedidos-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: end;
        justify-content: flex-end;
      }
      .pedidos-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        color: var(--muted);
        font: 800 0.78rem/1.4 "Montserrat", sans-serif;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .pedidos-stats .pill {
        background: rgba(255,255,255,0.94);
      }
      .pedidos-table-shell {
        padding: 0;
        overflow: auto;
        border-radius: 22px;
        border: 1px solid rgba(26,42,58,0.08);
        background: rgba(255,255,255,0.98);
      }
      .pedidos-table-shell table {
        min-width: 1200px;
        border-collapse: separate;
        border-spacing: 0;
      }
      .pedidos-table-shell thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: linear-gradient(180deg, #f8fbff, #eef3f8);
        color: #334155;
        border-bottom: 1px solid rgba(26,42,58,0.10);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.74rem;
        padding-top: 16px;
        padding-bottom: 16px;
      }
      .pedidos-table-shell tbody tr {
        transition: background 160ms ease, transform 160ms ease;
      }
      .pedidos-table-shell tbody tr:nth-child(even) {
        background: rgba(248,250,252,0.7);
      }
      .pedidos-table-shell tbody tr:hover {
        background: rgba(239,246,255,0.75);
      }
      .pedidos-row[hidden] {
        display: none !important;
      }
      .pedidos-native .chip {
        background: rgba(255,255,255,0.96);
        border-color: rgba(26,42,58,0.10);
        box-shadow: 0 4px 12px rgba(26,42,58,0.06);
        letter-spacing: 0.06em;
      }
      .pedidos-coverage {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 18px;
        margin-top: 10px;
      }
      .pedidos-coverage-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 14px;
        flex-wrap: wrap;
      }
      .pedidos-coverage-head h3 {
        margin: 0;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: -0.02em;
        font-size: clamp(1.05rem, 1.8vw, 1.35rem);
      }
      .pedidos-coverage-head p {
        margin: 8px 0 0;
        max-width: 980px;
        color: var(--muted);
        line-height: 1.5;
      }
      .pedidos-coverage-tabs {
        margin-left: auto;
        justify-content: flex-end;
      }
      .pedidos-coverage-panels {
        display: grid;
        gap: 16px;
      }
      .pedidos-coverage-panel {
        display: grid;
      }
      .pedidos-coverage-panel[hidden] {
        display: none !important;
      }
      .pedidos-coverage-card {
        background:
          linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96)),
          var(--surface);
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 28px;
        padding: 18px;
        box-shadow: 0 20px 48px rgba(26,42,58,0.08);
      }
      .pedidos-coverage-card h4 {
        margin: 0;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: -0.02em;
      }
      .pedidos-coverage-card .coverage-meta {
        margin-top: 8px;
        color: var(--muted);
        line-height: 1.45;
      }
      .pedidos-coverage-card .summary-grid {
        margin-top: 14px;
      }
      .pedidos-coverage-section {
        margin-top: 12px;
      }
      .pedidos-coverage-subtitle {
        margin: 18px 0 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--ink);
        font: 900 0.82rem/1 "Montserrat", sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .pedidos-coverage-subtitle::before {
        content: "";
        width: 28px;
        height: 1px;
        background: rgba(26,42,58,0.22);
      }
      .pedidos-coverage-table {
        margin-top: 8px;
        border-radius: 18px;
      }
      .pedidos-coverage-table .table-shell {
        border-radius: 18px;
      }
      .pedidos-coverage-table table {
        min-width: 1080px;
      }
      .pedidos-coverage-empty {
        padding: 18px;
        color: var(--muted);
        border: 1px dashed rgba(26,42,58,0.18);
        border-radius: 18px;
        background: rgba(248,250,252,0.72);
      }
      .pedidos-coverage-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(29,78,216,0.08);
        color: var(--ink);
        font: 900 0.7rem/1 "Montserrat", sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .calendar-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 26px;
        background:
          radial-gradient(circle at top right, rgba(192,57,43,0.06), transparent 34%),
          radial-gradient(circle at left bottom, rgba(26,42,58,0.04), transparent 30%),
          linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94));
      }
      .calendar-split {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(250px, 0.32fr);
        gap: 16px;
        align-items: start;
      }
      .calendar-header {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 14px;
        flex-wrap: wrap;
      }
      .calendar-header h2 {
        margin: 0;
        font-size: 1.34rem;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
      }
      .calendar-header p {
        margin: 8px 0 0;
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
        font-size: 0.9rem;
      }
      .calendar-frame-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        gap: 10px;
      }
      .calendar-switch {
        display: inline-flex;
        gap: 8px;
        padding: 6px;
        border-radius: 999px;
        background: var(--navy-soft);
        border: 1px solid rgba(26,42,58,0.10);
      }
      .calendar-switch-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 9px 14px;
        border-radius: 999px;
        text-decoration: none;
        font-weight: 800;
        font-size: 0.84rem;
        font-family: "Montserrat", sans-serif;
        color: var(--muted);
        background: transparent;
        transition: background 180ms ease, color 180ms ease, transform 180ms ease;
      }
      .calendar-switch-btn:hover {
        transform: translateY(-1px);
      }
      .calendar-switch-btn.active {
        background: #fff;
        color: var(--crimson);
        box-shadow: 0 8px 18px rgba(26,42,58,0.08);
      }
      .calendar-summary {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .calendar-metric {
        display: grid;
        gap: 4px;
        min-height: 74px;
        padding: 14px 16px;
        border-radius: 20px;
        background: rgba(255,255,255,0.84);
        border: 1px solid rgba(26,42,58,0.08);
        box-shadow: 0 8px 22px rgba(26,42,58,0.05);
      }
      .calendar-metric span {
        color: var(--muted);
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-family: "Montserrat", sans-serif;
        font-weight: 900;
      }
      .calendar-metric strong {
        color: var(--ink);
        font-size: 1.28rem;
        line-height: 1;
        font-family: "Cinzel", serif;
      }
      .calendar-metric--accent {
        background: linear-gradient(135deg, rgba(192,57,43,0.10), rgba(255,255,255,0.92));
        border-color: rgba(192,57,43,0.14);
      }
      .calendar-metric--accent strong {
        color: var(--crimson);
      }
      .calendar-metric--soft {
        background: linear-gradient(135deg, rgba(26,42,58,0.06), rgba(255,255,255,0.92));
      }
      .calendar-metric--gold {
        background: linear-gradient(135deg, rgba(214,164,58,0.12), rgba(255,255,255,0.92));
      }
      .calendar-metric--teal {
        background: linear-gradient(135deg, rgba(20,184,166,0.12), rgba(255,255,255,0.92));
      }
      .calendar-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-top: 12px;
        padding: 10px;
        border-radius: 18px;
        border: 1px solid rgba(26,42,58,0.08);
        background: rgba(255,255,255,0.74);
        backdrop-filter: blur(12px);
      }
      .calendar-legend-label {
        font-family: "Montserrat", sans-serif;
        font-size: 0.74rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .calendar-legend-items {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .calendar-filter-pill,
      .calendar-filter-clear {
        border: 0;
        cursor: pointer;
        transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
      }
      .calendar-filter-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: "Montserrat", sans-serif;
        font-size: 0.72rem;
        font-weight: 800;
        text-shadow: 0 1px 0 rgba(0,0,0,0.12);
      }
      .calendar-filter-pill-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.24);
        flex: 0 0 auto;
      }
      .calendar-filter-pill:hover,
      .calendar-filter-clear:hover {
        transform: translateY(-1px);
      }
      .calendar-filter-pill.is-active,
      .calendar-filter-clear.is-active {
        box-shadow: 0 0 0 3px rgba(26,42,58,0.12), 0 12px 22px rgba(26,42,58,0.18);
        opacity: 1;
      }
      .calendar-filter-clear {
        background: var(--navy-soft);
        color: var(--ink);
        border: 1px solid rgba(26,42,58,0.10);
        font-family: "Montserrat", sans-serif;
        font-size: 0.72rem;
        font-weight: 800;
        padding: 6px 10px;
        border-radius: 999px;
      }
      .calendar-filter-clear.is-active {
        background: rgba(192,57,43,0.10);
        color: var(--crimson);
        border-color: rgba(192,57,43,0.22);
      }
      .calendar-sidebar {
        display: grid;
        gap: 12px;
      }
      .calendar-sidebar-card {
        display: grid;
        gap: 10px;
        padding: 14px;
        border-radius: 22px;
        border: 1px solid rgba(26,42,58,0.08);
        background: rgba(255,255,255,0.78);
        box-shadow: 0 14px 28px rgba(26,42,58,0.06);
      }
      .calendar-sidebar-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .calendar-frame {
        border-radius: 28px;
        border: 1px solid rgba(26,42,58,0.08);
        background: rgba(255,255,255,0.72);
        backdrop-filter: blur(14px);
        padding: 16px;
        overflow: hidden;
        box-shadow: 0 18px 34px rgba(26,42,58,0.08);
      }
      .calendar-frame-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        padding: 0 2px 10px;
        border-bottom: 1px solid rgba(26,42,58,0.08);
      }
      .calendar-frame-label {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(26,42,58,0.06);
        color: var(--ink);
        font-family: "Montserrat", sans-serif;
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .calendar-frame-caption {
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
        font-size: 0.82rem;
      }
      .dashboard-calendar {
        min-height: 640px;
      }
      .calendar-hint {
        color: var(--muted);
        font-size: 0.86rem;
        font-family: "Montserrat", sans-serif;
      }
      .calendar-detail-overlay {
        position: fixed;
        inset: 0;
        z-index: 80;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(9, 18, 30, 0.45);
        backdrop-filter: blur(12px);
        pointer-events: none;
      }
      .calendar-detail-overlay.is-open {
        display: flex;
        pointer-events: auto;
      }
      .calendar-detail-surface {
        width: min(680px, 100%);
        max-height: min(88vh, 920px);
        overflow: auto;
        border-radius: 28px;
        box-shadow: 0 30px 70px rgba(9,18,30,0.35);
      }
      .calendar-detail-card,
      .calendar-detail-empty {
        display: grid;
        gap: 14px;
        padding: 22px;
        border-radius: 26px;
        background: rgba(255,255,255,0.86);
        border: 1px solid rgba(26,42,58,0.08);
        box-shadow: 0 18px 34px rgba(26,42,58,0.08);
        backdrop-filter: blur(10px);
      }
      .calendar-detail-card {
        cursor: default;
      }
      .calendar-detail-top-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: -4px;
      }
      .calendar-detail-close {
        appearance: none;
        border: 0;
        cursor: pointer;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(26,42,58,0.08);
        color: var(--ink);
        font-size: 1rem;
        font-weight: 900;
      }
      .calendar-detail-card--birthday {
        border-top: 4px solid var(--gold);
      }
      .calendar-detail-card--note {
        border-top: 4px solid var(--teal);
      }
      .calendar-detail-empty h3,
      .calendar-detail-card h3 {
        margin: 2px 0 0;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: -0.02em;
        line-height: 1.05;
        font-size: 1.06rem;
      }
      .calendar-detail-empty p {
        margin: 0;
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
      }
      .calendar-detail-top {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: start;
      }
      .calendar-detail-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .calendar-detail-section {
        display: grid;
        gap: 8px;
      }
      .calendar-detail-section strong {
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--crimson);
        font-family: "Montserrat", sans-serif;
      }
      .calendar-detail-section span {
        color: var(--ink);
        font-family: "Montserrat", sans-serif;
        line-height: 1.5;
        font-weight: 600;
      }
      .calendar-detail-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 4px;
      }
      .calendar-note-form {
        display: grid;
        gap: 12px;
      }
      .calendar-note-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .calendar-note-close {
        appearance: none;
        border: 0;
        cursor: pointer;
        width: 36px;
        height: 36px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(26,42,58,0.08);
        color: var(--ink);
        font-size: 1rem;
        font-weight: 900;
      }
      .calendar-note-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .calendar-note-field {
        display: grid;
        gap: 8px;
      }
      .calendar-note-field span {
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--crimson);
        font-family: "Montserrat", sans-serif;
        font-weight: 900;
      }
      .calendar-note-field input[type="text"],
      .calendar-note-field input[type="date"],
      .calendar-note-field select {
        width: 100%;
        min-height: 46px;
        border-radius: 16px;
        border: 1px solid rgba(26,42,58,0.12);
        background: rgba(255,255,255,0.96);
        padding: 0 14px;
        color: var(--ink);
        font: inherit;
        outline: none;
      }
      .calendar-note-field input[type="text"]:focus,
      .calendar-note-field input[type="date"]:focus,
      .calendar-note-field select:focus {
        border-color: rgba(192,57,43,0.55);
        box-shadow: 0 0 0 4px rgba(192,57,43,0.08);
      }
      .calendar-note-field--wide {
        grid-column: 1 / -1;
      }
      .calendar-note-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .calendar-note-tag {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        padding: 7px 12px;
        border-radius: 999px;
        border: 1px solid rgba(26,42,58,0.12);
        background: color-mix(in srgb, var(--tag-color) 12%, #ffffff);
        color: var(--tag-text);
        cursor: pointer;
        transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
      }
      .calendar-note-tag:hover {
        transform: translateY(-1px);
      }
      .calendar-note-tag input {
        accent-color: var(--tag-color);
      }
      .calendar-note-tag span {
        color: inherit;
        font: inherit;
        font-weight: 800;
      }
      .calendar-note-tag--all {
        border-style: dashed;
      }
      .calendar-note-emoji {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.7em;
        height: 1.7em;
        margin-right: 0.35em;
        border-radius: 999px;
        background: rgba(139,92,246,0.12);
        color: #7c3aed;
        font-size: 0.95em;
        vertical-align: -0.15em;
      }
      .notes-form {
        display: grid;
        gap: 10px;
      }
      .notes-textarea {
        width: 100%;
        min-height: 112px;
        resize: vertical;
        border-radius: 18px;
        border: 1px solid rgba(26,42,58,0.12);
        background: rgba(255,255,255,0.96);
        padding: 14px 16px;
        color: var(--ink);
        font: inherit;
        line-height: 1.5;
        outline: none;
      }
      .notes-textarea:focus {
        border-color: rgba(192,57,43,0.55);
        box-shadow: 0 0 0 4px rgba(192,57,43,0.08);
      }
      .notes-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .notes-state {
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
        font-size: 0.82rem;
        font-weight: 700;
      }
      .calendar-panel .fc {
        --fc-border-color: rgba(26,42,58,0.10);
        --fc-page-bg-color: transparent;
        --fc-neutral-bg-color: rgba(255,255,255,0.92);
        --fc-today-bg-color: rgba(192,57,43,0.06);
        --fc-event-bg-color: var(--navy);
        --fc-event-border-color: var(--navy);
        --fc-event-text-color: #ffffff;
        font-family: "Montserrat", sans-serif;
      }
      .calendar-panel .fc .fc-toolbar {
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(26,42,58,0.08);
      }
      .calendar-panel .fc .fc-toolbar-title {
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: -0.02em;
        font-size: clamp(1rem, 2vw, 1.28rem);
        color: var(--ink);
      }
      .calendar-panel .fc .fc-button {
        border-radius: 999px;
        border: 1px solid rgba(26,42,58,0.12);
        background: #ffffff;
        color: var(--ink);
        box-shadow: none;
        text-shadow: none;
        font-weight: 800;
        font-family: "Montserrat", sans-serif;
      }
      .calendar-panel .fc .fc-button:hover {
        background: rgba(26,42,58,0.04);
      }
      .calendar-panel .fc .fc-button-primary:not(:disabled).fc-button-active,
      .calendar-panel .fc .fc-button-primary:not(:disabled):active {
        background: var(--crimson);
        border-color: var(--crimson);
        color: #fff;
      }
      .calendar-panel .fc .fc-event {
        cursor: pointer;
      }
      .calendar-panel .fc .fc-daygrid-day-number,
      .calendar-panel .fc .fc-col-header-cell-cushion {
        color: var(--ink);
        font-weight: 800;
        text-decoration: none;
      }
      .calendar-panel .fc .fc-col-header-cell-cushion {
        font-size: 0.76rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .calendar-panel .fc .fc-daygrid-day.fc-day-today {
        background: rgba(192,57,43,0.05);
      }
      .calendar-panel .fc .fc-daygrid-event {
        background: transparent;
        border: 0;
        padding: 0;
        box-shadow: none;
      }
      .calendar-panel .fc-event-programada {
        background: transparent;
      }
      .calendar-panel .fc-event-finalizada {
        background: transparent;
      }
      .calendar-panel .fc-event-birthday {
        background: transparent;
      }
      .calendar-panel .fc-event-note {
        background: transparent;
      }
      .calendar-panel .fc-event-capacitacion {
        position: relative;
        overflow: visible;
        border-radius: 0;
      }
      .calendar-panel .fc-event-capacitacion::before {
        display: none;
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 8px;
        background: var(--calendar-accent, rgba(255,255,255,0.25));
      }
      .calendar-panel .fc .fc-daygrid-event-harness,
      .calendar-panel .fc .fc-event {
        overflow: visible;
      }
      .calendar-panel .calendar-event-card {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        min-height: 38px;
        padding: 6px 9px 6px 10px;
        border-radius: 17px;
        background:
          radial-gradient(circle at top right, color-mix(in srgb, var(--calendar-accent, var(--crimson)) 12%, transparent), transparent 42%),
          linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(249,251,253,0.98) 100%);
        border: 1px solid rgba(26,42,58,0.075);
        box-shadow: 0 4px 10px rgba(26,42,58,0.05);
        color: var(--ink);
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(8px);
        transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
      }
      .calendar-panel .calendar-event-card::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 3px;
        background: var(--calendar-accent, var(--crimson));
      }
      .calendar-panel .calendar-event-card::after {
        content: "";
        position: absolute;
        inset: -12px -12px auto auto;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: radial-gradient(circle, color-mix(in srgb, var(--calendar-accent, var(--crimson)) 14%, transparent) 0%, transparent 70%);
        pointer-events: none;
      }
      .calendar-panel .calendar-event-card:hover {
        transform: translateY(-1px);
        border-color: rgba(26,42,58,0.12);
        box-shadow: 0 8px 16px rgba(26,42,58,0.08);
      }
      .calendar-panel .calendar-event-icon {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        flex: 0 0 auto;
        margin-top: 1px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.68), 0 4px 10px rgba(26,42,58,0.10);
        overflow: hidden;
      }
      .calendar-panel .calendar-event-icon svg {
        width: 14px;
        height: 14px;
        display: block;
      }
      .calendar-panel .calendar-event-icon--initials {
        font-size: 0.57rem;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: linear-gradient(135deg, var(--calendar-accent, var(--crimson)) 0%, color-mix(in srgb, var(--calendar-accent, var(--crimson)) 75%, #111827) 100%);
      }
      .calendar-panel .calendar-event-icon--emoji {
        font-size: 0.95rem;
        font-weight: 900;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
      }
      .calendar-panel .calendar-event-icon--capacitacion {
        background: linear-gradient(135deg, var(--calendar-accent, #1e3a8a) 0%, color-mix(in srgb, var(--calendar-accent, #1e3a8a) 68%, #111827) 100%);
      }
      .calendar-panel .calendar-event-icon--programada {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      }
      .calendar-panel .calendar-event-icon--finalizada {
        background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
      }
      .calendar-panel .calendar-event-icon--birthday {
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      }
      .calendar-panel .calendar-event-icon--calendar-note {
        background: linear-gradient(135deg, #0f766e 0%, #0f9e8e 100%);
      }
      .calendar-panel .calendar-event-body {
        min-width: 0;
        flex: 1 1 auto;
        display: grid;
        gap: 4px;
        padding-top: 0;
      }
      .calendar-panel .calendar-event-topline {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }
      .calendar-panel .calendar-event-title {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 0.79rem;
        line-height: 1.08;
        font-weight: 800;
        color: var(--ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: normal;
      }
      .calendar-panel .calendar-event-meta {
        font-size: 0.62rem;
        line-height: 1.1;
        font-weight: 700;
        color: rgba(26,42,58,0.62);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .calendar-panel .calendar-event-time {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 18px;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(192,57,43,0.10);
        color: var(--crimson);
        font-size: 0.56rem;
        font-weight: 900;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .calendar-panel .calendar-event-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: flex-start;
        flex: 0 0 auto;
        min-height: 20px;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(192,57,43,0.08);
        color: var(--crimson);
        font-size: 0.54rem;
        line-height: 1;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
        margin-top: 0;
      }
      .calendar-panel .calendar-event-badge--birthday {
        background: rgba(245,158,11,0.14);
        color: #9a3412;
      }
      .calendar-panel .calendar-event-badge--note {
        background: rgba(15,118,110,0.12);
        color: #0f766e;
      }
      .calendar-panel .fc .fc-daygrid-more-link {
        color: var(--crimson);
        font-weight: 800;
      }
      @media (max-width: 1100px) {
        .calendar-split {
          grid-template-columns: 1fr;
        }
        .calendar-sidebar {
          grid-template-columns: minmax(0, 1fr);
        }
        .calendar-frame-top {
          flex-direction: column;
          align-items: flex-start;
        }
      }
      .user-chip {
        display: inline-flex;
        margin-bottom: 12px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(192,57,43,0.08);
        color: var(--ink);
        font-size: 0.78rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-family: "Montserrat", sans-serif;
      }
      .details {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }
      .detail {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        padding: 12px 14px;
        border-radius: 16px;
        background: #ffffff;
        border: 1px solid rgba(26,42,58,0.10);
      }
      .detail strong {
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
      }
      .detail span {
        text-align: right;
        font-weight: 700;
        color: var(--ink);
        font-family: "Montserrat", sans-serif;
      }
      .details-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .detail-hero {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
        padding: 4px 0 18px;
        border-bottom: 1px solid rgba(26,42,58,0.10);
      }
      .detail-kicker {
        display: inline-flex;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(192,57,43,0.08);
        color: var(--crimson);
        font-size: 0.76rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-family: "Montserrat", sans-serif;
      }
      .detail-hero-copy h2 {
        margin: 14px 0 0;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        font-size: clamp(1.45rem, 2.2vw, 2rem);
        line-height: 1.05;
      }
      .detail-hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }
      .detail-grid {
        display: grid;
        gap: 14px;
        margin-top: 16px;
      }
      .detail-block-wide {
        min-height: 88px;
      }
      .detail-actions-surface {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 18px;
        padding: 14px;
        border-radius: 22px;
        background: rgba(26,42,58,0.03);
        border: 1px solid rgba(26,42,58,0.10);
      }
      .details-header h2 {
        margin: 10px 0 0;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        font-size: 1.35rem;
      }
      .capacitacion-detail-panel {
        margin: 20px 0 0;
      }
      .detail-topline {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-top: 16px;
      }
      .detail-date {
        font-family: "Montserrat", sans-serif;
        font-size: 0.82rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .detail-body {
        display: grid;
        gap: 14px;
        margin-top: 16px;
      }
      .detail-block {
        display: grid;
        gap: 10px;
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.92);
      }
      .detail-block strong {
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--crimson);
        font-family: "Montserrat", sans-serif;
      }
      .detail-block span {
        color: var(--ink);
        font-family: "Montserrat", sans-serif;
        line-height: 1.55;
        font-weight: 600;
      }
      .tag-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .tag-pill {
        display: inline-flex;
        align-items: center;
        padding: 8px 12px;
        border-radius: 999px;
        background: var(--navy-soft);
        border: 1px solid rgba(26,42,58,0.10);
        color: var(--ink);
        font-family: "Montserrat", sans-serif;
        font-size: 0.82rem;
        font-weight: 700;
      }
      .tag-pill-muted {
        background: #f7f7f9;
        color: var(--muted);
      }
      .accordion-list {
        display: grid;
        gap: 12px;
      }
      .accordion-card {
        border-radius: 22px;
        border: 1px solid rgba(26,42,58,0.10);
        background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
        box-shadow: 0 16px 40px rgba(26,42,58,0.08);
        overflow: hidden;
      }
      .accordion-card[open] {
        box-shadow: 0 22px 52px rgba(26,42,58,0.10);
      }
      .accordion-summary {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 14px;
        padding: 16px 18px;
        cursor: pointer;
        list-style: none;
        user-select: none;
      }
      .accordion-summary::-webkit-details-marker {
        display: none;
      }
      .accordion-summary-main {
        display: grid;
        gap: 6px;
      }
      .accordion-summary-main strong {
        font-family: "Cinzel", serif;
        font-size: 1rem;
        text-transform: uppercase;
      }
      .accordion-summary-main span {
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
        font-size: 0.84rem;
        font-weight: 700;
      }
      .accordion-summary-meta {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .accordion-chevron {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        display: inline-grid;
        place-items: center;
        background: rgba(26,42,58,0.06);
        color: var(--ink);
        font-size: 1rem;
        font-weight: 900;
        transition: transform 180ms ease, background 180ms ease;
      }
      .accordion-card[open] .accordion-chevron {
        transform: rotate(45deg);
        background: rgba(192,57,43,0.10);
      }
      .accordion-body {
        padding: 0 18px 18px;
        display: grid;
        gap: 14px;
      }
      .accordion-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .employee-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 14px;
      }
      .employee-card {
        min-height: 170px;
      }
      .employee-head strong {
        display: block;
        font-size: 1.02rem;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
      }
      .employee-head span {
        color: var(--muted);
        font-size: 0.88rem;
        font-family: "Montserrat", sans-serif;
      }
      .employee-meta {
        display: grid;
        gap: 8px;
        margin-top: 14px;
        color: var(--muted);
        font-size: 0.9rem;
        font-family: "Montserrat", sans-serif;
      }
      .employee-meta span {
        word-break: break-word;
      }
      .employee-foot {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        margin-top: auto;
      }
      .capacitacion-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 14px;
      }
      .faltantes-ley-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 14px;
      }
      .faltantes-ley-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 18px;
        border-radius: 24px;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255,255,255,0.97), rgba(248,250,252,0.98));
        box-shadow: var(--shadow);
      }
      .faltantes-ley-head,
      .faltantes-ley-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }
      .faltantes-ley-head strong {
        font-size: 1rem;
        line-height: 1.3;
      }
      .faltantes-ley-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .accolades-panel > h2 {
        margin-bottom: 14px;
      }
      .accolades-panel .empty-state {
        margin-top: 0;
      }
      .capacitacion-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 18px;
        border-radius: 24px;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(255,255,255,0.97), rgba(248,250,252,0.98));
        box-shadow: var(--shadow);
        border-top: 5px solid var(--navy);
      }
      .capacitacion-card-link {
        text-decoration: none;
        color: inherit;
        cursor: pointer;
        transition: transform 180ms ease, box-shadow 180ms ease;
      }
      .capacitacion-card-link:hover {
        transform: translateY(-2px);
        box-shadow: 0 26px 76px rgba(20, 32, 43, 0.12);
      }
      .capacitacion-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
      }
      .status-chip {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        border: 1px solid rgba(26,42,58,0.08);
        background: rgba(255,255,255,0.92);
      }
      .status-chip.is-programada {
        color: var(--blue);
      }
      .status-chip.is-finalizada {
        color: var(--green);
      }
      .capacitacion-card h3 {
        margin: 0;
        font-size: 1.08rem;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
      }
      .capacitacion-title-link {
        color: inherit;
        text-decoration: none;
      }
      .capacitacion-title-link:hover {
        color: var(--crimson);
      }
      .capacitacion-meta {
        display: grid;
        gap: 10px;
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
      }
      .capacitacion-meta strong {
        display: block;
        margin-bottom: 3px;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--crimson);
      }
      .capacitacion-meta span {
        display: block;
        line-height: 1.45;
      }
      .capacitacion-meta .tag-row {
        margin-top: 2px;
      }
      .capacitacion-details-link {
        display: inline-flex;
        width: fit-content;
        text-decoration: none;
        margin-top: 4px;
        padding: 0;
      }
      .status-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: auto;
      }
      .status-button {
        appearance: none;
        border: 1px solid rgba(26,42,58,0.14);
        background: #fff;
        color: var(--ink);
        padding: 10px 14px;
        border-radius: 999px;
        font-weight: 800;
        font-size: 0.88rem;
        cursor: pointer;
        font-family: "Montserrat", sans-serif;
      }
      .status-button.active {
        background: var(--navy);
        color: #fff;
        border-color: var(--navy);
      }
      .capacitacion-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: auto;
        font-weight: 800;
        color: var(--crimson);
        font-family: "Montserrat", sans-serif;
      }
      .capacitacion-cta {
        width: fit-content;
        text-decoration: none;
      }
      .route-hint {
        margin-top: 14px;
        padding: 14px;
        border-radius: 18px;
        background: var(--navy-soft);
        border: 1px solid rgba(26,42,58,0.10);
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
      }
      .detail-surface {
        margin-bottom: 20px;
      }
      .empty-state {
        padding: 24px;
        border-radius: 20px;
        background: rgba(255,255,255,0.94);
        border: 1px dashed rgba(26,42,58,0.18);
        color: var(--muted);
        font-family: "Montserrat", sans-serif;
      }
      .auth-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 28px 18px;
        background:
          radial-gradient(circle at top left, rgba(192,57,43,0.10), transparent 30%),
          radial-gradient(circle at bottom right, rgba(15, 76, 92, 0.12), transparent 30%),
          linear-gradient(180deg, #f7f2ea 0%, #f3eee7 42%, #edf2f7 100%);
      }
      .skip-link {
        position: absolute;
        left: 16px;
        top: 16px;
        z-index: 60;
        padding: 10px 14px;
        border-radius: 999px;
        background: #ffffff;
        color: var(--navy);
        border: 1px solid rgba(26,42,58,0.14);
        box-shadow: 0 8px 24px rgba(26,42,58,0.12);
        font-weight: 900;
        text-decoration: none;
        transform: translateY(-180%);
        transition: transform 180ms ease;
      }
      .skip-link:focus {
        transform: translateY(0);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .auth-card {
        width: min(1080px, 100%);
        background: rgba(255,255,255,0.96);
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 34px;
        overflow: hidden;
        box-shadow: 0 28px 80px rgba(20, 32, 43, 0.14);
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
      }
      .auth-visual {
        position: relative;
        overflow: hidden;
        padding: 38px;
        background:
          radial-gradient(circle at top right, rgba(255,211,122,0.20), transparent 26%),
          linear-gradient(160deg, var(--navy) 0%, #20364a 55%, #111e29 100%);
        color: #f8fbff;
        border-right: 6px solid var(--crimson);
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        text-align: center;
      }
      .auth-visual::after {
        content: "";
        position: absolute;
        inset: auto -18% -34% auto;
        width: 280px;
        height: 280px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,255,255,0.16), transparent 72%);
        pointer-events: none;
      }
      .auth-brand {
        display: grid;
        gap: 16px;
        justify-items: center;
        max-width: 420px;
        position: relative;
        z-index: 1;
      }
      .auth-logo {
        width: min(250px, 70vw);
        height: auto;
        object-fit: contain;
        filter: drop-shadow(0 16px 30px rgba(0,0,0,0.28));
      }
      .auth-visual h1 {
        margin: 0;
        color: #ffffff;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: clamp(1.4rem, 3vw, 2.05rem);
        line-height: 1.05;
      }
      .auth-pill {
        display: inline-flex;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(192,57,43,0.15);
        color: #ffe9e5;
        font-size: 0.76rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        font-family: "Montserrat", sans-serif;
      }
      .auth-form {
        padding: 36px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 18px;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.98), rgba(251,252,254,0.96));
      }
      .auth-form h2 {
        margin: 0;
        color: var(--navy);
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: clamp(1.25rem, 2.2vw, 1.8rem);
      }
      .auth-form .hint {
        margin-top: 0;
        color: var(--muted);
        line-height: 1.5;
        font-family: "Montserrat", sans-serif;
      }
      .field {
        display: grid;
        gap: 10px;
        margin-top: 6px;
      }
      .field label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 900;
        color: var(--crimson);
        font-family: "Montserrat", sans-serif;
      }
      .auth-links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .field input {
        width: 100%;
        padding: 15px 16px;
        border-radius: 18px;
        border: 1px solid rgba(26,42,58,0.12);
        background: #fff;
        font: inherit;
        outline: none;
      }
      .field input:focus {
        border-color: rgba(192,57,43,0.75);
        box-shadow: 0 0 0 4px rgba(192,57,43,0.08);
      }
      .auth-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 20px;
      }
      .submit-btn {
        appearance: none;
        border: 0;
        cursor: pointer;
        background: #102a3a;
        color: #fff;
        padding: 14px 18px;
        border-radius: 18px;
        font-weight: 900;
        font-size: 0.98rem;
        font-family: "Montserrat", sans-serif;
      }
      .submit-btn:hover {
        background: #0e1620;
      }
      .secondary-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        padding: 14px 18px;
        border-radius: 18px;
        border: 1px solid rgba(26,42,58,0.12);
        color: var(--ink);
        font-weight: 800;
        font-family: "Montserrat", sans-serif;
      }
      .message {
        margin-top: 4px;
        font-weight: 800;
        font-family: "Montserrat", sans-serif;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid rgba(26,42,58,0.10);
        background: rgba(255,255,255,0.88);
      }
      .message.error {
        color: #991b1b;
        background: rgba(254,226,226,0.86);
        border-color: rgba(185,28,28,0.18);
      }
      .message.ok {
        color: #166534;
        background: rgba(220,252,231,0.84);
        border-color: rgba(22,101,52,0.16);
      }
      .footer-note {
        margin-top: 18px;
        text-align: center;
        color: var(--muted);
        font-size: 0.92rem;
        font-family: "Montserrat", sans-serif;
      }
      .page-loader {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, rgba(255,255,255,0.98), rgba(247,249,251,0.94));
        backdrop-filter: blur(16px);
        transition: opacity 260ms ease, visibility 260ms ease;
      }
      .page-loader.is-hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .page-loader-card {
        display: grid;
        justify-items: center;
        gap: 14px;
        padding: 28px 32px;
        border-radius: 28px;
        background: rgba(255,255,255,0.9);
        border: 1px solid rgba(26,42,58,0.08);
        box-shadow: 0 24px 60px rgba(26,42,58,0.12);
      }
      .page-loader-logo-wrap {
        position: relative;
        width: 92px;
        height: 92px;
        display: grid;
        place-items: center;
      }
      .page-loader-logo {
        width: 72px;
        height: 72px;
        object-fit: contain;
        filter: drop-shadow(0 10px 18px rgba(26,42,58,0.14));
        animation: pageLoaderPulse 1.4s ease-in-out infinite;
      }
      .page-loader-spinner {
        position: absolute;
        inset: 0;
        width: 92px;
        height: 92px;
        border-radius: 999px;
        border: 4px solid rgba(198, 59, 34, 0.12);
        border-top-color: var(--crimson);
        border-right-color: rgba(26,42,58,0.18);
        animation: pageLoaderSpin 0.85s linear infinite;
      }
      .page-loader-text {
        margin: 0;
        font-family: "Montserrat", sans-serif;
        font-weight: 800;
        font-size: 0.88rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ink);
      }
      @keyframes pageLoaderSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes pageLoaderPulse {
        0%, 100% { transform: scale(1); filter: drop-shadow(0 10px 18px rgba(26,42,58,0.14)); }
        50% { transform: scale(0.96); filter: drop-shadow(0 14px 22px rgba(26,42,58,0.18)); }
      }
      @media (max-width: 980px) {
        .hero-grid {
          grid-template-columns: 1fr;
        }
        .hero-grid, .auth-card {
          grid-template-columns: 1fr;
        }
        .hero-side {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .calendar-header {
          align-items: flex-start;
        }
        .calendar-split {
          grid-template-columns: 1fr;
        }
        .calendar-sidebar {
          grid-template-columns: minmax(0, 1fr);
        }
        .dashboard-calendar {
          min-height: 540px;
        }
      }
      @media (max-width: 640px) {
        main { padding: 12px 8px 24px; }
        .hero, .panel, .auth-form, .auth-visual { padding: 16px; border-radius: 20px; }
        .dashboard-main .hero {
          padding: 12px 12px 10px;
        }
        .dashboard-main .hero-grid {
          gap: 8px;
          grid-template-columns: 1fr;
        }
        .dashboard-main .hero-side {
          display: grid;
          gap: 6px;
          grid-template-columns: 1fr;
        }
        .dashboard-main .hero-side-row {
          grid-template-columns: 1fr;
          gap: 8px;
        }
        .dashboard-main .hero-session-card {
          grid-template-columns: 56px minmax(0, 1fr);
          gap: 10px;
          min-height: auto;
          padding: 10px 12px;
          border-radius: 18px;
        }
        .dashboard-main .hero-brand-card {
          width: 100%;
          grid-template-columns: 1fr;
          justify-items: start;
          gap: 8px;
        }
        .dashboard-main .hero-brand-card .hero-session-media {
          width: 56px;
          min-width: 56px;
          height: 56px;
          border-radius: 16px;
        }
        .dashboard-main .hero-session-media {
          width: 56px;
          min-width: 56px;
          height: 56px;
          border-radius: 16px;
        }
        .dashboard-main .hero-logo {
          width: 42px;
          height: 42px;
        }
        .dashboard-main .hero-session-body h2 {
          font-size: 0.95rem;
        }
        .dashboard-main .hero-session-body p {
          display: block;
          font-size: 0.78rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dashboard-main .hero-header-copy {
          padding: 0;
        }
        .dashboard-main .hero-header-copy strong {
          font-size: 1.34rem;
        }
        .dashboard-main .hero-header-copy p {
          font-size: 0.84rem;
        }
        .dashboard-main .hero-session-inline {
          grid-template-columns: 1fr;
          justify-self: start;
          gap: 8px;
        }
        .dashboard-main .hero-session-inline__meta {
          justify-items: start;
        }
        .dashboard-main .hero-session-inline__meta p {
          text-align: left;
        }
        .dashboard-main .hero-session-inline__actions {
          width: 100%;
        }
        .dashboard-main .hero-quick-actions {
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          padding-top: 0;
        }
        .dashboard-main .hero-menu-toggle {
          display: none;
        }
        .dashboard-main .hero-quick-actions .button {
          width: 100%;
          justify-content: center;
        }
        .dashboard-main .hero-role-card {
          width: 100%;
        }
        .dashboard-main .hero-actions {
          display: none;
        }
        .hero::after {
          width: 180px;
          height: 180px;
          inset: auto -24px -68px auto;
        }
        .hero-grid {
          gap: 16px;
        }
        .hero-side {
          grid-template-columns: 1fr;
        }
        .hero-actions {
          gap: 8px;
        }
        .hero-actions .button,
        .calendar-header .button {
          width: 100%;
        }
        .auth-visual { border-right: 0; border-bottom: 6px solid var(--crimson); }
        .auth-form {
          padding-top: 22px;
        }
        .section-head {
          flex-direction: column;
          align-items: flex-start;
        }
        .portal-grid {
          grid-template-columns: 1fr;
        }
        .dashboard-tabs {
          margin-top: 18px;
          gap: 12px;
        }
        .dashboard-shell {
          padding-bottom: 148px;
        }
        .dashboard-mobile-dock {
          position: fixed;
          left: 10px;
          right: 10px;
          bottom: 10px;
          z-index: 90;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 22px;
          border: 1px solid rgba(26,42,58,0.12);
          background: rgba(247, 249, 251, 0.96);
          box-shadow: 0 18px 36px rgba(26,42,58,0.16);
          backdrop-filter: blur(18px);
          touch-action: manipulation;
          overflow-x: auto;
          overflow-y: hidden;
          white-space: nowrap;
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
          scroll-snap-type: x proximity;
        }
        .dashboard-mobile-dock__menu {
          flex: 0 0 auto;
          min-width: 76px;
          min-height: 44px;
          padding: 0 10px;
          border-radius: 16px;
          justify-content: center;
          box-shadow: 0 10px 24px rgba(26,42,58,0.12);
        }
        .dashboard-mobile-dock__track {
          flex: 1 1 auto;
          display: flex;
          align-items: center;
          gap: 8px;
          overflow-x: auto;
          overflow-y: hidden;
          white-space: nowrap;
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
          scroll-snap-type: x proximity;
          scrollbar-width: none;
          padding: 2px 2px 2px 0;
          mask-image: linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 14px), transparent);
        }
        .dashboard-mobile-dock__track::-webkit-scrollbar {
          display: none;
        }
        .dashboard-mobile-dock__group {
          flex: 0 0 auto;
          padding: 0 6px 0 2px;
          color: var(--muted);
          font-family: var(--portal-font-ui);
          font-size: 0.68rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          scroll-snap-align: start;
        }
        .dashboard-mobile-dock .dashboard-nav-link {
          flex: 0 0 auto;
          min-width: 132px;
          min-height: 48px;
          padding: 0 12px;
          border-radius: 16px;
          justify-content: center;
          text-align: left;
          scroll-snap-align: start;
        }
        .dashboard-mobile-dock .dashboard-nav-link__leading {
          gap: 8px;
          flex: 1 1 auto;
        }
        .dashboard-mobile-dock .dashboard-nav-link__label {
          white-space: nowrap;
          line-height: 1.05;
          font-size: 0.8rem;
        }
        .dashboard-mobile-dock .dashboard-nav-link__count {
          display: inline-flex;
          min-width: 1.55rem;
          height: 1.55rem;
          font-size: 0.7rem;
        }
        .calendar-header {
          gap: 12px;
        }
        .calendar-header-copy {
          width: 100%;
        }
        .calendar-legend {
          padding: 12px;
          gap: 10px;
          flex-wrap: wrap;
          overflow: visible;
          -webkit-overflow-scrolling: touch;
        }
        .calendar-legend-label {
          white-space: nowrap;
        }
        .calendar-legend-items {
          flex-wrap: wrap;
        }
        .calendar-filter-pill,
        .calendar-filter-clear {
          flex: 1 1 auto;
          min-width: 0;
          white-space: normal;
        }
        .calendar-frame {
          padding: 12px;
          border-radius: 22px;
          overflow: visible;
        }
        .calendar-frame-actions {
          justify-content: flex-start;
          width: 100%;
        }
        .calendar-new-note-btn {
          width: 100%;
        }
        .calendar-sidebar-card {
          padding: 12px;
          border-radius: 18px;
        }
        .calendar-frame-top {
          align-items: flex-start;
          flex-direction: column;
        }
        .calendar-frame-caption {
          line-height: 1.35;
        }
        .calendar-note-grid {
          grid-template-columns: 1fr;
        }
        .calendar-note-tags {
          gap: 8px;
        }
        .calendar-note-tag {
          width: 100%;
          justify-content: flex-start;
          min-height: 42px;
        }
        .notes-actions {
          flex-direction: column;
          align-items: stretch;
        }
        .notes-actions .button,
        .notes-actions .status-button {
          width: 100%;
        }
        .calendar-panel .fc .fc-toolbar {
          align-items: flex-start;
          gap: 8px;
        }
        .calendar-panel .fc .fc-toolbar-chunk {
          width: 100%;
        }
        .calendar-panel .fc .fc-toolbar-title {
          margin-top: 6px;
          font-size: 0.95rem;
          line-height: 1.12;
        }
        .calendar-panel .fc .fc-toolbar-chunk .fc-button-group {
          width: 100%;
        }
        .calendar-panel .fc .fc-button {
          padding: 8px 10px;
          font-size: 0.76rem;
        }
        .calendar-panel .fc .fc-daygrid-day-frame {
          min-height: 66px;
        }
        .calendar-panel .fc .fc-scrollgrid,
        .calendar-panel .fc .fc-scrollgrid-table,
        .calendar-panel .fc .fc-daygrid-body,
        .calendar-panel .fc .fc-col-header,
        .calendar-panel .fc .fc-daygrid-body table,
        .calendar-panel .fc .fc-scrollgrid-section-body table,
        .calendar-panel .fc table {
          width: 100% !important;
          min-width: 0 !important;
        }
        .calendar-panel .fc .fc-view-harness,
        .calendar-panel .fc .fc-daygrid-body,
        .calendar-panel .fc .fc-scrollgrid-section-body,
        .calendar-panel .fc .fc-scroller,
        .calendar-panel .fc .fc-scroller-liquid-absolute {
          overflow: visible !important;
        }
        .calendar-panel .fc .fc-daygrid-day-top {
          padding: 2px 3px 0;
        }
        .calendar-panel .fc .fc-daygrid-day-number {
          font-size: 0.78rem;
        }
        .calendar-panel .fc .fc-daygrid-event-harness,
        .calendar-panel .fc .fc-event {
          margin-top: 1px;
        }
        .calendar-panel .calendar-event-card {
          min-height: 34px;
          padding: 5px 7px;
          border-radius: 14px;
          gap: 8px;
        }
        .calendar-panel .calendar-event-icon {
          width: 22px;
          height: 22px;
        }
        .calendar-panel .calendar-event-icon svg {
          width: 12px;
          height: 12px;
        }
        .calendar-panel .calendar-event-title {
          font-size: 0.72rem;
        }
        .calendar-panel .calendar-event-meta {
          font-size: 0.56rem;
        }
        .calendar-panel .calendar-event-badge {
          display: none;
        }
        .calendar-panel .fc .fc-more-link,
        .calendar-panel .fc .fc-daygrid-more-link {
          display: block;
          font-size: 0.72rem;
          white-space: normal;
        }
        .calendar-panel .fc .fc-toolbar-chunk:first-child {
          order: 1;
        }
        .calendar-panel .fc .fc-toolbar-chunk:nth-child(2) {
          order: 3;
        }
        .calendar-panel .fc .fc-toolbar-chunk:nth-child(3) {
          order: 2;
        }
        .calendar-detail-overlay {
          padding: 10px;
        }
        .calendar-detail-surface {
          width: 100%;
          max-height: 92vh;
          border-radius: 20px;
        }
      }
    </style>
  `;
}

function renderLayout({ title, heroTitle, heroIntro, primaryAction, secondaryAction, sideContent, bodyContent, footer, headExtra = "", bodyScripts = "", mainClass = "" }) {
  const portalBasePath = getActivePortalBasePath();
  const loaderLogoPath = "/img/Logo%20sin%20fondo%203D%20HD.png";
  return `<!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/png" href="${HOME_FAVICON_PATH}" />
    <link rel="shortcut icon" type="image/png" href="${HOME_FAVICON_PATH}" />
    ${getHomeStyles()}
    ${headExtra}
  </head>
  <body>
    <a class="skip-link" href="#contenido-principal">Saltar al contenido principal</a>
    <div class="page-loader" id="page-loader" aria-hidden="true">
      <div class="page-loader-card" role="status" aria-live="polite" aria-label="Cargando">
        <div class="page-loader-logo-wrap" aria-hidden="true">
          <img class="page-loader-logo" src="${loaderLogoPath}" alt="" />
          <div class="page-loader-spinner"></div>
        </div>
        <p class="page-loader-text">Cargando Desarrollo EG</p>
      </div>
    </div>
    <main id="contenido-principal" role="main" aria-label="Contenido principal" class="${escapeAttr(mainClass || "")}">
      <section class="hero">
        <div class="hero-grid">
          <div>
            <span class="eyebrow">Desarrollo EG</span>
            ${heroTitle ? `<h1>${escapeHtml(heroTitle)}</h1>` : ""}
            ${heroIntro ? `<p>${escapeHtml(heroIntro)}</p>` : ""}
            <div class="hero-actions">
              ${primaryAction || ""}
              ${secondaryAction || ""}
            </div>
          </div>
          <div class="hero-side">
            ${sideContent || ""}
          </div>
        </div>
      </section>
      ${bodyContent || ""}
      ${footer ? `<p class="footer-note">${footer}</p>` : ""}
    </main>
    <script>
      (function () {
        const portalBasePath = ${JSON.stringify(portalBasePath)};
        window.__PORTAL_BASE_PATH__ = portalBasePath;
        window.__PORTAL_URL__ = function (path) {
          const cleanPath = String(path || "/").trim() || "/";
          const normalizedPath = cleanPath.startsWith("/") ? cleanPath : "/" + cleanPath;
          if (!portalBasePath) return normalizedPath;
          if (normalizedPath === portalBasePath || normalizedPath.startsWith(portalBasePath + "/")) {
            return normalizedPath;
          }
          return portalBasePath + normalizedPath;
        };
        const loader = document.getElementById("page-loader");
        if (!loader) return;
        let hidden = false;
        const hide = () => {
          if (hidden) return;
          hidden = true;
          loader.classList.add("is-hidden");
          window.setTimeout(() => loader.remove(), 320);
        };
        if (document.readyState === "complete") {
          requestAnimationFrame(hide);
          return;
        }
        window.addEventListener("load", hide, { once: true });
      })();
    </script>
    <script>
      (function () {
        const portalBasePath = window.__PORTAL_BASE_PATH__ || "";
        if (!portalBasePath) return;
        const prefixPath = (value) => {
          const cleanPath = String(value || "").trim();
          if (!cleanPath || cleanPath.startsWith("http://") || cleanPath.startsWith("https://") || cleanPath.startsWith("mailto:") || cleanPath.startsWith("tel:") || cleanPath.startsWith("#")) {
            return cleanPath;
          }
          if (cleanPath.startsWith(portalBasePath)) {
            return cleanPath;
          }
          return portalBasePath + (cleanPath.startsWith("/") ? cleanPath : "/" + cleanPath);
        };
        const rewrite = () => {
          document.querySelectorAll('a[href^="/"], form[action^="/"]').forEach((node) => {
            const attr = node.tagName === "FORM" ? "action" : "href";
            const current = node.getAttribute(attr) || "";
            const next = prefixPath(current);
            if (next && next !== current) {
              node.setAttribute(attr, next);
            }
          });
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", rewrite, { once: true });
        } else {
          rewrite();
        }
      })();
    </script>
    ${bodyScripts || ""}
  </body>
  </html>`;
}

function renderLoginPage(errorMessage = "", { showQaAccess = isQaAccessEnabled() } = {}) {
  const portalBasePath = getActivePortalBasePath();
  const isQaPortal = portalBasePath === "/QA";
  const shouldShowQaAccess = showQaAccess && isQaPortal;
  const errorHtml = errorMessage ? `<div class="message error" id="message">${escapeHtml(errorMessage)}</div>` : `<div class="message" id="message"></div>`;
  return `<!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Acceso | Desarrollo EG</title>
    <link rel="icon" type="image/png" href="${HOME_FAVICON_PATH}" />
    <link rel="shortcut icon" type="image/png" href="${HOME_FAVICON_PATH}" />
    ${getHomeStyles()}
  </head>
  <body>
    <a class="skip-link" href="#login-main">Saltar al contenido principal</a>
    <div class="auth-shell">
      <main id="login-main" class="auth-card" role="main" aria-label="Acceso al portal">
        <section class="auth-visual">
          <div class="auth-brand">
            <span class="auth-pill">${isQaPortal ? "Portal de pruebas" : "Portal de acceso"}</span>
            <img class="auth-logo" src="${BRAND_LOGO_PATH}" alt="Desarrollo EG" />
            <h1>${isQaPortal ? "Portal QA de Desarrollo EG" : "Portal de Desarrollo EG"}</h1>
          </div>
        </section>
        <section class="auth-form">
          <h2>Iniciar sesion</h2>
          <div class="field">
            <label>Acceso corporativo con Google</label>
            <div class="auth-links">
              <a class="submit-btn" href="${portalPath("/auth/google/start")}" style="text-decoration:none;text-align:center;display:inline-flex;justify-content:center;align-items:center;">Entrar con Google</a>
            </div>
          </div>
          ${shouldShowQaAccess ? `
          <form class="field" method="post" action="/auth/qa/start">
            <label for="qa-access-token">Acceso QA controlado</label>
            <input id="qa-access-token" name="token" type="password" autocomplete="one-time-code" placeholder="Token de QA" />
            <button class="submit-btn" type="submit">Entrar como QA</button>
          </form>
          ` : ""}
          ${errorHtml}
        </section>
      </main>
    </div>
  </body>
  </html>`;
}

function normalizeText(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function getPedidoRowClassification(row = {}, thresholds = {}) {
  const amount = Number(row.importeNumber);
  const estatalMin = Number(thresholds?.estatalMin || 32000);
  const municipalMin = Number(thresholds?.municipalMin || 9794.98);
  const tipo = row.tipoClasificacion || (Number.isFinite(amount)
    ? (amount >= estatalMin ? "estatal" : amount >= municipalMin ? "municipal" : "sin-clasificar")
    : "sin-clasificar");
  const statusText = normalizeText(row.status || "");
  const liberado = statusText.includes("LIBERADO") || statusText.includes("LIBERACION") || statusText.includes("LIBERADO PENDIENTE");
  const facturaLey = statusText.includes("LEY");
  const pago = statusText.includes("PAGO");
  return {
    tipo,
    liberado,
    facturaLey,
    pago,
    noLiberado: statusText.includes("SIN LIBERACION")
      || statusText.includes("NO LIBERADO")
      || (statusText.includes("PENDIENTE") && !statusText.includes("PAGO")),
    liberadoPendLey: statusText.includes("LIBERADO") && !facturaLey,
    pendientePago: statusText.includes("PENDIENTE") && statusText.includes("PAGO"),
    estatal: tipo === "estatal",
    municipal: tipo === "municipal",
  };
}

function renderPedidosAdminDashboardPanel({ data = {}, year = new Date().getFullYear(), embedded = false } = {}) {
  const baseHref = `/dashboard/pedidos?year=${encodeURIComponent(String(year))}`;
  return `
    <div class="pedidos-native-shell${embedded ? " pedidos-native-shell--embedded" : ""}">
      <div class="pedidos-header${embedded ? " pedidos-header--compact" : ""}">
        <div>
          <h2>Pedidos</h2>
          <p>${embedded ? "Lectura rápida por estatus, tipo y cobertura, integrada al dashboard." : "Resumen ejecutivo de pedidos con lectura rápida por estatus, tipo y cobertura. La vista completa queda disponible para revisión profunda."}</p>
        </div>
        ${embedded ? "" : `<div class="hero-actions"><a class="button primary" href="${escapeAttr(baseHref)}" target="_blank" rel="noopener">Abrir panel completo</a></div>`}
      </div>
      <div data-pedidos-loading style="background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(248,250,252,.96));border-radius:18px;border:1px solid rgba(26,42,58,.08);display:flex;align-items:center;justify-content:center;gap:12px;flex-direction:column;color:var(--muted);font-family:'Montserrat',sans-serif;font-weight:800;letter-spacing:.04em;text-transform:uppercase;min-height:340px;padding:18px;">
        <div class="page-loader-spinner" aria-hidden="true" style="width:40px;height:40px;border-width:3px;"></div>
        <span>Cargando pedidos</span>
      </div>
      <div data-pedidos-root style="display:none;">${data?.rows?.length ? renderPedidosDashboardFragment({ user: null, data, year, embedded: true }) : ""}</div>
  `;
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }
  return text;
}

function renderPedidoDashboardMetric(label, value, detail, tone = "blue") {
  return `
    <div class="summary-card" data-tone="${escapeAttr(tone)}" style="display:block;text-decoration:none;">
      <div class="eyebrow">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(String(value ?? 0))}</div>
      <div class="detail">${escapeHtml(detail || "")}</div>
    </div>
  `;
}

function getPedidoDashboardStatusBucket(row = {}, flags = null, hasOrder = true) {
  if (!hasOrder) return "sin-pedido";
  const statusText = normalizeText(row.status || "");
  const paid = Boolean(flags?.pago || row.pagoBool || statusText.includes("PAGADO"));
  const pendingPayment = Boolean(flags?.pendientePago || row.pendientePago || (statusText.includes("PENDIENTE") && statusText.includes("PAGO")));
  const liberated = Boolean(flags?.liberado || row.liberacionBool || statusText.includes("LIBERADO"));
  const noLiberado = Boolean(flags?.noLiberado || row.noLiberado || statusText.includes("SIN LIBERACION") || statusText.includes("NO LIBERADO"));
  if (pendingPayment) {
    return "pendientes-pago";
  }
  if (paid) {
    return "pagados";
  }
  if (liberated) {
    return "liberados";
  }
  if (noLiberado) {
    return "sin-liberacion";
  }
  if (statusText.includes("SIN LIBERACION") || statusText.includes("NO LIBERADO")) {
    return "sin-liberacion";
  }
  if (statusText.includes("LIBERADO") && !statusText.includes("LEY")) {
    return "liberados";
  }
  return "otros";
}

function getPedidoDashboardTypeBucket(row = {}) {
  if (row._flags?.estatal) return "estatal";
  if (row._flags?.municipal) return "municipal";
  return "otros";
}

function getPedidoCoverageBranchKey(row = {}) {
  return normalizeText(row.key || row.id || row.tienda || row.displayLabel || row.label || row.label2 || "");
}

function getPedidoCoverageBranchLabel(row = {}) {
  return String(row.displayLabel || row.label || row.label2 || row.tienda || row.key || row.id || "").trim();
}

function getPedidoCoverageBranchKinds(row = {}) {
  const work = normalizeText(row.trabajos || "");
  const kinds = [];
  if (work.includes("ESTATAL")) kinds.push("estatal");
  if (work.includes("MUNICIPAL")) kinds.push("municipal");
  return kinds;
}

function isPedidoCoverageBranchAllowed(row = {}) {
  return normalizeText(row.empresaId || row.empresa || "") === "1"
    && normalizeText(row.status || "").includes("ACTIVA");
}

function buildPedidosCoverageModel(rows = [], branches = [], facturadorId = "") {
  const normalizedFacturadorId = normalizeText(facturadorId || "");
  const ordersByBranchKey = new Map();
  const orderRows = Array.isArray(rows) ? rows : [];

  for (const row of orderRows) {
    if (normalizedFacturadorId && normalizeText(row.facturadorId) !== normalizedFacturadorId) continue;
    const rowKeys = [
      row.tiendaKey,
      row.establecimiento,
      row.tiendaLabel,
      row.tienda?.label,
      row.tienda?.displayLabel,
    ].map((item) => normalizeText(item)).filter(Boolean);
    const deduped = [];
    for (const key of rowKeys) {
      if (!deduped.includes(key)) deduped.push(key);
    }
    for (const key of deduped) {
      const bucket = ordersByBranchKey.get(key) || [];
      bucket.push(row);
      ordersByBranchKey.set(key, bucket);
    }
  }

  const branchesByKind = {
    estatal: [],
    municipal: [],
    otros: [],
  };

  const getBranchOrders = (branch) => {
    const candidateKeys = [
      branch.key,
      branch.id,
      branch.tienda,
      branch.displayLabel,
      branch.label,
      branch.label2,
    ].map((item) => normalizeText(item)).filter(Boolean);
    const collected = [];
    for (const key of candidateKeys) {
      const bucket = ordersByBranchKey.get(key);
      if (bucket && bucket.length) collected.push(...bucket);
    }
    const unique = [];
    const seen = new Set();
    for (const row of collected) {
      const identifier = String(row.pedido || row.rowId || row.uuid || row.fecha || `${row.tiendaKey || ""}-${row.status || ""}`).trim();
      if (seen.has(identifier)) continue;
      seen.add(identifier);
      unique.push(row);
    }
    unique.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")) || Number(b.fechaYear || 0) - Number(a.fechaYear || 0));
    return unique;
  };

  for (const branch of Array.isArray(branches) ? branches : []) {
    if (!isPedidoCoverageBranchAllowed(branch)) continue;
    const kinds = getPedidoCoverageBranchKinds(branch);
    for (const kind of kinds) {
      const isCuliacanMunicipal = kind === "municipal" && normalizeText(branch.municipioNombre || branch.municipioLabel || branch.municipio?.displayLabel || "").includes("CULIACAN");
      if (isCuliacanMunicipal) continue;
      const orders = getBranchOrders(branch).filter((row) => row._flags?.[kind]);
      const order = orders[0] || null;
      const entry = {
        branch,
        kind,
        order,
      };
      branchesByKind[kind].push(entry);
    }
    if (!kinds.length) {
      const orders = getBranchOrders(branch).filter((row) => getPedidoDashboardTypeBucket(row) === "otros");
      const order = orders[0] || null;
      branchesByKind.otros.push({
        branch,
        kind: "otros",
        order,
      });
    }
  }

  return {
    estatal: branchesByKind.estatal,
    municipal: branchesByKind.municipal,
    otros: branchesByKind.otros,
  };
}

function renderPedidosCoverageTable(entries = [], emptyMessage = "", kindLabel = "") {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) {
    return `<div class="pedidos-coverage-empty">${escapeHtml(emptyMessage)}</div>`;
  }

  return `
    <div class="pedidos-coverage-table table-shell">
      <table>
        <thead>
          <tr>
            <th>Sucursal</th>
            <th>Tipo</th>
            <th>Municipio</th>
            <th>Estado</th>
            <th>Condición</th>
            <th>Pedido</th>
            <th>Status</th>
            <th>Importe</th>
            <th>Observación</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((item) => {
            const branch = item.branch || {};
            const order = item.order || null;
            const missing = !order;
            const statusTone = missing ? "fail" : "ok";
            const kind = String(item.kind || kindLabel || "otros").trim();
            const kindLabelValue = kind === "otros" ? "Otros" : kind === "estatal" ? "Estatal" : "Municipal";
            const municipio = branch.municipioNombre || branch.municipioLabel || branch.municipio?.displayLabel || "";
            const estado = branch.estadoNombre || branch.estadoLabel || branch.estado?.displayLabel || "";
            const observation = missing ? "Debe tener pedido" : "Normal";
            const search = [
              getPedidoCoverageBranchLabel(branch),
              getPedidoCoverageBranchKey(branch),
              kindLabelValue,
              municipio,
              estado,
              order?.pedido,
              order?.status,
              order?.descripcion,
            ].map((value) => normalizeText(value)).join(" ");
            return `
              <tr
                data-pedidos-branch-row
                data-status="${escapeAttr(missing ? "sin-pedido" : (order?._statusBucket || "otros"))}"
                data-type="${escapeAttr(kind)}"
                data-search="${escapeAttr(search)}"
              >
                <td>
                  <div class="stack">
                    <strong>${escapeHtml(getPedidoCoverageBranchLabel(branch))}</strong>
                    <span class="muted">${escapeHtml(getPedidoCoverageBranchKey(branch))}</span>
                  </div>
                </td>
                <td><span class="chip ${kind === "otros" ? "blue" : kind === "municipal" ? "warn" : "ok"}">${escapeHtml(kindLabelValue)}</span></td>
                <td><strong>${escapeHtml(municipio)}</strong></td>
                <td><strong>${escapeHtml(estado)}</strong></td>
                <td>${missing ? '<span class="chip fail">Sin pedido</span>' : '<span class="chip ok">Con pedido</span>'}</td>
                <td>${escapeHtml(order?.pedido || "—")}</td>
                <td><span class="chip ${statusTone}">${escapeHtml(order?.status || "Sin status")}</span></td>
                <td><strong>${escapeHtml(order ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(Number(order.importeNumber || 0)) : "—")}</strong></td>
                <td><span class="pedidos-coverage-badge">${escapeHtml(observation)}</span></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPedidosCoverageSection({ rows = [], catalogs = {}, facturadorId = "" } = {}) {
  const branches = Array.isArray(catalogs?.sucursalesLookup?.rows) ? catalogs.sucursalesLookup.rows : [];
  const model = buildPedidosCoverageModel(rows, branches, facturadorId);
  const entries = [...model.estatal, ...model.municipal, ...model.otros];
  const estatales = entries.filter((item) => item.kind === "estatal");
  const municipales = entries.filter((item) => item.kind === "municipal");
  const otros = entries.filter((item) => item.kind === "otros");

  return `
    <section class="pedidos-coverage" data-pedidos-view="sucursales">
      <div class="pedidos-coverage-head">
        <div>
          <h3>Sucursales</h3>
          <p>Activas de la empresa 1. Aquí revisas cobertura y estatus de pedido por tipo: estatal, municipal u otros.</p>
        </div>
      </div>
      <div class="pedidos-context" style="margin-top:10px;">
        <div class="pedidos-context-copy">
          <strong>Cobertura de sucursales</strong>
          <span>Revisa qué sucursales deberían tener pedido estatal o municipal, cuáles ya lo tienen y cuáles faltan.</span>
        </div>
        <div class="pedidos-context-chips">
          <span class="pill strong">Estatales: ${escapeHtml(String(estatales.length))}</span>
          <span class="pill strong">Municipales: ${escapeHtml(String(municipales.length))}</span>
          <span class="pill strong">Otros: ${escapeHtml(String(otros.length))}</span>
        </div>
      </div>
      <div class="pedidos-coverage-section">
        ${renderPedidosCoverageTable(entries, "No hay sucursales para mostrar.", "Sucursal")}
      </div>
    </section>
  `;
}

function buildPedidosDashboardToolbar({ requestedYear, thresholds, facturadorId, facturadorLabel, selectedScope, selectedStatus, selectedType, searchText }) {
  return `
    <div class="pedidos-toolbar">
      <div class="pedidos-filter-group">
        <div class="pedidos-toolbar-label">Vista</div>
        <div class="pedidos-tabs" data-pedidos-scope-tabs>
          <button type="button" class="pedidos-tab-btn${selectedScope === "pedidos" ? " is-active" : ""}" data-pedidos-scope="pedidos">Pedidos</button>
          <button type="button" class="pedidos-tab-btn${selectedScope === "sucursales" ? " is-active" : ""}" data-pedidos-scope="sucursales">Sucursales</button>
        </div>
      </div>
      <div class="pedidos-filter-group">
        <div class="pedidos-toolbar-label">Tipo</div>
        <div class="pedidos-tabs" data-pedidos-type-tabs>
          <button type="button" class="pedidos-tab-btn${selectedType === "all" ? " is-active" : ""}" data-pedidos-type="all">Todos</button>
          <button type="button" class="pedidos-tab-btn${selectedType === "estatal" ? " is-active" : ""}" data-pedidos-type="estatal">Estatales</button>
          <button type="button" class="pedidos-tab-btn${selectedType === "municipal" ? " is-active" : ""}" data-pedidos-type="municipal">Municipales</button>
          <button type="button" class="pedidos-tab-btn${selectedType === "otros" ? " is-active" : ""}" data-pedidos-type="otros">Otros</button>
        </div>
      </div>
      <div class="pedidos-filter-group">
        <div class="pedidos-toolbar-label">Estatus</div>
        <div class="pedidos-tabs" data-pedidos-status-tabs>
          <button type="button" class="pedidos-tab-btn${selectedStatus === "all" ? " is-active" : ""}" data-pedidos-status="all">Todos</button>
          <button type="button" class="pedidos-tab-btn${selectedStatus === "sin-liberacion" ? " is-active" : ""}" data-pedidos-status="sin-liberacion">Sin liberación</button>
          <button type="button" class="pedidos-tab-btn${selectedStatus === "liberados" ? " is-active" : ""}" data-pedidos-status="liberados">Liberados</button>
          <button type="button" class="pedidos-tab-btn${selectedStatus === "pagados" ? " is-active" : ""}" data-pedidos-status="pagados">Pagados</button>
          <button type="button" class="pedidos-tab-btn${selectedStatus === "pendientes-pago" ? " is-active" : ""}" data-pedidos-status="pendientes-pago">Pendientes de pago</button>
          <button type="button" class="pedidos-tab-btn${selectedStatus === "sin-pedido" ? " is-active" : ""}" data-pedidos-status="sin-pedido">Sin pedido</button>
        </div>
      </div>
      <details class="pedidos-advanced">
        <summary>Filtros avanzados</summary>
        <div class="pedidos-advanced-grid">
          <div class="pedidos-field">
            <label>Año</label>
            <input data-pedidos-year type="number" min="2020" max="2100" value="${escapeAttr(String(requestedYear))}">
          </div>
          <div class="pedidos-field">
            <label>Facturador</label>
            <input data-pedidos-facturador type="text" value="${escapeAttr(String(facturadorId || ""))}" placeholder="ID del facturador">
          </div>
          <div class="pedidos-field">
            <label>Precio estatal</label>
            <input data-pedidos-estatal-min type="number" step="0.01" value="${escapeAttr(String(thresholds.estatalMin))}">
          </div>
          <div class="pedidos-field">
            <label>Precio municipal</label>
            <input data-pedidos-municipal-min type="number" step="0.01" value="${escapeAttr(String(thresholds.municipalMin))}">
          </div>
          <div class="pedidos-field">
            <label>Buscar</label>
            <input data-pedidos-search type="search" value="${escapeAttr(String(searchText || ""))}" placeholder="Pedido, sucursal, municipio...">
          </div>
          <div class="pedidos-actions">
            <button type="button" class="button secondary" data-pedidos-reset>Limpiar</button>
            <button type="button" class="button secondary" data-pedidos-refresh>Recargar datos</button>
            <button type="button" class="button primary" data-pedidos-apply>Aplicar</button>
          </div>
        </div>
        <div class="pedidos-stats" style="padding:0 16px 16px;color:var(--muted);">
          <span>Pedidos de ${escapeHtml(facturadorLabel || facturadorId || "todos")}</span>
          <span>·</span>
          <span>Vista: pedidos / sucursales · tipos: estatal, municipal, otros · estatus: liberados, pagados, sin liberación, pendientes y sin pedido.</span>
        </div>
      </details>
    </div>
  `;
}

export function renderPedidosDashboardFragment({ user = null, data = {}, year = new Date().getFullYear(), embedded = false } = {}) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const requestedYear = Number(data.requestedYear || data.year || year || new Date().getFullYear());
  const thresholds = data.thresholds || {};
  const selectedScope = String(data.scope || "pedidos").trim() || "pedidos";
  const selectedStatus = String(data.status || "all").trim() || "all";
  const selectedType = String(data.type || "all").trim() || "all";
  const searchText = String(data.search || "").trim();
  const state = {
    year: requestedYear,
    estatalMin: Number(thresholds.estatalMin || 32000),
    municipalMin: Number(thresholds.municipalMin || 9794.98),
    facturadorId: String(data.facturadorId || "").trim(),
    facturadorLabel: String(data.facturadorLabel || "").trim(),
  };

  const visibleRows = rows.filter((row) => {
    const rowYear = Number(row.fechaYear || 0);
    if (Number.isFinite(state.year) && rowYear && rowYear !== state.year) return false;
    return true;
  });
  const classifiedRows = visibleRows.map((row) => {
    const flags = getPedidoRowClassification(row, thresholds);
    const _statusBucket = getPedidoDashboardStatusBucket(row);
    const _typeBucket = getPedidoDashboardTypeBucket({ ...row, _flags: flags });
    const _searchText = [
      row.pedido,
      row.descripcion,
      row.status,
      row.tiendaLabel,
      row.tiendaKey,
      row.establecimiento,
      row.tienda?.municipioNombre,
      row.tienda?.estadoNombre,
      row.clasificacionLabel,
      row.clasificacionDetalle,
    ].map((item) => normalizeText(item)).join(" ");
    return { ...row, _flags: flags, _statusBucket, _typeBucket, _searchText };
  });
  const filteredRows = classifiedRows.filter((row) => {
    if (selectedStatus !== "all" && row._statusBucket !== selectedStatus) return false;
    if (selectedType !== "all" && row._typeBucket !== selectedType) return false;
    if (searchText && !row._searchText.includes(normalizeText(searchText))) return false;
    return true;
  });
  const coverageRows = buildPedidosCoverageModel(classifiedRows, data.catalogs?.sucursalesLookup?.rows || [], state.facturadorId);
  const counts = {
    total: filteredRows.length,
    sinLiberacion: filteredRows.filter((row) => row._statusBucket === "sin-liberacion").length,
    liberados: filteredRows.filter((row) => row._statusBucket === "liberados").length,
    pagados: filteredRows.filter((row) => row._statusBucket === "pagados").length,
    pendientesPago: filteredRows.filter((row) => row._statusBucket === "pendientes-pago").length,
  };
  const branchCounts = {
    total: coverageRows.estatal.length + coverageRows.municipal.length + coverageRows.otros.length,
    conPedido: [...coverageRows.estatal, ...coverageRows.municipal, ...coverageRows.otros].filter((item) => item.order).length,
    sinPedido: [...coverageRows.estatal, ...coverageRows.municipal, ...coverageRows.otros].filter((item) => !item.order).length,
    estatales: coverageRows.estatal.length,
    municipales: coverageRows.municipal.length,
    otros: coverageRows.otros.length,
  };
  const roleLabel = user?.role === "admin" ? "Administrador" : "Usuario";
  const username = escapeHtml(user?.nombre || user?.correo || "Usuario");
  const facturadorLabel = escapeHtml(state.facturadorLabel || state.facturadorId || "Todos");
  const visibleRowsCount = selectedScope === "sucursales" ? branchCounts.total : filteredRows.length;
  const visibleRowsLabel = selectedScope === "sucursales" ? "sucursales visibles" : "pedidos visibles";
  const typeLabel = selectedType === "estatal" ? "Estatales" : selectedType === "municipal" ? "Municipales" : selectedType === "otros" ? "Otros" : "Sin filtro de tipo";
  const typeRows = selectedType === "all" ? filteredRows : classifiedRows.filter((row) => row._typeBucket === selectedType);
  const typeSummaryChips = selectedType === "all"
    ? [
        `<span class="pill strong">Estatales: ${escapeHtml(String(classifiedRows.filter((row) => row._typeBucket === "estatal").length))}</span>`,
        `<span class="pill strong">Municipales: ${escapeHtml(String(classifiedRows.filter((row) => row._typeBucket === "municipal").length))}</span>`,
        `<span class="pill strong">Otros: ${escapeHtml(String(classifiedRows.filter((row) => row._typeBucket === "otros").length))}</span>`,
      ]
    : [
        `<span class="pill strong">${escapeHtml(typeLabel)}</span>`,
      ];
  const makeOrderRowMarkup = (row) => {
    const municipio = row.tienda?.municipioNombre || row.tienda?.municipioLabel || row.municipio?.nombre || row.municipio?.displayLabel || "";
    const estado = row.tienda?.estadoNombre || row.tienda?.estadoLabel || row.estado?.nombre || row.estado?.displayLabel || "";
    const tipo = row.clasificacionLabel || (row._flags.estatal ? "Estatal" : row._flags.municipal ? "Municipal" : "Otros");
    const tone = row.clasificacionLabel && normalizeText(row.clasificacionLabel).includes("CULIACAN")
      ? "warn"
      : row._flags.estatal
        ? "ok"
        : row._flags.municipal
          ? "blue"
          : "warn";
    const search = [
      row.pedido,
      row.descripcion,
      row.status,
      row.tiendaLabel,
      row.tiendaKey,
      row.establecimiento,
      municipio,
      estado,
      row.clasificacionLabel,
      row.clasificacionDetalle,
    ].map((item) => normalizeText(item)).join(" ");
    return `
      <tr
        class="pedidos-row"
        data-pedidos-row
        data-status="${escapeAttr(row._statusBucket)}"
        data-type="${escapeAttr(row._typeBucket)}"
        data-search="${escapeAttr(search)}"
      >
        <td>
          <div class="stack">
            <strong>${escapeHtml(row.pedido || "")}</strong>
            <span class="muted">${escapeHtml(row.descripcion || "")}</span>
          </div>
        </td>
        <td>
          <div class="stack">
            <strong>${escapeHtml(row.tiendaLabel || row.establecimiento || "")}</strong>
            <span class="muted">${escapeHtml(row.tiendaKey || row.establecimiento || "")}</span>
          </div>
        </td>
        <td><strong>${escapeHtml(municipio)}</strong></td>
        <td><strong>${escapeHtml(estado)}</strong></td>
        <td>${escapeHtml(formatDate(row.fecha || row["fecha(DATE)"] || ""))}</td>
        <td><strong>${escapeHtml(new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(Number(row.importeNumber || 0)))}</strong></td>
        <td><span class="chip ${tone}">${escapeHtml(tipo)}</span></td>
        <td><span class="chip ${tone}">${escapeHtml(row.status || "Sin status")}</span></td>
      </tr>
    `;
  };
  const rowMarkup = filteredRows.length
    ? filteredRows.map((row) => makeOrderRowMarkup(row)).join("")
    : `<tr><td colspan="8" class="empty">No hay pedidos para estos filtros.</td></tr>`;
  const branchesMarkup = renderPedidosCoverageSection({
    rows: classifiedRows,
    catalogs: data.catalogs || {},
    facturadorId: state.facturadorId,
  });

  return `
    <div class="pedidos-native${embedded ? " pedidos-native--embedded" : ""}" data-pedidos-panel data-year="${escapeAttr(String(requestedYear))}" data-facturador-id="${escapeAttr(state.facturadorId)}" data-estatal-min="${escapeAttr(String(state.estatalMin))}" data-municipal-min="${escapeAttr(String(state.municipalMin))}" data-status="${escapeAttr(selectedStatus)}" data-type="${escapeAttr(selectedType)}" data-scope="${escapeAttr(selectedScope)}" data-search="${escapeAttr(searchText)}">
      <div class="pedidos-surface" style="margin-top:16px;">
        <div class="pedidos-header">
          <div>
            <h2>${escapeHtml(selectedScope === "sucursales" ? "Cobertura de sucursales" : "Pedidos del año")} ${escapeHtml(String(requestedYear))}</h2>
            <p>${escapeHtml(selectedScope === "sucursales"
              ? "Aquí ves qué sucursales tienen pedido y cuáles faltan, sin usar tarjetas confusas."
              : "Aquí ves el estado operativo de los pedidos del año filtrado, sin KPI de interpretación difícil.")} Cambia entre pedidos y sucursales sin salir de esta pantalla.</p>
          </div>
          ${embedded ? "" : `<div class="hero-actions"><a class="button primary" href="/dashboard/pedidos?year=${encodeURIComponent(String(requestedYear))}" target="_blank" rel="noopener">Vista completa</a></div>`}
        </div>
        ${buildPedidosDashboardToolbar({
          requestedYear,
          thresholds,
          facturadorId: state.facturadorId,
          facturadorLabel: state.facturadorLabel,
          selectedScope,
          selectedStatus,
          selectedType,
          searchText,
        })}
        <div class="pedidos-stats" data-pedidos-stats style="margin-top:4px;">
          <span data-pedidos-visible-count>${escapeHtml(String(visibleRowsCount))}</span>
          <span>de</span>
          <span data-pedidos-total-count>${escapeHtml(String(selectedScope === "sucursales" ? branchCounts.total : classifiedRows.length))}</span>
          <span data-pedidos-visible-label>${escapeHtml(visibleRowsLabel)}</span>
        </div>
        <div class="pedidos-context">
          <div class="pedidos-context-copy">
            <strong>${selectedScope === "sucursales" ? "Cobertura de sucursales" : "Lectura de pedidos"}</strong>
            <span>${selectedScope === "sucursales"
              ? "Aquí ves cuáles sucursales tienen pedido, cuáles faltan y cómo se reparten por tipo."
              : `Aquí ves el estado operativo de los pedidos del año filtrado. Filtro activo: ${typeLabel}.`}</span>
          </div>
          <div class="pedidos-context-chips">
            ${selectedScope === "sucursales"
              ? [
                  `<span class="pill strong">Estatales: ${escapeHtml(String(branchCounts.estatales))}</span>`,
                  `<span class="pill strong">Municipales: ${escapeHtml(String(branchCounts.municipales))}</span>`,
                  `<span class="pill strong">Otros: ${escapeHtml(String(branchCounts.otros))}</span>`,
                  `<span class="pill strong">Con pedido: ${escapeHtml(String(branchCounts.conPedido))}</span>`,
                  `<span class="pill strong">Sin pedido: ${escapeHtml(String(branchCounts.sinPedido))}</span>`,
                ].join("")
              : [
                  ...typeSummaryChips,
                  `<span class="pill strong">Sin liberación: ${escapeHtml(String(typeRows.filter((row) => row._statusBucket === "sin-liberacion").length))}</span>`,
                  `<span class="pill strong">Liberados: ${escapeHtml(String(typeRows.filter((row) => row._statusBucket === "liberados").length))}</span>`,
                  `<span class="pill strong">Pagados: ${escapeHtml(String(typeRows.filter((row) => row._statusBucket === "pagados").length))}</span>`,
                  `<span class="pill strong">Pend. pago: ${escapeHtml(String(typeRows.filter((row) => row._statusBucket === "pendientes-pago").length))}</span>`,
                ].join("")}
          </div>
        </div>
        <section class="pedidos-view" data-pedidos-view="pedidos">
          <div class="pedidos-view-header">
            <div>
              <h3>Tabla de pedidos</h3>
              <p>Listado operativo de pedidos cargados para el año filtrado.</p>
            </div>
          </div>
          <div class="pedidos-table-shell table-shell">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Sucursal</th>
                  <th>Municipio</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th>Importe</th>
                  <th>Tipo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${rowMarkup}</tbody>
            </table>
          </div>
        </section>
        <section class="pedidos-view" data-pedidos-view="sucursales" hidden>
          <div class="pedidos-view-header">
            <div>
              <h3>Tabla de sucursales</h3>
              <p>Cobertura operativa para detectar faltantes y pedidos existentes.</p>
            </div>
          </div>
          ${branchesMarkup}
        </section>
      </div>
    </div>
  `;
}

async function renderDashboardPage({
  user,
  employees,
  pedidosData = null,
  dashboardData = null,
  selectedEmployee = user,
  returnPath = "/dashboard",
  selectedCapacitacionId = "",
  calendarView = "week",
  calendarPath = "/dashboard",
  calendarQuery = {},
}) {
  const selected = getEmployeeSummary(selectedEmployee);
  const role = selected.role || "capacitador";
  const routeCards = getRouteCardsForRole(role);
  const groupedRouteCards = role === "admin" ? groupAdminRouteCards(routeCards) : null;
  const title = "Portal";
  const logoPath = "/img/Logo%20sin%20fondo%203D%20HD.png";
  const viewingOtherDashboard = user?.role === "admin" && user?.rowId !== selected.rowId;
  const capacitadorView = role === "capacitador";
  const resolvedDashboardData = dashboardData || await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: selected });
  const { visible, programadas, finalizadasSinDiplomas, birthdayEvents, calendarCapacitaciones, calendarNotes } = resolvedDashboardData;
  const selectedCapacitacion = String(selectedCapacitacionId || "").trim()
    ? visible.find((item) => item.rowId === String(selectedCapacitacionId || "").trim())
    : null;
  const showRoutes = user?.role === "admin";
  const showStatusControls = Boolean(user?.role === "admin" || user?.rowId === selected.rowId);
  const selectedEmployeeId = selected.rowId;
  const selectedEmployeeRole = selected.role;
  const detailReturnPath = returnPath || "/dashboard";
  const dashboardReturnHref = buildDashboardReturnHref(calendarPath, calendarQuery, calendarView);
  const calendarEventCount = calendarCapacitaciones.length + birthdayEvents.length + calendarNotes.length;
  const selectedCapacitacionDetailHref = (capacitacion) =>
    buildCapacitacionDetailUrl(capacitacion.rowId, {
      employeeId: selectedEmployeeId,
      returnPath: dashboardReturnHref,
    });
  const sessionUser = user || selected;
  const dashboardHeaderTitle = "Calendario";
  const getDashboardTabIcon = (tabId) => ({
    calendar: "📅",
    gestion: "⚙️",
    pedidos: "🧾",
    faltantes: "⚠️",
    diplomas: "🎓",
    ley: "⚖️",
  })[String(tabId || "").trim()] || "•";
  const floatingMenuButton = showRoutes
    ? `<button class="dashboard-fab button primary" type="button" data-dashboard-drawer-open aria-label="Abrir menu">☰ Menú</button>`
    : "";

  const sideContent = `
    <div class="hero-side-row">
      <div class="hero-session-card hero-brand-card">
        <button class="hero-session-media hero-logo-button" type="button" data-dashboard-reload aria-label="Recargar tablero">
          <img class="hero-logo" src="${logoPath}" alt="Desarrollo EG" />
        </button>
      </div>
      <div class="hero-header-copy">
        <span class="eyebrow">Operación</span>
        <strong data-dashboard-operation-title>${escapeHtml(dashboardHeaderTitle)}</strong>
      </div>
      <div class="hero-session-inline">
        <div class="hero-session-inline__meta">
          <span class="eyebrow">Sesión</span>
          <strong>${escapeHtml(sessionUser?.nombre || "Usuario")}</strong>
          <p>${escapeHtml(sessionUser?.correo || "")}</p>
        </div>
        <div class="hero-session-inline__actions">
          ${viewingOtherDashboard ? `<a class="button secondary button--compact" href="/dashboard">Volver a mi vista</a>` : ""}
          <a class="button primary button--compact" href="/api/auth/logout">Cerrar sesión</a>
        </div>
      </div>
    </div>
  `;

  const calendarPanel = renderCapacitacionesCalendar(calendarCapacitaciones, {
    calendarView,
    calendarPath,
    calendarQuery,
    selectedEmployeeId,
    selectedEmployeeRole,
    returnPath: dashboardReturnHref,
    selectedCapacitacion,
    canEditNotes: showStatusControls,
    birthdayEvents,
    calendarNotes,
    employees,
  });

  const routePanel = showRoutes
    ? `
      <div class="panel dashboard-route-families">
        <div class="section-head">
          <div>
            <h2>Accesos internos</h2>
            <p>Las acciones principales quedan arriba y las utilidades secundarias quedan agrupadas al final para que no compitan con la operación diaria.</p>
          </div>
        </div>
        <section class="dashboard-route-family dashboard-route-family--primary">
          <div class="dashboard-route-family-head">
            <div>
              <h3>Acciones principales</h3>
              <p>Atajos que resuelven la operación más frecuente del tablero administrativo.</p>
            </div>
          </div>
          <div class="portal-grid">
            ${renderRouteGrid(groupedRouteCards?.primary || routeCards.slice(0, 5), { minimal: false })}
          </div>
        </section>
        <section class="dashboard-route-family dashboard-route-family--secondary">
          <div class="dashboard-route-family-head">
            <div>
              <h3>Utilidades secundarias</h3>
              <p>Herramientas de soporte que siguen disponibles, pero ya no ocupan la misma jerarquía visual.</p>
            </div>
          </div>
          <div class="portal-grid">
            ${renderRouteGrid([
              ...(groupedRouteCards?.secondary || []),
              ...(groupedRouteCards?.fallback || []),
            ], { minimal: true })}
          </div>
        </section>
      </div>
    `
    : "";
  const finalizadasPanel = renderFinalizadasSinDiplomasPanel({
    title: "Finalizadas sin diploma",
    description: "Capacitaciones cerradas que todavía requieren diplomas en este dashboard.",
    finalizadasSinDiplomas,
    showStatusControls,
    selectedEmployeeId,
    detailReturnPath,
    emptyMessage: "No hay capacitaciones finalizadas sin diploma.",
  });
  const faltantesLeyUrl = role === "capacitador"
    ? `/dashboard/faltantes-ley-panel?employee=${encodeURIComponent(selected.rowId)}`
    : "";
  const faltantesLeyPanel = role === "capacitador"
    ? renderFaltantesLeyLoadingPanel({
        title: "Faltantes Ley",
        description: "Documentación pendiente de las sucursales atendidas por este capacitador.",
        emptyMessage: "No hay faltantes para este capacitador.",
        url: faltantesLeyUrl,
      })
    : "";

  const peoplePanel = user?.role === "admin"
    ? `
      <div class="panel">
        <h2>Capacitadores</h2>
        <div class="employee-grid">
          ${renderEmployeeGrid(employees.filter((item) => item.role === "capacitador"))}
        </div>
      </div>
    `
    : "";
  const adminFaltantesPanel = user?.role === "admin"
    ? `
      <div class="panel">
        <div class="section-head">
          <div>
            <h2>Faltantes</h2>
            <p>Revisa la documentación pendiente de las sucursales en la vista completa y aplica filtros por capacitador.</p>
          </div>
        </div>
        <div class="hero-actions" style="margin-top:12px;">
          <a class="button primary" href="/faltantes-ley">Abrir faltantes ley</a>
        </div>
      </div>
    `
    : "";
  const managementPanel = user?.role === "admin"
    ? `
      <div class="dashboard-tab-panel-content dashboard-tab-panel--management">
        ${peoplePanel}
        ${routePanel}
      </div>
    `
    : "";
  const pedidosPanel = user?.role === "admin"
    ? renderPedidosAdminDashboardPanel({
        data: pedidosData || {},
        year: pedidosData?.requestedYear || pedidosData?.year || new Date().getFullYear(),
        embedded: true,
      })
    : "";
  const dashboardTabs = [
    {
      id: "calendar",
      label: "Calendario",
      count: calendarEventCount,
      content: calendarPanel,
    },
    ...(managementPanel
      ? [{
          id: "gestion",
          label: "Gestión",
          content: managementPanel,
        }]
      : []),
    ...(pedidosPanel
      ? [{
          id: "pedidos",
          label: "Pedidos",
          content: pedidosPanel,
        }]
      : []),
    ...(adminFaltantesPanel
      ? [{
          id: "faltantes",
          label: "Faltantes",
          content: adminFaltantesPanel,
        }]
      : []),
    {
      id: "diplomas",
      label: "Diplomas faltantes",
      count: finalizadasSinDiplomas.length,
      content: finalizadasPanel,
    },
    ...(role === "capacitador" && faltantesLeyPanel
      ? [{
          id: "ley",
          label: "Faltantes Ley",
          content: faltantesLeyPanel,
        }]
      : []),
  ].filter((tab) => Boolean(tab.content));
  const activeTabId = dashboardTabs[0]?.id || "calendar";
  const dashboardPrimaryLinks = showRoutes
    ? Array.from(new Map((groupedRouteCards?.primary || routeCards.slice(0, 5))
        .slice(0, 6)
        .map((card) => [String(card.label || card.title || "").trim().toLowerCase(), card])).values())
    : [];
  const renderDashboardTabButton = (tab, { compact = false, drawer = false } = {}) => `
    <button
      type="button"
      class="dashboard-nav-link${tab.id === activeTabId ? " active" : ""}${compact ? " dashboard-nav-link--compact" : ""}${drawer ? " dashboard-nav-link--drawer" : ""}"
      role="tab"
      aria-selected="${tab.id === activeTabId ? "true" : "false"}"
      aria-controls="dashboard-tab-${tab.id}"
      data-dashboard-tab="${escapeAttr(tab.id)}"
    >
      <span class="dashboard-nav-link__leading">
        <span class="dashboard-nav-link__icon" aria-hidden="true">${escapeHtml(getDashboardTabIcon(tab.id))}</span>
        <span class="dashboard-nav-link__label">${escapeHtml(tab.label)}</span>
      </span>
      ${typeof tab.count === "number" ? `<span class="dashboard-nav-link__count">${escapeHtml(String(tab.count))}</span>` : ""}
    </button>
  `;
  const dashboardSidebarContent = `
      <div class="dashboard-sidebar__content">
      <div class="dashboard-sidebar__header">
        <span class="eyebrow">Navegación</span>
      </div>
      <div class="dashboard-sidebar__groups">
        <section class="dashboard-nav-group">
          <h2>Secciones</h2>
          <div class="dashboard-nav-group__links">
            ${dashboardTabs.map((tab) => renderDashboardTabButton(tab)).join("")}
          </div>
        </section>
        ${showRoutes ? `
        <section class="dashboard-nav-group">
          <h2>Accesos</h2>
          <div class="dashboard-nav-group__links">
            ${dashboardPrimaryLinks.map((card) => `
              <a class="dashboard-nav-link dashboard-nav-link--compact" href="${escapeAttr(card.href)}">
                <span class="dashboard-nav-link__label">${escapeHtml(card.label || card.title || "")}</span>
              </a>
            `).join("")}
          </div>
        </section>
        ` : ""}
      </div>
    </div>
  `;
  const dashboardDrawer = `
    <div class="dashboard-drawer" data-dashboard-drawer hidden>
      <button class="dashboard-drawer__backdrop" type="button" aria-label="Cerrar menu" data-dashboard-drawer-close></button>
      <aside class="dashboard-drawer__panel" data-dashboard-drawer-panel tabindex="-1">
        <div class="dashboard-drawer__top">
          <strong>Menú</strong>
          <button class="button ghost button--compact" type="button" data-dashboard-drawer-close>Cerrar</button>
        </div>
        ${dashboardSidebarContent}
      </aside>
    </div>
  `;
  const dashboardMobileDock = `
    <nav class="dashboard-mobile-dock" aria-label="Navegacion movil">
      <button
        class="dashboard-nav-link dashboard-nav-link--compact dashboard-mobile-dock__menu"
        type="button"
        aria-label="Abrir menu"
        aria-expanded="false"
        data-dashboard-drawer-open
      >
        ☰ <span class="dashboard-nav-link__label">Menú</span>
      </button>
      <div class="dashboard-mobile-dock__track">
        ${dashboardTabs.map((tab) => renderDashboardTabButton(tab, { compact: true, drawer: true })).join("")}
        ${showRoutes ? `
          ${dashboardPrimaryLinks.map((card) => `
            <a class="dashboard-nav-link dashboard-nav-link--compact dashboard-nav-link--drawer" href="${escapeAttr(card.href)}">
              <span class="dashboard-nav-link__leading">
                <span class="dashboard-nav-link__icon" aria-hidden="true">↗</span>
                <span class="dashboard-nav-link__label">${escapeHtml(card.label || card.title || "")}</span>
              </span>
            </a>
          `).join("")}
        ` : ""}
      </div>
    </nav>
  `;
  const dashboardTabPanels = dashboardTabs.map((tab) => `
    <section
      id="dashboard-tab-${escapeAttr(tab.id)}"
      class="dashboard-tab-panel${tab.id === activeTabId ? " is-active" : ""}"
      role="tabpanel"
      aria-labelledby="dashboard-tab-${escapeAttr(tab.id)}"
      data-dashboard-tab-panel="${escapeAttr(tab.id)}"
      ${tab.id === activeTabId ? "" : "hidden"}
    >
      ${tab.content}
    </section>
  `).join("");
  const calendarBootstrap = user
    ? `
      <script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.20/index.global.min.js"></script>
      <script>
        document.addEventListener("DOMContentLoaded", function () {
          const dataEl = document.getElementById("dashboard-calendar-data");
          const mount = document.getElementById("dashboard-calendar");
          const detailMount = document.getElementById("dashboard-calendar-detail");
          if (!dataEl || !mount || typeof FullCalendar === "undefined") return;
          const payload = JSON.parse(dataEl.textContent || "{}");
          const isMobile = window.matchMedia("(max-width: 767px)").matches;
          const initialView = isMobile
            ? (payload.mobileInitialView || mount.dataset.mobileView || payload.initialView || mount.dataset.initialView || "dayGridMonth")
            : (mount.dataset.initialView || payload.initialView || "dayGridMonth");
          const openDetailOnLoad = Boolean(payload.openDetailOnLoad);
          const events = Array.isArray(payload.events) ? payload.events : [];
          const legendItems = Array.isArray(payload.legendItems) ? payload.legendItems : [];
          const selectedId = String(payload.selectedId || "");
          const canEditNotes = Boolean(payload.canEditNotes);
          const employees = Array.isArray(payload.employees) ? payload.employees : [];
          const defaultCapacitadorFilter = String(payload.defaultCapacitadorFilter || "");
          const selectedEmployeeId = String(payload.selectedEmployeeId || "");
          const returnTo = String(payload.returnTo || "/dashboard");
          const filterButtons = Array.from(document.querySelectorAll("[data-capacitador-filter]"));
          const tabs = Array.from(document.querySelectorAll("[data-dashboard-tab]"));
          const panels = Array.from(document.querySelectorAll("[data-dashboard-tab-panel]"));
          const mobileChips = Array.from(document.querySelectorAll(".dashboard-mobile-chip"));
          const operationTitle = document.querySelector("[data-dashboard-operation-title]");
          const operationTitleMap = {
            calendar: "Calendario",
            gestion: "Gestión",
            pedidos: "Pedidos",
            faltantes: "Faltantes",
            diplomas: "Diplomas faltantes",
            ley: "Faltantes Ley",
          };
          let activeCapacitadorFilter = defaultCapacitadorFilter;
          const escapeHtml = (value) => String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
          const normalizeDateInputValue = (value) => {
            const text = String(value || "").trim();
            if (!text) return "";
            const direct = new Date(text);
            if (!Number.isNaN(direct.getTime())) {
              return direct.toISOString().slice(0, 10);
            }
            const slash = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
            if (slash) {
              const first = Number(slash[1]);
              const second = Number(slash[2]);
              const year = slash[3];
              const month = first > 12 && second <= 12 ? second : first;
              const day = first > 12 && second <= 12 ? first : second;
              return String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
            }
            return "";
          };
          const renderEmployeePicker = (selectedIds = []) => {
            const selected = new Set((Array.isArray(selectedIds) ? selectedIds : [selectedIds]).map((item) => String(item || "").trim()).filter(Boolean));
            if (!employees.length) {
              return '<div class="calendar-note-tags"><label class="calendar-note-tag calendar-note-tag--all" style="--tag-color:#b45309;--tag-text:#ffffff;">' +
                '<input type="checkbox" name="empleados" value="TODOS" ' + (selected.has("TODOS") ? 'checked' : '') + ' />' +
                '<span>TODOS</span>' +
              '</label></div>';
            }
            return '<div class="calendar-note-tags"><label class="calendar-note-tag calendar-note-tag--all" style="--tag-color:#b45309;--tag-text:#ffffff;">' +
                '<input type="checkbox" name="empleados" value="TODOS" ' + (selected.has("TODOS") ? 'checked' : '') + ' />' +
                '<span>TODOS</span>' +
              '</label>' + employees.map((employee) => {
              const rowId = String(employee?.rowId || "").trim();
              const color = String(employee?.calendarColor || employee?.color || "").trim() || "#1e3a8a";
              const textColor = String(employee?.textColor || "#ffffff").trim() || "#ffffff";
              return '<label class="calendar-note-tag" style="--tag-color:' + escapeHtml(color) + ';--tag-text:' + escapeHtml(textColor) + ';">' +
                '<input type="checkbox" name="empleados" value="' + escapeHtml(rowId) + '" ' + (selected.has(rowId) ? 'checked' : '') + ' />' +
                '<span>' + escapeHtml(employee?.nombre || rowId || "") + '</span>' +
              '</label>';
            }).join("") + '</div>';
          };
          const renderCalendarNoteForm = (noteData = {}, submitLabel = "Guardar nota") => {
            const note = noteData || {};
            const selectedIds = Array.isArray(note.employeeKeys) && note.employeeKeys.length > 0
              ? note.employeeKeys
              : note.audienceAll
                ? ["TODOS"].concat(employees.map((employee) => String(employee?.rowId || "").trim()).filter(Boolean))
                : Array.isArray(note.employeeTokens) && note.employeeTokens.some((token) => ["TODOS", "ALL", "TODAS", "*"].includes(String(token || "").trim().toUpperCase()))
                ? ["TODOS"]
              : selectedEmployeeId
                ? [selectedEmployeeId]
                : [];
            const today = new Date();
            const todayValue = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
            const noteDateValue = normalizeDateInputValue(note.dateRaw || note.start || note.dateLabel || "") || todayValue;
            const iconValue = String(note.icon || note.noteIcon || "").trim() || "📝";
            const rowInput = note.rowId ? '<input type="hidden" name="rowId" value="' + escapeHtml(note.rowId) + '" />' : "";
            return '<form class="calendar-note-form js-async-calendar-note" method="post" action="/dashboard/calendario/notas">' +
              rowInput +
              '<input type="hidden" name="returnTo" value="' + escapeHtml(returnTo) + '" />' +
              '<div class="calendar-note-header">' +
                '<span class="detail-kicker">' + escapeHtml(note.rowId ? "Editar nota" : "Nueva nota") + '</span>' +
                '<button type="button" class="calendar-note-close js-close-calendar-detail" aria-label="Cerrar nota">×</button>' +
              '</div>' +
              '<div class="calendar-note-grid">' +
                '<label class="calendar-note-field">' +
                  '<span>Fecha</span>' +
                  '<input type="date" name="fecha" value="' + escapeHtml(noteDateValue) + '" required />' +
                '</label>' +
                '<label class="calendar-note-field">' +
                  '<span>Icono</span>' +
                  '<select name="icono">' +
                    [
                      ["📝", "Nota"],
                      ["📣", "Aviso"],
                      ["🔔", "Recordatorio"],
                      ["📌", "Fijado"],
                      ["🎯", "Objetivo"],
                      ["⭐", "Destacado"],
                      ["🎉", "Celebración"],
                      ["⚠️", "Urgente"],
                    ].map(([value, label]) => '<option value="' + escapeHtml(value) + '"' + (iconValue === value ? ' selected' : '') + '>' + escapeHtml(label) + '</option>').join("") +
                  '</select>' +
                '</label>' +
                '<label class="calendar-note-field">' +
                  '<span>Mensaje</span>' +
                  '<input type="text" name="titulo" value="' + escapeHtml(note.noteTitle || note.title || "") + '" placeholder="Ej. Recordatorio interno" />' +
                '</label>' +
              '</div>' +
              '<label class="calendar-note-field calendar-note-field--wide">' +
                '<span>Detalle opcional</span>' +
                '<textarea name="notas" rows="4" class="notes-textarea" placeholder="Escribe un detalle opcional...">' + escapeHtml(note.notes || "") + '</textarea>' +
              '</label>' +
              '<div class="calendar-note-field">' +
                '<span>Etiquetar empleados</span>' +
                renderEmployeePicker(selectedIds) +
              '</div>' +
              '<div class="notes-actions">' +
                '<button type="submit" class="status-button">' + escapeHtml(submitLabel) + '</button>' +
                '<span class="notes-state">' + (note.rowId ? "Nota lista para editar" : "Nota nueva") + '</span>' +
              '</div>' +
            '</form>';
          };
          const openCalendarNoteComposer = () => {
            if (!detailMount || !canEditNotes) return;
            detailMount.innerHTML = '<div class="calendar-detail-surface"><div class="calendar-detail-card">' + renderCalendarNoteForm({}, "Crear nota") + '</div></div>';
            detailMount.classList.add("is-open");
            detailMount.setAttribute("aria-hidden", "false");
          };
          const renderDetail = (eventData) => {
            if (!eventData) {
              return "";
            }
            const props = eventData.extendedProps || {};
            if (props.eventType === "birthday") {
              return \`
                <div class="calendar-detail-card calendar-detail-card--birthday" data-calendar-event-id="\${escapeHtml(eventData.capacitacionId || eventData.id || "")}">
                  <div class="calendar-detail-top-actions">
                    <button type="button" class="calendar-detail-close js-close-calendar-detail" aria-label="Cerrar detalle">×</button>
                  </div>
                  <div class="calendar-detail-top">
                    <div>
                      <span class="detail-kicker">Cumpleaños</span>
                      <h3>\${escapeHtml(props.employeeName || eventData.title || "Cumpleaños")}</h3>
                    </div>
                    <span class="status-chip is-programada">Anual</span>
                  </div>
                  <div class="calendar-detail-meta">
                    <span class="chip">\${escapeHtml(props.dateLabel || eventData.start || "")}</span>
                  </div>
                </div>
              \`;
            }
            if (props.eventType === "calendar-note" || props.eventType === "nota" || props.eventType === "note") {
            const noteData = {
                ...(eventData || {}),
                ...(props || {}),
              };
              noteData.rowId = noteData.rowId || noteData.noteId || noteData.capacitacionId || noteData.id || "";
              noteData.dateRaw = noteData.dateRaw || noteData.start || noteData.dateLabel || "";
              noteData.title = noteData.title || noteData.noteTitle || eventData?.title || "Nota";
              noteData.notes = noteData.notes || props.notes || "";
              noteData.icon = noteData.icon || noteData.noteIcon || "📝";
              const employeeSummaries = Array.isArray(props.employeeSummaries) ? props.employeeSummaries : [];
              return \`
                <div class="calendar-detail-card calendar-detail-card--note" data-calendar-event-id="\${escapeHtml(eventData.capacitacionId || eventData.id || "")}">
                  <div class="calendar-detail-top-actions">
                    <button type="button" class="calendar-detail-close js-close-calendar-detail" aria-label="Cerrar detalle">×</button>
                  </div>
                  <div class="calendar-detail-top">
                    <div>
                      <span class="detail-kicker">Nota del calendario</span>
                      <h3><span class="calendar-note-emoji">\${escapeHtml(noteData.icon || props.noteIcon || "📝")}</span> \${escapeHtml(props.noteTitle || eventData.title || "Nota")}</h3>
                    </div>
                    <span class="status-chip is-programada">Nota</span>
                  </div>
                  <div class="calendar-detail-meta">
                    <span class="chip">\${escapeHtml(noteData.dateRaw || props.dateLabel || eventData.start || "")}</span>
                    <span class="chip">\${escapeHtml(props.audienceAll ? "TODOS" : (employeeSummaries.length ? employeeSummaries.length + " etiquetado(s)" : "Sin etiquetas"))}</span>
                  </div>
                  <div class="calendar-detail-section">
                    <strong>Empleados etiquetados</strong>
                    <div class="tag-row">\${employeeSummaries.length
                      ? employeeSummaries.map((item) => {
                          const color = item.color || "#1e3a8a";
                          const textColor = item.textColor || "#ffffff";
                          return \`<span class="tag-pill" style="background:\${escapeHtml(color)};color:\${escapeHtml(textColor)};border-color:\${escapeHtml(color)};">\${escapeHtml(item.nombre || item.rowId || "")}</span>\`;
                        }).join("")
                      : '<span class="calendar-empty">Sin etiquetas</span>'}
                    </div>
                  </div>
                  <div class="calendar-detail-section">
                    <strong>Nota</strong>
                    \${canEditNotes ? renderCalendarNoteForm(noteData, "Guardar nota") : \`<span>\${escapeHtml(props.notes || "Sin nota")}</span>\`}
                  </div>
                  \${canEditNotes && noteData.rowId ? \`
                    <div class="calendar-detail-section">
                      <button type="button" class="button ghost js-delete-calendar-note" data-calendar-note-id="\${escapeHtml(noteData.rowId)}">Eliminar nota</button>
                    </div>
                  \` : ""}
                </div>
              \`;
            }
            const statusClass = props.statusLabel === "FINALIZADA" ? "is-finalizada" : "is-programada";
            const tags = [];
            if (props.dateLabel) tags.push(\`<span class="chip">\${escapeHtml(props.dateLabel)}</span>\`);
            if (props.hourLabel) tags.push(\`<span class="chip">\${escapeHtml(props.hourLabel)}</span>\`);
            if (props.statusLabel) tags.push(\`<span class="status-chip \${statusClass}">\${escapeHtml(props.statusLabel)}</span>\`);
            return \`
              <div class="calendar-detail-card" data-capacitacion-id="\${escapeHtml(eventData.capacitacionId || eventData.id || "")}">
                <div class="calendar-detail-top-actions">
                  <button type="button" class="calendar-detail-close js-close-calendar-detail" aria-label="Cerrar detalle">×</button>
                </div>
                <div class="calendar-detail-top">
                  <div>
                    <span class="detail-kicker">Evento del calendario</span>
                    <h3>\${escapeHtml(eventData.title || "Capacitación")}</h3>
                  </div>
                  <span class="status-chip \${statusClass}">\${escapeHtml(props.statusLabel || "Sin estado")}</span>
                </div>
                <div class="calendar-detail-meta">\${tags.join("")}</div>
                <div class="calendar-detail-section">
                  <strong>Capacitadores</strong>
                  <div class="tag-row">\${Array.isArray(props.capacitadores) && props.capacitadores.length
                    ? props.capacitadores.map((item) => {
                        const color = item.color || props.primaryColor || "#1e3a8a";
                        const textColor = item.textColor || "#ffffff";
                        return \`<span class="tag-pill" style="background:\${escapeHtml(color)};color:\${escapeHtml(textColor)};border-color:\${escapeHtml(color)};">\${escapeHtml(item.nombre || item.key || "")}</span>\`;
                      }).join("")
                    : \`<span class="calendar-empty">PENDIENTE</span>\`}
                  </div>
                </div>
                <div class="calendar-detail-section">
                  <strong>Sucursales a capacitar</strong>
                  <div class="tag-row">
                    \${String(props.sucursalesLabel || "")
                      .split(" · ")
                      .filter(Boolean)
                      .map((item) => \`<span class="tag-pill">\${escapeHtml(item)}</span>\`)
                      .join("") || '<span class="calendar-empty">Sin sucursales</span>'}
                  </div>
                </div>
                <div class="calendar-detail-section">
                  <strong>Notas</strong>
                  \${canEditNotes ? \`
                    <form class="notes-form js-async-notes" method="post" action="/dashboard/capacitaciones/\${escapeHtml(eventData.capacitacionId || eventData.id || "")}/notas">
                      <input type="hidden" name="returnTo" value="/dashboard" />
                      <textarea name="notas" rows="4" class="notes-textarea" placeholder="Escribe notas del evento...">\${escapeHtml(props.notes || "")}</textarea>
                      <div class="notes-actions">
                        <button type="submit" class="status-button">Guardar notas</button>
                        <span class="notes-state">\${props.notes ? "Notas guardadas" : "Sin notas"}</span>
                      </div>
                    </form>
                  \` : \`<span>\${escapeHtml(props.notes || "Sin notas")}</span>\`}
                </div>
                <div class="calendar-detail-actions">
                  <a class="button primary" href="\${escapeHtml(props.constanciasUrl || "#")}" target="_blank" rel="noopener noreferrer">Crear constancias</a>
                </div>
              </div>
            \`;
          };
          const updateNotesState = (form, value) => {
            const button = form?.querySelector('button[type="submit"]');
            const state = form?.querySelector(".notes-state");
            if (state) state.textContent = value ? "Notas guardadas" : "Sin notas";
            if (button) button.disabled = false;
          };
          const syncDetail = (eventData) => {
            if (!detailMount) return;
            if (!eventData) {
              detailMount.classList.remove("is-open");
              detailMount.setAttribute("aria-hidden", "true");
              detailMount.innerHTML = "";
              return;
            }
            detailMount.innerHTML = '<div class="calendar-detail-surface">' + renderDetail(eventData) + '</div>';
            detailMount.classList.add("is-open");
            detailMount.setAttribute("aria-hidden", "false");
          };
          const getVisibleEvents = () => events.filter((eventData) => {
            if (!activeCapacitadorFilter || activeCapacitadorFilter === "__all") return true;
            const props = eventData?.extendedProps || {};
            if (props.eventType !== "capacitacion") return true;
            const keys = Array.isArray(props.capacitadorKeys) ? props.capacitadorKeys.map((item) => String(item || "").trim()).filter(Boolean) : [];
            return keys.includes(activeCapacitadorFilter);
          });
          const applyCalendarFilter = () => {
            if (!calendarInstance) return;
            calendarInstance.removeAllEvents();
            calendarInstance.addEventSource(getVisibleEvents());
            const nextEvent = getVisibleEvents().find((item) => String(item.id) === selectedId) || getVisibleEvents()[0] || null;
            syncDetail(openDetailOnLoad ? nextEvent : null);
          };
          const syncFilterButtons = () => {
            filterButtons.forEach((button) => {
              const isClear = button.dataset.capacitadorFilter === "__all";
              const isActive = isClear ? !activeCapacitadorFilter : button.dataset.capacitadorFilter === activeCapacitadorFilter;
              button.classList.toggle("is-active", isActive);
              button.setAttribute("aria-pressed", isActive ? "true" : "false");
            });
          };
          const updateDiplomaState = (form, value) => {
            const button = form?.querySelector('button[name="diplomas"]');
            if (!button) return;
            const isYes = String(value || "").trim().toUpperCase() === "Y";
            button.textContent = isYes ? "Diplomas: Sí" : "Marcar diplomas: Sí";
            button.classList.toggle("active", isYes);
            button.disabled = false;
          };
          let calendarInstance = null;
          const initPedidosPanel = (panel) => {
            if (!panel) return;
            const loading = panel.querySelector("[data-pedidos-loading]");
            const root = panel.querySelector("[data-pedidos-root]");
            const content = root?.querySelector("[data-pedidos-panel]") || panel.querySelector("[data-pedidos-panel]");
            if (!content) return;
            if (root) root.style.display = "block";
            if (loading) loading.style.display = "none";

            const normalizeText = (value) => String(value || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim()
              .toUpperCase();
            const state = {
              scope: String(content.dataset.scope || "pedidos").trim() || "pedidos",
              status: String(content.dataset.status || "all").trim() || "all",
              type: String(content.dataset.type || "all").trim() || "all",
              search: String(content.dataset.search || "").trim(),
              year: String(content.dataset.year || new Date().getFullYear()).trim(),
              facturadorId: String(content.dataset.facturadorId || "").trim(),
              estatalMin: String(content.dataset.estatalMin || "32000").trim(),
              municipalMin: String(content.dataset.municipalMin || "9794.98").trim(),
            };
            const portalUrl = (path) => (window.__PORTAL_URL__ ? window.__PORTAL_URL__(path) : path);
            const rows = Array.from(content.querySelectorAll("[data-pedidos-row]"));
            const branchRows = Array.from(content.querySelectorAll("[data-pedidos-branch-row]"));
            const scopeButtons = Array.from(content.querySelectorAll("[data-pedidos-scope]"));
            const statusButtons = Array.from(content.querySelectorAll("[data-pedidos-status]"));
            const typeButtons = Array.from(content.querySelectorAll("[data-pedidos-type]"));
            const yearInput = content.querySelector("[data-pedidos-year]");
            const facturadorInput = content.querySelector("[data-pedidos-facturador]");
            const estatalMinInput = content.querySelector("[data-pedidos-estatal-min]");
            const municipalMinInput = content.querySelector("[data-pedidos-municipal-min]");
            const searchInput = content.querySelector("[data-pedidos-search]");
            const applyBtn = content.querySelector("[data-pedidos-apply]");
            const resetBtn = content.querySelector("[data-pedidos-reset]");
            const refreshBtn = content.querySelector("[data-pedidos-refresh]");
            const visibleCount = content.querySelector("[data-pedidos-visible-count]");
            const totalCount = content.querySelector("[data-pedidos-total-count]");
            const visibleLabel = content.querySelector("[data-pedidos-visible-label]");
            const stats = content.querySelector("[data-pedidos-stats]");
            const pedidosView = content.querySelector('[data-pedidos-view="pedidos"]');
            const sucursalesView = content.querySelector('[data-pedidos-view="sucursales"]');
            const updateButtonState = (buttons, attr, activeValue) => {
              buttons.forEach((button) => {
                const value = String(button.getAttribute(attr) || "all").trim();
                const isActive = value === activeValue;
                button.classList.toggle("is-active", isActive);
                button.setAttribute("aria-pressed", isActive ? "true" : "false");
              });
            };
            const renderLocal = () => {
              const query = normalizeText(state.search);
              const matchesFilters = (row) => {
                const status = String(row.dataset.status || "otros").trim();
                const type = String(row.dataset.type || "otros").trim();
                const haystack = normalizeText(row.dataset.search || "");
                return (state.status === "all" || status === state.status)
                  && (state.type === "all" || type === state.type)
                  && (!query || haystack.includes(query));
              };
              const visibleOrderRows = rows.filter(matchesFilters);
              const visibleBranchRows = branchRows.filter(matchesFilters);
              rows.forEach((row) => { row.hidden = true; });
              branchRows.forEach((row) => { row.hidden = true; });
              if (state.scope === "pedidos") {
                visibleOrderRows.forEach((row) => { row.hidden = false; });
              }
              if (state.scope === "sucursales") {
                visibleBranchRows.forEach((row) => { row.hidden = false; });
              }
              if (pedidosView) pedidosView.hidden = state.scope !== "pedidos";
              if (sucursalesView) sucursalesView.hidden = state.scope !== "sucursales";
              const activeRows = state.scope === "sucursales" ? visibleBranchRows : visibleOrderRows;
              const visible = activeRows.length;
              if (visibleCount) visibleCount.textContent = String(visible);
              if (totalCount) totalCount.textContent = String(state.scope === "sucursales" ? branchRows.length : rows.length);
              if (visibleLabel) visibleLabel.textContent = state.scope === "sucursales" ? "sucursales visibles" : "pedidos visibles";
              if (stats) {
                stats.dataset.visible = String(visible);
                stats.dataset.total = String(activeRows.length);
              }
              updateButtonState(scopeButtons, "data-pedidos-scope", state.scope);
              updateButtonState(statusButtons, "data-pedidos-status", state.status);
              updateButtonState(typeButtons, "data-pedidos-type", state.type);
            };
            const reload = () => {
              const url = new URL(portalUrl("/dashboard/pedidos/panel"), window.location.origin);
              url.searchParams.set("year", state.year || String(new Date().getFullYear()));
              if (state.scope && state.scope !== "pedidos") url.searchParams.set("scope", state.scope);
              if (state.facturadorId) url.searchParams.set("facturadorId", state.facturadorId);
              if (state.estatalMin) url.searchParams.set("estatalMin", state.estatalMin);
              if (state.municipalMin) url.searchParams.set("municipalMin", state.municipalMin);
              if (state.status && state.status !== "all") url.searchParams.set("status", state.status);
              if (state.type && state.type !== "all") url.searchParams.set("type", state.type);
              if (state.search) url.searchParams.set("search", state.search);
              fetch(url.toString(), { headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" })
                .then((response) => {
                  if (!response.ok) throw new Error("HTTP " + response.status);
                  return response.text();
                })
                .then((html) => {
                  root.innerHTML = html;
                  root.style.display = "block";
                  panel.dataset.loaded = "true";
                  initPedidosPanel(panel);
                })
                .catch((error) => {
                  root.style.display = "block";
                  root.innerHTML = '<div class="panel" style="margin:0;border-top-color:var(--danger);"><div class="section-head"><div><h2>No se pudo cargar pedidos</h2><p>' + String(error instanceof Error ? error.message : "Error inesperado") + '</p></div></div></div>';
                  panel.dataset.loaded = "true";
                });
            };
            statusButtons.forEach((button) => {
              button.addEventListener("click", () => {
                state.status = String(button.getAttribute("data-pedidos-status") || "all").trim() || "all";
                renderLocal();
              });
            });
            typeButtons.forEach((button) => {
              button.addEventListener("click", () => {
                state.type = String(button.getAttribute("data-pedidos-type") || "all").trim() || "all";
                renderLocal();
              });
            });
            scopeButtons.forEach((button) => {
              button.addEventListener("click", () => {
                state.scope = String(button.getAttribute("data-pedidos-scope") || "pedidos").trim() || "pedidos";
                renderLocal();
              });
            });
            searchInput?.addEventListener("input", (event) => {
              state.search = String(event.target.value || "").trim();
              renderLocal();
            });
            yearInput?.addEventListener("change", (event) => {
              const next = String(event.target.value || "").trim();
              if (next) state.year = next;
            });
            facturadorInput?.addEventListener("change", (event) => {
              state.facturadorId = String(event.target.value || "").trim();
            });
            estatalMinInput?.addEventListener("change", (event) => {
              state.estatalMin = String(event.target.value || "").trim();
            });
            municipalMinInput?.addEventListener("change", (event) => {
              state.municipalMin = String(event.target.value || "").trim();
            });
            applyBtn?.addEventListener("click", reload);
            refreshBtn?.addEventListener("click", () => {
              const previous = new URL(window.location.href);
              previous.searchParams.set("refresh", "1");
              window.location.assign(previous.toString());
            });
            resetBtn?.addEventListener("click", () => {
              state.scope = "pedidos";
              state.status = "all";
              state.type = "all";
              state.search = "";
              state.year = String(new Date().getFullYear());
              state.facturadorId = "";
              state.estatalMin = "32000";
              state.municipalMin = "9794.98";
              reload();
            });
            renderLocal();
          };
          const loadPedidosPanel = () => {
            const panel = document.querySelector('[data-dashboard-tab-panel="pedidos"]');
            if (!panel || panel.dataset.loaded === "true") return;
            const loading = panel.querySelector("[data-pedidos-loading]");
            const root = panel.querySelector("[data-pedidos-root]");
            if (!root) return;
            if (root.querySelector("[data-pedidos-panel]")) {
              panel.dataset.loaded = "true";
              initPedidosPanel(panel);
              return;
            }
            const year = new Date().getFullYear();
            const url = portalUrl("/dashboard/pedidos/panel") + "?year=" + encodeURIComponent(String(year));
            fetch(url, { headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" })
              .then((response) => {
                if (!response.ok) throw new Error("HTTP " + response.status);
                return response.text();
              })
              .then((html) => {
                root.innerHTML = html;
                root.style.display = "block";
                if (loading) loading.style.display = "none";
                panel.dataset.loaded = "true";
                initPedidosPanel(panel);
              })
              .catch((error) => {
                if (loading) {
                  loading.style.display = "none";
                }
                root.style.display = "block";
                root.innerHTML = '<div class="panel" style="margin:0;border-top-color:var(--danger);"><div class="section-head"><div><h2>No se pudo cargar pedidos</h2><p>' + String(error instanceof Error ? error.message : "Error inesperado") + '</p></div></div></div>';
                panel.dataset.loaded = "true";
              });
          };
          const loadDeferredPanel = async (panelId) => {
            const panel = document.querySelector('[data-dashboard-tab-panel="' + panelId + '"]');
            if (!panel || panel.dataset.loaded === "true") return;
            const shell = panel.querySelector("[data-faltantes-ley-shell]");
            const url = shell?.dataset.faltantesLeyUrl || "";
            if (!shell || !url) return;
            shell.dataset.loading = "true";
            try {
              const response = await fetch(url, { headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" });
              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || "HTTP " + response.status);
              }
              const html = await response.text();
              shell.outerHTML = html;
              panel.dataset.loaded = "true";
            } catch (error) {
              const placeholder = panel.querySelector("[data-faltantes-ley-placeholder]");
              const empty = panel.querySelector("[data-faltantes-ley-empty]");
              if (placeholder) placeholder.style.display = "none";
              if (empty) {
                empty.textContent = error instanceof Error ? error.message : "No se pudieron cargar los faltantes.";
                empty.style.display = "";
              }
            } finally {
              if (shell) shell.dataset.loading = "false";
            }
          };
          const setActiveTab = (tabId, { focus = false } = {}) => {
            const nextTab = String(tabId || "").trim() || (tabs[0]?.dataset.dashboardTab || "calendar");
            if (operationTitle) {
              operationTitle.textContent = operationTitleMap[nextTab] || operationTitleMap.calendar;
            }
            tabs.forEach((button) => {
              const isActive = button.dataset.dashboardTab === nextTab;
              button.classList.toggle("active", isActive);
              button.setAttribute("aria-selected", isActive ? "true" : "false");
              button.tabIndex = isActive ? 0 : -1;
            });
            panels.forEach((panel) => {
              const isActive = panel.dataset.dashboardTabPanel === nextTab;
              panel.hidden = !isActive;
              panel.classList.toggle("is-active", isActive);
            });
            if (nextTab === "calendar" && calendarInstance) {
              requestAnimationFrame(() => requestAnimationFrame(() => calendarInstance?.updateSize?.()));
            }
            if (nextTab === "ley") {
              loadDeferredPanel("ley");
            }
            if (nextTab === "pedidos") {
              loadPedidosPanel();
            }
            if (focus) {
              tabs.find((button) => button.dataset.dashboardTab === nextTab)?.focus();
            }
          };
          tabs.forEach((button) => {
            button.addEventListener("click", () => setActiveTab(button.dataset.dashboardTab));
          });
          mobileChips.forEach((button) => {
            button.addEventListener("click", () => setActiveTab(button.dataset.dashboardTab, { focus: false }));
          });
          if (detailMount) {
            detailMount.addEventListener("click", (event) => {
              const target = event.target instanceof Element ? event.target : null;
              if (!target) return;
              if (target === detailMount) {
                syncDetail(null);
                return;
              }
              if (target.closest(".js-close-calendar-detail")) {
                syncDetail(null);
              }
            });
          }
          document.addEventListener("submit", async (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.classList.contains("js-async-diplomas")) return;
            event.preventDefault();
            const button = form.querySelector('button[name="diplomas"]');
            if (button) button.disabled = true;
            try {
              const response = await fetch(form.action, {
                method: "POST",
                body: new FormData(form),
                headers: { "X-Requested-With": "fetch" },
                credentials: "same-origin",
              });
              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || "HTTP " + response.status);
              }
              updateDiplomaState(form, form.querySelector('button[name="diplomas"]')?.value || "Y");
              const card = form.closest(".capacitacion-card");
              if (card) {
                card.style.transition = "opacity 180ms ease, transform 180ms ease";
                card.style.opacity = "0";
                card.style.transform = "translateY(-4px)";
                setTimeout(() => card.remove(), 220);
              }
            } catch (error) {
              if (button) button.disabled = false;
              alert(error instanceof Error ? error.message : "No se pudo actualizar los diplomas.");
            }
          });
          document.addEventListener("submit", async (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.classList.contains("js-async-notes")) return;
            event.preventDefault();
            const button = form.querySelector('button[type="submit"]');
            if (button) button.disabled = true;
            try {
              const payload = new URLSearchParams(new FormData(form));
              const response = await fetch(form.action, {
                method: "POST",
                body: payload,
                headers: {
                  "X-Requested-With": "fetch",
                  "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                credentials: "same-origin",
              });
              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || "HTTP " + response.status);
              }
              updateNotesState(form, String(form.querySelector('textarea[name="notas"]')?.value || "").trim());
            } catch (error) {
              if (button) button.disabled = false;
              alert(error instanceof Error ? error.message : "No se pudieron actualizar las notas.");
            }
          });
          document.addEventListener("submit", async (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.classList.contains("js-async-calendar-note")) return;
            event.preventDefault();
            const button = form.querySelector('button[type="submit"]');
            if (button) button.disabled = true;
            try {
              const payload = new URLSearchParams(new FormData(form));
              const response = await fetch(form.action, {
                method: "POST",
                body: payload,
                headers: {
                  "X-Requested-With": "fetch",
                  "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                credentials: "same-origin",
              });
              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || "HTTP " + response.status);
              }
              window.location.reload();
            } catch (error) {
              if (button) button.disabled = false;
              alert(error instanceof Error ? error.message : "No se pudo guardar la nota.");
            }
          });
          calendarInstance = new FullCalendar.Calendar(mount, {
            locale: "es",
            firstDay: 1,
            initialView,
            height: "auto",
            expandRows: true,
            fixedWeekCount: false,
            nowIndicator: false,
            navLinks: true,
            dayMaxEvents: 3,
            eventDisplay: "block",
            displayEventTime: true,
            eventTimeFormat: {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            },
            stickyHeaderDates: true,
            headerToolbar: {
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth"
            },
            buttonText: {
              today: "Hoy",
              month: "Mes"
            },
            events: getVisibleEvents(),
            eventContent(info) {
              const props = info.event.extendedProps || {};
              const accent = String(props.accentColor || props.primaryColor || props.employeeColor || info.event.backgroundColor || "").trim();
              const eventType = String(props.eventType || "").trim();
              const isFinalizada = String(props.statusSuffix || "").trim() === "FINALIZADA";
              const title = escapeHtml(info.event.title || "");
              const subtitleParts = eventType === "birthday"
                ? [props.employeeRole || "", props.dateLabel || ""]
                : eventType === "calendar-note"
                  ? [props.dateLabel || "", Array.isArray(props.employeeNames) ? String(props.employeeNames.length) + " etiquetado(s)" : ""]
                  : [props.sedeLabel || "", props.hourLabel || "", props.capacitadoresLabel || ""];
              const subtitle = subtitleParts
                .map((item) => String(item || "").trim())
                .filter(Boolean)
                .join(" · ");
              const badgeText = eventType === "birthday"
                ? "Cumpleaños"
                : eventType === "calendar-note"
                  ? "Nota"
                  : "";
              const badgeClass = eventType === "birthday"
                ? "calendar-event-badge calendar-event-badge--birthday"
                : "calendar-event-badge calendar-event-badge--note";
              const cardStyle = accent ? ' style="--calendar-accent:' + escapeHtml(accent) + ';"' : "";
              const iconType = eventType === "birthday"
                ? "birthday"
                : eventType === "calendar-note"
                  ? "calendar-note"
                  : isFinalizada
                    ? "finalizada"
                    : "programada";
              const noteIcon = String(props.noteIcon || "📝").trim() || "📝";
              const iconSvg = iconType === "birthday"
                ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.6 3.8c0 1.3 1.2 2.2 1.2 4.3 0 2.7-2 4.7-4.1 4.7S2.6 10.8 2.6 8.1c0-2.1 1.2-3 1.2-4.3 0-.8.7-1.5 1.5-1.5.5 0 1 .3 1.2.8.3-.5.7-.8 1.3-.8.8 0 1.5.7 1.5 1.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path><path d="M7.2 13v5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path><path d="M6.3 18.2h1.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path><path d="M16.9 5.2c0 1.5 1.3 2.6 1.3 4.7 0 3-2.2 5.2-4.6 5.2S9 12.9 9 9.9c0-2.1 1.3-3.2 1.3-4.7 0-.9.8-1.7 1.7-1.7.6 0 1.1.3 1.4.9.3-.6.8-.9 1.4-.9.9 0 1.7.8 1.7 1.7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path><path d="M14.4 14.4v4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path><path d="M13.4 18.8h2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path><path d="M3.2 21h17.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>'
                : iconType === "finalizada"
                  ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 12.5l3.3 3.3L17.8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z" fill="none" stroke="currentColor" stroke-width="1.6"></path></svg>'
                  : iconType === "programada"
                    ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7.8" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M12 8.2v4.3l2.9 1.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9.2 3.7h5.6M12 2.4v2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>'
                    : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 4h7l4 4v12H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path><path d="M14 4v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path><path d="M9 12h6M9 15h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>';
              const iconMarkup = eventType === "calendar-note"
                ? '<span class="calendar-event-icon calendar-event-icon--emoji calendar-event-icon--calendar-note">' + escapeHtml(noteIcon) + '</span>'
                : '<span class="calendar-event-icon calendar-event-icon--' + escapeHtml(iconType) + '">' + iconSvg + '</span>';
              const timeMarkup = props.hourLabel ? '<span class="calendar-event-time">' + escapeHtml(props.hourLabel) + '</span>' : "";
              const subtitleMarkup = subtitle ? '<div class="calendar-event-meta">' + escapeHtml(subtitle) + '</div>' : "";
              const topLineMarkup = '<div class="calendar-event-topline">' +
                '<div class="calendar-event-title">' + title + '</div>' +
                (timeMarkup || badgeText ? '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;">' + timeMarkup + (badgeText ? '<span class="' + badgeClass + '">' + escapeHtml(badgeText) + '</span>' : '') + '</div>' : '') +
              '</div>';
              return {
                html: '<div class="calendar-event-card calendar-event-card--' + escapeHtml(eventType || "capacitacion") + '"' + cardStyle + '>' +
                  iconMarkup +
                  '<div class="calendar-event-body">' +
                    topLineMarkup +
                    subtitleMarkup +
                  '</div>' +
                '</div>',
              };
            },
            eventClick(info) {
              info.jsEvent.preventDefault();
              syncDetail(info.event.toPlainObject());
            },
            eventDidMount(info) {
              const props = info.event.extendedProps || {};
              const parts = props.eventType === "birthday"
                ? [props.employeeName || info.event.title, props.employeeRole, props.dateLabel, props.statusLabel]
                : props.eventType === "calendar-note"
                  ? [props.noteTitle || info.event.title, props.dateLabel, ...(Array.isArray(props.employeeNames) ? props.employeeNames : [])]
                  : [info.event.title, props.sedeLabel, props.sucursalesLabel, props.capacitadoresLabel, props.statusLabel, props.dateLabel];
              const accent = String(props.accentColor || props.primaryColor || props.employeeColor || info.event.backgroundColor || "").trim();
              if (accent) {
                info.el.style.setProperty("--calendar-accent", accent);
                info.el.style.borderLeft = "0";
                info.el.style.borderTop = "0";
                info.el.style.boxShadow = "0 4px 10px rgba(26,42,58,0.06), inset 0 0 0 1px " + accent + "20";
              }
              info.el.title = parts.join(" | ");
            }
          });
          calendarInstance.render();
          syncFilterButtons();
          const createNoteButton = document.querySelector("[data-open-calendar-note]");
          if (createNoteButton) {
            createNoteButton.addEventListener("click", openCalendarNoteComposer);
          }
          document.addEventListener("click", async (event) => {
            const button = event.target instanceof Element ? event.target.closest(".js-delete-calendar-note") : null;
            if (!button) return;
            const noteId = String(button.dataset.calendarNoteId || "").trim();
            if (!noteId) return;
            if (!window.confirm("¿Eliminar esta nota?")) return;
            try {
              const payload = new URLSearchParams();
              payload.set("rowId", noteId);
              payload.set("returnTo", returnTo);
              const response = await fetch(portalUrl("/dashboard/calendario/notas/eliminar"), {
                method: "POST",
                body: payload,
                headers: {
                  "X-Requested-With": "fetch",
                  "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                credentials: "same-origin",
              });
              if (!response.ok) {
                throw new Error(await response.text() || "No se pudo eliminar la nota.");
              }
              window.location.reload();
            } catch (error) {
              alert(error instanceof Error ? error.message : "No se pudo eliminar la nota.");
            }
          });
          filterButtons.forEach((button) => {
            button.addEventListener("click", () => {
              activeCapacitadorFilter = button.dataset.capacitadorFilter || "";
              syncFilterButtons();
              applyCalendarFilter();
            });
          });
          applyCalendarFilter();
          setActiveTab(tabs.find((button) => button.classList.contains("active"))?.dataset.dashboardTab || tabs[0]?.dataset.dashboardTab || "calendar");
        });
      </script>
    `
    : "";

  return renderLayout({
    title: `${title} | Desarrollo EG`,
    heroTitle: "",
    heroIntro: "",
    primaryAction: "",
    secondaryAction: "",
    sideContent,
    headExtra: "",
    mainClass: "dashboard-main",
    bodyContent: `
      <section class="dashboard-shell">
        ${floatingMenuButton}
        <div class="dashboard-content">
          ${dashboardTabPanels}
        </div>
        ${dashboardMobileDock}
        ${dashboardDrawer}
      </section>
    `,
    bodyScripts: `
      ${calendarBootstrap}
      <script>
        (function () {
          const reloadButtons = Array.from(document.querySelectorAll("[data-dashboard-reload]"));
          const drawer = document.querySelector("[data-dashboard-drawer]");
          const drawerPanel = document.querySelector("[data-dashboard-drawer-panel]");
          const openButtons = Array.from(document.querySelectorAll("[data-dashboard-drawer-open]"));
          const closeButtons = Array.from(document.querySelectorAll("[data-dashboard-drawer-close]"));
          if (!drawer || !drawerPanel || openButtons.length === 0) return;
          const focusables = () => Array.from(drawerPanel.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
          let lastActive = null;
          let closeTimer = null;
          const setOpenState = (isOpen) => {
            openButtons.forEach((button) => button.setAttribute("aria-expanded", isOpen ? "true" : "false"));
          };
          const openDrawer = () => {
            if (closeTimer) {
              window.clearTimeout(closeTimer);
              closeTimer = null;
            }
            lastActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            drawer.hidden = false;
            requestAnimationFrame(() => drawer.classList.add("is-open"));
            document.body.style.overflow = "hidden";
            setOpenState(true);
            requestAnimationFrame(() => (drawerPanel.querySelector("button, a, [tabindex]") || drawerPanel).focus());
          };
          const closeDrawer = () => {
            drawer.classList.remove("is-open");
            document.body.style.overflow = "";
            setOpenState(false);
            closeTimer = window.setTimeout(() => {
              drawer.hidden = true;
            }, 240);
            lastActive?.focus?.();
          };
          reloadButtons.forEach((button) => {
            button.addEventListener("click", () => window.location.reload());
          });
          openButtons.forEach((button) => button.addEventListener("click", openDrawer));
          closeButtons.forEach((button) => button.addEventListener("click", closeDrawer));
          drawer.addEventListener("click", (event) => {
            if (event.target === drawer) closeDrawer();
          });
          document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !drawer.hidden) {
              event.preventDefault();
              closeDrawer();
              return;
            }
            if (event.key !== "Tab" || drawer.hidden) return;
            const elements = focusables();
            if (elements.length === 0) return;
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          });
          drawer.querySelectorAll("[data-dashboard-tab]").forEach((button) => {
            button.addEventListener("click", () => closeDrawer());
          });
        })();
      </script>
    `,
    footer: "",
  });
}
async function requireUser(req, res) {
  const user = await loadAuthenticatedEmployee(req);
  if (!user) {
    return null;
  }
  return user;
}

homeRouter.get("/", async (req, res) => {
  const user = await loadAuthenticatedEmployee(req);
  if (user) {
    res.redirect("/dashboard");
    return;
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.type("html").send(renderLoginPage());
});

homeRouter.get("/login", async (req, res) => {
  const user = await loadAuthenticatedEmployee(req);
  if (user) {
    res.redirect("/dashboard");
    return;
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.type("html").send(renderLoginPage());
});

homeRouter.post("/auth/qa/start", async (req, res) => {
  if (!isQaAccessEnabled()) {
    res.status(503).type("html").send(renderLoginPage("El acceso QA no esta habilitado en este entorno.", { showQaAccess: false }));
    return;
  }

  const token = String(req.body?.token || req.query.token || "").trim();
  if (!verifyQaAccessToken(token)) {
    res.status(403).type("html").send(renderLoginPage("Token QA invalido o vencido."));
    return;
  }

  try {
    const secure = isRequestSecure(req);
    const employee = buildQaAccessEmployee();
    const sessionToken = await createSessionForEmployee(employee);
    res.setHeader("Set-Cookie", buildCookieHeader(sessionToken, { secure }));
    void warmPortalDashboardCaches().catch(() => {});
    res.redirect("/dashboard");
  } catch (error) {
    res.status(500).type("html").send(renderLoginPage(error instanceof Error ? error.message : "No se pudo abrir el acceso QA."));
  }
});

homeRouter.get("/auth/google/start", async (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    res.status(503).type("html").send(renderLoginPage("Google OAuth no esta configurado en este entorno."));
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  const secure = isRequestSecure(req);
  res.setHeader("Set-Cookie", `${getOAuthStateCookieName()}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`);
  res.redirect(buildGoogleAuthUrl(state, getGoogleOAuthRedirectUri(req)));
});

homeRouter.get("/auth/google/callback", async (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    res.status(503).type("html").send(renderLoginPage("Google OAuth no esta configurado en este entorno."));
    return;
  }

  const cookies = parseCookies(req);
  const expectedState = cookies[getOAuthStateCookieName()];
  const receivedState = String(req.query.state || "");
  const code = String(req.query.code || "");
  const error = String(req.query.error || "");
  const secure = isRequestSecure(req);

  if (error) {
    res.setHeader("Set-Cookie", buildClearOAuthStateCookieHeader({ secure }));
    res.status(401).type("html").send(renderLoginPage(`Google rechazo el acceso: ${error}`));
    return;
  }

  if (!code) {
    res.setHeader("Set-Cookie", buildClearOAuthStateCookieHeader({ secure }));
    res.status(400).type("html").send(renderLoginPage("Falto el codigo de autorizacion de Google."));
    return;
  }

  if (!expectedState || expectedState !== receivedState) {
    res.setHeader("Set-Cookie", buildClearOAuthStateCookieHeader({ secure }));
    res.status(400).type("html").send(renderLoginPage("La validacion de seguridad de Google fallo. Vuelve a intentar."));
    return;
  }

  try {
    const profile = await exchangeGoogleAuthCode(code, getGoogleOAuthRedirectUri(req));
    const employee = await authenticateEmployeeByEmail(profile.email);
    const token = await createSessionForEmployee(employee);
    res.setHeader("Set-Cookie", [
      buildCookieHeader(token, { secure }),
      buildClearOAuthStateCookieHeader({ secure }),
    ]);
    void warmPortalDashboardCaches().catch(() => {});
    res.redirect("/dashboard");
  } catch (loginError) {
    res.setHeader("Set-Cookie", buildClearOAuthStateCookieHeader({ secure }));
    res.status(403).type("html").send(renderLoginPage(loginError instanceof Error ? loginError.message : "No se pudo completar el acceso."));
  }
});

homeRouter.get("/api/auth/me", async (req, res) => {
  const user = await loadAuthenticatedEmployee(req);
  if (!user) {
    res.status(401).json({ ok: false, user: null });
    return;
  }

  res.json({ ok: true, user: getEmployeeSummary(user) });
});

homeRouter.get("/api/auth/logout", async (req, res) => {
  res.setHeader("Set-Cookie", [
    buildClearCookieHeader({ secure: isRequestSecure(req) }),
    buildClearOAuthStateCookieHeader({ secure: isRequestSecure(req) }),
  ]);
  res.redirect("/");
});

homeRouter.post("/api/auth/logout", async (req, res) => {
  res.setHeader("Set-Cookie", [
    buildClearCookieHeader({ secure: isRequestSecure(req) }),
    buildClearOAuthStateCookieHeader({ secure: isRequestSecure(req) }),
  ]);
  res.json({ ok: true, redirect: "/" });
});

homeRouter.get("/dashboard", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const [employees, dashboardData, pedidosData] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
    user.role === "admin"
      ? fetchPedidosLeyAdminDashboardData({ year: new Date().getFullYear() }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const calendarView = normalizeCalendarView(req.query.calendar);
  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    pedidosData,
    returnPath: "/dashboard",
    calendarView,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
});

homeRouter.get("/dashboard/capacitador/:rowId", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const [employees, dashboardData] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
  ]);
  const target = employees.find((item) => item.rowId === String(req.params.rowId || ""));
  if (!target) {
    res.status(404).type("html").send(renderLoginPage("No encontramos el dashboard solicitado."));
    return;
  }

  if (user.role !== "admin" && user.rowId !== target.rowId) {
    res.status(403).type("html").send(renderLoginPage("No tienes permiso para abrir ese dashboard."));
    return;
  }

  const calendarView = normalizeCalendarView(req.query.calendar);
  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    selectedEmployee: target,
    returnPath: `/dashboard/capacitador/${encodeURIComponent(target.rowId)}`,
    calendarView,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
});

homeRouter.get("/dashboard/capacitacion/:rowId", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const [employees, dashboardData] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
  ]);
  const employeeParam = String(req.query.employee || "").trim();
  const targetEmployee = employees.find((item) => item.rowId === employeeParam) || user;
  const returnTo = String(req.query.returnTo || "").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : (targetEmployee.rowId === user.rowId ? "/dashboard" : `/dashboard/capacitador/${encodeURIComponent(targetEmployee.rowId)}`);
  const calendarView = normalizeCalendarView(req.query.calendar);

  if (user.role !== "admin" && targetEmployee.rowId !== user.rowId) {
    res.status(403).type("html").send(renderLoginPage("No tienes permiso para abrir ese detalle."));
    return;
  }

  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    selectedEmployee: targetEmployee,
    selectedCapacitacionId: req.params.rowId,
    returnPath: safeReturnTo,
    calendarView,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
});

homeRouter.get("/dashboard/faltantes-ley-panel", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const employees = await listEmployeesForPortal({ runAsUserEmail: user.correo });
  const employeeId = String(req.query.employee || "").trim();
  const selectedEmployee = employees.find((item) => item.rowId === employeeId) || user;

  if (user.role !== "admin" && selectedEmployee.rowId !== user.rowId) {
    res.status(403).type("html").send(renderLoginPage("No tienes permiso para ver estos faltantes."));
    return;
  }

  const rows = await getFaltantesLeyData("", "faltantes", {
    capacitador: [selectedEmployee.nombre, selectedEmployee.initials, selectedEmployee.rowId, selectedEmployee.correo],
  }).then((result) => result.rows || []);

  res.type("html").send(renderFaltantesLeyCompactPanel({
    title: "Faltantes Ley",
    description: "Documentación pendiente de las sucursales atendidas por este capacitador.",
    rows,
    emptyMessage: "No hay faltantes para este capacitador.",
  }));
});

homeRouter.get("/dashboard/general", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }
  if (user.role !== "admin") {
    res.redirect("/dashboard");
    return;
  }

  const [employees, dashboardData, pedidosData] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
    fetchPedidosLeyAdminDashboardData({ year: new Date().getFullYear() }).catch(() => null),
  ]);
  const calendarView = normalizeCalendarView(req.query.calendar);
  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    pedidosData,
    returnPath: "/dashboard/general",
    calendarView,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
});

homeRouter.get("/dashboard/pedidos", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  if (user.role !== "admin") {
    res.status(403).type("html").send(renderLoginPage("Solo los administradores pueden abrir pedidos."));
    return;
  }

  try {
    const year = String(req.query.year || "").trim();
    const forceRefresh = String(req.query.refresh || "") === "1";
    const data = await fetchPedidosLeyAdminDashboardData({
      year,
      forceRefresh,
      facturadorId: String(req.query.facturadorId || "").trim() || undefined,
      thresholds: {
        estatalMin: req.query.estatalMin,
        municipalMin: req.query.municipalMin,
      },
    });
    data.status = String(req.query.status || "all").trim() || "all";
    data.type = String(req.query.type || "all").trim() || "all";
    data.scope = String(req.query.scope || "pedidos").trim() || "pedidos";
    data.search = String(req.query.search || "").trim();
    data.queryString = req.url.includes("?") ? req.url.split("?")[1] : "";
    res.type("html").send(renderPedidosLeyAdminPage({ user, data }));
  } catch (error) {
    res.status(500).type("html").send(renderLoginPage(error instanceof Error ? error.message : "No se pudo cargar el panel de pedidos."));
  }
});

homeRouter.get("/dashboard/pedidos/panel", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).type("html").send(renderLoginPage("No autenticado"));
    return;
  }

  if (user.role !== "admin") {
    res.status(403).type("html").send(renderLoginPage("Solo los administradores pueden abrir pedidos."));
    return;
  }

  try {
    const year = String(req.query.year || "").trim();
    const forceRefresh = String(req.query.refresh || "") === "1";
    const data = await fetchPedidosLeyAdminDashboardData({
      year,
      forceRefresh,
      facturadorId: String(req.query.facturadorId || "").trim() || undefined,
      thresholds: {
        estatalMin: req.query.estatalMin,
        municipalMin: req.query.municipalMin,
      },
    });
    data.status = String(req.query.status || "all").trim() || "all";
    data.type = String(req.query.type || "all").trim() || "all";
    data.scope = String(req.query.scope || "pedidos").trim() || "pedidos";
    data.search = String(req.query.search || "").trim();
    data.queryString = req.url.includes("?") ? req.url.split("?")[1] : "";
    res.type("html").send(renderPedidosDashboardFragment({ user, data, year }));
  } catch (error) {
    res.status(500).type("html").send(renderLoginPage(error instanceof Error ? error.message : "No se pudo cargar el panel de pedidos."));
  }
});

homeRouter.get("/pedidos-sin-liberacion", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  if (user.role !== "admin") {
    res.status(403).type("html").send(renderLoginPage("Solo los administradores pueden abrir pedidos sin liberacion."));
    return;
  }

  res.type("html").send(renderPedidosSinLiberacionPage({ user }));
});

homeRouter.get("/pedidos-sin-liberacion/sender/connect", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  if (user.role !== "admin") {
    res.status(403).type("html").send(renderLoginPage("Solo los administradores pueden conectar un remitente."));
    return;
  }

  res
    .status(200)
    .type("html")
    .send(renderLoginPage("El envio de pedidos ahora sale desde Apps Script con contacto.gga.sc@gmail.com. Ya no hace falta conectar un remitente."));
});

homeRouter.post("/dashboard/capacitaciones/:rowId/status", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const targetRowId = String(req.params.rowId || "").trim();
  const nextStatus = String(req.body?.status || "").trim();
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";

  try {
    if (user.role !== "admin") {
      const { programadas: visibleCapacitaciones } = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user });
      const target = visibleCapacitaciones.find((item) => item.rowId === targetRowId);
      if (!target) {
        res.status(403).type("html").send(renderLoginPage("No tienes permiso para cambiar ese estado."));
        return;
      }
    }

    await updateCapacitacionStatus(targetRowId, nextStatus, user.correo);
    res.redirect(safeReturnTo);
  } catch (error) {
    res.status(400).type("html").send(renderLoginPage(error instanceof Error ? error.message : "No se pudo actualizar el estado."));
  }
});

homeRouter.post("/dashboard/capacitaciones/:rowId/diplomas", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const targetRowId = String(req.params.rowId || "").trim();
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";
  const nextValue = String(req.body?.diplomas || "Y").trim().toUpperCase() === "Y";

  try {
    if (user.role !== "admin") {
      const { visible } = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user });
      const target = visible.find((item) => item.rowId === targetRowId);
      if (!target) {
        res.status(403).type("html").send(renderLoginPage("No tienes permiso para cambiar ese diploma."));
        return;
      }
    }

    await updateCapacitacionDiplomas(targetRowId, nextValue, user.correo);
    res.redirect(safeReturnTo);
  } catch (error) {
    res.status(400).type("html").send(renderLoginPage(error instanceof Error ? error.message : "No se pudo actualizar los diplomas."));
  }
});

homeRouter.post("/dashboard/capacitaciones/:rowId/notas", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const targetRowId = String(req.params.rowId || "").trim();
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";
  const notas = String(req.body?.notas || "").trim();

  try {
    if (user.role !== "admin") {
      const { visible } = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user });
      const target = visible.find((item) => item.rowId === targetRowId);
      if (!target) {
        res.status(403).type("html").send(renderLoginPage("No tienes permiso para cambiar esas notas."));
        return;
      }
    }

    await updateCapacitacionNotas(targetRowId, notas, user.correo);
    if (String(req.headers["x-requested-with"] || "").toLowerCase() === "fetch") {
      res.json({ ok: true, notas });
      return;
    }
    res.redirect(safeReturnTo);
  } catch (error) {
    if (String(req.headers["x-requested-with"] || "").toLowerCase() === "fetch") {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "No se pudieron actualizar las notas." });
      return;
    }
    res.status(400).type("html").send(renderLoginPage(error instanceof Error ? error.message : "No se pudieron actualizar las notas."));
  }
});

homeRouter.post("/dashboard/calendario/notas", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const targetRowId = String(req.body?.rowId || "").trim();
  const fecha = String(req.body?.fecha || "").trim();
  const titulo = String(req.body?.titulo || "").trim();
  const notas = String(req.body?.notas || "").trim();
  const icono = String(req.body?.icono || "").trim();
  const empleados = Array.isArray(req.body?.empleados)
    ? req.body.empleados
    : req.body?.empleados
      ? [req.body.empleados]
      : [];
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";

  try {
    if (user.role !== "admin" && empleados.length > 0 && !empleados.map((item) => String(item || "").trim()).includes(user.rowId)) {
      res.status(403).type("html").send(renderLoginPage("Solo puedes crear notas etiquetándote a ti mismo o desde un perfil de admin."));
      return;
    }

    const note = await upsertCalendarNote({
      rowId: targetRowId,
      fecha,
      title: titulo,
      notes: notas,
      icon: icono,
      employees: empleados,
    }, user.correo);

    if (String(req.headers["x-requested-with"] || "").toLowerCase() === "fetch") {
      res.json({ ok: true, note });
      return;
    }

    res.redirect(safeReturnTo);
  } catch (error) {
    if (String(req.headers["x-requested-with"] || "").toLowerCase() === "fetch") {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "No se pudo guardar la nota." });
      return;
    }
    res.status(400).type("html").send(renderLoginPage(error instanceof Error ? error.message : "No se pudo guardar la nota."));
  }
});

homeRouter.post("/dashboard/calendario/notas/eliminar", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const targetRowId = String(req.body?.rowId || "").trim();
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";

  try {
    if (!targetRowId) {
      throw new Error("No se pudo identificar la nota a eliminar.");
    }

    await deleteCalendarNote({ rowId: targetRowId }, user.correo);

    if (String(req.headers["x-requested-with"] || "").toLowerCase() === "fetch") {
      res.json({ ok: true });
      return;
    }

    res.redirect(safeReturnTo);
  } catch (error) {
    if (String(req.headers["x-requested-with"] || "").toLowerCase() === "fetch") {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "No se pudo eliminar la nota." });
      return;
    }
    res.status(400).type("html").send(renderLoginPage(error instanceof Error ? error.message : "No se pudo eliminar la nota."));
  }
});

