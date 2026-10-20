// "For you": show and movie recommendations based on your watch history.
import { api } from "../api.js";
import { icon } from "../icons.js";
import { addToLibrary, emptyHtml, esc, loadingHtml, mediaCardHtml, timeAgo, toast } from "../ui.js";

const FILTERS = [["all", "All"], ["show", "TV shows"], ["movie", "Movies"]];

export async function render(root, { params }) {
  let data = await api.get("/recommendations");
  let filter = FILTERS.some(([key]) => key === params.get("type")) ? params.get("type") : "all";
  let building = false;

  root.addEventListener("click", onClick);
  draw();
  if (data.stale) refresh();  // show what we have right away, update in the background

  async function refresh() {
    building = true;
    draw();
    try {
      data = await api.post("/recommendations/refresh");
    } catch (err) {
      toast(`Couldn't update recommendations: ${err.message}`, { type: "error" });
    }
    building = false;
    draw();
  }

  function draw() {
    const items = data.items.filter((r) => filter === "all" || r.type === filter);
    const count = (key) => data.items.filter((r) => key === "all" || r.type === key).length;
    let status = "";
    if (building) status = `<span class="building"><span class="spinner"></span> Updating…</span>`;
    else if (data.built_at) status = `Updated ${timeAgo(data.built_at)}`;

    let body;
    if (!data.has_seeds) {
      body = emptyHtml("Nothing to go on yet",
        "Add the shows you watch and mark (and rate) movies you've seen. Recommendations will show up here.");
    } else if (!data.items.length) {
      body = building
        ? `${loadingHtml()}<p class="muted center">Looking for shows and movies you might like…</p>`
        : emptyHtml("No recommendations right now", "Try again later, or track a few more shows and movies.");
    } else {
      body = `
        <div class="toolbar">
          <div class="tabs">${FILTERS.map(([key, label]) => `
            <button class="tab ${key === filter ? "active" : ""}" data-action="filter" data-filter="${key}">${label}<span class="n">${count(key)}</span></button>`).join("")}
          </div>
        </div>
        ${items.length
          ? `<div class="results">${items.map((r) => mediaCardHtml(r, { extra: becauseHtml(r.because), dismissible: true })).join("")}</div>`
          : emptyHtml("Nothing here", "No recommendations of this type right now.")}`;
    }

    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">For you</h1>
          <p class="muted">Based on what you've watched and how you rated it. ${status}</p>
        </div>
        ${data.has_seeds ? `<button class="btn" data-action="refresh" ${building ? "disabled" : ""}>${icon("refresh", 16)} Refresh</button>` : ""}
      </div>
      ${body}`;
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
    if (action === "refresh") {
      refresh();
      return;
    }
    const item = data.items.find((r) => r.type === el.dataset.type && r.id === Number(el.dataset.id));
    el.disabled = true;
    try {
      if (action === "add") {
        el.textContent = "Adding…";
        await addToLibrary(item, el.dataset.status);
      } else if (action === "dismiss") {
        const body = { type: item.type, id: item.id };
        await api.post("/recommendations/dismiss", body);
        const index = data.items.indexOf(item);
        data.items.splice(index, 1);
        toast(`You won't see “${item.title}” here again`, {
          action: {
            label: "Undo",
            onClick: async () => {
              await api.post("/recommendations/dismiss", { ...body, dismissed: false });
              data.items.splice(index, 0, item);
              draw();
            },
          },
        });
      }
      draw();
    } catch (err) {
      el.disabled = false;
      toast(err.message, { type: "error" });
    }
  }
}

function becauseHtml(titles) {
  if (!titles?.length) return "";
  const names = titles.map((t) => `<b>${esc(t)}</b>`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `<div class="because">Because you watched ${list}</div>`;
}
