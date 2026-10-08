// Shared formatting and rendering helpers.
import { icon } from "./icons.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const SHOW_STATUS_LABELS = {
  watching: "Watching",
  watchlist: "Watchlist",
  paused: "Paused",
  completed: "Completed",
  dropped: "Dropped",
};

export const tmdbImg = (path, size = "w342") => (path ? `https://image.tmdb.org/t/p/${size}${path}` : "");

export function posterHtml(path, title, { size = "w342", badge = "" } = {}) {
  const inner = path
    ? `<img src="${tmdbImg(path, size)}" alt="" loading="lazy">`
    : `<div class="poster-ph">${esc(title)}</div>`;
  return `<div class="poster">${inner}${badge}</div>`;
}

export const thumbHtml = (path) =>
  path ? `<img class="thumb" src="${tmdbImg(path, "w92")}" alt="" loading="lazy">` : `<div class="thumb"></div>`;

export const pad = (n) => String(n).padStart(2, "0");
export const epCode = (season, episode) => `S${pad(season)}E${pad(episode)}`;
export const year = (iso) => (iso ? iso.slice(0, 4) : "");

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "YYYY-MM-DD" (or a full timestamp) -> local Date at midnight
export function parseDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDate(iso, options = { month: "short", day: "numeric", year: "numeric" }) {
  return iso ? parseDate(iso).toLocaleDateString(undefined, options) : "";
}

export function daysFromToday(iso) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parseDate(iso) - today) / 86400000);
}

export function relDay(iso) {
  const n = daysFromToday(iso);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 1 && n < 14) return `in ${n} days`;
  if (n >= 14 && n < 60) return `in ${Math.round(n / 7)} weeks`;
  if (n < -1 && n > -14) return `${-n} days ago`;
  return fmtDate(iso);
}

// "today", "in 3 days", "in 2 weeks"... or "" when the date is too far away for that to read well
export function relSoon(iso) {
  const n = daysFromToday(iso);
  return n > -14 && n < 60 ? relDay(iso).toLowerCase() : "";
}

// Countdown to a show's next confirmed air date, e.g. "4 days remaining for S04E03".
// `coming` is the API's {date, season, episode}; returns "" when there's no date to count down to.
export function countdownHtml(coming) {
  if (!coming?.date) return "";
  const days = daysFromToday(coming.date);
  if (days < 0) return "";
  const what = coming.episode ? epCode(coming.season, coming.episode) : `Season ${coming.season}`;
  const text = days === 0 ? `${what} airs today` : `${plural(days, "day")} remaining for ${what}`;
  return `<div class="countdown">${icon("clock", 13)}<span>${text}</span></div>`;
}

export function timeAgo(timestamp) {
  const seconds = (Date.now() - new Date(timestamp).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return fmtDate(timestamp);
}

export function fmtDuration(minutes) {
  if (!minutes) return "0h";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function airStatusBadge(status) {
  const known = {
    "Returning Series": ["Returning", "badge-success"],
    "In Production": ["In production", "badge-accent"],
    Planned: ["Planned", "badge-accent"],
    Ended: ["Ended", ""],
    Canceled: ["Canceled", "badge-danger"],
  };
  if (!status) return "";
  const [label, cls] = known[status] || [status, ""];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export const loadingHtml = () => `<div class="loading"><div class="spinner"></div></div>`;

export const emptyHtml = (title, text, extra = "") =>
  `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${extra}</div>`;

export function toast(message, { type = "info", action, duration = 4000 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.addEventListener("click", () => {
      el.remove();
      action.onClick();
    });
    el.append(button);
  }
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), action ? duration + 3000 : duration);
}
