// Search results with quick "add" buttons.
import { api } from "../api.js";
import { addToLibrary, emptyHtml, esc, mediaCardHtml, toast } from "../ui.js";

const FILTERS = [["all", "All"], ["show", "TV shows"], ["movie", "Movies"]];

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
      ${visible.length
        ? `<div class="results">${visible.map((r) => mediaCardHtml(r)).join("")}</div>`
        : emptyHtml("Nothing found", "Try a different spelling or the original title.")}
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
        el.textContent = "Adding…";
        await addToLibrary(item, el.dataset.status);
      }
      draw();
    } catch (err) {
      el.disabled = false;
      toast(err.message, { type: "error" });
    }
  }
}
