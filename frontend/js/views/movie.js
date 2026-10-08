// Movie page: info, watched date, rating, watchlist.
import { api } from "../api.js";
import { icon } from "../icons.js";
import { daysFromToday, esc, fmtDate, posterHtml, tmdbImg, toast, todayIso, year } from "../ui.js";

export async function render(root, { id }) {
  let data = await api.get(`/movies/${id}`);
  root.innerHTML = heroHtml(data.movie);
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  update();

  function update() {
    root.querySelector("#actions").innerHTML = actionsHtml(data);
  }

  async function save(changes, message) {
    data = await api.post(`/movies/${id}`, changes);
    if (message) toast(message);
    update();
  }

  async function onClick(e) {
    const el = e.target.closest("button[data-action]");
    if (!el) return;
    const { action } = el.dataset;
    try {
      if (action === "set") {
        el.disabled = true;
        const status = el.dataset.status;
        await save({ user_status: status }, status === "watched" ? "Marked as watched" : "Added to your watchlist");
      } else if (action === "rate") {
        const rating = Number(el.dataset.rating);
        await save({ rating: rating === data.movie.rating ? null : rating });
      } else if (action === "remove") {
        if (!confirm(`Remove “${data.movie.title}” from your library?`)) return;
        await api.del(`/movies/${id}`);
        toast(`Removed “${data.movie.title}”`);
        location.hash = "#/movies";
      }
    } catch (err) {
      el.disabled = false;
      toast(err.message, { type: "error" });
    }
  }

  async function onChange(e) {
    if (e.target.id !== "watched-at" || !e.target.value) return;
    try {
      await save({ watched_at: e.target.value }, "Watch date updated");
    } catch (err) {
      toast(err.message, { type: "error" });
    }
  }
}

function heroHtml(movie) {
  const runtime = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : "";
  const upcoming = movie.release_date && daysFromToday(movie.release_date) > 0;
  const meta = [
    upcoming ? `Releases ${fmtDate(movie.release_date)}` : year(movie.release_date),
    runtime,
    movie.genres,
  ].filter(Boolean).map((m) => `<span>${esc(m)}</span>`);
  if (movie.vote_average) meta.push(`<span>${icon("star", 14, "filled")} ${movie.vote_average.toFixed(1)}</span>`);
  const backdrop = tmdbImg(movie.backdrop_path, "w1280");

  return `
    <section class="hero">
      ${backdrop ? `<div class="hero-bg" style="background-image:url('${backdrop}')"></div>` : ""}
      <div class="hero-inner">
        ${posterHtml(movie.poster_path, movie.title, { size: "w500" })}
        <div class="hero-info">
          <div><span class="badge">Movie</span></div>
          <h1>${esc(movie.title)}</h1>
          <div class="meta">${meta.join("")}</div>
          ${movie.tagline ? `<p class="tagline">${esc(movie.tagline)}</p>` : ""}
          <p class="overview">${esc(movie.overview || "No overview available.")}</p>
          <div class="actions" id="actions"></div>
        </div>
      </div>
    </section>`;
}

function actionsHtml({ in_library, movie }) {
  const markWatched = `<button class="btn btn-primary" data-action="set" data-status="watched">${icon("check", 16)} Mark as watched</button>`;
  const remove = `<button class="btn btn-ghost btn-danger" data-action="remove">${icon("trash", 16)} Remove</button>`;
  if (!in_library) {
    return `${markWatched}<button class="btn" data-action="set" data-status="watchlist">${icon("bookmark", 16)} Add to watchlist</button>`;
  }
  if (movie.user_status === "watchlist") {
    return `<span class="badge badge-accent">${icon("bookmark", 12)} On your watchlist</span>${markWatched}${remove}`;
  }
  const stars = [1, 2, 3, 4, 5].map((n) => `
    <button class="star ${movie.rating >= n ? "on" : ""}" data-action="rate" data-rating="${n}"
            title="${movie.rating === n ? "Clear rating" : `${n} star${n > 1 ? "s" : ""}`}">${icon("star", 22)}</button>`).join("");
  return `
    <div class="panel watched-box">
      <span class="badge badge-success">${icon("check", 12)} Watched</span>
      <label class="muted small">on <input type="date" class="input input-date" id="watched-at" value="${movie.watched_at || ""}" max="${todayIso()}"></label>
      <span class="muted small rating">Your rating <span class="stars">${stars}</span></span>
    </div>
    <button class="btn" data-action="set" data-status="watchlist">Move to watchlist</button>
    ${remove}`;
}
