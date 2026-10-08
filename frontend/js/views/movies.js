// "My movies": watched list and watchlist.
import { api } from "../api.js";
import { icon } from "../icons.js";
import { daysFromToday, emptyHtml, esc, fmtDate, posterHtml, year } from "../ui.js";

const TABS = [["watched", "Watched"], ["watchlist", "Watchlist"]];

const SORTS = {
  date: ["Date", (a, b) => (b.watched_at || b.added_at).localeCompare(a.watched_at || a.added_at)],
  title: ["Title", (a, b) => a.title.localeCompare(b.title)],
  rating: ["Your rating", (a, b) => (b.rating || 0) - (a.rating || 0)],
  release: ["Release date", (a, b) => (b.release_date || "").localeCompare(a.release_date || "")],
};

export async function render(root, { params }) {
  const tab = params.get("tab") === "watchlist" ? "watchlist" : "watched";
  const sort = SORTS[params.get("sort")] ? params.get("sort") : "date";
  const movies = await api.get("/movies");
  const list = movies.filter((m) => m.user_status === tab).sort(SORTS[sort][1]);
  const count = (key) => movies.filter((m) => m.user_status === key).length;

  root.innerHTML = `
    <h1 class="page-title">My movies</h1>
    <div class="toolbar">
      <div class="tabs">${TABS.map(([key, label]) => `
        <a class="tab ${key === tab ? "active" : ""}" href="#/movies?tab=${key}&sort=${sort}">${label}<span class="n">${count(key)}</span></a>`).join("")}
      </div>
      <select class="select" id="sort" aria-label="Sort by">${Object.entries(SORTS).map(([key, [label]]) => `
        <option value="${key}" ${key === sort ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </div>
    ${list.length
      ? `<div class="poster-grid">${list.map(cardHtml).join("")}</div>`
      : emptyHtml(
          tab === "watched" ? "No watched movies yet" : "Your watchlist is empty",
          "Search for a movie and mark it as watched or add it to your watchlist.",
        )}`;

  root.querySelector("#sort").addEventListener("change", (e) => {
    location.replace(`#/movies?tab=${tab}&sort=${e.target.value}`);
  });
}

function cardHtml(movie) {
  let sub, badge = "";
  if (movie.user_status === "watched") {
    sub = movie.watched_at ? `Watched ${fmtDate(movie.watched_at)}` : "Watched";
    if (movie.rating) badge = `<span class="badge badge-accent">${icon("star", 11, "filled-dark")} ${movie.rating}</span>`;
  } else if (movie.release_date && daysFromToday(movie.release_date) > 0) {
    sub = `Out ${fmtDate(movie.release_date)}`;
    badge = `<span class="badge">Soon</span>`;
  } else {
    sub = year(movie.release_date) || "Release date unknown";
  }
  return `
    <a class="poster-card" href="#/movie/${movie.id}">
      ${posterHtml(movie.poster_path, movie.title, { badge })}
      <div class="pc-title">${esc(movie.title)}</div>
      <div class="pc-sub">${sub}</div>
    </a>`;
}
