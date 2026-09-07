import crypto from "crypto";
import express from "express";
import { getActivePortalBasePath, portalPath } from "./portalPath.js";
import {
  buildClearOAuthStateCookieHeader,
  buildClearCookieHeader,
  buildGoogleAuthUrl,
  buildCookieHeader,
  buildQaAccessEmployee,
  createPortalNoteEntry,
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
  getEmpresaLogoForPortal,
  getTerritoryShieldForPortal,
  listEmpresasForPortal,
  listEmployeesForPortal,
  listPortalNotes,
  listSucursalesForPortal,
  loadAuthenticatedEmployee,
  deleteCalendarNote,
  verifyQaAccessToken,
  upsertCalendarNote,
  updateCapacitacionDiplomas,
  updateCapacitacionStatus,
  updatePortalNoteEntry,
  deletePortalNoteEntry,
  warmPortalDashboardCaches,
} from "./portalAuth.service.js";
import { getFaltantesLeyData } from "../faltantes-ley/faltantesLey.service.js";
import { renderPedidosSinLiberacionPage } from "../pedidos-ley/pedidosLey.page.js";
import { fetchPedidosLeyAdminDashboardData } from "../pedidos-ley/services/pedidosLey.js";
import { renderPedidosLeyAdminPage } from "../pedidos-ley/pedidosLey.admin.page.js";
import { refreshAppShellCaches } from "../../services/appShellRefresh.js";
import {
  canUsePortalView,
  canViewAllForPortalView,
  getPortalViewPermission,
  resolvePortalAccessProfile,
} from "./portalAccessPolicy.js";

export const homeRouter = express.Router();

const HOME_FAVICON_PATH = "/img/brand-favicon.png?v=20260825b";
const BRAND_LOGO_PATH = "/img/brand-logo.png?v=20260825b";
const MONTH_NAMES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

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

function getStructuredUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  try {
    const parsed = JSON.parse(text);
    const candidate = String(parsed?.Url || parsed?.url || parsed?.Link || parsed?.link || "").trim();
    return /^https?:\/\//i.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

function formatOptionalMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "Sin importe";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(number);
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

function getIntegratedConstanciasUrlFromCapacitacion(capacitacion) {
  const capacitacionId = String(capacitacion?.id || capacitacion?.rowId || "").trim();
  return `/CONSTANCIAS/capacitaciones/${encodeURIComponent(capacitacionId)}/HTML?embed=1`;
}

function normalizeCalendarView(value) {
  return String(value || "week").toLowerCase() === "month" ? "month" : "week";
}

function parseDashboardDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const isoLike = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoLike) {
    const date = new Date(Number(isoLike[1]), Number(isoLike[2]) - 1, Number(isoLike[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const slashLike = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (slashLike) {
    const first = Number(slashLike[1]);
    const second = Number(slashLike[2]);
    let year = Number(slashLike[3]);
    if (year < 100) year += 2000;
    const dayFirst = first > 12 && second <= 12;
    const month = dayFirst ? second : first;
    const day = dayFirst ? first : second;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
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
    title: capacitacion.statusLabel || "Sin estado",
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
          <h1>Calendario</h1>
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
  if (Array.isArray(capacitacion?.sucursales)) {
    return capacitacion.sucursales
      .map((item) => typeof item === "object" && item !== null
        ? (item.label || item.nombre || item.name || item.key || item.id || "")
        : item)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  const fallback = String(capacitacion?.sucursales || "").trim();
  return fallback ? [fallback] : [];
}

function getCapacitacionHoraLabel(capacitacion) {
  const formatTime = (value) => {
    const raw = String(value || "").trim();
    const match = raw.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (!match) return raw;
    const hour = match[1].padStart(2, "0");
    const period = match[3] ? ` ${match[3].toUpperCase()}` : "";
    return `${hour}:${match[2]}${period}`;
  };
  const start = formatTime(capacitacion?.horaInicio);
  const end = formatTime(capacitacion?.horaFin);
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
    const authorLabel = String(noteData.authorName || noteData.author || noteData.authorEmail || "Sin autor registrado").trim();
    const authorSecondary = noteData.authorName && noteData.authorEmail
      ? String(noteData.authorEmail).trim()
      : "";
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
          <strong>Creada por</strong>
          <div class="tag-row">
            <span class="tag-pill">${escapeHtml(authorLabel)}</span>
            ${authorSecondary ? `<span class="calendar-empty">${escapeHtml(authorSecondary)}</span>` : ""}
          </div>
        </div>
        <div class="calendar-detail-section">
          <strong>Empleados etiquetados</strong>
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
    inlineDetails = false,
    canEditNotes = false,
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
  const hourLabel = getCapacitacionHoraLabel(capacitacion);
  const notes = String(capacitacion.notas || "").trim();
  const threadNotes = Array.isArray(capacitacion.threadNotes) ? capacitacion.threadNotes : [];
  const noteEntries = [
    ...(notes ? [{
      id: "",
      authorName: "Registro historico",
      body: notes,
      createdAt: capacitacion.dateRaw || "",
    }] : []),
    ...threadNotes,
  ];
  const notesThreadMarkup = noteEntries.length
    ? `<div class="note-thread" data-note-thread>${noteEntries.map((note) => {
        const createdAt = String(note.createdAt || "").trim();
        const dateLabel = createdAt
          ? (parseDashboardDate(createdAt)?.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) || createdAt)
          : "Sin fecha";
        return `<article class="note-entry"${note.id ? ` data-note-id="${escapeAttr(note.id)}"` : ""}>
          <header><strong>${escapeHtml(note.authorName || note.authorEmail || "Sistema")}</strong><time>${escapeHtml(dateLabel)}</time></header>
          <p>${escapeHtml(note.body || "")}</p>
        </article>`;
      }).join("")}</div>`
    : `<span class="capacitacion-card__note-copy">Sin notas</span>`;
  const diplomaChoiceMarkup = `
    <${canEditDiplomas ? "form" : "div"} class="status-actions diploma-choice${canEditDiplomas ? " js-async-diplomas" : ""}" ${canEditDiplomas ? `method="post" action="/dashboard/capacitaciones/${encodeURIComponent(capacitacion.rowId)}/diplomas"` : ""}>
      ${canEditDiplomas ? `<input type="hidden" name="returnTo" value="${returnValue}" />` : ""}
      <span class="diploma-choice__label">Diplomas</span>
      <button type="${canEditDiplomas ? "submit" : "button"}" name="diplomas" value="Y" class="status-button ${capacitacion.hasDiplomas ? "active" : ""}" ${canEditDiplomas ? "" : "disabled"}>SI</button>
      <button type="${canEditDiplomas ? "submit" : "button"}" name="diplomas" value="N" class="status-button ${capacitacion.hasDiplomas ? "" : "active"}" ${canEditDiplomas ? "" : "disabled"}>NO</button>
    </${canEditDiplomas ? "form" : "div"}>
  `;

  if (inlineDetails) {
    const statusText = capacitacion.statusSuffix || capacitacion.statusLabel || "Sin estado";
    return `
      <details class="capacitacion-card capacitacion-card--expandable ${statusClass}" data-keep-after-diplomas>
        <summary class="capacitacion-card__summary">
          <div class="capacitacion-card__summary-main">
            <div class="capacitacion-head">
              <span class="status-chip ${statusClass}">${escapeHtml(statusText)}</span>
              <time class="capacitacion-card__date">${escapeHtml(capacitacion.dateLabel || "Sin fecha")}</time>
            </div>
            <span class="capacitacion-card__eyebrow">Sede</span>
            <h3>${escapeHtml(sedeLabel)}</h3>
            <div class="capacitacion-card__summary-meta">
              <span class="capacitacion-summary-fact"><small>Horario</small><strong>${escapeHtml(hourLabel)}</strong></span>
              <span class="capacitacion-summary-fact"><small>Capacitador</small><strong>${capacitadoresLabel}</strong></span>
              <span class="diploma-summary" aria-label="Diplomas ${capacitacion.hasDiplomas ? "si" : "no"}">
                <span>Diplomas</span>
                <span class="status-button ${capacitacion.hasDiplomas ? "active" : ""}">SI</span>
                <span class="status-button ${capacitacion.hasDiplomas ? "" : "active"}">NO</span>
              </span>
            </div>
          </div>
          <span class="accordion-chevron capacitacion-card__chevron" aria-hidden="true"></span>
        </summary>
        <div class="capacitacion-card__body">
          <div class="capacitacion-card__content">
            <section class="capacitacion-card__section capacitacion-card__branches">
              <strong>Sucursales a capacitar</strong>
              <div class="tag-row">
                ${sucursalesItems.length ? sucursalesItems.map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`).join("") : `<span class="calendar-empty">Sin sucursales</span>`}
              </div>
            </section>
            <section class="capacitacion-card__section capacitacion-card__notes">
              <strong>Notas</strong>
              ${notesThreadMarkup}
              ${canEditNotes ? `
                <details class="capacitacion-note-compose">
                  <summary>Agregar nota</summary>
                  <form class="notes-form js-async-notes" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(capacitacion.rowId)}/notas">
                    <input type="hidden" name="returnTo" value="${returnValue}" />
                    <textarea name="notas" rows="2" class="notes-textarea" placeholder="Escribe una nueva entrada..." required></textarea>
                    <div class="notes-actions">
                      <button type="submit" class="status-button">Guardar nota</button>
                      <span class="notes-state">${noteEntries.length} entrada(s)</span>
                    </div>
                  </form>
                </details>
              ` : ""}
            </section>
          </div>
          <div class="capacitacion-card__actions">
            ${diplomaChoiceMarkup}
            ${linkHref ? `<a class="button primary" href="${escapeAttr(linkHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkText)}</a>` : ""}
          </div>
        </div>
      </details>
    `;
  }
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
      ${diplomaChoiceMarkup}
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

function renderCapacitacionesPlatformPanel({
  capacitaciones = [],
  showStatusControls = false,
  selectedEmployeeId = "",
  detailReturnPath = "/dashboard",
} = {}) {
  return `
    <div class="panel accolades-panel" style="margin-top:20px;">
      <div class="section-head">
        <div>
          <h1>Capacitaciones</h1>
          <p>Listado operativo integrado al dashboard. Aqui se revisan fechas, sedes, sucursales, capacitadores, notas y estado de diplomas.</p>
        </div>
      </div>
      ${renderCapacitacionesAccordion(capacitaciones, {
        emptyMessage: "No hay capacitaciones para mostrar.",
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

function renderCapacitacionesPlatformPanelV2({
  capacitaciones = [],
  employees = [],
  showStatusControls = false,
  selectedEmployeeId = "",
  detailReturnPath = "/dashboard",
} = {}) {
  const capacitacionesReturnPath = `${portalPath("/dashboard")}?tab=capacitaciones`;
  const capacitadores = employees.filter((employee) => employee.role === "capacitador");
  const groups = [
    {
      key: "PROGRAMADA",
      title: "Programadas",
      description: "Capacitaciones pendientes o en curso.",
      rows: capacitaciones.filter((item) => item.statusSuffix !== "FINALIZADA"),
    },
    {
      key: "FINALIZADA",
      title: "Finalizadas",
      description: "Capacitaciones cerradas, con o sin diplomas.",
      rows: capacitaciones.filter((item) => item.statusSuffix === "FINALIZADA"),
    },
  ];
  const renderItem = (capacitacion) => {
    const capacitadorKeys = Array.isArray(capacitacion.capacitadores)
      ? capacitacion.capacitadores.map((item) => String(item?.key || "").trim()).filter(Boolean).join(",")
      : "";
    const search = [
      capacitacion.cedeLabel,
      capacitacion.cede,
      capacitacion.dateLabel,
      capacitacion.statusLabel,
      capacitacion.statusSuffix,
      getCapacitacionHoraLabel(capacitacion),
      getCapacitacionSucursalesItems(capacitacion).join(" "),
      Array.isArray(capacitacion.capacitadores) ? capacitacion.capacitadores.map((item) => item?.nombre || item?.key || "").join(" ") : "",
      capacitacion.hasDiplomas ? "DIPLOMAS SI" : "DIPLOMAS NO",
    ].join(" ");
    return `
      <div
        data-capacitacion-item
        data-status="${escapeAttr(capacitacion.statusSuffix || "PROGRAMADA")}"
        data-diplomas="${capacitacion.hasDiplomas ? "Y" : "N"}"
        data-capacitadores="${escapeAttr(capacitadorKeys)}"
        data-search="${escapeAttr(search)}"
      >
        ${renderCapacitacionCard(capacitacion, {
          href: getCapacitacionConstanciasUrlFromCapacitacion(capacitacion),
          linkLabel: "Crear constancias",
          canEditDiplomas: showStatusControls,
          canEditNotes: showStatusControls,
          selectedEmployeeId,
          returnPath: capacitacionesReturnPath,
          inlineDetails: true,
        })}
      </div>
    `;
  };

  return `
    <div class="panel capacitaciones-studio" data-capacitaciones-studio>
      <div class="section-head">
        <div>
          <span class="eyebrow">Capacitaciones</span>
          <h1>Capacitaciones</h1>
          <p>Vista operativa agrupada por programadas y finalizadas, con filtros vivos sin salir del dashboard.</p>
        </div>
      </div>
      <div class="capacitaciones-filter-bar">
        <div class="calendar-note-grid">
          <label class="calendar-note-field">
            <span>Buscar</span>
            <input data-capacitaciones-filter="search" placeholder="Sede, sucursal, fecha..." />
          </label>
          <label class="calendar-note-field">
            <span>Estatus</span>
            <select data-capacitaciones-filter="status">
              <option value="">Todos</option>
              <option value="PROGRAMADA">Programadas</option>
              <option value="FINALIZADA">Finalizadas</option>
            </select>
          </label>
          <label class="calendar-note-field">
            <span>Capacitador</span>
            <select data-capacitaciones-filter="capacitador">
              <option value="">Todos</option>
              ${capacitadores.map((employee) => `
                <option value="${escapeAttr(employee.rowId)}" ${employee.rowId === selectedEmployeeId ? "selected" : ""}>${escapeHtml(employee.nombre || employee.correo || employee.rowId)}</option>
              `).join("")}
            </select>
          </label>
          <label class="calendar-note-field">
            <span>Diplomas</span>
            <select data-capacitaciones-filter="diplomas">
              <option value="">Todos</option>
              <option value="Y">Con diplomas</option>
              <option value="N">Sin diplomas</option>
            </select>
          </label>
        </div>
        <div class="capacitaciones-filter-bar__meta">
          <span data-capacitaciones-results>${escapeHtml(String(capacitaciones.length))} capacitaciones visibles</span>
          <button class="button secondary" type="button" data-capacitaciones-filter-reset>Limpiar</button>
        </div>
      </div>
      <div class="capacitaciones-groups">
        ${groups.map((group) => `
          <details class="accordion-card capacitaciones-group" data-capacitacion-group data-group-status="${escapeAttr(group.key)}">
            <summary class="accordion-summary">
              <div class="accordion-summary-main">
                <strong>${escapeHtml(group.title)}</strong>
                <span>${escapeHtml(group.description)}</span>
              </div>
              <div class="accordion-summary-meta">
                <span class="status-chip ${group.key === "FINALIZADA" ? "is-finalizada" : "is-programada"}" data-capacitacion-group-count>${escapeHtml(String(group.rows.length))}</span>
                <span class="accordion-chevron" aria-hidden="true">+</span>
              </div>
            </summary>
            <div class="accordion-body">
              <div class="capacitacion-grid">
                ${group.rows.length ? group.rows.map(renderItem).join("") : `<div class="empty-state">No hay capacitaciones ${escapeHtml(group.title.toLowerCase())}.</div>`}
              </div>
              ${group.rows.length > 12 ? `<button class="button secondary capacitaciones-load-more" type="button" data-capacitaciones-more>Mostrar más capacitaciones</button>` : ""}
            </div>
          </details>
        `).join("")}
      </div>
    </div>
  `;
}

function renderConstanciasWorkspacePanel({
  capacitaciones = [],
  faltantes = [],
  selectedCapacitacion = null,
  selectedEmployee = null,
  user = null,
  employees = [],
  showStatusControls = false,
  actionPath = "/dashboard",
} = {}) {
  const candidates = (faltantes.length ? faltantes : capacitaciones).filter(Boolean);
  const active = selectedCapacitacion || candidates[0] || capacitaciones[0] || null;
  const activeId = String(active?.rowId || active?.id || "").trim();
  const constanciasUrl = active ? getCapacitacionConstanciasUrlFromCapacitacion(active) : "";
  const canPickCapacitador = user?.role === "admin";
  const capacitadorOptions = canPickCapacitador
    ? employees.filter((employee) => employee.role === "capacitador")
    : [];

  return `
    <div class="panel accolades-panel" style="margin-top:20px;">
      <div class="section-head">
        <div>
          <h2>Constancias</h2>
          <p>Creacion de constancias integrada a la plataforma, con selector de capacitacion y control para marcar diplomas como entregados.</p>
        </div>
      </div>
      <div class="detail-grid">
        ${canPickCapacitador ? `
          <form class="detail-block detail-block-wide" method="get" action="/dashboard">
            <strong>Capacitador</strong>
            <select name="employee" class="notes-textarea" onchange="if(this.value){window.location.href='/dashboard/capacitador/' + encodeURIComponent(this.value);}">
              <option value="">Vista general</option>
              ${capacitadorOptions.map((employee) => `
                <option value="${escapeAttr(employee.rowId)}" ${employee.rowId === selectedEmployee?.rowId ? "selected" : ""}>${escapeHtml(employee.nombre || employee.correo || employee.rowId)}</option>
              `).join("")}
            </select>
          </form>
        ` : ""}
        <form class="detail-block detail-block-wide" method="get" action="${escapeAttr(actionPath)}">
          <strong>Capacitacion</strong>
          <select name="capacitacion" class="notes-textarea" onchange="this.form.submit()">
            ${candidates.length ? candidates.map((capacitacion) => {
              const rowId = String(capacitacion.rowId || capacitacion.id || "").trim();
              const label = `${capacitacion.cedeLabel || capacitacion.cede || "Sin sede"} - ${capacitacion.dateLabel || capacitacion.dateRaw || "Sin fecha"}`;
              return `<option value="${escapeAttr(rowId)}" ${rowId === activeId ? "selected" : ""}>${escapeHtml(label)}</option>`;
            }).join("") : `<option value="">Sin capacitaciones disponibles</option>`}
          </select>
        </form>
        <div class="detail-block detail-block-wide">
          <strong>Constancias faltantes</strong>
          <span>${escapeHtml(String(faltantes.length))} capacitacion(es) sin constancias/diplomas.</span>
        </div>
        ${active ? `
          <div class="detail-block detail-block-wide">
            <strong>Seleccion activa</strong>
            <span>${escapeHtml(active.cedeLabel || active.cede || "Sin sede")} - ${escapeHtml(active.dateLabel || active.dateRaw || "Sin fecha")}</span>
          </div>
          <div class="detail-block detail-block-wide">
            <strong>Sucursales precargadas</strong>
            <div class="tag-row">
              ${(getCapacitacionSucursalesItems(active).map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`).join("")) || `<span class="calendar-empty">Sin sucursales</span>`}
            </div>
          </div>
          ${showStatusControls ? `
            <form class="detail-block detail-block-wide js-async-diplomas" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(active.rowId)}/diplomas">
              <input type="hidden" name="returnTo" value="${escapeAttr(actionPath)}" />
              <strong>Control de diplomas</strong>
              <button type="submit" name="diplomas" value="Y" class="status-button ${active.hasDiplomas ? "active" : ""}">
                ${active.hasDiplomas ? "Diplomas ya marcados" : "Marcar constancias/diplomas como listos"}
              </button>
            </form>
          ` : ""}
        ` : `<div class="empty-state">No hay capacitaciones para crear constancias.</div>`}
      </div>
      ${constanciasUrl ? `
        <div class="calendar-frame" style="margin-top:16px;">
          <div class="calendar-frame-top">
            <span class="calendar-frame-label">Vista de constancia</span>
            <a class="button secondary button--compact" href="${escapeAttr(constanciasUrl)}" target="_blank" rel="noopener noreferrer">Abrir en pestaña</a>
          </div>
          <iframe title="Crear constancias" src="${escapeAttr(constanciasUrl)}" style="width:100%;min-height:720px;border:0;border-radius:22px;background:#fff;"></iframe>
        </div>
      ` : ""}
    </div>
  `;
}

function renderSucursalesInfoPanel({ sucursales = [] } = {}) {
  const groups = new Map();
  for (const sucursal of Array.isArray(sucursales) ? sucursales : []) {
    const raw = sucursal?.raw || {};
    const empresa = String(raw.empresa_nombre || raw["RAZON SOCIAL"] || raw.razon_social || raw.empresa_id || "Sin empresa").trim();
    const estado = String(raw.estado_nombre || raw.ESTADO_NOMBRE || raw.estado || raw.estado_id || "Sin estado").trim();
    const municipio = String(raw.municipio_nombre || raw.MUNICIPIO_NOMBRE || raw.municipio || raw.municipio_id || "Sin municipio").trim();
    if (!groups.has(empresa)) groups.set(empresa, new Map());
    const estados = groups.get(empresa);
    if (!estados.has(estado)) estados.set(estado, new Map());
    const municipios = estados.get(estado);
    if (!municipios.has(municipio)) municipios.set(municipio, []);
    municipios.get(municipio).push(sucursal);
  }

  const markup = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([empresa, estados]) => `
      <details class="accordion-card">
        <summary class="accordion-summary">
          <div class="accordion-summary-main">
            <strong>${escapeHtml(empresa)}</strong>
            <span>${escapeHtml(String([...estados.values()].reduce((count, municipios) => count + [...municipios.values()].reduce((sum, rows) => sum + rows.length, 0), 0)))} sucursal(es)</span>
          </div>
          <div class="accordion-summary-meta"><span class="accordion-chevron">+</span></div>
        </summary>
        <div class="accordion-body">
          ${[...estados.entries()].sort(([a], [b]) => a.localeCompare(b, "es")).map(([estado, municipios]) => `
            <div class="detail-block detail-block-wide">
              <strong>${escapeHtml(estado)}</strong>
              ${[...municipios.entries()].sort(([a], [b]) => a.localeCompare(b, "es")).map(([municipio, rows]) => `
                <div style="margin-top:12px;">
                  <span class="chip">${escapeHtml(municipio)}</span>
                  <div class="tag-row" style="margin-top:8px;">
                    ${rows
                      .sort((a, b) => String(a.displayLabel || "").localeCompare(String(b.displayLabel || ""), "es"))
                      .map((row) => `<span class="tag-pill">${escapeHtml(row.displayLabel || row.label || row.key || "")}</span>`)
                      .join("")}
                  </div>
                </div>
              `).join("")}
            </div>
          `).join("")}
        </div>
      </details>
    `)
    .join("");

  return `
    <div class="panel accolades-panel" style="margin-top:20px;">
      <div class="section-head">
        <div>
          <h2>Informacion de sucursales</h2>
          <p>Sucursales agrupadas por empresa, estado y municipio. Se muestra solo el label de cada sucursal para evitar informacion redundante.</p>
        </div>
      </div>
      ${markup || `<div class="empty-state">No hay sucursales para mostrar.</div>`}
    </div>
  `;
}

function renderNotasThreadPanel({ calendarNotes = [], capacitaciones = [], employees = [], user = null, canEditNotes = false, canEditAllNotes = false } = {}) {
  const noteItems = [
    ...(Array.isArray(calendarNotes) ? calendarNotes : []).map((note) => ({
      type: "Nota calendario",
      title: note.title || note.noteTitle || "Nota",
      date: note.dateLabel || note.dateRaw || "",
      body: note.notes || note.title || note.noteTitle || "",
      author: note.author || note.authorName || note.authorEmail || "Sin autor registrado",
    })),
    ...(Array.isArray(capacitaciones) ? capacitaciones : []).flatMap((capacitacion) => [
      ...(String(capacitacion.notas || "").trim() ? [{
        type: "Capacitacion",
        title: capacitacion.cedeLabel || capacitacion.cede || "Capacitacion",
        date: capacitacion.dateLabel || capacitacion.dateRaw || "",
        body: capacitacion.notas || "",
        author: "Registro historico",
      }] : []),
      ...(Array.isArray(capacitacion.threadNotes) ? capacitacion.threadNotes.map((note) => ({
        id: note.id,
        type: "Capacitacion",
        title: capacitacion.cedeLabel || capacitacion.cede || "Capacitacion",
        date: note.createdAt || capacitacion.dateLabel || "",
        body: note.body || "",
        author: note.authorName || note.authorEmail || "Sin autor registrado",
        authorId: note.authorId || "",
        authorEmail: note.authorEmail || "",
      })) : []),
    ]),
  ].filter((item) => String(item.body || "").trim());
  const noteThreads = Array.from(noteItems.reduce((threads, item) => {
    const key = `${item.type || "Nota"}::${item.title || "General"}`;
    if (!threads.has(key)) threads.set(key, { key, type: item.type || "Nota", title: item.title || "General", items: [] });
    threads.get(key).items.push(item);
    return threads;
  }, new Map()).values());

  return `
    <div class="panel accolades-panel" style="margin-top:20px;">
      <div class="section-head">
        <div>
          <h1>Notas</h1>
          <p>Lectura tipo hilo para notas y observaciones visibles en el dashboard. El formato objetivo es usuario - fecha: nota.</p>
        </div>
      </div>
      ${canEditNotes ? `<details class="accordion-card note-compose-card">
        <summary class="accordion-summary">
          <div class="accordion-summary-main"><strong>Nueva nota</strong><span>Crear una observacion y etiquetar empleados</span></div>
          <div class="accordion-summary-meta"><span class="accordion-chevron" aria-hidden="true">+</span></div>
        </summary>
        <div class="accordion-body">${renderCalendarNoteForm({
          employees,
          selectedEmployeeId: user?.rowId || "",
          returnTo: "/dashboard",
          canEditNotes,
          action: portalPath("/dashboard/calendario/notas"),
          submitLabel: "Crear nota",
        })}</div>
      </details>` : ""}
      <div class="ui-filter-bar notes-filter-bar" data-notes-toolbar>
        <label class="calendar-note-field"><span>Buscar notas</span><input type="search" data-notes-search placeholder="Usuario, fecha, sede o contenido..." /></label>
        <div class="capacitaciones-filter-bar__meta"><span data-notes-count>${escapeHtml(String(noteItems.length))} notas</span><button class="button secondary" type="button" data-notes-clear>Limpiar</button></div>
      </div>
      <div class="accordion-list" style="margin-top:14px;" data-notes-list>
        ${noteThreads.length ? noteThreads.map((thread) => `
          <details class="accordion-card note-thread-card" data-note-thread data-note-count="${thread.items.length}" data-search="${escapeAttr(thread.items.map((item) => `${item.author || ""} ${item.date || ""} ${item.body || ""}`).join(" ") + ` ${thread.type} ${thread.title}`)}">
            <summary class="accordion-summary">
              <div class="accordion-summary-main"><strong>${escapeHtml(thread.title)}</strong><span>${escapeHtml(thread.type)}</span></div>
              <div class="accordion-summary-meta"><span class="status-chip">${thread.items.length}</span><span class="accordion-chevron" aria-hidden="true">+</span></div>
            </summary>
            <div class="accordion-body note-thread-body">
              ${thread.items.map((item) => {
                const currentUserKeys = [user?.rowId, user?.correo].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
                const authorKeys = [item.authorId, item.authorEmail].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
                const canManageEntry = Boolean(item.id && canEditNotes && (canEditAllNotes || authorKeys.some((key) => currentUserKeys.includes(key))));
                return `<article class="detail-block detail-block-wide note-thread-entry"${item.id ? ` data-thread-note-id="${escapeAttr(item.id)}"` : ""}>
                  <strong>${escapeHtml(item.author || "Sistema")} - ${escapeHtml(item.date || "Sin fecha")}</strong>
                  <span class="thread-note-body">${escapeHtml(item.body)}</span>
                  ${canManageEntry ? `<details class="note-entry-actions"><summary>Editar o eliminar</summary><form class="notes-form js-edit-thread-note" method="post" action="${portalPath(`/dashboard/notas/${encodeURIComponent(item.id)}/editar`)}"><textarea name="notas" rows="3" required>${escapeHtml(item.body)}</textarea><div class="notes-actions"><button type="submit" class="status-button">Guardar cambio</button><button type="button" class="status-button secondary js-delete-thread-note" data-action="${portalPath(`/dashboard/notas/${encodeURIComponent(item.id)}/eliminar`)}">Eliminar</button></div></form></details>` : ""}
                </article>`;
              }).join("")}
            </div>
          </details>
        `).join("") : `<div class="empty-state">No hay notas visibles.</div>`}
      </div>
      ${noteThreads.length > 12 ? `<button class="button secondary notes-load-more" type="button" data-notes-more>Mostrar más hilos</button>` : ""}
      <script>(() => {
        const script = document.currentScript;
        const root = script?.closest('.accolades-panel');
        if (!root || root.dataset.notesReady === '1') return;
        root.dataset.notesReady = '1';
        const search = root.querySelector('[data-notes-search]');
        const count = root.querySelector('[data-notes-count]');
        const more = root.querySelector('[data-notes-more]');
        const rows = Array.from(root.querySelectorAll('[data-note-thread]'));
        let limit = 12;
        const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase();
        const apply = () => {
          const query = normalize(search?.value);
          const matches = rows.filter((row) => !query || normalize(row.dataset.search).includes(query));
          rows.forEach((row) => { row.hidden = !matches.includes(row) || matches.indexOf(row) >= limit; });
          const visibleNotes = matches.slice(0, limit).reduce((total, row) => total + Number(row.dataset.noteCount || 0), 0);
          const totalNotes = matches.reduce((total, row) => total + Number(row.dataset.noteCount || 0), 0);
          if (count) count.textContent = visibleNotes + ' de ' + totalNotes + ' notas en ' + matches.length + ' hilos';
          if (more) more.hidden = matches.length <= limit;
        };
        search?.addEventListener('input', () => { limit = 12; apply(); });
        root.querySelector('[data-notes-clear]')?.addEventListener('click', () => { if (search) search.value = ''; limit = 12; apply(); search?.focus(); });
        more?.addEventListener('click', () => { limit += 12; apply(); });
        apply();
      })();</script>
    </div>
  `;
}

function renderConstanciasWorkspacePanelV2({
  capacitaciones = [],
  faltantes = [],
  selectedCapacitacion = null,
  selectedEmployee = null,
  user = null,
  employees = [],
  showStatusControls = false,
} = {}) {
  const candidates = (faltantes.length ? faltantes : capacitaciones).filter(Boolean);
  const defaultEmployeeId = selectedEmployee?.role === "capacitador" ? String(selectedEmployee.rowId || "") : "";
  const active = selectedCapacitacion || candidates.find((capacitacion) => {
    if (!defaultEmployeeId) return true;
    return Array.isArray(capacitacion.capacitadores)
      && capacitacion.capacitadores.some((item) => String(item?.key || "").trim() === defaultEmployeeId);
  }) || candidates[0] || capacitaciones[0] || null;
  const activeId = String(active?.rowId || active?.id || "").trim();
  const capacitadorOptions = employees.filter((employee) => employee.role === "capacitador");
  const canPickCapacitador = user?.role === "admin";

  const optionsMarkup = candidates.map((capacitacion) => {
    const rowId = String(capacitacion.rowId || capacitacion.id || "").trim();
    const label = `${capacitacion.cedeLabel || capacitacion.cede || "Sin sede"} - ${capacitacion.dateLabel || capacitacion.dateRaw || "Sin fecha"}`;
    const sucursalesItems = getCapacitacionSucursalesItems(capacitacion);
    const capacitadorKeys = Array.isArray(capacitacion.capacitadores)
      ? capacitacion.capacitadores.map((item) => String(item?.key || "").trim()).filter(Boolean).join(",")
      : "";
    return `
      <option
        value="${escapeAttr(rowId)}"
        data-url="${escapeAttr(getCapacitacionConstanciasUrlFromCapacitacion(capacitacion))}"
        data-integrated-url="${escapeAttr(getIntegratedConstanciasUrlFromCapacitacion(capacitacion))}"
        data-sede="${escapeAttr(capacitacion.cedeLabel || capacitacion.cede || "Sin sede")}"
        data-fecha="${escapeAttr(capacitacion.dateLabel || capacitacion.dateRaw || "Sin fecha")}"
        data-diplomas="${capacitacion.hasDiplomas ? "Y" : "N"}"
        data-capacitadores="${escapeAttr(capacitadorKeys)}"
        data-sucursales="${escapeAttr(JSON.stringify(sucursalesItems))}"
        ${rowId === activeId ? "selected" : ""}
      >${escapeHtml(label)}</option>
    `;
  }).join("");

  return `
    <div class="panel constancias-studio platform-surface" data-constancias-studio>
      <div class="section-head">
        <div>
          <span class="eyebrow">Generador de Constancias</span>
          <h1>Generador de Constancias</h1>
          <p>Selecciona capacitador y capacitacion sin salir del dashboard. La vista de constancias se precarga con sede, fecha y sucursales.</p>
        </div>
      </div>
      <div class="constancias-workbench">
      <aside class="constancias-workbench__controls">
      <div class="calendar-frame">
        <div class="calendar-frame-top">
          <span class="calendar-frame-label">Controles</span>
          <span class="calendar-frame-caption">${escapeHtml(String(faltantes.length))} capacitacion(es) sin constancias/diplomas</span>
        </div>
        <div class="detail-grid">
          ${canPickCapacitador ? `
            <label class="calendar-note-field">
              <span>Capacitador</span>
              <select data-constancias-capacitador-filter>
                <option value="">Todos los capacitadores</option>
                ${capacitadorOptions.map((employee) => `
                  <option value="${escapeAttr(employee.rowId)}" ${employee.rowId === defaultEmployeeId ? "selected" : ""}>${escapeHtml(employee.nombre || employee.correo || employee.rowId)}</option>
                `).join("")}
              </select>
            </label>
          ` : `
            <label class="calendar-note-field">
              <span>Capacitador</span>
              <input value="${escapeAttr(selectedEmployee?.nombre || user?.nombre || "Capacitador")}" readonly />
            </label>
          `}
          <label class="calendar-note-field">
            <span>Capacitacion</span>
            <select data-constancias-capacitacion-select>
              ${optionsMarkup || `<option value="">Sin capacitaciones disponibles</option>`}
            </select>
          </label>
          <form class="calendar-note-field js-async-diplomas" method="post" action="/dashboard/capacitaciones/${encodeURIComponent(activeId)}/diplomas" data-constancias-diplomas-form>
            <span>Control de diplomas</span>
            <div class="status-actions" data-constancias-diplomas-toggle>
              <button type="submit" name="diplomas" value="Y" class="status-button ${active?.hasDiplomas ? "active" : ""}">SI</button>
              <button type="submit" name="diplomas" value="N" class="status-button ${active?.hasDiplomas ? "" : "active"}">NO</button>
            </div>
          </form>
        </div>
      </div>
      <div class="calendar-detail-card" data-constancias-summary>
        <div class="calendar-detail-top">
          <div>
            <span class="detail-kicker">Capacitacion seleccionada</span>
            <h3 data-constancias-sede>${escapeHtml(active?.cedeLabel || active?.cede || "Sin sede")}</h3>
          </div>
          <span class="status-chip ${active?.hasDiplomas ? "is-finalizada" : "is-programada"}" data-constancias-diplomas-state>${active?.hasDiplomas ? "DIPLOMAS: SI" : "DIPLOMAS: NO"}</span>
        </div>
        <div class="calendar-detail-meta">
          <span class="chip" data-constancias-fecha>${escapeHtml(active?.dateLabel || active?.dateRaw || "Sin fecha")}</span>
        </div>
        <div class="calendar-detail-section">
          <strong>Sucursales precargadas</strong>
          <div class="tag-row" data-constancias-sucursales>
            ${(getCapacitacionSucursalesItems(active).map((item) => `<span class="tag-pill">${escapeHtml(item)}</span>`).join("")) || `<span class="calendar-empty">Sin sucursales</span>`}
          </div>
        </div>
        <a class="button secondary button--compact constancias-open" href="${escapeAttr(getCapacitacionConstanciasUrlFromCapacitacion(active))}" target="_blank" rel="noopener noreferrer" data-constancias-open>Abrir versión independiente</a>
      </div>
      </aside>
      ${active ? `
        <div class="constancias-workbench__canvas">
          <iframe title="Generador de Constancias" data-src="${escapeAttr(getIntegratedConstanciasUrlFromCapacitacion(active))}" loading="lazy" data-constancias-frame></iframe>
        </div>
      ` : `<div class="empty-state">No hay capacitaciones para generar constancias.</div>`}
      </div>
    </div>
  `;
}

function renderSucursalesInfoPanelV2({ sucursales = [], empresas = [], selectedEmpresaId = "" } = {}) {
  const companyMap = new Map();
  for (const empresa of Array.isArray(empresas) ? empresas : []) {
    const raw = empresa?.raw || empresa || {};
    const key = String(empresa?.key || raw.id || raw.ID || raw["Row ID"] || "").trim();
    if (!key) continue;
    companyMap.set(key, {
      key,
      nombreComercial: String(empresa?.nombreComercial || raw.nombre_comercial || raw["NOMBRE COMERCIAL"] || raw.razon_social || raw["RAZON SOCIAL"] || key).trim(),
      razonSocial: String(empresa?.razonSocial || raw.razon_social || raw["RAZON SOCIAL"] || "Sin razón social").trim(),
      logo: String(empresa?.logo || raw.logo_url || raw.logo || raw.LOGOURL || raw.LOGO || "").trim(),
      rows: [],
    });
  }
  for (const sucursal of Array.isArray(sucursales) ? sucursales : []) {
    const raw = sucursal?.raw || {};
    const empresaId = String(raw.empresa_id || raw.EMPRESA || raw["ID EMPRESA"] || raw.razon_social || "sin-empresa").trim();
    const empresaKey = empresaId || "sin-empresa";
    if (!companyMap.has(empresaKey)) {
      companyMap.set(empresaKey, {
        key: empresaKey,
        nombreComercial: String(raw.nombre_comercial || raw.empresa_nombre_comercial || raw.empresa_nombre || raw.razon_social || raw["RAZON SOCIAL"] || empresaKey).trim(),
        razonSocial: String(raw.empresa_nombre || raw.razon_social || raw["RAZON SOCIAL"] || "Sin razon social").trim(),
        logo: String(raw.logo_url || raw.logo || raw.LOGOURL || raw.LOGO || "").trim(),
        rows: [],
      });
    }
    companyMap.get(empresaKey).rows.push(sucursal);
  }
  const deduplicatedCompanies = new Map();
  for (const company of companyMap.values()) {
    const signature = `${normalizeText(company.nombreComercial)}|${normalizeText(company.razonSocial)}`;
    const existing = deduplicatedCompanies.get(signature);
    if (!existing) {
      deduplicatedCompanies.set(signature, { ...company, aliases: [company.key] });
      continue;
    }
    existing.aliases.push(company.key);
    existing.rows.push(...company.rows);
    if (!existing.logo && company.logo) existing.logo = company.logo;
  }
  const companies = [...deduplicatedCompanies.values()].sort((a, b) => a.nombreComercial.localeCompare(b.nombreComercial, "es"));
  const requestedCompanyId = String(selectedEmpresaId || "").trim();
  const selectedCompany = companies.find((company) => company.aliases.includes(requestedCompanyId)) || null;
  const renderCompany = (company) => {
    const byState = new Map();
    for (const sucursal of company.rows) {
      const raw = sucursal?.raw || {};
      const estado = String(raw.estado_nombre || raw.ESTADO_NOMBRE || raw.estado || raw.estado_id || "Sin estado").trim();
      const municipio = String(raw.municipio_nombre || raw.MUNICIPIO_NOMBRE || raw.municipio || raw.municipio_id || "Sin municipio").trim();
      if (!byState.has(estado)) {
        byState.set(estado, {
          id: String(raw.estado_id || "").trim(),
          escudo: String(raw.estado_escudo || "").trim(),
          municipios: new Map(),
        });
      }
      const stateEntry = byState.get(estado);
      if (!stateEntry.municipios.has(municipio)) {
        stateEntry.municipios.set(municipio, {
          id: String(raw.municipio_id || "").trim(),
          escudo: String(raw.municipio_escudo || "").trim(),
          rows: [],
        });
      }
      stateEntry.municipios.get(municipio).rows.push(sucursal);
    }
    const withAddress = company.rows.filter((row) => String(row?.raw?.DIRECCION || row?.raw?.direccion || "").trim()).length;
    const withDrive = company.rows.filter((row) => getStructuredUrl(row?.raw?.DRIVE || row?.raw?.drive || "")).length;
    const capacitadores = new Set(company.rows.flatMap((row) => String(row?.raw?.capacitadores || "").split(",")).map((value) => value.trim()).filter(Boolean));
    const latestWorkOptions = new Set(company.rows.flatMap((row) => {
      const raw = row?.raw || {};
      return [raw.ultimo_pipc_estatal, raw.ultimo_municipal]
        .map((value) => String(value || "").trim()).filter((value) => /^\d{4}$/.test(value));
    }));

    const renderSucursal = (row) => {
      const raw = row.raw || {};
      const label = String(row.displayLabel || row.label || row.name || row.key || "Sucursal").trim();
      const tienda = String(row.tienda || raw.TIENDA || "").trim();
      const address = String(raw.DIRECCION || raw.direccion || raw.ADDRESS || "").trim();
      const trabajos = String(raw.trabajos || raw.TRABAJOS || raw.tipo || raw.TIPO || "").trim();
      const pedidoEstatal = String(raw.pedido_estatal || "").trim();
      const pedidoMunicipal = String(raw.pedido_municipal || "").trim();
      const estatal = String(raw.ultimo_pipc_estatal || "").trim();
      const municipal = String(raw.ultimo_municipal || "").trim();
      const capacitadoresLabel = String(raw.capacitadores || "").trim();
      const planeacion = String(raw.planeacion_status || "").trim();
      const risk = String(raw.nivel_riesgo || "").trim();
      const month = String(raw.mes_planeacion ?? raw.assigned_month ?? "").trim();
      const monthLabel = MONTH_NAMES[Number(month)] || month;
      const capacitacionStatus = String(raw.status_capacitacion || "").trim();
      const capacitacionDate = String(raw.fecha_ultima_capacitacion || "").trim();
      const estatalLabel = [estatal, raw.estatus_pipc_estatal].filter(Boolean).join(" · ");
      const municipalLabel = [municipal, raw.estatus_municipal].filter(Boolean).join(" · ");
      const driveUrl = getStructuredUrl(raw.DRIVE || raw.drive || "");
      const lat = Number(raw.LAT ?? raw.lat);
      const lng = Number(raw.LNG ?? raw.lng);
      const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
      const search = [label, tienda, address, trabajos, pedidoEstatal, pedidoMunicipal, estatalLabel, municipalLabel, capacitadoresLabel, planeacion, risk, capacitacionStatus || "SIN CAPACITACIÓN", capacitacionDate].join(" ");
      return `
        <details class="branch-card" data-sucursal-chip data-search="${escapeAttr(search)}" data-pedidos="${escapeAttr(`${pedidoEstatal} ${pedidoMunicipal}`)}" data-trabajos="${escapeAttr(trabajos)}" data-estatal-year="${escapeAttr(estatal)}" data-municipal-year="${escapeAttr(municipal)}">
          <summary class="branch-card__summary">
            <span class="branch-card__store">${escapeHtml(tienda || "S/N")}</span>
            <span class="branch-card__identity"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(address || "Dirección pendiente")}</small></span>
            <span class="branch-card__signals">${trabajos ? `<span class="territory-pill">${escapeHtml(trabajos)}</span>` : ""}<span class="accordion-chevron" aria-hidden="true">+</span></span>
          </summary>
          <div class="branch-card__body">
            <dl class="branch-facts">
              <div><dt>Pedido estatal</dt><dd>${escapeHtml(pedidoEstatal || "Sin pedido estatal este año")}</dd></div>
              <div><dt>Pedido municipal</dt><dd>${escapeHtml(pedidoMunicipal || "Sin pedido municipal este año")}</dd></div>
              <div><dt>PIPC estatal</dt><dd>${escapeHtml(estatalLabel || "Sin registro")}</dd></div>
              <div><dt>Trabajo municipal</dt><dd>${escapeHtml(municipalLabel || "Sin registro")}</dd></div>
              <div><dt>Capacitadores</dt><dd>${escapeHtml(capacitadoresLabel || "Sin asignar")}</dd></div>
              <div><dt>Planeación</dt><dd>${escapeHtml(monthLabel ? `${monthLabel}${planeacion ? ` · ${planeacion}` : ""}` : (planeacion || "Sin programar"))}</dd></div>
              <div><dt>Capacitación</dt><dd>${escapeHtml(capacitacionStatus ? `${capacitacionStatus}${capacitacionDate ? ` · ${capacitacionDate}` : ""}` : "Sin capacitación")}</dd></div>
              <div><dt>Nivel de riesgo</dt><dd>${escapeHtml(risk || "Sin clasificar")}</dd></div>
              <div><dt>Precio estatal</dt><dd>${escapeHtml(formatOptionalMoney(raw.precio_estatal))}</dd></div>
              <div><dt>Precio municipal</dt><dd>${escapeHtml(formatOptionalMoney(raw.precio_municipal))}</dd></div>
            </dl>
            <div class="branch-card__actions">
              ${driveUrl ? `<a class="button secondary button--compact" href="${escapeAttr(driveUrl)}" target="_blank" rel="noopener noreferrer">Abrir Drive</a>` : ""}
              ${hasCoordinates ? `<a class="button secondary button--compact" href="https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}" target="_blank" rel="noopener noreferrer">Ver ubicación</a>` : ""}
            </div>
          </div>
        </details>`;
    };
    return `
      <section class="company-profile" data-sucursales-company="${escapeAttr(company.key)}">
        <a class="company-back" href="${portalPath("/dashboard")}?tab=sucursales">← Directorio de empresas</a>
        <header class="company-hero">
          <div class="company-hero__identity">
            ${company.logo ? `<img class="company-profile__logo" src="${portalPath(`/dashboard/empresas/${encodeURIComponent(company.key)}/logo`)}" alt="${escapeAttr(company.nombreComercial)}" />` : `<span class="company-logo-fallback">${escapeHtml(company.nombreComercial.slice(0, 2).toUpperCase())}</span>`}
            <div><span class="detail-kicker">Perfil empresarial</span><h3>${escapeHtml(company.nombreComercial)}</h3><p>${escapeHtml(company.razonSocial)}</p></div>
          </div>
          <div class="company-hero__metrics" aria-label="Resumen de empresa">
            <article><strong>${company.rows.length}</strong><span>Sucursales</span></article>
            <article><strong>${byState.size}</strong><span>Estados</span></article>
            <article><strong>${withDrive}</strong><span>Con Drive</span></article>
            <article><strong>${capacitadores.size}</strong><span>Capacitadores</span></article>
          </div>
        </header>
        <div class="company-data-quality"><span>${withAddress} de ${company.rows.length} sucursales con dirección</span><span>Todo el detalle inicia contraído</span></div>
        <div class="company-filter-bar">
          <label class="calendar-note-field company-filter-search"><span>Buscar sucursal</span><input data-sucursales-filter="search" type="search" placeholder="Nombre, tienda, dirección..." /></label>
          <label class="calendar-note-field"><span>Pedido</span><input data-sucursales-filter="pedido" placeholder="Pedido estatal o municipal..." /></label>
          <label class="calendar-note-field"><span>Trabajo</span><select data-sucursales-filter="trabajo"><option value="">Todos</option><option value="ESTATAL">Estatal</option><option value="MUNICIPAL">Municipal</option><option value="OTRO">Otro</option></select></label>
          <label class="calendar-note-field"><span>Último trabajo</span><select data-sucursales-filter="vigencia"><option value="">Todos los años</option>${[...latestWorkOptions].sort((a, b) => b.localeCompare(a, "es", { numeric: true })).map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>
          <label class="calendar-note-field"><span>Capacitador</span><select data-sucursales-filter="capacitador"><option value="">Todos</option>${[...capacitadores].sort((a, b) => a.localeCompare(b, "es")).map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>
          <label class="calendar-note-field"><span>Estado capacitación</span><select data-sucursales-filter="capacitacion"><option value="">Todos</option><option value="PROGRAMADA">Programada</option><option value="FINALIZADA">Finalizada</option><option value="SIN CAPACITACIÓN">Sin capacitación</option></select></label>
          <button class="button secondary company-filter-reset" type="button" data-sucursales-filter-reset>Limpiar filtros</button>
        </div>
        <p class="company-results" data-sucursales-results>${company.rows.length} sucursales disponibles</p>
        <div class="territory-list">
          ${[...byState.entries()].sort(([a], [b]) => a.localeCompare(b, "es")).map(([estado, stateEntry]) => {
            const count = [...stateEntry.municipios.values()].reduce((total, entry) => total + entry.rows.length, 0);
            return `<details class="accordion-card territory-card" data-territory-state>
              <summary class="accordion-summary">
                <span class="territory-crest territory-crest--state">${stateEntry.escudo && stateEntry.id ? `<img src="${portalPath(`/dashboard/territorios/estado/${encodeURIComponent(stateEntry.id)}/escudo`)}" alt="Escudo de ${escapeAttr(estado)}" loading="lazy" />` : `<span>${escapeHtml(estado.slice(0, 2).toUpperCase())}</span>`}</span>
                <div class="accordion-summary-main"><strong>${escapeHtml(estado)}</strong><span data-territory-state-count aria-live="polite">${count} sucursales · ${stateEntry.municipios.size} municipios</span></div>
                <div class="accordion-summary-meta"><span class="accordion-chevron" aria-hidden="true">+</span></div>
              </summary>
              <div class="accordion-body territory-card__body">
                ${[...stateEntry.municipios.entries()].sort(([a], [b]) => a.localeCompare(b, "es")).map(([municipio, entry]) => `
                  <details class="municipality-card" data-territory-municipality>
                    <summary class="municipality-card__summary">
                      <span class="territory-crest territory-crest--municipality">${entry.escudo && entry.id ? `<img src="${portalPath(`/dashboard/territorios/municipio/${encodeURIComponent(entry.id)}/escudo`)}" alt="Escudo de ${escapeAttr(municipio)}" loading="lazy" />` : `<span>${escapeHtml(municipio.slice(0, 2).toUpperCase())}</span>`}</span>
                      <span><strong>${escapeHtml(municipio)}</strong><small data-territory-municipality-count aria-live="polite">${entry.rows.length} sucursales</small></span>
                      <span class="accordion-chevron" aria-hidden="true">+</span>
                    </summary>
                    <div class="municipality-card__body">${entry.rows.sort((a, b) => String(a.displayLabel || "").localeCompare(String(b.displayLabel || ""), "es")).map(renderSucursal).join("")}</div>
                  </details>
                `).join("")}
              </div>
            </details>`;}).join("")}
        </div>
      </section>
    `;
  };

  return `
    <div class="panel sucursales-studio platform-surface" data-sucursales-studio>
      <div class="section-head">
        <div>
          <span class="eyebrow">Información de sucursales</span>
          <h1>Empresas y sucursales</h1>
          <p>${selectedCompany ? "Perfil empresarial y sucursales agrupadas por estado y municipio." : "Selecciona una empresa para abrir su perfil y consultar sus sucursales."}</p>
        </div>
      </div>
      ${selectedCompany ? renderCompany(selectedCompany) : `
      <div class="company-directory-tools">
        <label class="calendar-note-field company-directory-search"><span>Buscar empresa</span><input type="search" placeholder="Nombre comercial o razón social..." data-company-directory-search /></label>
        <span class="company-results" data-company-directory-results>${companies.length} empresas disponibles</span>
      </div>
      <div class="company-directory">
        ${companies.length ? companies.map((company) => `
          <a class="company-card" href="${portalPath(`/dashboard/empresas/${encodeURIComponent(company.key)}`)}" data-company-directory-card data-search="${escapeAttr(`${company.nombreComercial} ${company.razonSocial}`)}">
            <span class="company-card__media">
              ${company.logo ? `<img src="${portalPath(`/dashboard/empresas/${encodeURIComponent(company.key)}/logo`)}" alt="Logo de ${escapeAttr(company.nombreComercial)}" />` : `<span>${escapeHtml(company.nombreComercial.slice(0, 2).toUpperCase())}</span>`}
            </span>
            <span class="company-card__copy">
              <strong>${escapeHtml(company.nombreComercial)}</strong>
              <small>${escapeHtml(company.razonSocial)}</small>
              <em>${escapeHtml(String(company.rows.length))} ${company.rows.length === 1 ? "sucursal" : "sucursales"}</em>
            </span>
            <span class="company-card__arrow">→</span>
          </a>
        `).join("") : `<div class="empty-state">No hay empresas para mostrar.</div>`}
      </div>
      ${companies.length > 24 ? `<button class="button secondary company-directory-more" type="button" data-company-directory-more>Mostrar más empresas</button>` : ""}
      `}
    </div>
  `;
}

function renderCasaLeyStoresReport({ sucursales = [] } = {}) {
  const currentYear = new Date().getFullYear();
  const completed = (value) => ["EN DRIVE", "IMPRESO", "ENTREGADO"].some((status) => normalizeText(value).includes(status));
  const rows = (Array.isArray(sucursales) ? sucursales : [])
    .filter((row) => {
      const raw = row?.raw || {};
      const empresaId = String(raw.empresa_id || raw.EMPRESA || raw["ID EMPRESA"] || "").trim();
      const trabajos = normalizeText(raw.trabajos || raw.TRABAJOS || raw.tipo || raw.TIPO || "");
      return empresaId === "1" && (trabajos.includes("ESTATAL") || trabajos.includes("MUNICIPAL"));
    })
    .map((row) => {
      const raw = row.raw || {};
      const estatalYear = extractPedidoYear(raw.ultimo_pipc_estatal);
      const municipalYear = extractPedidoYear(raw.ultimo_municipal);
      const estatalActual = estatalYear === currentYear && completed(raw.estatus_pipc_estatal);
      const municipalActual = municipalYear === currentYear && completed(raw.estatus_municipal);
      const pcYear = extractPedidoYear(raw.pc_estatal_fecha || raw.fecha_pc_estatal || raw.pc_fecha);
      const pcStatus = pcYear === currentYear
        ? String(raw.pc_estatal_status || raw.status_pc_estatal || raw.pc_status || "PENDIENTE").trim()
        : "PENDIENTE";
      return {
        label: String(row.displayLabel || row.label || row.name || row.key || "Sucursal").trim(),
        municipio: String(raw.municipio_nombre || raw.municipio || raw.municipio_id || "Sin municipio").trim(),
        estado: String(raw.estado_nombre || raw.estado || raw.estado_id || "Sin estado").trim(),
        capacitacion: String(raw.status_capacitacion || "SIN CAPACITACION").trim(),
        capacitador: String(raw.capacitadores || "Sin asignar").trim(),
        estatalActual,
        municipalActual,
        pcStatus,
        idPc: String(raw.id_pc || raw.ID_PC || "").trim(),
      };
    })
    .sort((a, b) => a.estado.localeCompare(b.estado, "es") || a.municipio.localeCompare(b.municipio, "es") || a.label.localeCompare(b.label, "es"));
  const rowMarkup = rows.map((row) => {
    const search = [row.label, row.municipio, row.estado, row.capacitacion, row.capacitador, row.pcStatus].join(" ");
    return `<tr data-casa-ley-row data-search="${escapeAttr(search)}" data-work="${row.estatalActual ? "ESTATAL " : ""}${row.municipalActual ? "MUNICIPAL" : ""}">
      <td><strong>${escapeHtml(row.label)}</strong><small style="display:block;color:var(--muted);margin-top:4px;">${escapeHtml(`${row.municipio} · ${row.estado}`)}</small></td>
      <td><span class="chip ${row.capacitacion === "FINALIZADA" ? "ok" : ""}">${escapeHtml(row.capacitacion)}</span></td>
      <td>${escapeHtml(row.capacitador)}</td>
      <td><span class="chip ${row.municipalActual ? "ok" : "warn"}">${row.municipalActual ? "SI" : "NO"}</span></td>
      <td><span class="chip ${row.estatalActual ? "ok" : "warn"}">${row.estatalActual ? "SI" : "NO"}</span></td>
      <td><span class="chip ${normalizeText(row.pcStatus) === "PENDIENTE" ? "warn" : "ok"}">${escapeHtml(row.pcStatus)}</span>${row.idPc ? `<small style="display:block;color:var(--muted);margin-top:4px;">ID ${escapeHtml(row.idPc)}</small>` : ""}</td>
    </tr>`;
  }).join("");
  return `<section class="pedidos-native pedidos-surface" data-casa-ley-report>
    <div class="pedidos-header">
      <div><span class="detail-kicker">Operacion Casa Ley · ${currentYear}</span><h1>Reporte de tiendas</h1><p>Seguimiento anual de trabajos, capacitacion y Proteccion Civil desde la base local persistente.</p></div>
      <span class="pill strong" data-casa-ley-count>${rows.length} tiendas</span>
    </div>
    <div class="pedidos-filter-grid">
      <label class="pedidos-field"><span>Buscar</span><input type="search" data-casa-ley-search placeholder="Tienda, municipio, estado o capacitador..."></label>
      <label class="pedidos-field"><span>Trabajo vigente</span><select data-casa-ley-work><option value="">Todos</option><option value="ESTATAL">Estatal</option><option value="MUNICIPAL">Municipal</option></select></label>
    </div>
    <div class="pedidos-table-shell casa-ley-table-shell"><table><thead><tr><th>Tienda</th><th>Capacitacion</th><th>Capacitador</th><th>Municipal ${currentYear}</th><th>Estatal ${currentYear}</th><th>PC Estatal</th></tr></thead><tbody>${rowMarkup || `<tr><td colspan="6">No hay tiendas Casa Ley con trabajos configurados.</td></tr>`}</tbody></table></div>
    ${rows.length > 30 ? `<button class="button secondary casa-ley-more" type="button" data-casa-ley-more>Mostrar más tiendas</button>` : ""}
    <script>(() => {
      const root = document.currentScript.closest('[data-casa-ley-report]');
      if (!root) return;
      const search = root.querySelector('[data-casa-ley-search]');
      const work = root.querySelector('[data-casa-ley-work]');
      const count = root.querySelector('[data-casa-ley-count]');
      const more = root.querySelector('[data-casa-ley-more]');
      const rows = Array.from(root.querySelectorAll('[data-casa-ley-row]'));
      let limit = window.matchMedia('(max-width: 720px)').matches ? 8 : 30;
      const pageSize = limit;
      const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase();
      const apply = () => {
        const query = normalize(search?.value);
        const kind = work?.value || '';
        const matches = rows.filter((row) => (!query || normalize(row.dataset.search).includes(query)) && (!kind || row.dataset.work.includes(kind)));
        rows.forEach((row) => { row.hidden = !matches.includes(row) || matches.indexOf(row) >= limit; });
        if (count) count.textContent = Math.min(limit, matches.length) + ' de ' + matches.length + ' tiendas';
        if (more) more.hidden = matches.length <= limit;
      };
      search?.addEventListener('input', () => { limit = 30; apply(); });
      work?.addEventListener('change', () => { limit = 30; apply(); });
      more?.addEventListener('click', () => { limit += pageSize; apply(); });
      apply();
    })();</script>
  </section>`;
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

function renderSolventacionesPanel() {
  return `
    <div class="dashboard-tab-panel-content" data-solventaciones-shell>
      <iframe
        title="Sistema de Proteccion Civil"
        data-solventaciones-frame
        data-src="/solventaciones/html?embed=1"
        loading="lazy"
        style="display:block;width:100%;min-height:980px;border:0;background:transparent;"
      ></iframe>
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
    const constanciasUrl = typeof options.hrefBuilder === "function"
      ? options.hrefBuilder(capacitacion)
      : getCapacitacionConstanciasUrlFromCapacitacion(capacitacion);
    const hourLabel = getCapacitacionHoraLabel(capacitacion);
    const notes = String(capacitacion.notas || "").trim();

    return `
      <details class="accordion-card">
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
      .hero-callout h2, .section-head h1, .section-head h2, .pedidos-header h1 {
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
      .pedidos-field input,
      .pedidos-field select {
        width: 100%;
        border: 1px solid rgba(26,42,58,0.12);
        border-radius: 16px;
        background: rgba(255,255,255,0.96);
        padding: 12px 13px;
        font: inherit;
        color: var(--ink);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.65);
      }
      .pedidos-field input:focus,
      .pedidos-field select:focus {
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
      .pedidos-table-shell table.pedidos-table--send {
        min-width: 980px;
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
      .pedidos-detail-row[hidden] {
        display: none !important;
      }
      .pedidos-detail-row td {
        background: rgba(239,246,255,0.72);
        border-top: 0;
        padding: 0 14px 16px;
      }
      .pedidos-sendbar {
        display: grid;
        grid-template-columns: minmax(220px, 0.8fr) minmax(280px, 1.2fr) auto;
        gap: 12px;
        align-items: end;
        margin: 14px 0;
        padding: 14px;
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 22px;
        background: rgba(255,255,255,0.88);
        box-shadow: 0 14px 30px rgba(26,42,58,0.06);
      }
      .pedidos-sendbar select,
      .pedidos-sendbar textarea {
        width: 100%;
        border: 1px solid rgba(26,42,58,0.12);
        border-radius: 16px;
        background: rgba(255,255,255,0.96);
        padding: 12px 13px;
        font: inherit;
        color: var(--ink);
      }
      .pedidos-sendbar textarea {
        min-height: 48px;
        resize: vertical;
      }
      .pedidos-status-line {
        grid-column: 1 / -1;
        color: var(--muted);
        font: 800 0.78rem/1.4 "Montserrat", sans-serif;
      }
      .pedidos-status-line.ok {
        color: #166534;
      }
      .pedidos-status-line.err {
        color: #b91c1c;
      }
      .pedidos-row-actions {
        display: grid;
        gap: 8px;
        min-width: 180px;
      }
      .pedidos-files-panel {
        display: grid;
        gap: 12px;
        padding: 14px;
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 20px;
        background: rgba(255,255,255,0.86);
      }
      .pedidos-files-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }
      .pedidos-files-list {
        display: grid;
        gap: 8px;
      }
      .pedidos-file-item {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: start;
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(26,42,58,0.10);
        background: rgba(248,250,252,0.9);
      }
      .pedidos-file-item strong {
        display: block;
      }
      .pedidos-file-item small {
        display: block;
        color: var(--muted);
        margin-top: 2px;
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
      .calendar-note-field input[type="search"],
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
      .calendar-note-field input[type="search"]:focus,
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
      .accordion-card[open] > .accordion-summary .accordion-chevron {
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
      .capacitacion-card--expandable {
        display: block;
        padding: 0;
        overflow: hidden;
      }
      .capacitacion-card--expandable[open] {
        box-shadow: 0 24px 64px rgba(20,32,43,0.13);
      }
      .capacitacion-card__summary {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 42px;
        align-items: center;
        gap: 16px;
        padding: 18px;
        cursor: pointer;
        list-style: none;
      }
      .capacitacion-card__summary::-webkit-details-marker {
        display: none;
      }
      .capacitacion-card__summary-main {
        display: grid;
        gap: 11px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .capacitacion-card__summary-meta {
        display: grid;
        grid-template-columns: minmax(110px, auto) minmax(0, 1fr) auto;
        align-items: end;
        gap: 10px 16px;
        color: var(--muted);
        font: 700 0.78rem "Montserrat", sans-serif;
      }
      .capacitacion-summary-fact {
        display: grid;
        min-width: 0;
        gap: 3px;
      }
      .capacitacion-summary-fact small {
        color: var(--crimson);
        font-size: 0.62rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .capacitacion-summary-fact strong {
        overflow: hidden;
        color: var(--ink);
        font-size: 0.76rem;
        line-height: 1.35;
        text-overflow: ellipsis;
      }
      .diploma-summary {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        justify-self: end;
      }
      .diploma-summary > span:first-child {
        color: var(--crimson);
        font-size: 0.68rem;
        font-weight: 900;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .diploma-summary .status-button {
        padding: 5px 8px;
        cursor: inherit;
        font-size: 0.68rem;
      }
      .capacitacion-card--expandable[open] > .capacitacion-card__summary .accordion-chevron {
        transform: rotate(45deg);
        background: rgba(192,57,43,0.10);
      }
      .capacitacion-card__body {
        display: grid;
        gap: 16px;
        padding: 0 18px 18px;
        border-top: 1px solid rgba(26,42,58,0.08);
      }
      .capacitacion-card__detail-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 16px;
      }
      .capacitacion-card__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .capacitacion-note-compose {
        margin-top: 10px;
        border-top: 1px solid rgba(26,42,58,0.08);
        padding-top: 10px;
      }
      .capacitacion-note-compose > summary {
        width: fit-content;
        cursor: pointer;
        color: var(--navy);
        font: 900 0.72rem/1.2 "Montserrat", sans-serif;
        letter-spacing: 0.04em;
        list-style: none;
        text-transform: uppercase;
      }
      .capacitacion-note-compose > summary::before {
        content: "+";
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        margin-right: 7px;
        border-radius: 50%;
        background: rgba(20,42,61,0.07);
      }
      .capacitacion-note-compose[open] > summary::before { content: "−"; }
      .capacitacion-note-compose > summary::-webkit-details-marker { display: none; }
      .capacitacion-note-compose .notes-form { margin-top: 12px; }
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
      @media (max-width: 720px) {
        .capacitacion-card__summary {
          padding: 15px;
        }
        .capacitacion-card__summary-meta {
          grid-template-columns: 1fr;
          align-items: start;
        }
        .diploma-summary { justify-self: start; }
        .capacitacion-card__detail-grid {
          grid-template-columns: 1fr;
        }
        .capacitacion-card__body {
          padding: 0 15px 15px;
        }
        .capacitacion-card__actions {
          align-items: stretch;
          flex-direction: column;
        }
      }
      .capacitaciones-studio {
        --cap-glass-border: rgba(255,255,255,0.82);
        --cap-glass-shadow: 0 20px 54px rgba(20,32,43,0.10);
        overflow: hidden;
        border: 1px solid var(--cap-glass-border);
        border-top: 1px solid var(--cap-glass-border);
        border-radius: 30px;
        background:
          linear-gradient(145deg, rgba(255,255,255,0.80), rgba(255,255,255,0.42) 48%, rgba(234,240,246,0.38)),
          linear-gradient(315deg, rgba(192,57,43,0.06), transparent 38%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.94), var(--cap-glass-shadow);
        backdrop-filter: blur(30px) saturate(1.2);
      }
      .capacitaciones-studio > .section-head {
        margin-bottom: 18px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(26,42,58,0.08);
      }
      .capacitaciones-filter-bar {
        display: grid;
        gap: 14px;
        padding: 16px;
        border: 1px solid var(--cap-glass-border);
        border-radius: 24px;
        background: linear-gradient(150deg, rgba(255,255,255,0.64), rgba(246,249,252,0.38));
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.90), 0 12px 32px rgba(20,32,43,0.07);
        backdrop-filter: blur(22px) saturate(1.15);
      }
      .capacitaciones-filter-bar .calendar-note-grid {
        grid-template-columns: minmax(220px, 1.45fr) repeat(3, minmax(150px, 1fr));
      }
      .capacitaciones-filter-bar .calendar-note-field {
        gap: 6px;
      }
      .capacitaciones-filter-bar .calendar-note-field input,
      .capacitaciones-filter-bar .calendar-note-field select {
        width: 100%;
        min-height: 44px;
        padding: 0 14px;
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 18px;
        outline: none;
        color: var(--ink);
        background: linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.54));
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.88), 0 8px 22px rgba(20,32,43,0.05);
        font: 700 0.82rem "Montserrat", sans-serif;
      }
      .capacitaciones-filter-bar .calendar-note-field input:focus,
      .capacitaciones-filter-bar .calendar-note-field select:focus {
        border-color: rgba(192,57,43,0.42);
        box-shadow: 0 0 0 4px rgba(192,57,43,0.07), inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .capacitaciones-filter-bar__meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(26,42,58,0.07);
        color: var(--muted);
        font: 750 0.8rem "Montserrat", sans-serif;
      }
      .capacitaciones-filter-bar__meta .button {
        min-height: 38px;
        padding: 8px 15px;
        border-radius: 999px;
      }
      .capacitaciones-groups {
        display: grid;
        gap: 12px;
        margin-top: 16px;
      }
      .capacitaciones-group {
        border: 1px solid var(--cap-glass-border);
        border-radius: 26px;
        background: linear-gradient(150deg, rgba(255,255,255,0.68), rgba(241,246,250,0.40));
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.92), 0 14px 38px rgba(20,32,43,0.07);
        backdrop-filter: blur(24px) saturate(1.16);
      }
      .capacitaciones-group[open] {
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.94), 0 22px 54px rgba(20,32,43,0.11);
      }
      .capacitaciones-group > .accordion-summary {
        min-height: 80px;
        padding: 16px 18px;
      }
      .capacitaciones-group > .accordion-summary .accordion-summary-main strong {
        color: var(--navy);
        font-size: 1rem;
      }
      .capacitaciones-group > .accordion-body {
        padding: 0 16px 16px;
      }
      .capacitaciones-studio .capacitacion-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .capacitaciones-studio .capacitacion-card {
        position: relative;
        border: 1px solid rgba(20,42,61,0.11);
        border-left: 4px solid var(--blue);
        border-radius: 20px;
        background: linear-gradient(145deg, rgba(255,255,255,0.98), rgba(246,249,252,0.94));
        box-shadow: 0 12px 28px rgba(20,32,43,0.07);
        transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
      }
      .capacitaciones-studio .capacitacion-card.is-finalizada { border-left-color: var(--green); }
      .capacitaciones-studio .capacitacion-card.is-programada { border-left-color: var(--blue); }
      .capacitaciones-studio .capacitacion-card:hover {
        border-color: rgba(20,42,61,0.18);
        box-shadow: 0 18px 38px rgba(20,32,43,0.10);
      }
      .capacitaciones-studio .capacitacion-card__summary {
        min-height: 154px;
        padding: 18px 18px 18px 20px;
      }
      .capacitaciones-studio .capacitacion-card--expandable[open] > .capacitacion-card__summary {
        background: rgba(240,245,249,0.48);
      }
      .capacitaciones-studio .capacitacion-card__summary-main {
        align-content: start;
        gap: 6px;
      }
      .capacitaciones-studio .capacitacion-card h3 {
        color: var(--navy);
        font-size: 1.08rem;
        line-height: 1.2;
      }
      .capacitaciones-studio .capacitacion-head {
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .capacitaciones-studio .status-chip {
        padding: 6px 9px;
        font-size: 0.64rem;
      }
      .capacitaciones-studio .capacitacion-card__date {
        color: var(--muted);
        font: 800 0.72rem/1 "Montserrat", sans-serif;
        white-space: nowrap;
      }
      .capacitaciones-studio .capacitacion-card__eyebrow {
        margin-top: 6px;
        color: var(--crimson);
        font: 900 0.6rem/1 "Montserrat", sans-serif;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .capacitaciones-studio .capacitacion-card__summary-meta {
        margin-top: 7px;
        gap: 10px 16px;
        font-size: 0.73rem;
      }
      .capacitaciones-studio .diploma-summary {
        margin: 0;
      }
      .capacitaciones-studio .capacitacion-card__body {
        gap: 14px;
        padding: 0 16px 16px;
        background: rgba(247,250,252,0.76);
      }
      .capacitaciones-studio .capacitacion-card__chevron {
        flex: 0 0 auto;
        transform: none;
        font-size: 1rem;
      }
      .capacitaciones-studio .capacitacion-card__chevron::before { content: "+"; }
      .capacitaciones-studio .capacitacion-card--expandable[open] > .capacitacion-card__summary .capacitacion-card__chevron {
        transform: none;
      }
      .capacitaciones-studio .capacitacion-card--expandable[open] > .capacitacion-card__summary .capacitacion-card__chevron::before { content: "-"; }
      .capacitaciones-studio .capacitacion-card__content {
        display: grid;
        grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
        gap: 12px;
        padding-top: 16px;
      }
      .capacitaciones-studio .capacitacion-card__section {
        display: block;
        min-width: 0;
        padding: 15px;
        border: 1px solid rgba(20,42,61,0.08);
        border-radius: 17px;
        background: rgba(255,255,255,0.76);
      }
      .capacitaciones-studio .capacitacion-card__section > strong {
        display: block;
        margin-bottom: 10px;
        color: var(--crimson);
        font: 900 0.7rem "Montserrat", sans-serif;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .capacitaciones-studio .capacitacion-card__branches .tag-row {
        align-items: center;
        min-width: 0;
      }
      .capacitaciones-studio .capacitacion-card__branches .tag-pill {
        flex: 0 1 auto;
        align-self: center;
        max-width: 100%;
        min-height: 32px;
        padding: 6px 10px;
        white-space: normal;
      }
      .capacitaciones-studio .capacitacion-card__notes .notes-form {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
      }
      .capacitaciones-studio .capacitacion-card__notes .notes-textarea {
        min-height: 72px;
        padding: 11px 13px;
        border-radius: 16px;
        background: rgba(255,255,255,0.66);
      }
      .capacitaciones-studio .capacitacion-card__notes .notes-actions {
        display: grid;
        justify-items: start;
        min-width: 120px;
      }
      .capacitaciones-studio .capacitacion-card__notes .notes-state,
      .capacitaciones-studio .capacitacion-card__note-copy {
        color: var(--muted);
        font: 700 0.75rem "Montserrat", sans-serif;
      }
      .capacitaciones-studio .capacitacion-card__actions {
        padding-top: 14px;
        border-top: 1px solid rgba(26,42,58,0.07);
      }
      .capacitaciones-studio .capacitacion-card__detail-grid {
        padding: 10px;
        border: 1px solid rgba(255,255,255,0.72);
        border-radius: 20px;
        background: rgba(255,255,255,0.30);
      }
      .capacitaciones-studio .capacitacion-card__detail-grid .detail-block {
        min-height: 0;
        padding: 11px;
        border: 0;
        border-radius: 16px;
        background: rgba(255,255,255,0.46);
        box-shadow: none;
      }
      @media (max-width: 980px) {
        .capacitaciones-filter-bar .calendar-note-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .capacitaciones-studio .capacitacion-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 620px) {
        .capacitaciones-studio {
          padding: 12px;
          border-radius: 24px;
        }
        .capacitaciones-filter-bar .calendar-note-grid {
          grid-template-columns: 1fr;
        }
        .capacitaciones-filter-bar__meta {
          align-items: stretch;
          flex-direction: column;
        }
        .capacitaciones-group > .accordion-summary {
          min-height: 72px;
          padding: 14px;
        }
        .capacitaciones-group > .accordion-body {
          padding: 0 6px 6px;
        }
        .capacitaciones-studio .capacitacion-card__summary {
          min-height: 0;
          grid-template-columns: minmax(0, 1fr) 38px;
          padding: 16px 13px 16px 15px;
        }
        .capacitaciones-studio .capacitacion-card__summary-meta { grid-template-columns: 1fr; }
        .capacitaciones-studio .capacitacion-card__chevron { align-self: start; }
        .capacitaciones-studio .capacitacion-card__content {
          grid-template-columns: 1fr;
          gap: 10px;
        }
        .capacitaciones-studio .capacitacion-card__section {
          padding: 13px;
        }
        .capacitaciones-studio .capacitacion-card__notes .notes-form {
          grid-template-columns: 1fr;
        }
        .capacitaciones-studio .capacitacion-card__notes .notes-actions {
          grid-template-columns: 1fr auto;
          align-items: center;
          width: 100%;
        }
        .capacitaciones-studio .capacitacion-card__actions .diploma-choice,
        .capacitaciones-studio .capacitacion-card__actions .button {
          width: 100%;
        }
        .capacitaciones-studio .capacitacion-card__actions .diploma-choice {
          justify-content: space-between;
        }
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
      .status-button:disabled {
        cursor: default;
        opacity: 1;
      }
      .diploma-choice {
        align-items: center;
        width: fit-content;
        padding: 6px;
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 999px;
        background: rgba(255,255,255,0.78);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.92), 0 10px 22px rgba(26,42,58,0.05);
      }
      .diploma-choice__label {
        padding: 0 8px;
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .diploma-choice .status-button {
        min-width: 54px;
        padding: 8px 13px;
      }
      .platform-surface {
        position: relative;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.82);
        border-top: 0;
        background:
          radial-gradient(circle at 92% 4%, rgba(202,162,74,0.18), transparent 24%),
          radial-gradient(circle at 8% 10%, rgba(25,49,77,0.10), transparent 25%),
          linear-gradient(145deg, rgba(255,255,255,0.96), rgba(242,246,250,0.92));
        backdrop-filter: blur(18px) saturate(1.08);
        box-shadow: 0 24px 54px rgba(26,42,58,0.11), inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .platform-surface::before {
        content: "";
        position: absolute;
        inset: 0 0 auto;
        height: 4px;
        background: linear-gradient(90deg, var(--navy), var(--gold), var(--crimson));
      }
      .constancias-workbench {
        display: grid;
        grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
        gap: 14px;
        align-items: start;
        margin-top: 16px;
        padding: 10px;
        border: 1px solid rgba(26,42,58,0.08);
        border-radius: 24px;
        background: rgba(255,255,255,0.62);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.96), 0 18px 38px rgba(26,42,58,0.07);
      }
      .constancias-workbench__controls {
        position: sticky;
        top: 18px;
        display: grid;
        gap: 10px;
      }
      .constancias-workbench__controls .calendar-frame,
      .constancias-workbench__controls .calendar-detail-card,
      .constancias-workbench__canvas {
        margin: 0 !important;
        border-radius: 16px;
        box-shadow: none;
        background: rgba(255,255,255,0.82);
      }
      .constancias-workbench__controls .detail-grid { grid-template-columns: 1fr; }
      .constancias-workbench__canvas { min-width: 0; overflow: hidden; border-radius: 22px; }
      .constancias-studio iframe {
        width: 100%;
        min-height: 780px;
        border: 0;
        border-radius: 22px;
        background: transparent;
      }
      .constancias-open { width: 100%; margin-top: 12px; }
      .company-directory-tools {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 16px;
        margin-top: 18px;
        padding: 14px;
        border: 1px solid rgba(26,42,58,0.08);
        border-radius: 16px;
        background: rgba(255,255,255,0.72);
      }
      .company-directory-search { width: min(560px, 100%); }
      .company-directory {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 14px;
        margin-top: 18px;
      }
      .sucursales-studio {
        content-visibility: visible;
        contain: none;
      }
      .company-card {
        appearance: none;
        width: 100%;
        display: grid;
        grid-template-columns: 62px minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        padding: 15px;
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(255,255,255,0.94), rgba(244,248,252,0.90));
        box-shadow: 0 14px 30px rgba(26,42,58,0.07), inset 0 1px 0 rgba(255,255,255,0.94);
        color: var(--ink);
        cursor: pointer;
        text-align: left;
        text-decoration: none;
        transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
      }
      .company-card:hover {
        transform: translateY(-2px);
        border-color: rgba(202,162,74,0.58);
        box-shadow: 0 20px 38px rgba(26,42,58,0.11), inset 0 1px 0 #fff;
      }
      .company-card__media,
      .company-logo-fallback {
        width: 62px;
        height: 62px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border: 1px solid rgba(26,42,58,0.09);
        border-radius: 17px;
        background: rgba(255,255,255,0.92);
        color: var(--navy);
        font-weight: 900;
      }
      .company-card__media img,
      .company-profile__logo {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .company-card__copy {
        min-width: 0;
        display: grid;
        gap: 4px;
      }
      .company-card__copy strong,
      .company-card__copy small,
      .company-card__copy em {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .company-card__copy strong { font-family: "Montserrat", sans-serif; font-size: 0.95rem; }
      .company-card__copy small { color: var(--muted); white-space: nowrap; }
      .company-card__copy em { color: var(--crimson); font-size: 0.74rem; font-style: normal; font-weight: 800; }
      .company-card__arrow { color: var(--navy); font-size: 1.2rem; font-weight: 900; }
      .company-profiles { margin-top: 18px; }
      .company-profile {
        display: grid;
        gap: 18px;
        margin-top: 18px;
      }
      .company-profile[hidden] { display: none; }
      .company-back {
        width: fit-content;
        color: var(--navy);
        font: 850 0.84rem "Montserrat", sans-serif;
        text-decoration: none;
      }
      .company-back:hover { color: var(--crimson); }
      .company-hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(440px, 0.75fr);
        gap: 18px;
        padding: clamp(18px, 3vw, 28px);
        border: 1px solid rgba(255,255,255,0.82);
        border-radius: 22px;
        background:
          radial-gradient(circle at 8% 0%, rgba(214,164,58,0.15), transparent 26%),
          linear-gradient(135deg, rgba(255,255,255,0.91), rgba(239,245,251,0.70));
        box-shadow: inset 0 1px 0 #fff, 0 18px 42px rgba(26,42,58,0.09);
      }
      .company-hero__identity {
        display: flex;
        align-items: center;
        gap: 18px;
        min-width: 0;
      }
      .company-hero__identity h3 {
        margin: 10px 0 4px;
        color: var(--navy);
        font-size: clamp(1.65rem, 3vw, 2.55rem);
        line-height: 1;
      }
      .company-hero__identity p { margin: 0; }
      .company-hero__metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }
      .company-hero__metrics article {
        display: grid;
        align-content: center;
        gap: 5px;
        min-height: 96px;
        padding: 13px;
        border: 1px solid rgba(26,42,58,0.08);
        border-radius: 8px;
        background: rgba(255,255,255,0.68);
      }
      .company-hero__metrics strong { color: var(--navy); font-size: 1.8rem; line-height: 1; }
      .company-hero__metrics span { color: var(--muted); font: 800 0.67rem "Montserrat", sans-serif; text-transform: uppercase; }
      .company-profile__logo {
        width: 104px;
        height: 104px;
        flex: 0 0 104px;
        padding: 10px;
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 18px;
        background: #fff;
      }
      .company-data-quality {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 10px;
        padding: 11px 14px;
        border: 1px solid rgba(26,42,58,0.08);
        border-radius: 12px;
        color: var(--muted);
        background: rgba(255,255,255,0.58);
        font: 750 0.78rem "Montserrat", sans-serif;
      }
      .company-filter-bar {
        display: grid;
        grid-template-columns: minmax(250px, 1.6fr) repeat(4, minmax(145px, 1fr)) auto;
        align-items: end;
        gap: 10px;
        padding: 14px;
        border: 1px solid rgba(26,42,58,0.09);
        border-radius: 16px;
        background: rgba(246,249,252,0.78);
      }
      .company-filter-bar .calendar-note-field { margin: 0; }
      .company-filter-bar :is(input, select) { width: 100%; min-height: 44px; padding: 0 12px; }
      .company-filter-reset { min-height: 44px; white-space: nowrap; }
      .company-results { margin: -4px 0 0; font-size: 0.82rem; font-weight: 800; }
      .company-directory-more { display: flex; width: fit-content; margin: 18px auto 0; }
      .territory-list { display: grid; gap: 12px; }
      .territory-card > .accordion-summary { display: grid; grid-template-columns: 54px minmax(0, 1fr) auto; }
      .territory-crest {
        display: inline-grid;
        place-items: center;
        overflow: hidden;
        border: 1px solid rgba(26,42,58,0.09);
        border-radius: 12px;
        color: var(--navy);
        background: rgba(255,255,255,0.86);
        font: 900 0.72rem "Montserrat", sans-serif;
      }
      .territory-crest--state { width: 48px; height: 48px; }
      .territory-crest--municipality { width: 40px; height: 40px; }
      .territory-crest img { width: 100%; height: 100%; padding: 4px; object-fit: contain; }
      .territory-card__body { padding-top: 3px; }
      .municipality-card {
        overflow: hidden;
        border: 1px solid rgba(26,42,58,0.09);
        border-radius: 14px;
        background: rgba(255,255,255,0.65);
      }
      .municipality-card__summary {
        display: grid;
        grid-template-columns: 46px minmax(0, 1fr) auto;
        align-items: center;
        gap: 11px;
        padding: 12px 14px;
        list-style: none;
      }
      .municipality-card__summary::-webkit-details-marker,
      .branch-card__summary::-webkit-details-marker { display: none; }
      .municipality-card__summary > span:nth-child(2) { display: grid; gap: 3px; }
      .municipality-card__summary strong { color: var(--navy); font: 850 0.9rem "Montserrat", sans-serif; }
      .municipality-card__summary small { color: var(--muted); font: 700 0.75rem "Montserrat", sans-serif; }
      .municipality-card[open] > .municipality-card__summary .accordion-chevron,
      .branch-card[open] > .branch-card__summary .accordion-chevron { transform: rotate(45deg); }
      .municipality-card__body { display: grid; gap: 8px; padding: 0 12px 12px; }
      .branch-card {
        overflow: hidden;
        border: 1px solid rgba(26,42,58,0.08);
        border-radius: 10px;
        background: rgba(249,251,253,0.92);
      }
      .branch-card__summary {
        display: grid;
        grid-template-columns: 66px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        min-height: 64px;
        padding: 10px 12px;
        list-style: none;
      }
      .branch-card__store {
        display: inline-grid;
        min-height: 36px;
        place-items: center;
        padding: 4px 8px;
        border-radius: 8px;
        color: var(--navy);
        background: var(--navy-soft);
        font: 900 0.74rem "Montserrat", sans-serif;
      }
      .branch-card__identity { display: grid; min-width: 0; gap: 3px; }
      .branch-card__identity strong { font: 850 0.9rem "Montserrat", sans-serif; }
      .branch-card__identity small { overflow: hidden; color: var(--muted); font-size: 0.76rem; text-overflow: ellipsis; white-space: nowrap; }
      .branch-card__signals { display: flex; align-items: center; gap: 8px; }
      .territory-pill { padding: 7px 9px; border-radius: 999px; color: var(--navy); background: var(--navy-soft); font: 800 0.68rem "Montserrat", sans-serif; }
      .branch-card__body { display: grid; gap: 12px; padding: 0 12px 14px 90px; }
      .branch-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
      .branch-facts div { display: grid; gap: 4px; min-height: 66px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.85); }
      .branch-facts dt { color: var(--muted); font: 800 0.65rem "Montserrat", sans-serif; text-transform: uppercase; }
      .branch-facts dd { margin: 0; color: var(--ink); font: 750 0.78rem "Montserrat", sans-serif; line-height: 1.35; }
      .branch-card__actions { display: flex; flex-wrap: wrap; gap: 8px; }
      @media (max-width: 1100px) {
        .constancias-workbench { grid-template-columns: 1fr; }
        .constancias-workbench__controls { position: static; }
        .company-hero { grid-template-columns: 1fr; }
        .company-filter-bar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .company-filter-search { grid-column: span 2; }
        .branch-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        .company-directory-tools { align-items: stretch; flex-direction: column; }
        .company-hero__identity { align-items: flex-start; }
        .company-profile__logo { width: 72px; height: 72px; flex-basis: 72px; }
        .company-hero__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .company-filter-bar { grid-template-columns: 1fr; }
        .company-filter-search { grid-column: auto; }
        .territory-card > .accordion-summary { grid-template-columns: 46px minmax(0, 1fr) auto; padding: 12px; }
        .branch-card__summary { grid-template-columns: 52px minmax(0, 1fr) auto; gap: 8px; }
        .branch-card__signals .territory-pill { display: none; }
        .branch-card__body { padding-left: 12px; }
        .branch-facts { grid-template-columns: 1fr; }
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
          min-height: 44px;
          white-space: normal;
        }
        .calendar-frame {
          padding: 12px;
          border-radius: 22px;
          overflow: visible;
        }
        .dashboard-calendar { min-height: 0; }
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
          min-height: 44px;
          padding: 8px 10px;
          font-size: 0.76rem;
        }
        .calendar-panel .fc .fc-daygrid-day-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 44px;
          min-height: 44px;
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
  const loaderLogoPath = "/img/brand-logo.png?v=20260825b";
  return `<!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" type="image/png" href="${HOME_FAVICON_PATH}" />
    <link rel="shortcut icon" type="image/png" href="${HOME_FAVICON_PATH}" />
    <link rel="stylesheet" href="/ui/portal-shell.css?v=20260903a" />
    ${getHomeStyles()}
    ${headExtra}
  </head>
  <body class="portal-shell portal-dashboard">
    <a class="skip-link" href="#contenido-principal">Saltar al contenido principal</a>
    <div class="page-loader" id="page-loader">
      <div class="page-loader-card" role="status" aria-live="polite" aria-label="Cargando">
        <div class="page-loader-brand" aria-hidden="true">
          <img class="page-loader-logo" src="${loaderLogoPath}" alt="" />
          <div><span>Plataforma operativa</span><strong>Desarrollo EG</strong></div>
        </div>
        <div class="page-loader-progress" aria-hidden="true"><span></span></div>
        <p class="page-loader-text">Preparando tu espacio de trabajo</p>
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
        const startedAt = performance.now();
        const hide = () => {
          if (hidden) return;
          hidden = true;
          const remaining = Math.max(0, 320 - (performance.now() - startedAt));
          window.setTimeout(() => {
            loader.classList.add("is-hidden");
            window.setTimeout(() => loader.remove(), 320);
          }, remaining);
        };
        document.addEventListener("desarrolloeg:shell-ready", hide, { once: true });
        window.addEventListener("load", () => window.setTimeout(hide, 250), { once: true });
        window.setTimeout(hide, 2200);
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
    <script src="/ui/portal-shell.js?v=20260901c" defer></script>
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
  <body class="portal-auth">
    <a class="skip-link" href="#login-main">Saltar al contenido principal</a>
    <div class="auth-shell">
      <main id="login-main" class="auth-card" role="main" aria-label="Acceso al portal">
        <section class="auth-visual">
          <div class="auth-brand">
            <span class="auth-pill">${isQaPortal ? "Portal de pruebas" : "Portal de acceso"}</span>
            <img class="auth-logo" src="${BRAND_LOGO_PATH}" alt="Desarrollo EG" onerror="this.onerror=null;this.src='${HOME_FAVICON_PATH}';" />
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
  const estatalMin = Number(thresholds?.estatalMin || 32967.49);
  const municipalMin = Number(thresholds?.municipalMin || 11000);
  const tipo = row.tipoClasificacion || (Number.isFinite(amount)
    ? (amount >= estatalMin ? "estatal" : amount >= municipalMin ? "municipal" : "sin-clasificar")
    : "sin-clasificar");
  const statusText = normalizeText(row.status || "");
  const business = row.business || {};
  const fallbackLiberado = statusText.includes("LIBERADO") || statusText.includes("LIBERACION") || statusText.includes("LIBERADO PENDIENTE");
  const fallbackFacturaLey = statusText.includes("LEY");
  const fallbackPago = statusText.includes("PAGO");
  return {
    tipo,
    liberado: business.hasLiberacion ?? fallbackLiberado,
    facturaLey: business.hasFacturaLey ?? fallbackFacturaLey,
    pago: business.pagado ?? fallbackPago,
    noLiberado: business.hasLiberacion === false || statusText.includes("SIN LIBERACION")
      || statusText.includes("NO LIBERADO")
      || (statusText.includes("PENDIENTE") && !statusText.includes("PAGO")),
    liberadoPendLey: business.liberadoPendienteFactura ?? (fallbackLiberado && !fallbackFacturaLey),
    pendientePago: business.noPagado ?? (statusText.includes("PENDIENTE") && statusText.includes("PAGO")),
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
      <div data-pedidos-root style="display:none;">${renderPedidosDashboardFragment({ user: null, data, year, embedded: true })}</div>
    </div>
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
  const business = row.business || {};
  if (business.sinLiberacionEnviado) return "sin-liberacion-enviados";
  if (business.sinLiberacionListo) return "sin-liberacion-no-enviados";
  if (business.sinLiberacionSinTrabajo) return "sin-liberacion-sin-trabajo";
  if (business.pagado) return "pagados";
  if (business.noPagado) return "pendientes-pago";
  if (business.liberadoPendienteFactura) return "liberados";
  const statusText = normalizeText(row.status || "");
  const sent = Boolean(row.enviadoBool) || ["SI", "S", "Y", "YES", "TRUE", "1", "ENVIADO"].includes(normalizeText(row.enviado || ""));
  const paid = Boolean(flags?.pago || row.pagoBool || statusText.includes("PAGADO"));
  const pendingPayment = Boolean(flags?.pendientePago || row.pendientePago || (statusText.includes("PENDIENTE") && statusText.includes("PAGO")));
  const liberated = Boolean(flags?.liberado || row.liberacionBool || statusText.includes("LIBERADO"));
  const noLiberado = Boolean(flags?.noLiberado || row.noLiberado || statusText.includes("SIN LIBERACION") || statusText.includes("NO LIBERADO"));
  if (noLiberado) {
    return sent ? "sin-liberacion-enviados" : "sin-liberacion-no-enviados";
  }
  if (pendingPayment) {
    return "pendientes-pago";
  }
  if (paid) {
    return "pagados";
  }
  if (liberated) {
    return "liberados";
  }
  if (statusText.includes("SIN LIBERACION") || statusText.includes("NO LIBERADO")) {
    return sent ? "sin-liberacion-enviados" : "sin-liberacion-no-enviados";
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
  return normalizeText(row.key || row.id || row.row_id || row.rowId || row.tienda || row.displayLabel || row.label || row.label2 || "");
}

function getPedidoCoverageBranchLabel(row = {}) {
  return String(row.displayLabel || row.label || row.label2 || row.tienda || row.key || row.id || "").trim();
}

function getPedidoCoverageBranchKinds(row = {}, fallbackKinds = []) {
  const work = normalizeText(row.trabajos || "");
  const kinds = [];
  if (work.includes("ESTATAL")) kinds.push("estatal");
  if (work.includes("MUNICIPAL")) kinds.push("municipal");
  const unique = [];
  for (const kind of kinds) {
    if (!unique.includes(kind)) unique.push(kind);
  }
  if (unique.length) return unique;
  return Array.isArray(fallbackKinds) ? fallbackKinds.filter(Boolean) : [];
}

function isPedidoCoverageBranchAllowed(row = {}) {
  const company = normalizeText(row.empresaId || row.empresa || row.raw?.empresa_id || "");
  const status = normalizeText(row.status || row.planeacionStatus || row.raw?.planeacion_status || row.raw?.status || "");
  const blocked = ["INACTIVA", "INACTIVO", "BAJA", "CANCELADA", "CANCELADO"].some((word) => status.includes(word));
  return company === "1" && !blocked;
}

function getPedidoCoverageFacturadorKinds(facturadorId = "") {
  const normalized = String(facturadorId || "").trim();
  if (normalized === "xwDqa6Mt6a42iqKHzJG9L6") return ["estatal"];
  if (normalized === "EiHiUQ9YHf4mA-C7L_ziyc") return ["municipal"];
  return [];
}

function buildPedidosCoverageModel(rows = [], branches = [], facturadorId = "") {
  const normalizedFacturadorId = normalizeText(facturadorId || "");
  const facturadorKinds = getPedidoCoverageFacturadorKinds(facturadorId);
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
      row.tienda?.id,
      row.tienda?.row_id,
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
      branch.row_id,
      branch.rowId,
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
    const branchOrders = getBranchOrders(branch);
    const inferredKinds = [];
    for (const order of branchOrders) {
      const kind = getPedidoDashboardTypeBucket(order);
      if (kind !== "otros" && !inferredKinds.includes(kind)) inferredKinds.push(kind);
    }
    const fallbackKinds = inferredKinds;
    const kinds = getPedidoCoverageBranchKinds(branch, fallbackKinds)
      .filter((kind) => !facturadorKinds.length || facturadorKinds.includes(kind));
    for (const kind of kinds) {
      const orders = branchOrders.filter((row) => row._flags?.[kind]);
      const order = orders[0] || null;
      const entry = {
        branch,
        kind,
        order,
      };
      branchesByKind[kind].push(entry);
    }
    if (!kinds.length) {
      const orders = branchOrders.filter((row) => getPedidoDashboardTypeBucket(row) === "otros");
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
  const conPedido = entries.filter((item) => item.order).length;
  const sinPedido = entries.filter((item) => !item.order).length;

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
          <span class="pill strong">Con pedido: ${escapeHtml(String(conPedido))}</span>
          <span class="pill strong">Sin pedido: ${escapeHtml(String(sinPedido))}</span>
        </div>
      </div>
      <div class="pedidos-coverage-section">
        ${renderPedidosCoverageTable(entries, "No hay sucursales para mostrar.", "Sucursal")}
      </div>
    </section>
  `;
}

function buildPedidosDashboardToolbar({ requestedYear, thresholds, facturadorId, facturadorLabel, facturadores = [], selectedScope, selectedStatus, selectedType, searchText }) {
  const selectedFacturadorId = String(facturadorId || "").trim();
  const estatalMin = Number.isFinite(Number(thresholds?.estatalMin)) ? Number(thresholds.estatalMin) : 32967.49;
  const municipalMin = Number.isFinite(Number(thresholds?.municipalMin)) ? Number(thresholds.municipalMin) : 11000;
  const facturadorOptions = Array.isArray(facturadores) ? facturadores : [];
  const selectedExists = !selectedFacturadorId || facturadorOptions.some((option) => String(option?.value || option?.id || "").trim() === selectedFacturadorId);
  const facturadorOptionMarkup = [
    `<option value="">Todos los proveedores</option>`,
    ...(!selectedExists
      ? [`<option value="${escapeAttr(selectedFacturadorId)}" selected>${escapeHtml(facturadorLabel || selectedFacturadorId)}</option>`]
      : []),
    ...facturadorOptionMarkupFromOptions(facturadorOptions, selectedFacturadorId),
  ].join("");

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
          <button type="button" class="pedidos-tab-btn${selectedStatus === "sin-liberacion" ? " is-active" : ""}" data-pedidos-status="sin-liberacion">Sin liberación sin trabajo</button>
          <button type="button" class="pedidos-tab-btn${selectedStatus === "sin-liberacion-no-enviados" ? " is-active" : ""}" data-pedidos-status="sin-liberacion-no-enviados">Sin liberacion no enviados</button>
          <button type="button" class="pedidos-tab-btn${selectedStatus === "sin-liberacion-enviados" ? " is-active" : ""}" data-pedidos-status="sin-liberacion-enviados">Sin liberacion enviados</button>
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
            <select data-pedidos-facturador>
              ${facturadorOptionMarkup}
            </select>
          </div>
          <div class="pedidos-field">
            <label>Precio estatal</label>
            <input data-pedidos-estatal-min type="number" step="0.01" value="${escapeAttr(String(estatalMin))}">
          </div>
          <div class="pedidos-field">
            <label>Precio municipal</label>
            <input data-pedidos-municipal-min type="number" step="0.01" value="${escapeAttr(String(municipalMin))}">
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

function pedidoStatusMatchesFilter(bucket = "", selectedStatus = "all") {
  const status = String(selectedStatus || "all").trim();
  if (status === "all") return true;
  if (status === "sin-liberacion") {
    return bucket === "sin-liberacion-sin-trabajo";
  }
  return bucket === status;
}

function pedidoRowStatusMatches(row = {}, selectedStatus = "all") {
  const status = String(selectedStatus || "all").trim();
  const business = row.business || {};
  if (status === "all") return true;
  if (status === "sin-liberacion") {
    return Boolean(business.sinLiberacionSinTrabajo) || pedidoStatusMatchesFilter(row._statusBucket, status);
  }
  const businessFlagByStatus = {
    "sin-liberacion-no-enviados": "sinLiberacionListo",
    "sin-liberacion-enviados": "sinLiberacionEnviado",
    "sin-liberacion-sin-trabajo": "sinLiberacionSinTrabajo",
    liberados: "liberadoPendienteFactura",
    pagados: "pagado",
    "pendientes-pago": "noPagado",
  };
  const businessFlag = businessFlagByStatus[status];
  return Boolean((businessFlag && business[businessFlag]) || row._statusBucket === status);
}

function extractPedidoYear(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const directYear = text.match(/\b(20\d{2})\b/);
  if (directYear?.[1]) return Number(directYear[1]);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.getFullYear();
  return null;
}

function getPedidoTrabajosDelYear(row = {}, year = new Date().getFullYear()) {
  const targetYear = Number(year);
  const trabajos = [];
  if (Number.isFinite(targetYear) && extractPedidoYear(row.ultimoPipcEstatal || row.tienda?.ultimoPipcEstatal) === targetYear) {
    trabajos.push("Estatal");
  }
  if (Number.isFinite(targetYear) && extractPedidoYear(row.ultimoPipcMunicipal || row.tienda?.ultimoPipcMunicipal) === targetYear) {
    trabajos.push("Municipal");
  }
  return trabajos.length ? trabajos.join(" + ") : "Sin trabajo del año";
}

function facturadorOptionMarkupFromOptions(options = [], selectedFacturadorId = "") {
  return options
    .map((option) => {
      const value = String(option?.value || option?.id || "").trim();
      const label = String(option?.label || option?.nombre || value).trim();
      if (!value || !label) return "";
      const count = Number(option?.count || 0);
      const countLabel = count > 0 ? ` (${count})` : "";
      return `<option value="${escapeAttr(value)}"${value === selectedFacturadorId ? " selected" : ""}>${escapeHtml(label + countLabel)}</option>`;
    })
    .filter(Boolean)
    .join("");
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
    estatalMin: Number(thresholds.estatalMin || 32967.49),
    municipalMin: Number(thresholds.municipalMin || 11000),
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
    if (!pedidoRowStatusMatches(row, selectedStatus)) return false;
    if (selectedType !== "all" && row._typeBucket !== selectedType) return false;
    if (searchText && !row._searchText.includes(normalizeText(searchText))) return false;
    return true;
  });
  const coverageRows = buildPedidosCoverageModel(classifiedRows, data.catalogs?.sucursalesLookup?.rows || [], state.facturadorId);
  const counts = {
    total: filteredRows.length,
    sinLiberacion: filteredRows.filter((row) => pedidoStatusMatchesFilter(row._statusBucket, "sin-liberacion")).length,
    sinLiberacionNoEnviados: filteredRows.filter((row) => row._statusBucket === "sin-liberacion-no-enviados").length,
    sinLiberacionEnviados: filteredRows.filter((row) => row._statusBucket === "sin-liberacion-enviados").length,
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
    const tipo = row.clasificacionLabel || (row._flags.estatal ? "Estatal" : row._flags.municipal ? "Municipal" : "Otros");
    const trabajosYear = getPedidoTrabajosDelYear(row, requestedYear);
    const trabajosTone = trabajosYear === "Sin trabajo del año" ? "warn" : "ok";
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
      row.clasificacionLabel,
      row.clasificacionDetalle,
    ].map((item) => normalizeText(item)).join(" ");
    const pedido = String(row.pedido || "").trim();
    const rowKey = pedido || String(row.rowId || row.uuid || "").trim();
    const isSinLiberacion = row.business?.hasLiberacion === false;
    const canSend = Boolean(pedido) && Boolean(row.business?.sinLiberacionListo || row.business?.sinLiberacionEnviado);
    const sendLabel = row._statusBucket === "sin-liberacion-enviados" ? "Reenviar" : "Enviar";
    const sentChip = isSinLiberacion
      ? row._statusBucket === "sin-liberacion-enviados"
        ? '<span class="chip ok">Enviado</span>'
        : '<span class="chip warn">No enviado</span>'
      : "";
    const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(Number(row.importeNumber || 0));
    return `
      <tr
        class="pedidos-row"
        data-pedidos-row
        data-pedido="${escapeAttr(pedido)}"
        data-facturador-nombre="${escapeAttr(row.facturadorNombre || "")}"
        data-status="${escapeAttr(row._statusBucket)}"
        data-type="${escapeAttr(row._typeBucket)}"
        data-search="${escapeAttr(search)}"
      >
        <td>
          <strong>${escapeHtml(pedido)}</strong>
        </td>
        <td><span class="chip ${tone}">${escapeHtml(tipo)}</span></td>
        <td>
          <strong>${escapeHtml(row.tiendaLabel || row.establecimiento || "")}</strong>
        </td>
        <td><strong>${escapeHtml(municipio)}</strong></td>
        <td><strong>${escapeHtml(money)}</strong></td>
        <td><span class="chip ${trabajosTone}">${escapeHtml(trabajosYear)}</span></td>
        <td>
          <div class="pedidos-row-actions">
            ${canSend
              ? `${sentChip}
                 <button type="button" class="button secondary button--compact" data-pedidos-toggle-files="${escapeAttr(rowKey)}">Ver archivos</button>
                 <button type="button" class="button primary button--compact" data-pedidos-send="${escapeAttr(rowKey)}">${escapeHtml(sendLabel)}</button>`
              : `${sentChip || `<span class="chip ${tone}">${escapeHtml(row.status || "Sin status")}</span>`}`}
          </div>
        </td>
      </tr>
      <tr class="pedidos-detail-row" data-pedidos-detail-row data-pedido-detail="${escapeAttr(rowKey)}" hidden>
        <td colspan="7">
          <div class="pedidos-files-panel" data-pedidos-files-panel="${escapeAttr(rowKey)}">
            <div class="pedidos-files-head">
              <strong>Archivos del pedido ${escapeHtml(pedido)}</strong>
              <span class="muted" data-pedidos-files-state="${escapeAttr(rowKey)}">Selecciona "Ver archivos" para cargar Drive solo para este pedido.</span>
            </div>
            <div class="pedidos-files-list" data-pedidos-files-list="${escapeAttr(rowKey)}"></div>
          </div>
        </td>
      </tr>
    `;
  };
  const rowMarkup = filteredRows.length
    ? filteredRows.map((row) => makeOrderRowMarkup(row)).join("")
    : `<tr><td colspan="7" class="empty">No hay pedidos para estos filtros.</td></tr>`;
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
          facturadores: data.catalogs?.facturadores || [],
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
                  `<span class="pill strong">Sin liberacion no enviados: ${escapeHtml(String(typeRows.filter((row) => row._statusBucket === "sin-liberacion-no-enviados").length))}</span>`,
                  `<span class="pill strong">Sin liberacion enviados: ${escapeHtml(String(typeRows.filter((row) => row._statusBucket === "sin-liberacion-enviados").length))}</span>`,
                  `<span class="pill strong">Sin trabajo: ${escapeHtml(String(typeRows.filter((row) => pedidoStatusMatchesFilter(row._statusBucket, "sin-liberacion")).length))}</span>`,
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
          <div class="pedidos-sendbar" data-pedidos-sendbar>
            <div class="pedidos-field">
              <label>Remitente</label>
              <select data-pedidos-sender>
                <option value="">Cargando remitentes...</option>
              </select>
            </div>
            <div class="pedidos-field">
              <label>Correo destino</label>
              <textarea data-pedidos-to rows="2" placeholder="correo@dominio.com"></textarea>
            </div>
            <div class="pedidos-actions">
              <button type="button" class="button secondary" data-pedidos-config-refresh>Actualizar remitente</button>
            </div>
            <div class="pedidos-status-line" data-pedidos-send-status>Listo para cargar archivos bajo demanda.</div>
          </div>
          <div class="pedidos-table-shell table-shell">
            <table class="pedidos-table--send">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Tipo</th>
                  <th>Sucursal</th>
                  <th>Municipio</th>
                  <th>Importe</th>
                  <th>Trabajos</th>
                  <th>Acciones</th>
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

export async function renderDashboardPage({
  user,
  employees,
  pedidosData = null,
  dashboardData = null,
  sucursales = [],
  empresas = [],
  selectedEmployee = user,
  returnPath = "/dashboard",
  selectedCapacitacionId = "",
  selectedEmpresaId = "",
  initialTabId = "",
  calendarView = "week",
  calendarPath = "/dashboard",
  calendarQuery = {},
}) {
  const selected = getEmployeeSummary(selectedEmployee);
  const role = selected.role || "capacitador";
  const routeCards = getRouteCardsForRole(role);
  const groupedRouteCards = role === "admin" ? groupAdminRouteCards(routeCards) : null;
  const title = "Portal";
  const logoPath = BRAND_LOGO_PATH;
  const viewingOtherDashboard = canUseGlobalScope(user, "calendario") && user?.rowId !== selected.rowId;
  const capacitadorView = role === "capacitador";
  const resolvedDashboardData = dashboardData || await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: selected });
  const resolvedEmpresas = empresas.length ? empresas : await listEmpresasForPortal();
  const { visible, programadas, finalizadasSinDiplomas, birthdayEvents, calendarCapacitaciones, calendarNotes } = resolvedDashboardData;
  const selectedCapacitacion = String(selectedCapacitacionId || "").trim()
    ? visible.find((item) => item.rowId === String(selectedCapacitacionId || "").trim())
    : null;
  const showRoutes = Boolean(getUserAccessProfile(user)?.views && Object.keys(getUserAccessProfile(user).views).length > 0);
  const showStatusControls = Boolean(
    hasPortalCapability(user, "capacitaciones", "edit")
      && canAccessEmployeeScope(user, selected, "capacitaciones"),
  );
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
  const dashboardHeaderTitle = selectedEmpresaId
    ? "Empresas y sucursales"
    : ({
        capacitaciones: "Capacitaciones",
        constancias: "Constancias",
        sucursales: "Empresas y sucursales",
        notas: "Notas",
        gestion: "Gestion",
        pedidos: "Pedidos",
        "reporte-ley": "Reporte Casa Ley",
        solventaciones: "Proteccion Civil",
        faltantes: "Faltantes",
        diplomas: "Diplomas faltantes",
        ley: "Faltantes Ley",
      }[String(initialTabId || "").trim()] || "Calendario");
  const sideContent = `
    <div class="hero-side-row">
      <div class="hero-session-card hero-brand-card">
        <button class="hero-session-media hero-logo-button" type="button" data-dashboard-reload data-refresh-scope="portal" aria-label="Recargar tablero">
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
  const capacitacionesPanel = renderCapacitacionesPlatformPanelV2({
    capacitaciones: visible,
    employees,
    showStatusControls,
    selectedEmployeeId: selectedEmployeeRole === "capacitador" ? selectedEmployeeId : "",
    detailReturnPath,
  });
  const constanciasPanel = renderConstanciasWorkspacePanelV2({
    capacitaciones: visible,
    faltantes: finalizadasSinDiplomas,
    selectedCapacitacion,
    selectedEmployee: selected,
    user,
    employees,
    showStatusControls,
    actionPath: selected.rowId && selected.rowId !== user?.rowId
      ? `/dashboard/capacitador/${encodeURIComponent(selected.rowId)}`
      : "/dashboard",
  });
  const sucursalesPanel = renderSucursalesInfoPanelV2({
    sucursales,
    empresas: resolvedEmpresas,
    selectedEmpresaId,
  });
  const notasPanel = renderNotasThreadPanel({
    calendarNotes,
    capacitaciones: visible,
    employees,
    user,
    canEditNotes: showStatusControls,
    canEditAllNotes: canMutateGlobalScope(user, "notas"),
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

  const peoplePanel = canUseGlobalScope(user, "capacitaciones")
    ? `
      <div class="panel">
        <h2>Capacitadores</h2>
        <div class="employee-grid">
          ${renderEmployeeGrid(employees.filter((item) => item.role === "capacitador"))}
        </div>
      </div>
    `
    : "";
  const adminFaltantesPanel = hasPortalCapability(user, "faltantes-ley", "view")
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
  const managementPanel = canUseGlobalScope(user, "capacitaciones")
    ? `
      <div class="dashboard-tab-panel-content dashboard-tab-panel--management">
        ${peoplePanel}
        ${routePanel}
      </div>
    `
    : "";
  const pedidosPanel = hasPortalCapability(user, "pedidos", "view")
    ? renderPedidosAdminDashboardPanel({
        data: pedidosData || {},
        year: pedidosData?.requestedYear || pedidosData?.year || new Date().getFullYear(),
        embedded: true,
      })
    : "";
  const casaLeyReportPanel = hasPortalCapability(user, "reportes", "view")
    ? renderCasaLeyStoresReport({ sucursales })
    : "";
  const solventacionesPanel = hasPortalCapability(user, "reportes", "view")
    ? renderSolventacionesPanel()
    : "";
  const dashboardTabs = [
    {
      id: "calendar",
      view: "calendario",
      label: "Calendario",
      count: calendarEventCount,
      content: calendarPanel,
    },
    {
      id: "capacitaciones",
      view: "capacitaciones",
      label: "Capacitaciones",
      count: visible.length,
      content: capacitacionesPanel,
    },
    {
      id: "constancias",
      view: "crear-constancias-por-capacitacion",
      label: "Constancias",
      count: finalizadasSinDiplomas.length,
      content: constanciasPanel,
    },
    {
      id: "sucursales",
      view: "informacion-sucursales",
      label: "Sucursales",
      count: Array.isArray(sucursales) ? sucursales.length : 0,
      content: sucursalesPanel,
    },
    ...(solventacionesPanel
      ? [{
          id: "solventaciones",
          view: "reportes",
          label: "Proteccion Civil",
          content: solventacionesPanel,
        }]
      : []),
    {
      id: "notas",
      view: "notas",
      label: "Notas",
      count: calendarNotes.length,
      content: notasPanel,
    },
    ...(managementPanel
      ? [{
          id: "gestion",
          view: "gestion",
          label: "Gestión",
          content: managementPanel,
        }]
      : []),
    ...(pedidosPanel
      ? [{
          id: "pedidos",
          view: "pedidos",
          label: "Pedidos",
          content: pedidosPanel,
        }]
      : []),
    ...(casaLeyReportPanel
      ? [{
          id: "reporte-ley",
          view: "reportes",
          label: "Reporte Casa Ley",
          content: casaLeyReportPanel,
        }]
      : []),
    ...(adminFaltantesPanel
      ? [{
          id: "faltantes",
          view: "faltantes-ley",
          label: "Faltantes",
          content: adminFaltantesPanel,
        }]
      : []),
    {
      id: "diplomas",
      view: "constancias-faltantes",
      label: "Diplomas faltantes",
      count: finalizadasSinDiplomas.length,
      content: finalizadasPanel,
    },
    ...(role === "capacitador" && faltantesLeyPanel
      ? [{
          id: "ley",
          view: "faltantes-ley",
          label: "Faltantes Ley",
          content: faltantesLeyPanel,
        }]
      : []),
  ].filter((tab) => Boolean(tab.content) && hasPortalCapability(user, tab.view, "view"));
  const requestedTabId = String(initialTabId || "").trim();
  const activeTabId = dashboardTabs.some((tab) => tab.id === requestedTabId)
    ? requestedTabId
    : (dashboardTabs[0]?.id || "calendar");
  const dashboardTabBasePath = viewingOtherDashboard
    ? portalPath(`/dashboard/capacitador/${encodeURIComponent(selected.rowId)}`)
    : portalPath("/dashboard");
  const sucursalesTabPath = selectedEmpresaId
    ? portalPath(`/dashboard/empresas/${encodeURIComponent(selectedEmpresaId)}`)
    : dashboardTabBasePath;
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
      <script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.20/index.global.min.js" defer></script>
      <script>
        document.addEventListener("DOMContentLoaded", function () {
          const dataEl = document.getElementById("dashboard-calendar-data");
          const mount = document.getElementById("dashboard-calendar");
          const detailMount = document.getElementById("dashboard-calendar-detail");
          if (!dataEl || !mount) return;
          const payload = JSON.parse(dataEl.textContent || "{}");
          const hasFullCalendar = typeof FullCalendar !== "undefined";
          if (!hasFullCalendar) {
            mount.innerHTML = '<div class="calendar-empty" style="padding:16px;">El calendario no pudo cargarse, pero la navegacion sigue disponible.</div>';
          }
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
          const portalUrl = (path) => (window.__PORTAL_URL__ ? window.__PORTAL_URL__(path) : path);
          const filterButtons = Array.from(document.querySelectorAll("[data-capacitador-filter]"));
          const tabs = Array.from(document.querySelectorAll("[data-dashboard-tab]"));
          const panels = Array.from(document.querySelectorAll("[data-dashboard-tab-panel]"));
          const mobileChips = Array.from(document.querySelectorAll(".dashboard-mobile-chip"));
          const operationTitle = document.querySelector("[data-dashboard-operation-title]");
          const dashboardTabBasePath = ${JSON.stringify(dashboardTabBasePath)};
          const sucursalesTabPath = ${JSON.stringify(sucursalesTabPath)};
          const operationTitleMap = {
            calendar: "Calendario",
            capacitaciones: "Capacitaciones",
            constancias: "Constancias",
            sucursales: "Empresas y sucursales",
            notas: "Notas",
            gestion: "Gestión",
            pedidos: "Pedidos",
            "reporte-ley": "Reporte Casa Ley",
            solventaciones: "Proteccion Civil",
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
                      \${props.notes ? '<div class="note-entry"><header><strong>Registro historico</strong></header><p>' + escapeHtml(props.notes) + '</p></div>' : ""}
                      <textarea name="notas" rows="4" class="notes-textarea" placeholder="Agregar una entrada al hilo..." required></textarea>
                      <div class="notes-actions">
                        <button type="submit" class="status-button">Agregar nota</button>
                        <span class="notes-state">Hilo de notas</span>
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
          const updateNotesState = (form, note) => {
            const button = form?.querySelector('button[type="submit"]');
            const state = form?.querySelector(".notes-state");
            const textarea = form?.querySelector('textarea[name="notas"]');
            const section = form?.closest(".capacitacion-card__notes, .calendar-detail-section");
            let thread = section?.querySelector("[data-note-thread]");
            if (!thread && section && note?.body) {
              thread = document.createElement("div");
              thread.className = "note-thread";
              thread.dataset.noteThread = "true";
              form.before(thread);
            }
            if (thread && note?.body) {
              const article = document.createElement("article");
              article.className = "note-entry";
              article.dataset.noteId = String(note.id || "");
              const date = note.createdAt ? new Date(note.createdAt).toLocaleString("es-MX") : "Ahora";
              article.innerHTML = '<header><strong>' + escapeText(note.authorName || note.authorEmail || "Usuario") + '</strong><time>' + escapeText(date) + '</time></header><p>' + escapeText(note.body) + '</p>';
              thread.appendChild(article);
            }
            if (textarea) textarea.value = "";
            if (state) state.textContent = "Nota agregada";
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
            if (!keys.length) return true;
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
            const buttons = Array.from(form?.querySelectorAll('button[name="diplomas"]') || []);
            if (buttons.length) {
              const isYes = String(value || "").trim().toUpperCase() === "Y";
              if (buttons.length === 1) {
                const [button] = buttons;
                button.textContent = isYes ? "Diplomas: Si" : "Marcar diplomas: Si";
                button.classList.toggle("active", isYes);
                button.disabled = false;
              } else {
                buttons.forEach((button) => {
                  const active = String(button.value || "").trim().toUpperCase() === (isYes ? "Y" : "N");
                  button.classList.toggle("active", active);
                  button.disabled = false;
                });
              }
              const studio = form.closest("[data-constancias-studio]");
              const state = studio?.querySelector("[data-constancias-diplomas-state]");
              if (state) {
                state.textContent = isYes ? "DIPLOMAS: SI" : "DIPLOMAS: NO";
                state.classList.toggle("is-finalizada", isYes);
                state.classList.toggle("is-programada", !isYes);
              }
              const select = studio?.querySelector("[data-constancias-capacitacion-select]");
              const option = select?.selectedOptions?.[0];
              if (option) option.dataset.diplomas = isYes ? "Y" : "N";
              return;
            }
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
            if (!content) {
              if (loading) loading.style.display = "none";
              if (root) {
                root.style.display = "block";
                root.innerHTML = '<div class="panel" style="margin:0;border-top-color:var(--danger);"><div class="section-head"><div><h2>No se pudo inicializar pedidos</h2><p>La respuesta no incluyo el panel esperado. Intenta refrescar la pagina.</p></div></div></div>';
              }
              panel.dataset.loaded = "true";
              return;
            }
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
              estatalMin: String(content.dataset.estatalMin || "32967.49").trim(),
              municipalMin: String(content.dataset.municipalMin || "11000").trim(),
            };
            const rows = Array.from(content.querySelectorAll("[data-pedidos-row]"));
            const detailRows = Array.from(content.querySelectorAll("[data-pedidos-detail-row]"));
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
            const senderSelect = content.querySelector("[data-pedidos-sender]");
            const toInput = content.querySelector("[data-pedidos-to]");
            const sendStatus = content.querySelector("[data-pedidos-send-status]");
            const configRefreshBtn = content.querySelector("[data-pedidos-config-refresh]");
            const filesByPedido = new Map();
            const selectedFilesByPedido = new Map();
            const rowByPedido = new Map(rows.map((row) => [String(row.dataset.pedido || "").trim(), row]).filter(([pedido]) => pedido));
            const setSendStatus = (message, kind = "") => {
              if (!sendStatus) return;
              sendStatus.textContent = message || "";
              sendStatus.classList.toggle("ok", kind === "ok");
              sendStatus.classList.toggle("err", kind === "err");
            };
            const apiJson = async (url, options = {}) => {
              const response = await fetch(portalUrl(url), {
                credentials: "same-origin",
                headers: {
                  "X-Requested-With": "fetch",
                  ...(options.headers || {}),
                },
                ...options,
              });
              const text = await response.text();
              let data = null;
              try {
                data = text ? JSON.parse(text) : null;
              } catch {
                throw new Error("El backend no devolvio JSON valido.");
              }
              if (!response.ok || data?.ok === false) {
                throw new Error(data?.error || "HTTP " + response.status);
              }
              return data;
            };
            const cssEscape = (value) => {
              if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
              return String(value || "").replace(/["\\\\]/g, "\\\\$&");
            };
            const fileKey = (file) => String(file?.id || file?.relativePath || file?.path || file?.openUrl || file?.downloadUrl || file?.name || "").trim();
            const renderFiles = (pedido, files) => {
              const list = content.querySelector('[data-pedidos-files-list="' + cssEscape(pedido) + '"]');
              const stateNode = content.querySelector('[data-pedidos-files-state="' + cssEscape(pedido) + '"]');
              if (!list) return;
              if (!files.length) {
                list.innerHTML = '<div class="empty">No se encontraron archivos para este pedido.</div>';
                if (stateNode) stateNode.textContent = "Sin archivos encontrados.";
                return;
              }
              selectedFilesByPedido.set(pedido, new Set(files.map(fileKey).filter(Boolean)));
              list.innerHTML = files.map((file) => {
                const key = fileKey(file);
                const label = file.name || file.relativePath || key;
                const meta = [file.mimeType, file.size ? (Math.round(Number(file.size) / 1024) + " KB") : ""].filter(Boolean).join(" · ");
                const link = file.openUrl || file.downloadUrl || "";
                return '<label class="pedidos-file-item">' +
                  '<input type="checkbox" data-pedidos-file="' + escapeHtml(pedido) + '" value="' + escapeHtml(key) + '" checked />' +
                  '<span><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(meta || "Archivo disponible") + '</small></span>' +
                  (link ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener">Abrir</a>' : '<span></span>') +
                '</label>';
              }).join("");
              if (stateNode) stateNode.textContent = files.length + " archivo(s) cargado(s).";
              list.querySelectorAll("[data-pedidos-file]").forEach((input) => {
                input.addEventListener("change", () => {
                  const selected = new Set(Array.from(list.querySelectorAll("[data-pedidos-file]:checked")).map((item) => String(item.value || "").trim()).filter(Boolean));
                  selectedFilesByPedido.set(pedido, selected);
                });
              });
            };
            const loadFilesForPedido = async (pedido, { open = true } = {}) => {
              const safePedido = String(pedido || "").trim();
              if (!safePedido) throw new Error("Falta pedido.");
              const detail = content.querySelector('[data-pedido-detail="' + cssEscape(safePedido) + '"]');
              const stateNode = content.querySelector('[data-pedidos-files-state="' + cssEscape(safePedido) + '"]');
              if (open && detail) detail.hidden = false;
              if (filesByPedido.has(safePedido)) return filesByPedido.get(safePedido);
              if (stateNode) stateNode.textContent = "Cargando archivos de Drive...";
              const data = await apiJson("/api/pedidos-ley/pedido/" + encodeURIComponent(safePedido) + "/files");
              const files = Array.isArray(data.matchedFiles) ? data.matchedFiles : [];
              filesByPedido.set(safePedido, files);
              renderFiles(safePedido, files);
              return files;
            };
            const loadPedidosConfig = async () => {
              try {
                const [config, senderStatus] = await Promise.all([
                  apiJson("/api/pedidos-ley/config"),
                  apiJson("/api/pedidos-ley/sender/status"),
                ]);
                const recipients = Array.isArray(config.defaultRecipients) ? config.defaultRecipients : ["SGIIREGION1@casaley.com.mx"];
                if (toInput && !String(toInput.value || "").trim()) {
                  toInput.value = recipients.join(", ");
                }
                const accounts = Array.isArray(senderStatus.accounts) ? senderStatus.accounts : [];
                if (senderSelect) {
                  senderSelect.innerHTML = '<option value="">-- Seleccionar remitente --</option>' + accounts.map((account) => {
                    const email = String(account.email || "").trim();
                    return '<option value="' + escapeHtml(email) + '"' + (email === senderStatus.activeEmail ? " selected" : "") + '>' + escapeHtml(email) + '</option>';
                  }).join("");
                }
                setSendStatus(accounts.length ? "Remitente listo." : "No hay remitentes configurados.", accounts.length ? "ok" : "err");
              } catch (error) {
                setSendStatus(error instanceof Error ? error.message : "No se pudo cargar remitente.", "err");
              }
            };
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
              const statusMatches = (status, filter) => {
                if (filter === "all") return true;
                if (filter === "sin-liberacion") {
                  return status === "sin-liberacion-sin-trabajo";
                }
                return status === filter;
              };
              const matchesFilters = (row) => {
                const status = String(row.dataset.status || "otros").trim();
                const type = String(row.dataset.type || "otros").trim();
                const haystack = normalizeText(row.dataset.search || "");
                return statusMatches(status, state.status)
                  && (state.type === "all" || type === state.type)
                  && (!query || haystack.includes(query));
              };
              const visibleOrderRows = rows.filter(matchesFilters);
              const visibleBranchRows = branchRows.filter(matchesFilters);
              rows.forEach((row) => { row.hidden = true; });
              detailRows.forEach((row) => { row.hidden = true; });
              branchRows.forEach((row) => { row.hidden = true; });
              if (state.scope === "pedidos") {
                visibleOrderRows.forEach((row) => {
                  row.hidden = false;
                  const pedido = String(row.dataset.pedido || "").trim();
                  const detail = pedido ? content.querySelector('[data-pedido-detail="' + cssEscape(pedido) + '"]') : null;
                  if (detail && detail.dataset.open === "true") detail.hidden = false;
                });
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
              state.estatalMin = "32967.49";
              state.municipalMin = "11000";
              reload();
            });
            configRefreshBtn?.addEventListener("click", loadPedidosConfig);
            senderSelect?.addEventListener("change", async () => {
              const email = String(senderSelect.value || "").trim();
              if (!email) return;
              try {
                await apiJson("/api/pedidos-ley/sender/select", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email }),
                });
                setSendStatus("Remitente activo: " + email, "ok");
              } catch (error) {
                setSendStatus(error instanceof Error ? error.message : "No se pudo seleccionar remitente.", "err");
              }
            });
            content.querySelectorAll("[data-pedidos-toggle-files]").forEach((button) => {
              button.addEventListener("click", async () => {
                const pedido = String(button.getAttribute("data-pedidos-toggle-files") || "").trim();
                const detail = content.querySelector('[data-pedido-detail="' + cssEscape(pedido) + '"]');
                if (!detail) return;
                const shouldOpen = detail.hidden;
                detail.dataset.open = shouldOpen ? "true" : "false";
                detail.hidden = !shouldOpen;
                button.textContent = shouldOpen ? "Ocultar archivos" : "Ver archivos";
                if (shouldOpen) {
                  try {
                    await loadFilesForPedido(pedido);
                  } catch (error) {
                    setSendStatus(error instanceof Error ? error.message : "No se pudieron cargar archivos.", "err");
                  }
                }
              });
            });
            content.querySelectorAll("[data-pedidos-send]").forEach((button) => {
              button.addEventListener("click", async () => {
                const pedido = String(button.getAttribute("data-pedidos-send") || "").trim();
                const row = rowByPedido.get(pedido);
                const to = String(toInput?.value || "").trim();
                const fromEmail = String(senderSelect?.value || "").trim();
                if (!to) {
                  setSendStatus("Agrega al menos un correo destino.", "err");
                  return;
                }
                try {
                  button.disabled = true;
                  setSendStatus("Cargando archivos del pedido " + pedido + "...", "");
                  const files = await loadFilesForPedido(pedido);
                  const selected = selectedFilesByPedido.get(pedido) || new Set(files.map(fileKey).filter(Boolean));
                  const selectedFiles = files.filter((file) => selected.has(fileKey(file)));
                  if (!selectedFiles.length) {
                    setSendStatus("Selecciona al menos un archivo para enviar.", "err");
                    return;
                  }
                  setSendStatus("Enviando pedido " + pedido + "...", "");
                  await apiJson("/api/pedidos-ley/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      pedido,
                      to,
                      fromEmail,
                      facturadorNombre: row?.dataset?.facturadorNombre || "",
                      files: selectedFiles,
                      textBody: "Le informamos que el trabajo correspondiente al pedido " + pedido + " ya esta listo. Adjuntamos el documento final para su revision.",
                      htmlBody: "<p>Le informamos que el trabajo correspondiente al pedido <strong>" + escapeHtml(pedido) + "</strong> ya esta listo.</p><p>Adjuntamos el documento final para su revision.</p>",
                    }),
                  });
                  setSendStatus("Pedido " + pedido + " enviado correctamente.", "ok");
                  row?.setAttribute("data-status", "sin-liberacion-enviados");
                  row?.setAttribute("hidden", "hidden");
                  const detail = content.querySelector('[data-pedido-detail="' + cssEscape(pedido) + '"]');
                  if (detail) detail.hidden = true;
                } catch (error) {
                  setSendStatus(error instanceof Error ? error.message : "No se pudo enviar el pedido.", "err");
                } finally {
                  button.disabled = false;
                  renderLocal();
                }
              });
            });
            void loadPedidosConfig();
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
          const getTabFromLocation = () => {
            const currentPath = window.location.pathname.replace(/\\/$/, "");
            if (currentPath === String(sucursalesTabPath || "").replace(/\\/$/, "") && sucursalesTabPath !== dashboardTabBasePath) {
              return "sucursales";
            }
            const requested = new URL(window.location.href).searchParams.get("tab") || "";
            return panels.some((panel) => panel.dataset.dashboardTabPanel === requested)
              ? requested
              : (tabs[0]?.dataset.dashboardTab || "calendar");
          };
          const buildTabUrl = (tabId) => {
            const useContextPath = tabId === "sucursales" && sucursalesTabPath !== dashboardTabBasePath;
            const url = new URL(useContextPath ? sucursalesTabPath : dashboardTabBasePath, window.location.origin);
            if (!useContextPath) url.searchParams.set("tab", tabId);
            return url.pathname + url.search;
          };
          const setActiveTab = (tabId, { focus = false, historyMode = "none" } = {}) => {
            const requestedTab = String(tabId || "").trim();
            if (requestedTab === "pedidos") {
              window.location.assign(portalUrl("/dashboard/pedidos"));
              return;
            }
            const nextTab = panels.some((panel) => panel.dataset.dashboardTabPanel === requestedTab)
              ? requestedTab
              : (tabs[0]?.dataset.dashboardTab || "calendar");
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
            document.dispatchEvent(new CustomEvent("desarrolloeg:dashboard-tab", { detail: { tabId: nextTab } }));
            if (nextTab === "calendar" && calendarInstance) {
              requestAnimationFrame(() => requestAnimationFrame(() => calendarInstance?.updateSize?.()));
            }
            if (nextTab === "ley") {
              loadDeferredPanel("ley");
            }
            if (nextTab === "solventaciones") {
              const frame = document.querySelector("[data-solventaciones-frame]");
              if (frame && !frame.src) frame.src = frame.dataset.src || "/solventaciones/html?embed=1";
            }
            if (focus) {
              tabs.find((button) => button.dataset.dashboardTab === nextTab)?.focus();
            }
            if (historyMode === "push" || historyMode === "replace") {
              const nextUrl = buildTabUrl(nextTab);
              const currentUrl = window.location.pathname + window.location.search;
              if (nextUrl !== currentUrl) {
                window.history[historyMode === "replace" ? "replaceState" : "pushState"]({ dashboardTab: nextTab }, "", nextUrl);
                window.dispatchEvent(new CustomEvent("desarrolloeg:navigation-changed", { detail: { tab: nextTab } }));
              }
            }
          };
          tabs.forEach((button) => {
            button.addEventListener("click", () => setActiveTab(button.dataset.dashboardTab, { historyMode: "push" }));
          });
          window.addEventListener("message", (event) => {
            if (event.data?.type !== "desarrolloeg:solventaciones-height") return;
            const frame = document.querySelector("[data-solventaciones-frame]");
            const height = Number(event.data.height || 0);
            if (frame && event.source === frame.contentWindow && Number.isFinite(height) && height > 0) {
              frame.style.height = Math.max(760, Math.min(height + 8, 5000)) + "px";
            }
          });
          mobileChips.forEach((button) => {
            button.addEventListener("click", () => setActiveTab(button.dataset.dashboardTab, { focus: false, historyMode: "push" }));
          });
          window.addEventListener("popstate", () => setActiveTab(getTabFromLocation(), { historyMode: "none" }));
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
          const refreshAppShellCache = async (scope = "portal", { reload = true, quiet = false } = {}) => {
            const refreshFn = window.__DESARROLLOEG_REFRESH_CACHE__;
            if (typeof refreshFn === "function") {
              return refreshFn({ scope, reload, quiet });
            }
            const response = await fetch(portalUrl("/api/app-shell/cache/refresh?scope=" + encodeURIComponent(scope)), {
              method: "POST",
              headers: {
                "X-Requested-With": "fetch",
              },
              credentials: "same-origin",
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              const errorText = payload?.error || payload?.message || "No se pudo actualizar la cache.";
              throw new Error(errorText);
            }
            if (reload) {
              window.location.reload();
            } else if (!quiet) {
              window.dispatchEvent(new CustomEvent("desarrolloeg:cache-refreshed", { detail: { scope, payload } }));
            }
            return payload;
          };
          window.refreshAppShellCache = refreshAppShellCache;
          document.addEventListener("submit", async (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.classList.contains("js-async-diplomas")) return;
            event.preventDefault();
            const button = event.submitter instanceof HTMLButtonElement
              ? event.submitter
              : form.querySelector('button[name="diplomas"]');
            const nextDiplomas = button?.name === "diplomas"
              ? String(button.value || "Y").trim()
              : String(form.querySelector('button[name="diplomas"].active')?.value || "Y").trim();
            form.querySelectorAll('button[name="diplomas"]').forEach((item) => { item.disabled = true; });
            try {
              const payload = new FormData(form);
              payload.set("diplomas", nextDiplomas || "Y");
              const response = await fetch(form.action, {
                method: "POST",
                body: payload,
                headers: { "X-Requested-With": "fetch" },
                credentials: "same-origin",
              });
              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || "HTTP " + response.status);
              }
              updateDiplomaState(form, nextDiplomas || "Y");
              const card = form.closest(".capacitacion-card");
              if (card && !card.hasAttribute("data-keep-after-diplomas") && !form.closest("[data-constancias-studio]")) {
                card.style.transition = "opacity 180ms ease, transform 180ms ease";
                card.style.opacity = "0";
                card.style.transform = "translateY(-4px)";
                setTimeout(() => card.remove(), 220);
              }
              await refreshAppShellCache("portal", { reload: false, quiet: true });
            } catch (error) {
              form.querySelectorAll('button[name="diplomas"]').forEach((item) => { item.disabled = false; });
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
              const responsePayload = await response.json().catch(() => null);
              if (!response.ok) {
                throw new Error(responsePayload?.error || "HTTP " + response.status);
              }
              updateNotesState(form, responsePayload?.note);
              await refreshAppShellCache("portal", { reload: false, quiet: true });
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
              await refreshAppShellCache("portal", { reload: true, quiet: false });
            } catch (error) {
              if (button) button.disabled = false;
              alert(error instanceof Error ? error.message : "No se pudo guardar la nota.");
            }
          });
          document.addEventListener("submit", async (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.classList.contains("js-edit-thread-note")) return;
            event.preventDefault();
            const button = form.querySelector('button[type="submit"]');
            if (button) button.disabled = true;
            try {
              const response = await fetch(form.action, {
                method: "POST",
                body: new URLSearchParams(new FormData(form)),
                headers: {
                  "X-Requested-With": "fetch",
                  "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                credentials: "same-origin",
              });
              const payload = await response.json().catch(() => null);
              if (!response.ok) throw new Error(payload?.error || "No se pudo editar la nota.");
              const article = form.closest("[data-thread-note-id]");
              const body = article?.querySelector(".thread-note-body");
              if (body) body.textContent = '"' + String(payload?.note?.body || "") + '"';
              form.closest("details")?.removeAttribute("open");
            } catch (error) {
              alert(error instanceof Error ? error.message : "No se pudo editar la nota.");
            } finally {
              if (button) button.disabled = false;
            }
          });
          document.addEventListener("click", async (event) => {
            const button = event.target instanceof Element ? event.target.closest(".js-delete-thread-note") : null;
            if (!button) return;
            if (!window.confirm("¿Eliminar esta entrada del hilo?")) return;
            try {
              const response = await fetch(String(button.dataset.action || ""), {
                method: "POST",
                headers: { "X-Requested-With": "fetch" },
                credentials: "same-origin",
              });
              const payload = await response.json().catch(() => null);
              if (!response.ok) throw new Error(payload?.error || "No se pudo eliminar la nota.");
              button.closest("[data-thread-note-id]")?.remove();
            } catch (error) {
              alert(error instanceof Error ? error.message : "No se pudo eliminar la nota.");
            }
          });
          if (hasFullCalendar) {
            calendarInstance = new FullCalendar.Calendar(mount, {
            locale: "es",
            allDayText: "Todo el día",
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
                  : [props.statusLabel || "", props.hourLabel || "", props.capacitadoresLabel || ""];
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
            const refreshCalendarEvents = async () => {
              const query = new URLSearchParams({
                employee: String(config.selectedEmployeeId || ""),
                returnTo: String(config.returnTo || "/dashboard"),
                _: String(Date.now()),
              });
              const response = await fetch(portalUrl("/api/portal/calendar?" + query.toString()), {
                credentials: "same-origin",
                headers: { "X-Requested-With": "fetch" },
                cache: "no-store",
              });
              const payload = await response.json().catch(() => null);
              if (!response.ok) throw new Error(payload?.error || "No se pudo actualizar el calendario.");
              events.splice(0, events.length, ...(Array.isArray(payload?.events) ? payload.events : []));
              calendarInstance.removeAllEvents();
              calendarInstance.addEventSource(getVisibleEvents());
              return payload;
            };
            window.__DESARROLLOEG_REFRESH_CALENDAR__ = refreshCalendarEvents;
            window.addEventListener("desarrolloeg:data-changed", () => {
              void refreshCalendarEvents().catch(() => {});
            });
          }
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
          setActiveTab(getTabFromLocation(), { historyMode: "none" });
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
        <div class="dashboard-content">
          ${dashboardTabPanels}
        </div>
      </section>
    `,
    bodyScripts: `
      <script>
        (function () {
          document.addEventListener("DOMContentLoaded", () => {
          if (window.__DESARROLLOEG_SHELL_REALTIME__) return;
          if (window.__DESARROLLOEG_PORTAL_REALTIME_STARTED__) return;
          window.__DESARROLLOEG_PORTAL_REALTIME_STARTED__ = true;
          const portalUrl = (path) => (window.__PORTAL_URL__ ? window.__PORTAL_URL__(path) : path);
          let lastCursor = null;
          let lastRevision = null;
          let pendingCursor = null;
          let checking = false;
          let eventsConnected = false;
          const stateUrl = () => {
            const base = portalUrl("/api/app-shell/cache/state?scope=portal");
            return base + (base.includes("?") ? "&" : "?") + "_=" + Date.now();
          };
          const eventsUrl = () => portalUrl("/api/app-shell/events?scope=portal");
          const shouldDeferReload = () => {
            const active = document.activeElement;
            return active instanceof HTMLInputElement
              || active instanceof HTMLTextAreaElement
              || active instanceof HTMLSelectElement;
          };
          const reloadWhenReady = (cursor) => {
            pendingCursor = cursor;
            if (shouldDeferReload()) return false;
            pendingCursor = null;
            window.dispatchEvent(new CustomEvent("desarrolloeg:data-changed", {
              detail: { scope: "portal", cursor, source: "dashboard-realtime" },
            }));
            return true;
          };
          const handleCursor = (cursor, { initial = false } = {}) => {
            const numericCursor = Number(cursor || 0);
            if (!Number.isFinite(numericCursor) || numericCursor <= 0) return;
            if (lastCursor == null || initial) {
              lastCursor = numericCursor;
              return;
            }
            if (numericCursor > lastCursor) {
              lastCursor = numericCursor;
              reloadWhenReady(numericCursor);
            }
          };
          const handleRevision = (revision, { initial = false } = {}) => {
            const numericRevision = Number(revision || 0);
            if (!Number.isFinite(numericRevision) || numericRevision <= 0) return false;
            if (lastRevision == null || initial) {
              lastRevision = numericRevision;
              return false;
            }
            if (numericRevision !== lastRevision) {
              lastRevision = numericRevision;
              reloadWhenReady(numericRevision);
              return true;
            }
            return false;
          };
          const handleRefreshEvent = (state) => {
            const numericRevision = Number(state?.revision || 0);
            if (Number.isFinite(numericRevision) && numericRevision > 0) {
              lastRevision = numericRevision;
            }
            const numericCursor = Number(state?.cursor || 0);
            if (Number.isFinite(numericCursor) && numericCursor > 0 && lastCursor == null) {
              lastCursor = numericCursor;
              return;
            }
            if (Number.isFinite(numericCursor) && numericCursor > 0 && numericCursor > lastCursor) {
              lastCursor = numericCursor;
              reloadWhenReady(numericCursor);
              return;
            }
            reloadWhenReady(numericCursor || Date.now());
          };
          const startEventStream = () => {
            if (!("EventSource" in window)) return;
            const source = new EventSource(eventsUrl());
            source.addEventListener("open", () => {
              eventsConnected = true;
            });
            source.addEventListener("init", (event) => {
              const state = JSON.parse(event.data || "{}");
              handleCursor(state?.cursor, { initial: true });
              handleRevision(state?.revision, { initial: true });
            });
            source.addEventListener("app-shell-cache", (event) => {
              const state = JSON.parse(event.data || "{}");
              handleRefreshEvent(state);
            });
            source.addEventListener("error", () => {
              eventsConnected = false;
            });
          };
          const checkState = async () => {
            if (checking) return;
            if (pendingCursor != null && !shouldDeferReload()) {
              const cursor = pendingCursor;
              pendingCursor = null;
              window.dispatchEvent(new CustomEvent("desarrolloeg:data-changed", {
                detail: { scope: "portal", cursor, source: "dashboard-realtime" },
              }));
            }
            checking = true;
            try {
              const response = await fetch(stateUrl(), {
                headers: { "X-Requested-With": "fetch" },
                credentials: "same-origin",
                cache: "no-store",
              });
              if (!response.ok) return;
              const state = await response.json().catch(() => null);
              if (handleRevision(state?.revision, { initial: lastRevision == null })) return;
              handleCursor(state?.cursor, { initial: lastCursor == null });
            } finally {
              checking = false;
            }
          };
          window.__DESARROLLOEG_PORTAL_REALTIME_CHECK__ = checkState;
          startEventStream();
          window.setInterval(checkState, 3000);
          window.addEventListener("focus", checkState);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") checkState();
          });
          checkState();
          }, { once: true });
        })();
      </script>
      <script>
        (function () {
          const escapeText = (value) => String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
          const capacitaciones = document.querySelector("[data-capacitaciones-studio]");
          if (capacitaciones) {
            const normalize = (value) => String(value || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim()
              .toUpperCase();
            const controls = Array.from(capacitaciones.querySelectorAll("[data-capacitaciones-filter]"));
            const items = Array.from(capacitaciones.querySelectorAll("[data-capacitacion-item]"));
            const groups = Array.from(capacitaciones.querySelectorAll("[data-capacitacion-group]"));
            const groupLimits = new WeakMap(groups.map((group) => [group, 12]));
            const applyCapacitacionesFilters = () => {
              const search = normalize(capacitaciones.querySelector('[data-capacitaciones-filter="search"]')?.value || "");
              const status = normalize(capacitaciones.querySelector('[data-capacitaciones-filter="status"]')?.value || "");
              const capacitador = String(capacitaciones.querySelector('[data-capacitaciones-filter="capacitador"]')?.value || "").trim();
              const diplomas = String(capacitaciones.querySelector('[data-capacitaciones-filter="diplomas"]')?.value || "").trim().toUpperCase();
              const filtersActive = Boolean(search || status || capacitador || diplomas);
              let totalMatches = 0;
              items.forEach((item) => {
                const haystack = normalize(item.dataset.search || item.textContent || "");
                const itemStatus = normalize(item.dataset.status || "");
                const itemDiplomas = String(item.dataset.diplomas || "").trim().toUpperCase();
                const keys = String(item.dataset.capacitadores || "").split(",").map((key) => key.trim()).filter(Boolean);
                const visible = (!search || haystack.includes(search))
                  && (!status || itemStatus === status)
                  && (!capacitador || keys.includes(capacitador))
                  && (!diplomas || itemDiplomas === diplomas);
                item.dataset.filterMatch = visible ? "1" : "0";
                if (visible) totalMatches += 1;
              });
              groups.forEach((group) => {
                const groupItems = Array.from(group.querySelectorAll("[data-capacitacion-item]"));
                const matches = groupItems.filter((item) => item.dataset.filterMatch === "1");
                const limit = filtersActive ? Math.max(24, groupLimits.get(group) || 12) : (groupLimits.get(group) || 12);
                groupItems.forEach((item) => { item.hidden = !matches.includes(item) || matches.indexOf(item) >= limit; });
                const visibleCount = matches.length;
                const count = group.querySelector("[data-capacitacion-group-count]");
                if (count) count.textContent = String(visibleCount);
                group.hidden = visibleCount === 0;
                if (filtersActive && visibleCount > 0) group.open = true;
                const more = group.querySelector("[data-capacitaciones-more]");
                if (more) {
                  more.hidden = visibleCount <= limit;
                  more.textContent = "Mostrar más (" + Math.max(0, visibleCount - limit) + ")";
                }
              });
              const results = capacitaciones.querySelector("[data-capacitaciones-results]");
              if (results) results.textContent = totalMatches + (totalMatches === 1 ? " capacitacion encontrada" : " capacitaciones encontradas");
            };
            controls.forEach((control) => {
              control.addEventListener("input", applyCapacitacionesFilters);
              control.addEventListener("change", applyCapacitacionesFilters);
            });
            capacitaciones.querySelector("[data-capacitaciones-filter-reset]")?.addEventListener("click", () => {
              controls.forEach((control) => { control.value = ""; });
              groups.forEach((group) => { groupLimits.set(group, 12); });
              groups.forEach((group) => { group.open = false; });
              applyCapacitacionesFilters();
            });
            groups.forEach((group) => {
              group.querySelector("[data-capacitaciones-more]")?.addEventListener("click", () => {
                groupLimits.set(group, (groupLimits.get(group) || 12) + 12);
                applyCapacitacionesFilters();
              });
            });
            applyCapacitacionesFilters();
          }

          const constancias = document.querySelector("[data-constancias-studio]");
          if (constancias) {
            const capacitador = constancias.querySelector("[data-constancias-capacitador-filter]");
            const capacitacion = constancias.querySelector("[data-constancias-capacitacion-select]");
            const frame = constancias.querySelector("[data-constancias-frame]");
            const openLink = constancias.querySelector("[data-constancias-open]");
            const sede = constancias.querySelector("[data-constancias-sede]");
            const fecha = constancias.querySelector("[data-constancias-fecha]");
            const state = constancias.querySelector("[data-constancias-diplomas-state]");
            const sucursalesList = constancias.querySelector("[data-constancias-sucursales]");
            const diplomasForm = constancias.querySelector("[data-constancias-diplomas-form]");
            const resizeFrame = () => {
              if (!frame) return;
              try {
                const height = frame.contentDocument?.documentElement?.scrollHeight || frame.contentDocument?.body?.scrollHeight || 0;
                if (height > 0) frame.style.height = Math.max(780, height + 12) + "px";
              } catch {}
            };
            frame?.addEventListener("load", () => {
              resizeFrame();
              window.setTimeout(resizeFrame, 500);
              window.setTimeout(resizeFrame, 1500);
            });
            const updateFromSelected = () => {
              const option = capacitacion?.selectedOptions?.[0];
              if (!option) return;
              const url = option.dataset.url || "";
              const integratedUrl = option.dataset.integratedUrl || url;
              const rowId = option.value || "";
              const hasDiplomas = String(option.dataset.diplomas || "").toUpperCase() === "Y";
              const panel = constancias.closest("[data-dashboard-tab-panel]");
              if (frame && integratedUrl) {
                frame.dataset.src = integratedUrl;
                if (!panel || !panel.hidden) frame.src = integratedUrl;
              }
              if (openLink && url) openLink.href = url;
              if (sede) sede.textContent = option.dataset.sede || "Sin sede";
              if (fecha) fecha.textContent = option.dataset.fecha || "Sin fecha";
              if (sucursalesList) {
                let items = [];
                try {
                  items = JSON.parse(option.dataset.sucursales || "[]");
                } catch {
                  items = [];
                }
                sucursalesList.innerHTML = Array.isArray(items) && items.length
                  ? items.map((item) => '<span class="tag-pill">' + escapeText(item) + '</span>').join("")
                  : '<span class="calendar-empty">Sin sucursales</span>';
              }
              if (state) {
                state.textContent = hasDiplomas ? "DIPLOMAS: SI" : "DIPLOMAS: NO";
                state.classList.toggle("is-finalizada", hasDiplomas);
                state.classList.toggle("is-programada", !hasDiplomas);
              }
              if (diplomasForm && rowId) diplomasForm.action = "/dashboard/capacitaciones/" + encodeURIComponent(rowId) + "/diplomas";
              diplomasForm?.querySelectorAll('button[name="diplomas"]').forEach((button) => {
                const active = String(button.value || "").toUpperCase() === (hasDiplomas ? "Y" : "N");
                button.classList.toggle("active", active);
              });
            };
            const applyCapacitadorFilter = () => {
              const selected = String(capacitador?.value || "").trim();
              let firstVisible = null;
              capacitacion?.querySelectorAll("option").forEach((option) => {
                const keys = String(option.dataset.capacitadores || "").split(",").map((item) => item.trim()).filter(Boolean);
                const visible = !selected || keys.includes(selected);
                option.hidden = !visible;
                option.disabled = !visible;
                if (visible && !firstVisible) firstVisible = option;
              });
              if (firstVisible && (capacitacion.selectedOptions[0]?.disabled || capacitacion.selectedOptions[0]?.hidden)) {
                capacitacion.value = firstVisible.value;
              }
              updateFromSelected();
            };
            capacitador?.addEventListener("change", applyCapacitadorFilter);
            capacitacion?.addEventListener("change", updateFromSelected);
            document.addEventListener("desarrolloeg:dashboard-tab", (event) => {
              if (event.detail?.tabId === "constancias") updateFromSelected();
            });
            applyCapacitadorFilter();
          }

          const sucursales = document.querySelector("[data-sucursales-studio]");
          if (sucursales) {
            const directorySearch = sucursales.querySelector("[data-company-directory-search]");
            const directoryMore = sucursales.querySelector("[data-company-directory-more]");
            const directoryCards = Array.from(sucursales.querySelectorAll("[data-company-directory-card]"));
            const directoryPageSize = window.matchMedia("(max-width: 720px)").matches ? 12 : 24;
            let directoryLimit = directoryPageSize;
            const applyDirectorySearch = () => {
              const query = String(directorySearch?.value || "").trim().toUpperCase();
              const matches = directoryCards.filter((card) => !query || String(card.dataset.search || "").toUpperCase().includes(query));
              directoryCards.forEach((card) => { card.hidden = !matches.includes(card) || matches.indexOf(card) >= directoryLimit; });
              const result = sucursales.querySelector("[data-company-directory-results]");
              if (result) result.textContent = Math.min(directoryLimit, matches.length) + " de " + matches.length + (matches.length === 1 ? " empresa" : " empresas");
              if (directoryMore) directoryMore.hidden = matches.length <= directoryLimit;
            };
            directorySearch?.addEventListener("input", () => { directoryLimit = directoryPageSize; applyDirectorySearch(); });
            directoryMore?.addEventListener("click", () => { directoryLimit += directoryPageSize; applyDirectorySearch(); });
            applyDirectorySearch();
            const applyFilters = (panel) => {
              const controls = Array.from(panel.querySelectorAll("[data-sucursales-filter]"));
              const valueFor = (kind) => String(controls.find((input) => input.dataset.sucursalesFilter === kind)?.value || "").trim().toUpperCase();
              const pedido = valueFor("pedido");
              const trabajo = valueFor("trabajo");
              const vigencia = valueFor("vigencia");
              const filters = controls.filter((input) => !["pedido", "trabajo", "vigencia"].includes(input.dataset.sucursalesFilter)).map((input) => {
                const values = input instanceof HTMLSelectElement && input.multiple
                  ? Array.from(input.selectedOptions).map((option) => option.value)
                  : [input.value];
                return values.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean);
              }).filter((values) => values.length);
              let visibleCount = 0;
              panel.querySelectorAll("[data-sucursal-chip]").forEach((chip) => {
                const haystack = String(chip.dataset.search || chip.textContent || "").toUpperCase();
                const trabajos = String(chip.dataset.trabajos || "").toUpperCase();
                const hasEstatal = trabajos.includes("ESTATAL");
                const hasMunicipal = trabajos.includes("MUNICIPAL");
                const matchesPedido = !pedido || String(chip.dataset.pedidos || "").toUpperCase().includes(pedido);
                const matchesTrabajo = !trabajo
                  || (trabajo === "ESTATAL" && hasEstatal)
                  || (trabajo === "MUNICIPAL" && hasMunicipal)
                  || (trabajo === "OTRO" && !hasEstatal && !hasMunicipal);
                const matchesVigencia = !vigencia
                  || (trabajo === "ESTATAL" && chip.dataset.estatalYear === vigencia)
                  || (trabajo === "MUNICIPAL" && chip.dataset.municipalYear === vigencia)
                  || (!trabajo && (chip.dataset.estatalYear === vigencia || chip.dataset.municipalYear === vigencia));
                const matchesGeneric = filters.every((values) => values.some((value) => haystack.includes(value)));
                chip.hidden = !(matchesPedido && matchesTrabajo && matchesVigencia && matchesGeneric);
                if (!chip.hidden) visibleCount += 1;
              });
              panel.querySelectorAll("[data-territory-municipality]").forEach((municipality) => {
                const municipalityCount = municipality.querySelectorAll("[data-sucursal-chip]:not([hidden])").length;
                municipality.hidden = municipalityCount === 0;
                const countLabel = municipality.querySelector("[data-territory-municipality-count]");
                if (countLabel) countLabel.textContent = municipalityCount + (municipalityCount === 1 ? " sucursal" : " sucursales");
              });
              panel.querySelectorAll("[data-territory-state]").forEach((state) => {
                const stateCount = state.querySelectorAll("[data-sucursal-chip]:not([hidden])").length;
                const municipalityCount = state.querySelectorAll("[data-territory-municipality]:not([hidden])").length;
                state.hidden = stateCount === 0;
                const countLabel = state.querySelector("[data-territory-state-count]");
                if (countLabel) {
                  countLabel.textContent = stateCount
                    + (stateCount === 1 ? " sucursal · " : " sucursales · ")
                    + municipalityCount
                    + (municipalityCount === 1 ? " municipio" : " municipios");
                }
              });
              const result = panel.querySelector("[data-sucursales-results]");
              if (result) result.textContent = visibleCount + (visibleCount === 1 ? " sucursal disponible" : " sucursales disponibles");
            };
            sucursales.querySelectorAll("[data-sucursales-company]").forEach((panel) => {
              panel.querySelectorAll("[data-sucursales-filter]").forEach((input) => {
                input.addEventListener("input", () => applyFilters(panel));
                input.addEventListener("change", () => applyFilters(panel));
              });
              panel.querySelector("[data-sucursales-filter-reset]")?.addEventListener("click", () => {
                panel.querySelectorAll("[data-sucursales-filter]").forEach((input) => { input.value = ""; });
                panel.querySelectorAll("details").forEach((detail) => { detail.open = false; });
                applyFilters(panel);
              });
              applyFilters(panel);
            });
          }
        })();
      </script>
      ${calendarBootstrap}
      <script>
        (function () {
          const portalUrl = (path) => (window.__PORTAL_URL__ ? window.__PORTAL_URL__(path) : path);
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
          document.addEventListener("click", async (event) => {
            const target = event.target instanceof Element ? event.target.closest("[data-dashboard-reload]") : null;
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            const button = target;
            const originalLabel = button.textContent;
            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            try {
              const scope = button.dataset.refreshScope || "portal";
              await window.refreshAppShellCache(scope, { reload: true, quiet: false });
            } catch (error) {
              alert(error instanceof Error ? error.message : "No se pudo actualizar la cachÃ©.");
            } finally {
              button.disabled = false;
              button.removeAttribute("aria-busy");
              button.textContent = originalLabel;
            }
          }, true);
          reloadButtons.forEach((button) => {
            button.addEventListener("click", async () => {
              const originalLabel = button.textContent;
              button.disabled = true;
              button.setAttribute("aria-busy", "true");
              try {
                const scope = button.dataset.refreshScope || "portal";
                const response = await fetch(portalUrl("/api/app-shell/cache/refresh?scope=" + encodeURIComponent(scope)), {
                  method: "POST",
                  headers: {
                    "X-Requested-With": "fetch",
                  },
                  credentials: "same-origin",
                });
                if (!response.ok) {
                  const text = await response.text().catch(() => "");
                  throw new Error(text || "No se pudo actualizar la caché.");
                }
                window.location.reload();
              } catch (error) {
                alert(error instanceof Error ? error.message : "No se pudo actualizar la caché.");
              } finally {
                button.disabled = false;
                button.removeAttribute("aria-busy");
                button.textContent = originalLabel;
              }
            });
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

function getUserAccessProfile(user = {}) {
  return user?.accessProfile || resolvePortalAccessProfile(user);
}

function hasPortalCapability(user, view, action = "view") {
  return canUsePortalView({ ...user, accessProfile: getUserAccessProfile(user) }, view, action);
}

function canUseGlobalScope(user, view) {
  return canViewAllForPortalView({ ...user, accessProfile: getUserAccessProfile(user) }, view);
}

function canMutateGlobalScope(user, view) {
  return getPortalViewPermission({ ...user, accessProfile: getUserAccessProfile(user) }, view).scope === "all";
}

function canAccessEmployeeScope(user, targetEmployee, view) {
  if (!user || !targetEmployee) return false;
  return String(user.rowId || "") === String(targetEmployee.rowId || "") || canUseGlobalScope(user, view);
}

function rejectCapability(res, message = "No tienes permiso para realizar esta accion.") {
  res.status(403).type("html").send(renderLoginPage(message));
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
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

homeRouter.get("/api/portal/calendar", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  if (!hasPortalCapability(user, "calendario", "view")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para ver el calendario." });
    return;
  }
  const employees = await listEmployeesForPortal({ runAsUserEmail: user.correo });
  const requestedEmployeeId = String(req.query.employee || "").trim();
  const selectedEmployee = employees.find((employee) => employee.rowId === requestedEmployeeId) || user;
  if (!canAccessEmployeeScope(user, selectedEmployee, "calendario")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para ver ese calendario." });
    return;
  }
  const data = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee });
  const returnPath = String(req.query.returnTo || "/dashboard").trim();
  const events = [
    ...data.calendarCapacitaciones.map((capacitacion) => buildCapacitacionCalendarEvent(capacitacion, selectedEmployee.rowId, returnPath)),
    ...data.birthdayEvents,
    ...data.calendarNotes.map((note) => buildCalendarNoteEvent(note, selectedEmployee.rowId, returnPath)),
  ].filter(Boolean);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, generatedAt: new Date().toISOString(), events });
});

homeRouter.get("/api/portal/bootstrap", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    home: portalPath("/dashboard"),
    defaultView: "calendario",
    user: getEmployeeSummary(user),
  });
});

homeRouter.get("/api/portal/capacitaciones", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  if (!hasPortalCapability(user, "capacitaciones", "view")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para ver capacitaciones." });
    return;
  }
  const employees = await listEmployeesForPortal({ runAsUserEmail: user.correo });
  const requestedEmployeeId = String(req.query.employee || "").trim();
  const selectedEmployee = employees.find((employee) => employee.rowId === requestedEmployeeId) || user;
  if (!canAccessEmployeeScope(user, selectedEmployee, "capacitaciones")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para ver esas capacitaciones." });
    return;
  }
  const data = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    selectedEmployee: getEmployeeSummary(selectedEmployee),
    capabilities: getUserAccessProfile(user)?.views?.capacitaciones || { actions: [], scope: "none" },
    counts: {
      total: data.visible.length,
      programadas: data.visible.filter((item) => item.statusSuffix === "PROGRAMADA").length,
      finalizadas: data.visible.filter((item) => item.statusSuffix === "FINALIZADA").length,
      sinDiplomas: data.finalizadasSinDiplomas.length,
    },
    rows: data.visible.map((item) => ({
      id: item.rowId,
      date: item.dateRaw,
      dateLabel: item.dateLabel,
      status: item.statusSuffix,
      statusLabel: item.statusLabel,
      sedeId: item.cede,
      sede: item.cedeLabel,
      horaInicio: item.horaInicio,
      horaFin: item.horaFin,
      diplomas: item.hasDiplomas,
      sucursales: getCapacitacionSucursalesItems(item),
      capacitadores: item.capacitadores || [],
      notasHistoricas: item.notas || "",
      threadNotes: item.threadNotes || [],
    })),
  });
});

homeRouter.get("/api/portal/empresas", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  if (!hasPortalCapability(user, "informacion-sucursales", "view")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para ver empresas y sucursales." });
    return;
  }
  const [empresas, sucursales] = await Promise.all([
    listEmpresasForPortal(),
    listSucursalesForPortal({ runAsUserEmail: user.correo }),
  ]);
  const requestedId = String(req.query.id || "").trim();
  const filteredEmpresas = requestedId ? empresas.filter((empresa) => empresa.key === requestedId) : empresas;
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    rows: filteredEmpresas.map((empresa) => ({
      ...empresa,
      sucursales: sucursales.filter((sucursal) => String(
        sucursal?.raw?.empresa_id
          || sucursal?.raw?.EMPRESA
          || sucursal?.raw?.["ID EMPRESA"]
          || "",
      ).trim() === empresa.key),
    })),
  });
});

homeRouter.get("/api/portal/pedidos", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  if (!hasPortalCapability(user, "pedidos", "view")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para ver pedidos." });
    return;
  }
  try {
    const data = await fetchPedidosLeyAdminDashboardData({
      year: String(req.query.year || "").trim(),
      forceRefresh: String(req.query.refresh || "") === "1",
      facturadorId: String(req.query.facturadorId || "").trim() || undefined,
      thresholds: {
        estatalMin: req.query.estatalMin,
        municipalMin: req.query.municipalMin,
      },
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, generatedAt: new Date().toISOString(), data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "No se pudieron cargar los pedidos." });
  }
});

homeRouter.get("/api/portal/notas", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  if (!hasPortalCapability(user, "notas", "view")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para ver notas." });
    return;
  }
  const data = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user });
  const visibleIds = data.visible.map((item) => item.rowId);
  const capacitacionNotes = listPortalNotes({ entityType: "capacitacion", entityIds: visibleIds });
  const calendarNotes = data.calendarNotes.map((note) => ({
    id: `calendar:${note.rowId}`,
    entityType: "calendario",
    entityId: note.rowId,
    authorId: note.authorId || "",
    authorName: note.authorName || note.author || "Sin autor registrado",
    authorEmail: note.authorEmail || "",
    body: note.notes || note.title || "",
    createdAt: note.dateRaw || "",
    updatedAt: note.dateRaw || "",
    mentions: note.audienceAll ? ["TODOS"] : (note.employeeKeys || []),
    title: note.title || "Nota",
  }));
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    rows: [...calendarNotes, ...capacitacionNotes]
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || ""))),
  });
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

homeRouter.post("/dashboard/cache/refresh", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }

  try {
    const result = await refreshAppShellCaches({ scope: "portal", runAsUserEmail: user.correo });
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "No se pudo reconciliar la caché.",
    });
  }
});

homeRouter.get("/dashboard/empresas/:empresaId/logo", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const logo = await getEmpresaLogoForPortal(req.params.empresaId);
    if (!logo) {
      res.status(404).end();
      return;
    }
    res.set("Cache-Control", "private, max-age=3600");
    res.type(logo.contentType).send(logo.bytes);
  } catch (error) {
    console.warn("No se pudo cargar el logo de empresa:", error instanceof Error ? error.message : error);
    res.status(404).end();
  }
});

homeRouter.get("/dashboard/territorios/:kind/:territoryId/escudo", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).end();
    return;
  }
  const shield = await getTerritoryShieldForPortal(req.params.kind, req.params.territoryId);
  if (!shield) {
    res.status(404).end();
    return;
  }
  res.set("Cache-Control", "private, max-age=86400");
  res.type(shield.contentType).send(shield.bytes);
});

homeRouter.get("/dashboard/empresas/:empresaId", async (req, res) => {
  setNoStore(res);
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const [employees, dashboardData, sucursales, empresas] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
    listSucursalesForPortal({ runAsUserEmail: user.correo }),
    listEmpresasForPortal(),
  ]);
  const selectedEmpresaId = String(req.params.empresaId || "").trim();
  if (!empresas.some((empresa) => empresa.key === selectedEmpresaId)) {
    res.status(404).type("html").send(renderLoginPage("No encontramos la empresa solicitada."));
    return;
  }

  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    sucursales,
    empresas,
    selectedEmpresaId,
    initialTabId: "sucursales",
    returnPath: `/dashboard/empresas/${encodeURIComponent(selectedEmpresaId)}`,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
});

homeRouter.get("/dashboard", async (req, res) => {
  setNoStore(res);
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }
  if (String(req.query.tab || "").trim().toLowerCase() === "pedidos") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query || {})) {
      if (key === "tab" || value === undefined || value === null) continue;
      const values = Array.isArray(value) ? value : [value];
      values.forEach((item) => query.append(key, String(item)));
    }
    const suffix = query.toString();
    res.redirect(302, `/dashboard/pedidos${suffix ? `?${suffix}` : ""}`);
    return;
  }
  if (!hasPortalCapability(user, "calendario", "view")) {
    rejectCapability(res, "Tu puesto no tiene acceso al portal operativo.");
    return;
  }

  const [employees, dashboardData, sucursales] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
    listSucursalesForPortal({ runAsUserEmail: user.correo }),
  ]);
  const calendarView = normalizeCalendarView(req.query.calendar);
  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    sucursales,
    selectedCapacitacionId: req.query.capacitacion,
    initialTabId: req.query.tab,
    returnPath: "/dashboard",
    calendarView,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
});

homeRouter.get("/dashboard/capacitador/:rowId", async (req, res) => {
  setNoStore(res);
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const [employees, dashboardData, sucursales] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
    listSucursalesForPortal({ runAsUserEmail: user.correo }),
  ]);
  const target = employees.find((item) => item.rowId === String(req.params.rowId || ""));
  if (!target) {
    res.status(404).type("html").send(renderLoginPage("No encontramos el dashboard solicitado."));
    return;
  }

  if (!hasPortalCapability(user, "calendario", "view") || !canAccessEmployeeScope(user, target, "calendario")) {
    res.status(403).type("html").send(renderLoginPage("No tienes permiso para abrir ese dashboard."));
    return;
  }

  const calendarView = normalizeCalendarView(req.query.calendar);
  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    sucursales,
    selectedEmployee: target,
    selectedCapacitacionId: req.query.capacitacion,
    initialTabId: req.query.tab,
    returnPath: `/dashboard/capacitador/${encodeURIComponent(target.rowId)}`,
    calendarView,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
});

homeRouter.get("/dashboard/capacitacion/:rowId", async (req, res) => {
  setNoStore(res);
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  const [employees, dashboardData, sucursales] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
    listSucursalesForPortal({ runAsUserEmail: user.correo }),
  ]);
  const employeeParam = String(req.query.employee || "").trim();
  const targetEmployee = employees.find((item) => item.rowId === employeeParam) || user;
  const returnTo = String(req.query.returnTo || "").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : (targetEmployee.rowId === user.rowId ? "/dashboard" : `/dashboard/capacitador/${encodeURIComponent(targetEmployee.rowId)}`);
  const calendarView = normalizeCalendarView(req.query.calendar);

  if (!hasPortalCapability(user, "capacitaciones", "view") || !canAccessEmployeeScope(user, targetEmployee, "capacitaciones")) {
    res.status(403).type("html").send(renderLoginPage("No tienes permiso para abrir ese detalle."));
    return;
  }

  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    sucursales,
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

  if (!hasPortalCapability(user, "constancias-faltantes", "view") || !canAccessEmployeeScope(user, selectedEmployee, "constancias-faltantes")) {
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
  setNoStore(res);
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }
  if (!canUseGlobalScope(user, "calendario")) {
    res.redirect("/dashboard");
    return;
  }

  const [employees, dashboardData, sucursales] = await Promise.all([
    listEmployeesForPortal({ runAsUserEmail: user.correo }),
    getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user }),
    listSucursalesForPortal({ runAsUserEmail: user.correo }),
  ]);
  const calendarView = normalizeCalendarView(req.query.calendar);
  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    dashboardData,
    sucursales,
    selectedCapacitacionId: req.query.capacitacion,
    returnPath: "/dashboard/general",
    calendarView,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
});

homeRouter.get("/dashboard/pedidos", async (req, res) => {
  setNoStore(res);
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }

  if (!hasPortalCapability(user, "pedidos", "view")) {
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

  if (!hasPortalCapability(user, "pedidos", "view")) {
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
  if (!hasPortalCapability(user, "capacitaciones", "edit")) {
    rejectCapability(res, "No tienes permiso para editar capacitaciones.");
    return;
  }

  const targetRowId = String(req.params.rowId || "").trim();
  const nextStatus = String(req.body?.status || "").trim();
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";

  try {
    if (!canUseGlobalScope(user, "capacitaciones")) {
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
  if (!hasPortalCapability(user, "crear-constancias-por-capacitacion", "edit")) {
    rejectCapability(res, "No tienes permiso para cambiar el estado de diplomas.");
    return;
  }

  const targetRowId = String(req.params.rowId || "").trim();
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";
  const nextValue = String(req.body?.diplomas || "Y").trim().toUpperCase() === "Y";

  try {
    if (!canUseGlobalScope(user, "crear-constancias-por-capacitacion")) {
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
  if (!hasPortalCapability(user, "notas", "create")) {
    rejectCapability(res, "No tienes permiso para agregar notas.");
    return;
  }

  const targetRowId = String(req.params.rowId || "").trim();
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";
  const notas = String(req.body?.notas || "").trim();

  try {
    if (!canUseGlobalScope(user, "capacitaciones")) {
      const { visible } = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user });
      const target = visible.find((item) => item.rowId === targetRowId);
      if (!target) {
        res.status(403).type("html").send(renderLoginPage("No tienes permiso para cambiar esas notas."));
        return;
      }
    }

    const note = createPortalNoteEntry({
      entityType: "capacitacion",
      entityId: targetRowId,
      body: notas,
      author: user,
    });
    if (String(req.headers["x-requested-with"] || "").toLowerCase() === "fetch") {
      res.json({ ok: true, note });
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

homeRouter.post("/dashboard/notas/:noteId/editar", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  if (!hasPortalCapability(user, "notas", "edit")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para editar notas." });
    return;
  }
  const noteId = String(req.params.noteId || "").trim();
  const note = listPortalNotes().find((item) => item.id === noteId);
  if (!note) {
    res.status(404).json({ ok: false, error: "La nota no existe." });
    return;
  }
  const isAuthor = [note.authorId, note.authorEmail]
    .map((value) => String(value || "").trim().toLowerCase())
    .some((value) => value && (value === String(user.rowId || "").trim().toLowerCase()
      || value === String(user.correo || "").trim().toLowerCase()));
  if (!isAuthor && !getUserAccessProfile(user)?.allPermissions) {
    res.status(403).json({ ok: false, error: "Solo el creador puede editar esta nota." });
    return;
  }
  try {
    const updated = updatePortalNoteEntry(noteId, req.body?.notas || req.body?.body || "");
    res.json({ ok: true, note: updated });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "No se pudo editar la nota." });
  }
});

homeRouter.post("/dashboard/notas/:noteId/eliminar", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.status(401).json({ ok: false, error: "No autenticado" });
    return;
  }
  if (!hasPortalCapability(user, "notas", "delete")) {
    res.status(403).json({ ok: false, error: "No tienes permiso para eliminar notas." });
    return;
  }
  const noteId = String(req.params.noteId || "").trim();
  const note = listPortalNotes().find((item) => item.id === noteId);
  if (!note) {
    res.status(404).json({ ok: false, error: "La nota no existe." });
    return;
  }
  const isAuthor = [note.authorId, note.authorEmail]
    .map((value) => String(value || "").trim().toLowerCase())
    .some((value) => value && (value === String(user.rowId || "").trim().toLowerCase()
      || value === String(user.correo || "").trim().toLowerCase()));
  if (!isAuthor && !getUserAccessProfile(user)?.allPermissions) {
    res.status(403).json({ ok: false, error: "Solo el creador puede eliminar esta nota." });
    return;
  }
  try {
    deletePortalNoteEntry(noteId);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "No se pudo eliminar la nota." });
  }
});

homeRouter.post("/dashboard/calendario/notas", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) {
    res.redirect("/login");
    return;
  }
  const noteAction = String(req.body?.rowId || "").trim() ? "edit" : "create";
  if (!hasPortalCapability(user, "notas", noteAction)) {
    rejectCapability(res, `No tienes permiso para ${noteAction === "edit" ? "editar" : "crear"} notas.`);
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
    if (!canMutateGlobalScope(user, "notas") && empleados.length > 0 && !empleados.map((item) => String(item || "").trim()).includes(user.rowId)) {
      res.status(403).type("html").send(renderLoginPage("Solo puedes crear notas etiquetándote a ti mismo o desde un perfil de admin."));
      return;
    }

    if (targetRowId && !canMutateGlobalScope(user, "notas")) {
      const { calendarNotes = [] } = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user });
      const targetNote = calendarNotes.find((note) => String(note?.rowId || "") === targetRowId);
      const authorKeys = [targetNote?.authorId, targetNote?.authorEmail]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      const currentUserKeys = [user.rowId, user.correo]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      if (!targetNote || !authorKeys.some((key) => currentUserKeys.includes(key))) {
        res.status(403).type("html").send(renderLoginPage("Solo el creador puede editar esta nota."));
        return;
      }
    }

    const note = await upsertCalendarNote({
      rowId: targetRowId,
      fecha,
      title: titulo,
      notes: notas,
      icon: icono,
      employees: empleados,
      author: {
        rowId: user.rowId,
        nombre: user.nombre,
        correo: user.correo,
      },
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
  if (!hasPortalCapability(user, "notas", "delete")) {
    rejectCapability(res, "No tienes permiso para eliminar notas.");
    return;
  }

  const targetRowId = String(req.body?.rowId || "").trim();
  const returnTo = String(req.body?.returnTo || "/dashboard").trim();
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";

  try {
    if (!targetRowId) {
      throw new Error("No se pudo identificar la nota a eliminar.");
    }

    const { calendarNotes = [] } = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: user });
    const targetNote = calendarNotes.find((note) => String(note?.rowId || "") === targetRowId);
    if (!targetNote) {
      res.status(404).type("html").send(renderLoginPage("La nota ya no existe o no esta disponible."));
      return;
    }
    const isAuthor = [targetNote.authorId, targetNote.authorEmail]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .some((value) => value === String(user.rowId || "").trim().toLowerCase()
        || value === String(user.correo || "").trim().toLowerCase());
    const canDeleteAny = Boolean(getUserAccessProfile(user)?.allPermissions);
    if (!isAuthor && !canDeleteAny) {
      rejectCapability(res, "Solo el creador de la nota puede eliminarla.");
      return;
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

