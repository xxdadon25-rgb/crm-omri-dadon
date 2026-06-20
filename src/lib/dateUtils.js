/**
 * Shared date formatting utility.
 * All user-facing date displays should use these functions.
 */
import { format, parse, parseISO } from "date-fns";

/**
 * Formats a YYYY-MM-DD date string to DD/MM/YYYY.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const date =
      typeof dateStr === "string"
        ? parse(dateStr, "yyyy-MM-dd", new Date())
        : dateStr;
    return format(date, "dd/MM/yyyy");
  } catch {
    return dateStr;
  }
}

/**
 * Formats a full ISO timestamp (created_date etc.) to DD/MM/YYYY HH:mm.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function formatDateTime(dateStr) {
  if (!dateStr) return "-";
  try {
    // Server returns UTC dates, possibly without timezone indicator.
    // parseISO treats bare ISO strings as local time — force UTC.
    // Check if already has timezone: ends with 'Z' or contains ±HH:MM offset
    const hasTz = typeof dateStr === "string" && /(Z|[+\-]\d{2}:\d{2})$/.test(dateStr.trim());
    const iso = !hasTz ? dateStr.trim() + "Z" : dateStr;
    return format(parseISO(iso), "dd/MM/yyyy HH:mm");
  } catch {
    return dateStr;
  }
}