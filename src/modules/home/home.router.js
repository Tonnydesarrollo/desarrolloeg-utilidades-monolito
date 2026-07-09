import crypto from "crypto";
import express from "express";
import {
  buildClearOAuthStateCookieHeader,
  buildClearCookieHeader,
  buildGoogleAuthUrl,
  buildCookieHeader,
  authenticateEmployeeByEmail,
  createSessionForEmployee,
  exchangeGoogleAuthCode,
  getCapacitacionesDashboardData,
  buildCalendarNoteEvent,
  getEmployeeSummary,
  getRouteCardsForRole,
  getOAuthStateCookieName,
  isGoogleOAuthConfigured,
  isRequestSecure,
  listEmployeesForPortal,
  loadAuthenticatedEmployee,
  deleteCalendarNote,
  upsertCalendarNote,
  updateCapacitacionDiplomas,
  updateCapacitacionStatus,
  updateCapacitacionNotas,
} from "./portalAuth.service.js";
import { getFaltantesLeyData } from "../faltantes-ley/faltantesLey.service.js";
import { renderPedidosSinLiberacionPage } from "../pedidos-ley/pedidosLey.page.js";

export const homeRouter = express.Router();

const HOME_FAVICON_PATH = "/img/Logo%20sin%20fondo%203D%20HD.png";

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

function renderEmployeeCard(employee, basePath = "/dashboard/capacitador") {
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
        <span class="employee-link">Abrir dashboard</span>
      </div>
    </a>
  `;
}

function renderRouteGrid(cards, options = {}) {
  return cards.map((card) => renderCard(card, options)).join("\n");
}

function renderEmployeeGrid(employees, basePath = "/dashboard/capacitador") {
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
  returnTo = "/dashboard",
  canEditNotes = false,
  action = "/dashboard/calendario/notas",
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
      <input type="hidden" name="returnTo" value="${escapeAttr(returnTo || "/dashboard")}" />
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
  const safePath = String(path || "/dashboard").trim() || "/dashboard";
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
  return qs ? `/dashboard/capacitacion/${encodeURIComponent(rowId)}?${qs}` : `/dashboard/capacitacion/${encodeURIComponent(rowId)}`;
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
  returnTo = "/dashboard",
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
          action: "/dashboard/calendario/notas",
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
            action: "/dashboard/calendario/notas",
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

function renderCapacitacionDetailsPanel(capacitacion, { returnPath = "/dashboard", canEditStatus = false, canEditDiplomas = false } = {}) {
  if (!capacitacion) return "";

  const backHref = escapeAttr(returnPath || "/dashboard");
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
      .hero {
        overflow: hidden;
        position: relative;
        border-radius: 32px;
        background: linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96));
        color: var(--ink);
        padding: 28px;
        box-shadow: var(--shadow);
        border: 1px solid rgba(26, 42, 58, 0.10);
        border-top: 6px solid var(--crimson);
      }
      .hero::after {
        content: "";
        position: absolute;
        inset: auto -2% -32% auto;
        width: 340px;
        height: 340px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(192, 57, 43, 0.12), transparent 70%);
        pointer-events: none;
      }
      .hero-grid {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.9fr);
        gap: 22px;
        align-items: start;
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
        margin: 14px 0 0;
        font-size: clamp(2.1rem, 4.4vw, 3.7rem);
        line-height: 0.95;
        letter-spacing: -0.03em;
        font-family: "Cinzel", serif;
        text-transform: uppercase;
      }
      .hero p {
        margin: 14px 0 0;
        max-width: 760px;
        color: var(--muted);
        line-height: 1.55;
        font-family: "Montserrat", sans-serif;
      }
      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 22px;
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
        gap: 12px;
      }
      .hero-callout, .hero-note {
        border-radius: 22px;
        padding: 18px;
        background: #ffffff;
        border: 1px solid rgba(26,42,58,0.10);
        box-shadow: 0 10px 24px rgba(26,42,58,0.05);
      }
      .hero-logo {
        display: block;
        max-width: 170px;
        width: min(170px, 54vw);
        height: auto;
        margin: 0 auto 14px;
        object-fit: contain;
        filter: drop-shadow(0 12px 24px rgba(0,0,0,0.16));
      }
      .hero-callout h2, .section-head h2 {
        margin: 0;
        letter-spacing: -0.03em;
        font-family: "Cinzel", serif;
      }
      .hero-callout p, .hero-note p {
        margin: 10px 0 0;
        color: var(--muted);
        line-height: 1.5;
        font-family: "Montserrat", sans-serif;
      }
      .hero-note strong {
        display: block;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--crimson);
        font-family: "Montserrat", sans-serif;
      }
      .hero-note p {
        margin-top: 8px;
        font-size: 0.94rem;
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
        margin-top: 26px;
        display: grid;
        gap: 18px;
      }
      .dashboard-tabs-nav {
        position: sticky;
        top: 14px;
        z-index: 18;
        display: flex;
        gap: 8px;
        padding: 8px;
        margin: 0;
        border-radius: 24px;
        border: 1px solid rgba(26,42,58,0.10);
        background: rgba(247, 249, 251, 0.92);
        backdrop-filter: blur(18px);
        box-shadow: 0 14px 28px rgba(26,42,58,0.08);
        overflow-x: auto;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
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
        padding: 11px 16px;
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
        background: #fff;
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
      .dashboard-tab-panel-content {
        display: grid;
        gap: 20px;
      }
      .dashboard-tab-panel--management .portal-grid {
        gap: 20px;
      }
      .dashboard-tab-panel--management .panel + .panel {
        margin-top: 0;
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 28px;
        padding: 22px;
        box-shadow: var(--shadow);
        border-top: 5px solid var(--crimson);
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
        padding: 24px 18px;
      }
      .auth-card {
        width: min(980px, 100%);
        background: rgba(255,255,255,0.98);
        border: 1px solid rgba(26,42,58,0.10);
        border-radius: 32px;
        overflow: hidden;
        box-shadow: var(--shadow);
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
      }
      .auth-visual {
        padding: 34px;
        background: linear-gradient(160deg, var(--navy) 0%, #20364a 55%, #111e29 100%);
        color: #f8fbff;
        border-right: 6px solid var(--crimson);
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        text-align: center;
      }
      .auth-brand {
        display: grid;
        gap: 14px;
        justify-items: center;
        max-width: 360px;
      }
      .auth-logo {
        width: min(260px, 68vw);
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
        font-size: clamp(1.3rem, 2.8vw, 1.9rem);
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
        padding: 34px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .auth-form h2 {
        margin: 0;
        color: var(--navy);
        font-family: "Cinzel", serif;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: clamp(1.25rem, 2.2vw, 1.7rem);
      }
      .field {
        display: grid;
        gap: 10px;
        margin-top: 26px;
      }
      .field label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 900;
        color: var(--crimson);
        font-family: "Montserrat", sans-serif;
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
        margin-top: 14px;
        font-weight: 800;
        font-family: "Montserrat", sans-serif;
      }
      .message.error { color: #b91c1c; }
      .message.ok { color: #166534; }
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
      .page-loader-spinner {
        width: 52px;
        height: 52px;
        border-radius: 999px;
        border: 4px solid rgba(198, 59, 34, 0.14);
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
        .hero, .panel, .auth-form, .auth-visual { padding: 18px; border-radius: 22px; }
        .hero::after {
          width: 220px;
          height: 220px;
          inset: auto -28px -86px auto;
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
        .dashboard-tabs-nav {
          display: none;
        }
        .dashboard-mobile-bar {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          padding: 10px;
          border-radius: 22px;
          background: rgba(247, 249, 251, 0.96);
          border: 1px solid rgba(26,42,58,0.12);
          box-shadow: 0 16px 34px rgba(26,42,58,0.16);
          backdrop-filter: blur(18px);
          overflow: hidden;
        }
        .dashboard-mobile-chip {
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          width: 100%;
          min-width: 0;
          min-height: 54px;
          padding: 0 14px;
          border-radius: 18px;
          border: 1px solid rgba(26,42,58,0.12);
          background: rgba(255,255,255,0.88);
          color: var(--ink);
          font: inherit;
          font-weight: 900;
          cursor: pointer;
        }
        .dashboard-mobile-chip.active {
          background: rgba(192,57,43,0.10);
          color: var(--crimson);
          border-color: rgba(192,57,43,0.20);
        }
        .dashboard-mobile-chip-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.84rem;
        }
        .dashboard-mobile-chip-count {
          flex: 0 0 auto;
          min-width: 1.7rem;
          height: 1.7rem;
          padding: 0 0.4rem;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(26,42,58,0.08);
          font-size: 0.76rem;
          font-weight: 900;
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

function renderLayout({ title, heroTitle, heroIntro, primaryAction, secondaryAction, sideContent, bodyContent, footer, headExtra = "", bodyScripts = "" }) {
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
    <div class="page-loader" id="page-loader" aria-hidden="true">
      <div class="page-loader-card" role="status" aria-live="polite" aria-label="Cargando">
        <div class="page-loader-spinner" aria-hidden="true"></div>
        <p class="page-loader-text">Cargando Desarrollo EG</p>
      </div>
    </div>
    <main>
      <section class="hero">
        <div class="hero-grid">
          <div>
            <span class="eyebrow">Desarrollo EG</span>
            <h1>${escapeHtml(heroTitle)}</h1>
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
    ${bodyScripts || ""}
  </body>
  </html>`;
}

function renderLoginPage(errorMessage = "") {
  const errorHtml = errorMessage ? `<div class="message error" id="message">${escapeHtml(errorMessage)}</div>` : `<div class="message" id="message"></div>`;
  const logoPath = "/img/Logo%20sin%20fondo%203D%20HD.png";
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
    <div class="auth-shell">
      <div class="auth-card">
        <section class="auth-visual">
          <div class="auth-brand">
            <span class="auth-pill">Portal de acceso</span>
            <img class="auth-logo" src="${logoPath}" alt="Desarrollo EG" />
            <h1>Desarrollo EG</h1>
          </div>
        </section>
        <section class="auth-form">
          <h2>Acceso</h2>
          <div class="field">
            <label>Acceso con Google</label>
            <a class="submit-btn" href="/auth/google/start" style="text-decoration:none;text-align:center;display:inline-flex;justify-content:center;align-items:center;">Continuar con Google</a>
          </div>
          ${errorHtml}
        </section>
      </div>
    </div>
  </body>
  </html>`;
}

async function renderDashboardPage({
  user,
  employees,
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
  const title = role === "admin" ? "Dashboard general" : "Dashboard personal";
  const logoPath = "/img/Logo%20sin%20fondo%203D%20HD.png";
  const viewingOtherDashboard = user?.role === "admin" && user?.rowId !== selected.rowId;
  const capacitadorView = role === "capacitador";
  const { visible, programadas, finalizadasSinDiplomas, birthdayEvents, calendarCapacitaciones, calendarNotes } = await getCapacitacionesDashboardData({ viewer: user, selectedEmployee: selected });
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

  const sideContent = `
    <div class="hero-callout">
      <img class="hero-logo" src="${logoPath}" alt="Desarrollo EG" />
      <span class="eyebrow">Sesión</span>
      <h2>${escapeHtml(selected.nombre || "Usuario")}</h2>
    </div>
    <div class="hero-note">
      <strong>${escapeHtml(role)}</strong>
      <p>${escapeHtml(selected.correo || "")}</p>
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
      <div class="panel">
        <div class="portal-grid">
          ${renderRouteGrid(routeCards, { minimal: true })}
        </div>
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
  const dashboardTabs = [
    {
      id: "calendar",
      label: "Calendario",
      count: calendarEventCount,
      content: calendarPanel,
    },
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
    ...(adminFaltantesPanel
      ? [{
          id: "faltantes",
          label: "Faltantes",
          content: adminFaltantesPanel,
        }]
      : []),
    ...(managementPanel
      ? [{
          id: "gestion",
          label: "Gestión",
          content: managementPanel,
        }]
      : []),
  ].filter((tab) => Boolean(tab.content));
  const activeTabId = dashboardTabs[0]?.id || "calendar";
  const dashboardTabsNav = dashboardTabs.map((tab) => `
    <button
      type="button"
      class="dashboard-tab-btn${tab.id === activeTabId ? " active" : ""}"
      role="tab"
      aria-selected="${tab.id === activeTabId ? "true" : "false"}"
      aria-controls="dashboard-tab-${tab.id}"
      data-dashboard-tab="${escapeAttr(tab.id)}"
    >
      <span class="dashboard-tab-label">${escapeHtml(tab.label)}</span>
      ${typeof tab.count === "number" ? `<span class="dashboard-tab-count">${escapeHtml(String(tab.count))}</span>` : ""}
    </button>
  `).join("");
  const dashboardMobileBar = `
    <div class="dashboard-mobile-bar" aria-label="Navegación rápida del dashboard">
      ${dashboardTabs.map((tab) => `
        <button
          type="button"
          class="dashboard-mobile-chip${tab.id === activeTabId ? " active" : ""}"
          data-dashboard-tab="${escapeAttr(tab.id)}"
          aria-pressed="${tab.id === activeTabId ? "true" : "false"}"
        >
          <span class="dashboard-mobile-chip-label">${escapeHtml(tab.label)}</span>
          ${typeof tab.count === "number" ? `<span class="dashboard-mobile-chip-count">${escapeHtml(String(tab.count))}</span>` : ""}
        </button>
      `).join("")}
    </div>
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
  const headerAction = `<a class="button primary" href="/api/auth/logout">Cerrar sesión</a>`;
  const headerAction2 = user?.role === "admin"
    ? (viewingOtherDashboard
      ? `<a class="button ghost" href="/dashboard/general">Volver a mi dashboard</a>`
      : `<a class="button ghost" href="/dashboard">Recargar</a>`)
    : "";
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
              const response = await fetch("/dashboard/calendario/notas/eliminar", {
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
    heroTitle: role === "admin" ? "Dashboard general" : "Dashboard personal",
    heroIntro: "",
    primaryAction: headerAction,
    secondaryAction: headerAction2,
    sideContent,
    headExtra: "",
    bodyContent: `
      <section class="dashboard-tabs" data-dashboard-tabs>
        <div class="dashboard-tabs-nav" role="tablist" aria-label="Secciones del dashboard">
          ${dashboardTabsNav}
        </div>
        ${dashboardTabPanels}
      </section>
      ${dashboardMobileBar}
    `,
    bodyScripts: calendarBootstrap,
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

  res.type("html").send(renderLoginPage());
});

homeRouter.get("/login", async (req, res) => {
  const user = await loadAuthenticatedEmployee(req);
  if (user) {
    res.redirect("/dashboard");
    return;
  }

  res.type("html").send(renderLoginPage());
});

homeRouter.get("/auth/google/start", async (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    res.status(503).type("html").send(renderLoginPage("Google OAuth no esta configurado en este entorno."));
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  const secure = isRequestSecure(req);
  res.setHeader("Set-Cookie", `${getOAuthStateCookieName()}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`);
  res.redirect(buildGoogleAuthUrl(state));
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
    const profile = await exchangeGoogleAuthCode(code);
    const employee = await authenticateEmployeeByEmail(profile.email);
    const token = await createSessionForEmployee(employee);
    res.setHeader("Set-Cookie", [
      buildCookieHeader(token, { secure }),
      buildClearOAuthStateCookieHeader({ secure }),
    ]);
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

  const employees = await listEmployeesForPortal({ runAsUserEmail: user.correo });
  const calendarView = normalizeCalendarView(req.query.calendar);
  res.type("html").send(await renderDashboardPage({
    user,
    employees,
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

  const employees = await listEmployeesForPortal({ runAsUserEmail: user.correo });
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

  const employees = await listEmployeesForPortal({ runAsUserEmail: user.correo });
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

  const employees = await listEmployeesForPortal({ runAsUserEmail: user.correo });
  const calendarView = normalizeCalendarView(req.query.calendar);
  res.type("html").send(await renderDashboardPage({
    user,
    employees,
    returnPath: "/dashboard/general",
    calendarView,
    calendarPath: req.path,
    calendarQuery: req.query,
  }));
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

