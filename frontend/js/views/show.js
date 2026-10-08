// Show page: info, progress, and every season's episodes with watch checkboxes.
import { api } from "../api.js";
import { icon } from "../icons.js";
import {
  airStatusBadge, countdownHtml, epCode, esc, fmtDate, pad, plural, posterHtml, relSoon, SHOW_STATUS_LABELS, tmdbImg,
  toast, year,
} from "../ui.js";

export async function render(root, { id }) {
  let data = await api.get(`/shows/${id}`);
  const open = new Set();
  const firstSeason = data.next?.season_number ?? data.seasons.find((s) => s.season_number > 0)?.season_number;
  if (firstSeason != null) open.add(firstSeason);

  root.innerHTML = `${heroHtml(data)}<div id="progress"></div><div id="seasons"></div>`;
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  update();

  function update() {
    root.querySelector("#actions").innerHTML = actionsHtml(data);
    root.querySelector("#progress").innerHTML = progressHtml(data);
    root.querySelector("#seasons").innerHTML = seasonsHtml(data, open);
  }

  async function watch(body) {
    const wasInLibrary = data.in_library;
    data = await api.post(`/shows/${id}/watch`, body);
    if (!wasInLibrary) toast(`Added “${data.show.name}” to your shows`);
    update();
  }

  async function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const { action } = el.dataset;
    const season = el.dataset.season != null ? Number(el.dataset.season) : null;
    const episode = el.dataset.episode != null ? Number(el.dataset.episode) : null;
    try {
      if (action === "expand") {
        open.has(season) ? open.delete(season) : open.add(season);
        update();
        return;
      }
      if (action === "remove" && !confirm(`Remove “${data.show.name}” and its watch history from your library?`)) return;
      if (action === "all" && !confirm("Mark every aired episode as watched?")) return;
      el.disabled = true;
      switch (action) {
        case "toggle":
          await watch({ action: "episode", season, episode, watched: el.dataset.watched === "true" });
          break;
        case "season":
          await watch({ action: "season", season, watched: el.dataset.watched === "true" });
          break;
        case "upto":
          await watch({ action: "up_to", season, episode });
          break;
        case "all":
          await watch({ action: "all", watched: true });
          break;
        case "add":
          data = await api.post(`/shows/${id}`, { user_status: el.dataset.status });
          toast(`Added to ${SHOW_STATUS_LABELS[data.show.user_status]}`);
          update();
          break;
        case "refresh":
          data = await api.post(`/shows/${id}/refresh`);
          toast("Show info refreshed from TMDB");
          update();
          break;
        case "remove":
          await api.del(`/shows/${id}`);
          toast(`Removed “${data.show.name}”`);
          location.hash = "#/shows";
          break;
      }
    } catch (err) {
      el.disabled = false;
      toast(err.message, { type: "error" });
    }
  }

  async function onChange(e) {
    if (e.target.id !== "status") return;
    const status = e.target.value;
    if (status === "completed" && data.progress.remaining &&
        !confirm("Mark this show as completed? Every aired episode will be marked as watched.")) {
      e.target.value = data.show.user_status;
      return;
    }
    try {
      data = await api.patch(`/shows/${id}`, { user_status: status });
      toast(`Moved to ${SHOW_STATUS_LABELS[data.show.user_status]}`);
      update();
    } catch (err) {
      e.target.value = data.show.user_status;
      toast(err.message, { type: "error" });
    }
  }
}

function heroHtml({ show, seasons }) {
  const ended = show.status === "Ended" || show.status === "Canceled";
  let years = year(show.first_air_date);
  if (years && ended && year(show.last_air_date) !== years) years += `–${year(show.last_air_date)}`;
  else if (years && !ended) years += "–";
  const seasonCount = seasons.filter((s) => s.season_number > 0).length;
  const meta = [
    years,
    show.networks,
    seasonCount ? plural(seasonCount, "season") : "",
    show.episode_run_time ? `${show.episode_run_time} min` : "",
    show.genres,
  ].filter(Boolean).map((m) => `<span>${esc(m)}</span>`);
  if (show.vote_average) meta.push(`<span>${icon("star", 14, "filled")} ${show.vote_average.toFixed(1)}</span>`);
  const backdrop = tmdbImg(show.backdrop_path, "w1280");

  return `
    <section class="hero">
      ${backdrop ? `<div class="hero-bg" style="background-image:url('${backdrop}')"></div>` : ""}
      <div class="hero-inner">
        ${posterHtml(show.poster_path, show.name, { size: "w500" })}
        <div class="hero-info">
          <div>${airStatusBadge(show.status)}</div>
          <h1>${esc(show.name)}</h1>
          <div class="meta">${meta.join("")}</div>
          ${show.tagline ? `<p class="tagline">${esc(show.tagline)}</p>` : ""}
          <p class="overview">${esc(show.overview || "No overview available.")}</p>
          <div class="actions" id="actions"></div>
        </div>
      </div>
    </section>`;
}

function actionsHtml({ in_library, show }) {
  if (!in_library) {
    return `
      <button class="btn btn-primary" data-action="add" data-status="watching">${icon("plus", 16)} Add to Watching</button>
      <button class="btn" data-action="add" data-status="watchlist">${icon("bookmark", 16)} Add to Watchlist</button>`;
  }
  return `
    <select class="select" id="status" aria-label="Status">${Object.entries(SHOW_STATUS_LABELS).map(([key, label]) => `
      <option value="${key}" ${key === show.user_status ? "selected" : ""}>${label}</option>`).join("")}
    </select>
    <button class="btn" data-action="refresh" title="Download the latest info from TMDB">${icon("refresh", 16)} Refresh</button>
    <button class="btn btn-ghost btn-danger" data-action="remove">${icon("trash", 16)} Remove</button>`;
}

function progressHtml({ progress: p, next, upcoming, coming, show }) {
  if (!p.total) return "";
  let summary;
  if (p.aired) {
    summary = `<div><strong>${p.watched}</strong> of ${p.aired} aired episodes watched${p.remaining ? ` · ${p.remaining} left` : ""}</div>
      <div class="progress big"><span style="width:${p.percent}%"></span></div>`;
  } else {
    summary = `<div>Not aired yet${show.first_air_date ? ` · premieres ${fmtDate(show.first_air_date)}` : ""}</div>`;
  }
  const soon = upcoming && relSoon(upcoming.air_date);
  const upcomingLine = upcoming
    ? `<div class="faint small">Next airing: ${epCode(upcoming.season_number, upcoming.episode_number)} on ${fmtDate(upcoming.air_date)}${soon ? ` (${soon})` : ""}</div>`
    : "";
  const markAll = p.remaining > 1 ? `<div><button class="link-btn" data-action="all">Mark all aired episodes as watched</button></div>` : "";

  let right = "";
  if (next) {
    right = `
      <div class="next-up">
        <button class="check-btn" data-action="toggle" data-season="${next.season_number}" data-episode="${next.episode_number}"
                data-watched="true" title="Mark as watched">${icon("check", 20)}</button>
        <div>
          <div class="label">Up next</div>
          <div class="title">${epCode(next.season_number, next.episode_number)}${next.name ? ` · ${esc(next.name)}` : ""}</div>
          ${next.air_date ? `<div class="faint small">Aired ${fmtDate(next.air_date)}</div>` : ""}
        </div>
      </div>`;
  } else if (p.aired && !p.remaining && p.watched) {
    right = `
      <div class="caught-up-box">
        <div class="caught-up">${icon("check", 18)} You're up to date</div>
        ${countdownHtml(coming)}
      </div>`;
  }

  return `
    <div class="panel show-progress">
      <div class="overall">${summary}${upcomingLine}${markAll}</div>
      ${right}
    </div>`;
}

function seasonsHtml({ seasons }, open) {
  if (!seasons.length) return `<div class="empty"><p>TMDB doesn't list any episodes for this show yet.</p></div>`;
  return `<h2 class="seasons-title">Seasons</h2>${seasons.map((s) => seasonHtml(s, open.has(s.season_number))).join("")}`;
}

function seasonHtml(season, isOpen) {
  const n = season.season_number;
  const count = season.episodes.length || season.episode_count;
  const label = n === 0 ? "Specials" : season.name || `Season ${n}`;
  const sub = [season.air_date ? year(season.air_date) : "TBA", plural(count, "episode")].join(" · ");
  const watchedAired = Math.min(season.watched, season.aired);
  const allWatched = season.aired > 0 && watchedAired >= season.aired;

  let right;
  if (season.aired) {
    right = `
      <div class="season-prog">
        <div class="progress"><span style="width:${Math.round((100 * watchedAired) / season.aired)}%"></span></div>
        <span>${watchedAired}/${season.aired}</span>
      </div>
      <button class="btn btn-sm" data-action="season" data-season="${n}" data-watched="${!allWatched}">
        ${allWatched ? "Unmark all" : "Mark all watched"}</button>`;
  } else {
    right = `<span class="badge">${season.air_date ? `Starts ${fmtDate(season.air_date)}` : "Upcoming"}</span>`;
  }

  const episodes = isOpen
    ? `<ol class="episodes">${season.episodes.map(episodeHtml).join("") || `<li class="episode faint">No episodes listed yet.</li>`}</ol>`
    : "";
  return `
    <section class="season ${isOpen ? "open" : ""}">
      <header class="season-head" data-action="expand" data-season="${n}">
        <div class="season-name">${esc(label)}<span class="muted">${sub}</span></div>
        ${right}
        <span class="chev">${icon("chevron", 18)}</span>
      </header>
      ${episodes}
    </section>`;
}

function episodeHtml(ep) {
  const canToggle = ep.aired || ep.watched;
  const still = tmdbImg(ep.still_path, "w300");
  let when = "Air date TBA";
  if (ep.air_date) {
    const soon = relSoon(ep.air_date);
    when = ep.aired ? fmtDate(ep.air_date) : `Airs ${fmtDate(ep.air_date)}${soon ? ` (${soon})` : ""}`;
  }
  const meta = [when, ep.runtime ? `${ep.runtime} min` : "", ep.watched && ep.watched_at ? `watched ${fmtDate(ep.watched_at)}` : ""]
    .filter(Boolean).join(" · ");
  const upTo = ep.aired && !ep.watched && ep.season_number > 0
    ? `<button class="btn btn-sm btn-ghost ep-upto" data-action="upto" data-season="${ep.season_number}" data-episode="${ep.episode_number}"
         title="Mark this and every earlier episode as watched">Watched up to here</button>`
    : "";
  return `
    <li class="episode ${ep.watched ? "watched" : ""} ${ep.aired ? "" : "unaired"}">
      <button class="check-btn ${ep.watched ? "on" : ""}" data-action="toggle" data-season="${ep.season_number}"
              data-episode="${ep.episode_number}" data-watched="${!ep.watched}" ${canToggle ? "" : "disabled"}
              title="${ep.watched ? "Mark as unwatched" : ep.aired ? "Mark as watched" : "Not aired yet"}">${icon("check", 16)}</button>
      <div class="ep-still">${still ? `<img src="${still}" alt="" loading="lazy">` : ""}</div>
      <div class="ep-main">
        <div class="ep-title"><span class="ep-num">E${pad(ep.episode_number)}</span>${esc(ep.name || `Episode ${ep.episode_number}`)}</div>
        <div class="ep-meta">${meta}</div>
        ${ep.overview ? `<p class="ep-overview">${esc(ep.overview)}</p>` : ""}
      </div>
      ${upTo}
    </li>`;
}
