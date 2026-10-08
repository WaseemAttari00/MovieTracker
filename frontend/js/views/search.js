// Search results with quick "add" buttons.
import { api } from "../api.js";
import { icon } from "../icons.js";
import { emptyHtml, esc, posterHtml, SHOW_STATUS_LABELS, toast, year } from "../ui.js";

const FILTERS = [["all", "All"], ["show", "TV shows"], ["movie", "Movies"]];
const MOVIE_LABELS = { watched: "Watched", watchlist: "Watchlist" };

export async function render(root, { params }) {
  const q = (params.get("q") || "").trim();
  if (!q) {
    root.innerHTML = emptyHtml("Search", "Type the name of a show or movie in the search bar above.");
    return;
  }
  let filter = "all";
  let page = 1;
  const first = await api.get(`/search?q=${encodeURIComponent(q)}`);
  let results = first.results;
  const totalPages = first.total_pages;

  root.addEventListener("click", onClick);
  draw();

  function draw() {
    const visible = results.filter((r) => filter === "all" || r.type === filter);
    const count = (key) => results.filter((r) => key === "all" || r.type === key).length;
    root.innerHTML = `
      <h1 class="page-title">Results for “${esc(q)}”</h1>
      <div class="toolbar">
        <div class="tabs">${FILTERS.map(([key, label]) => `
          <button class="tab ${key === filter ? "active" : ""}" data-action="filter" data-filter="${key}">${label}<span class="n">${count(key)}</span></button>`).join("")}
        </div>
      </div>
      ${visible.length ? `<div class="results">${visible.map(resultHtml).join("")}</div>` : emptyHtml("Nothing found", "Try a different spelling or the original title.")}
      ${page < totalPages ? `<div class="more"><button class="btn" data-action="more">Load more results</button></div>` : ""}`;
  }

  async function onClick(e) {
    const el = e.target.closest("button[data-action]");
    if (!el) return;
    const { action } = el.dataset;
    if (action === "filter") {
      filter = el.dataset.filter;
      draw();
      return;
    }
    el.disabled = true;
    try {
      if (action === "more") {
        const next = await api.get(`/search?q=${encodeURIComponent(q)}&page=${page + 1}`);
        page += 1;
        const seen = new Set(results.map((r) => `${r.type}:${r.id}`));
        results = results.concat(next.results.filter((r) => !seen.has(`${r.type}:${r.id}`)));
      } else if (action === "add") {
        const item = results.find((r) => r.type === el.dataset.type && r.id === Number(el.dataset.id));
        const status = el.dataset.status;
        el.textContent = "Adding…";
        await api.post(`/${item.type === "show" ? "shows" : "movies"}/${item.id}`, { user_status: status });
        item.user_status = status;
        const label = item.type === "show" ? SHOW_STATUS_LABELS[status] : MOVIE_LABELS[status];
        toast(`Added “${item.title}” to ${label}`);
      }
      draw();
    } catch (err) {
      el.disabled = false;
      toast(err.message, { type: "error" });
    }
  }
}

function resultHtml(r) {
  const href = r.type === "show" ? `#/show/${r.id}` : `#/movie/${r.id}`;
  const data = `data-action="add" data-type="${r.type}" data-id="${r.id}"`;
  let actions;
  if (r.user_status) {
    const label = r.type === "show" ? SHOW_STATUS_LABELS[r.user_status] : MOVIE_LABELS[r.user_status];
    actions = `<span class="badge badge-success">${icon("check", 12)} ${label}</span>`;
  } else if (r.type === "show") {
    actions = `
      <button class="btn btn-sm btn-primary" ${data} data-status="watching">${icon("plus", 15)} Watching</button>
      <button class="btn btn-sm" ${data} data-status="watchlist">${icon("bookmark", 15)} Watchlist</button>`;
  } else {
    actions = `
      <button class="btn btn-sm btn-primary" ${data} data-status="watched">${icon("check", 15)} Watched</button>
      <button class="btn btn-sm" ${data} data-status="watchlist">${icon("bookmark", 15)} Watchlist</button>`;
  }
  return `
    <article class="result">
      <a href="${href}">${posterHtml(r.poster_path, r.title, { size: "w185" })}</a>
      <div class="result-body">
        <a class="result-title" href="${href}">${esc(r.title)} <span class="muted">${year(r.date)}</span></a>
        <div><span class="badge">${r.type === "show" ? "TV" : "Movie"}</span></div>
        <p class="result-overview">${esc(r.overview || "")}</p>
        <div class="result-actions">${actions}</div>
      </div>
    </article>`;
}
