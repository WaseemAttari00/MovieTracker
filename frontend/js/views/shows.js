// "My shows" library grid.
import { api } from "../api.js";
import { emptyHtml, esc, fmtDate, posterHtml, relSoon, SHOW_STATUS_LABELS } from "../ui.js";

const TABS = [...Object.entries(SHOW_STATUS_LABELS), ["all", "All"]];

const SORTS = {
  recent: ["Recently watched", (a, b) => (b.last_watched_at || b.added_at).localeCompare(a.last_watched_at || a.added_at)],
  added: ["Recently added", (a, b) => b.added_at.localeCompare(a.added_at)],
  title: ["Title", (a, b) => a.name.localeCompare(b.name)],
  left: ["Most episodes left", (a, b) => b.progress.remaining - a.progress.remaining],
};

export async function render(root, { params }) {
  const tab = TABS.some(([key]) => key === params.get("tab")) ? params.get("tab") : "watching";
  const sort = SORTS[params.get("sort")] ? params.get("sort") : "recent";
  const shows = await api.get("/shows");

  const counts = { all: shows.length };
  for (const s of shows) counts[s.user_status] = (counts[s.user_status] || 0) + 1;
  const list = shows.filter((s) => tab === "all" || s.user_status === tab).sort(SORTS[sort][1]);

  root.innerHTML = `
    <h1 class="page-title">My shows</h1>
    <div class="toolbar">
      <div class="tabs">${TABS.map(([key, label]) => `
        <a class="tab ${key === tab ? "active" : ""}" href="#/shows?tab=${key}&sort=${sort}">${label}<span class="n">${counts[key] || 0}</span></a>`).join("")}
      </div>
      <select class="select" id="sort" aria-label="Sort by">${Object.entries(SORTS).map(([key, [label]]) => `
        <option value="${key}" ${key === sort ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </div>
    ${list.length
      ? `<div class="poster-grid">${list.map(cardHtml).join("")}</div>`
      : emptyHtml("No shows here yet", shows.length ? "Shows you move to this list will appear here." : "Use the search bar to find and add shows.")}`;

  root.querySelector("#sort").addEventListener("change", (e) => {
    location.replace(`#/shows?tab=${tab}&sort=${e.target.value}`);
  });
}

function cardHtml(show) {
  const p = show.progress;
  let sub;
  if (!p.aired) {
    sub = show.first_air_date ? `Premieres ${fmtDate(show.first_air_date)}` : "Not aired yet";
  } else if (p.remaining) {
    sub = `${p.watched}/${p.aired} watched · ${p.remaining} left`;
  } else if (show.upcoming) {
    const date = show.upcoming.air_date;
    sub = `Up to date · next ${relSoon(date) || fmtDate(date)}`;
  } else {
    sub = show.user_status === "completed" ? "Completed" : `Up to date · ${p.watched}/${p.aired}`;
  }
  const badge = show.user_status === "watching" && p.remaining ? `<span class="badge badge-accent">${p.remaining}</span>` : "";
  return `
    <a class="poster-card" href="#/show/${show.id}">
      ${posterHtml(show.poster_path, show.name, { badge })}
      <div class="pc-title">${esc(show.name)}</div>
      <div class="pc-sub">${sub}</div>
      ${p.aired ? `<div class="progress"><span style="width:${p.percent}%"></span></div>` : ""}
    </a>`;
}
