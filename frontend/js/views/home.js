// Home: what's new, continue watching, coming soon.
import { api } from "../api.js";
import { icon } from "../icons.js";
import {
  daysFromToday, emptyHtml, epCode, esc, fmtDuration, parseDate, relDay, thumbHtml, timeAgo, tmdbImg, toast,
} from "../ui.js";

export async function render(root) {
  root.addEventListener("click", onClick);
  await draw();

  async function draw() {
    const data = await api.get("/dashboard");
    if (!data.has_api_key) root.innerHTML = onboardingHtml();
    else if (data.library_empty) root.innerHTML = welcomeHtml();
    else root.innerHTML = dashboardHtml(data);
  }

  async function onClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action } = btn.dataset;
    try {
      if (action === "watch") {
        const { show, season, episode } = btn.dataset;
        const body = { action: "episode", season: Number(season), episode: Number(episode) };
        btn.disabled = true;
        await api.post(`/shows/${show}/watch`, { ...body, watched: true });
        toast(`Marked ${epCode(season, episode)} as watched`, {
          action: {
            label: "Undo",
            onClick: () => api.post(`/shows/${show}/watch`, { ...body, watched: false }).then(draw),
          },
        });
        await draw();
      } else if (action === "dismiss") {
        await api.post("/updates/dismiss", { ids: [Number(btn.dataset.id)] });
        await draw();
      } else if (action === "dismiss-all") {
        await api.post("/updates/dismiss", {});
        await draw();
      } else if (action === "focus-search") {
        document.getElementById("search-input").focus();
      }
    } catch (err) {
      btn.disabled = false;
      toast(err.message, { type: "error" });
    }
  }
}

function onboardingHtml() {
  return `
    <div class="welcome">
      <h1>Welcome to MovieTracker</h1>
      <p>Keep track of the episodes and movies you've watched, see what's next, and find out when your shows come back.
         Show and movie info comes from TMDB, so first add your free TMDB API key.</p>
      <a class="btn btn-primary" href="#/settings">Set up your API key</a>
    </div>`;
}

function welcomeHtml() {
  return `
    <div class="welcome">
      <h1>Your library is empty</h1>
      <p>Search for a show you're watching or a movie you've seen to get started.
         Tip: press <code>/</code> anywhere to jump to the search box.</p>
      <button class="btn btn-primary" data-action="focus-search">${icon("search", 16)} Search</button>
    </div>`;
}

function dashboardHtml({ stats, updates, continue_watching: cw, coming_soon: coming }) {
  return `
    ${statsHtml(stats)}
    ${updates.length ? updatesHtml(updates) : ""}
    <section class="section">
      <div class="section-head">
        <h2>Continue watching${cw.length ? `<span class="count">${cw.length}</span>` : ""}</h2>
        <a class="link" href="#/shows">All shows →</a>
      </div>
      ${cw.length
        ? `<div class="cw-grid">${cw.map(continueCardHtml).join("")}</div>`
        : emptyHtml("You're all caught up", "There are no unwatched episodes in the shows you're watching.")}
    </section>
    <section class="section">
      <div class="section-head"><h2>Coming soon</h2></div>
      ${coming.length
        ? `<ul class="coming">${coming.map(comingRowHtml).join("")}</ul>`
        : emptyHtml("Nothing scheduled yet", "New episodes, season premieres and announced seasons of your shows will show up here.")}
    </section>`;
}

function statsHtml(stats) {
  const items = [
    [stats.shows.watching || 0, "Shows watching"],
    [stats.episodes_watched.toLocaleString(), "Episodes watched"],
    [stats.movies_watched.toLocaleString(), "Movies watched"],
    [fmtDuration(stats.minutes), "Time watched"],
  ];
  return `<div class="stats">${items.map(([value, label]) => `
    <div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`).join("")}
  </div>`;
}

function updatesHtml(updates) {
  return `
    <section class="section">
      <div class="section-head">
        <h2>What's new<span class="count">${updates.length}</span></h2>
        <button class="btn btn-sm btn-ghost" data-action="dismiss-all">Clear all</button>
      </div>
      <ul class="updates">${updates.map((u) => `
        <li class="update">
          <a href="#/show/${u.show_id}">${thumbHtml(u.poster_path)}</a>
          <div class="update-body">
            <a class="update-title" href="#/show/${u.show_id}">${esc(u.name)}</a>
            <div>${esc(u.message)}</div>
            <time>${timeAgo(u.created_at)}</time>
          </div>
          <button class="btn btn-icon btn-ghost" data-action="dismiss" data-id="${u.id}" title="Dismiss">${icon("x", 16)}</button>
        </li>`).join("")}
      </ul>
    </section>`;
}

function continueCardHtml(show) {
  const ep = show.next;
  const image = tmdbImg(ep.still_path, "w500") || tmdbImg(show.backdrop_path, "w780");
  const isNew = ep.air_date && daysFromToday(ep.air_date) >= -7;
  const left = show.progress.remaining;
  return `
    <article class="cw-card">
      <a class="cw-media" href="#/show/${show.id}">
        ${image ? `<img src="${image}" alt="" loading="lazy">` : `<div class="poster-ph">${esc(show.name)}</div>`}
        ${isNew ? `<span class="badge badge-accent">New</span>` : ""}
      </a>
      <div class="progress"><span style="width:${show.progress.percent}%"></span></div>
      <div class="cw-body">
        <div class="cw-info">
          <a class="cw-show" href="#/show/${show.id}">${esc(show.name)}</a>
          <div class="cw-ep">${epCode(ep.season_number, ep.episode_number)}${ep.name ? ` · ${esc(ep.name)}` : ""}</div>
          <div class="cw-left">${left === 1 ? "Last available episode" : `${left} episodes left`}</div>
        </div>
        <button class="check-btn" data-action="watch" data-show="${show.id}" data-season="${ep.season_number}"
                data-episode="${ep.episode_number}" title="Mark as watched">${icon("check", 20)}</button>
      </div>
    </article>`;
}

function comingRowHtml(item) {
  const href = item.type === "movie" ? `#/movie/${item.id}` : `#/show/${item.id}`;
  let chip, when;
  if (item.date) {
    const d = parseDate(item.date);
    const isToday = daysFromToday(item.date) === 0;
    chip = `<div class="date-chip ${isToday ? "today" : ""}">
      <div class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</div>
      <div class="day">${d.getDate()}</div>
      <div class="mon">${d.toLocaleDateString(undefined, { month: "short" })}</div></div>`;
    when = relDay(item.date);
  } else {
    chip = `<div class="date-chip tba"><div class="day">TBA</div></div>`;
    when = "Date not announced";
  }

  let detail, badge = "";
  if (item.type === "movie") {
    detail = "Movie release";
    badge = `<span class="badge">Movie</span>`;
  } else if (item.episode) {
    detail = `${epCode(item.season, item.episode)}${item.episode_name ? ` · ${esc(item.episode_name)}` : ""}`;
    if (item.premiere) badge = `<span class="badge badge-accent">${item.season === 1 ? "Series premiere" : "Season premiere"}</span>`;
  } else {
    detail = item.date ? `Season ${item.season} premiere` : `Season ${item.season} announced`;
    if (item.date) badge = `<span class="badge badge-accent">Season premiere</span>`;
  }

  return `
    <li><a class="coming-row" href="${href}">
      ${chip}
      ${thumbHtml(item.poster_path)}
      <div class="coming-info">
        <div class="coming-title">${esc(item.title)} ${badge}</div>
        <div class="muted small">${detail}</div>
      </div>
      <div class="coming-when">${when}</div>
    </a></li>`;
}
