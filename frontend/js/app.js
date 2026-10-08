// App shell: navigation, routing, search box and background refresh.
import { icon } from "./icons.js";
import { esc, loadingHtml, toast } from "./ui.js";
import { onSynced, runSync } from "./sync.js";
import * as home from "./views/home.js";
import * as shows from "./views/shows.js";
import * as show from "./views/show.js";
import * as movies from "./views/movies.js";
import * as movie from "./views/movie.js";
import * as search from "./views/search.js";
import * as settings from "./views/settings.js";

const ROUTES = [
  [/^\/$/, home],
  [/^\/shows$/, shows],
  [/^\/show\/(\d+)$/, show],
  [/^\/movies$/, movies],
  [/^\/movie\/(\d+)$/, movie],
  [/^\/search$/, search],
  [/^\/settings$/, settings],
];

const NAV = [
  ["#/", "home", "Home", (path) => path === "/"],
  ["#/shows", "tv", "Shows", (path) => /^\/shows?(\/|$)/.test(path)],
  ["#/movies", "film", "Movies", (path) => /^\/movies?(\/|$)/.test(path)],
  ["#/settings", "sliders", "Settings", (path) => path === "/settings"],
];

const viewEl = document.getElementById("view");
const navEl = document.getElementById("nav");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");

navEl.innerHTML = NAV.map(([href, ic, label]) => `<a href="${href}">${icon(ic, 20)}<span>${label}</span></a>`).join("");
document.getElementById("search-icon").outerHTML = icon("search", 18);

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

function errorHtml(err) {
  const button = err.status === 400
    ? `<a class="btn btn-primary" href="#/settings">Open settings</a>`
    : `<button class="btn" onclick="location.reload()">Try again</button>`;
  return `<div class="empty"><h3>Something went wrong</h3><p>${esc(err.message)}</p>${button}</div>`;
}

// `refresh` re-renders the current page in the background and swaps it in when ready (no spinner, no scroll jump).
async function router({ refresh = false } = {}) {
  const { path, params } = parseHash();
  const route = ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) {
    location.replace("#/");
    return;
  }
  const [pattern, view] = route;
  const id = path.match(pattern)[1];

  navEl.querySelectorAll("a").forEach((a, i) => a.classList.toggle("active", NAV[i][3](path)));
  if (document.activeElement !== searchInput) searchInput.value = path === "/search" ? params.get("q") || "" : "";

  const root = document.createElement("div");
  root.className = "view";
  if (!refresh) {
    root.innerHTML = loadingHtml();
    viewEl.replaceChildren(root);
    window.scrollTo(0, 0);
  }
  try {
    await view.render(root, { id: id ? Number(id) : null, params });
    if (refresh && parseHash().path === path) viewEl.replaceChildren(root);
  } catch (err) {
    console.error(err);
    if (!refresh) root.innerHTML = errorHtml(err);
  }
}

// --- search box ---
let searchTimer;
function goSearch() {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) return;
  const target = `#/search?q=${encodeURIComponent(q)}`;
  if (location.hash === target) return;
  if (parseHash().path === "/search") location.replace(target);
  else location.hash = target;
}
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(goSearch, 400);
});
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  goSearch();
});
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (e.key === "Escape" && document.activeElement === searchInput) {
    searchInput.blur();
  }
});

// --- background refresh ---
onSynced((result) => {
  if (result.errors?.length && !result.shows && !result.movies) {
    toast(`Couldn't check for updates: ${result.errors[0]}`, { type: "error" });
  }
  if ((result.shows || result.movies) && parseHash().path === "/") router({ refresh: true });
});

function backgroundSync() {
  runSync().catch((err) => {
    if (err.status !== 400) toast(`Couldn't check for updates: ${err.message}`, { type: "error" });
  });
}

window.addEventListener("hashchange", () => router());
router();
backgroundSync();
setInterval(backgroundSync, 60 * 60 * 1000);
