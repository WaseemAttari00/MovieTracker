"""Library logic: storing TMDB data, watch progress, "what's new" updates and the dashboard."""
import asyncio
import logging
from datetime import date, datetime, timedelta

from .db import backup_db, connect, now_iso, today_iso
from .tmdb import TMDB, TMDBError

log = logging.getLogger("movietracker")

SHOW_STATUSES = ("watching", "watchlist", "paused", "completed", "dropped")
MOVIE_STATUSES = ("watched", "watchlist")
ENDED = ("Ended", "Canceled")
CONCURRENCY = 6  # parallel TMDB requests during refresh/import

SHOW_FIELDS = (
    "name", "original_name", "overview", "tagline", "poster_path", "backdrop_path", "first_air_date",
    "last_air_date", "status", "networks", "genres", "episode_run_time", "vote_average",
)
MOVIE_FIELDS = (
    "title", "original_title", "overview", "tagline", "poster_path", "backdrop_path", "release_date",
    "runtime", "genres", "status", "vote_average",
)


# --- helpers -----------------------------------------------------------------

def _names(items):
    return ", ".join(i["name"] for i in items or [] if i.get("name"))


def _key(ep):
    return (ep["season_number"], ep["episode_number"])


def ep_code(season, episode):
    return f"S{season:02d}E{episode:02d}"


def human_date(iso):
    d = date.fromisoformat(iso)
    return f"{d:%b} {d.day}, {d.year}"


def is_aired(ep, show_status, today):
    if ep["air_date"]:
        return ep["air_date"] <= today
    return show_status in ENDED  # finished shows sometimes lack per-episode dates


# --- parsing TMDB payloads -----------------------------------------------------

def parse_show(data):
    """Split a payload from TMDB.show() into show, season and episode records."""
    run_times = data.get("episode_run_time") or []
    show = {
        "id": data["id"],
        "name": data.get("name") or data.get("original_name") or "Untitled",
        "original_name": data.get("original_name"),
        "overview": data.get("overview"),
        "tagline": data.get("tagline"),
        "poster_path": data.get("poster_path"),
        "backdrop_path": data.get("backdrop_path"),
        "first_air_date": data.get("first_air_date") or None,
        "last_air_date": data.get("last_air_date") or None,
        "status": data.get("status"),
        "networks": _names(data.get("networks")),
        "genres": _names(data.get("genres")),
        "episode_run_time": run_times[0] if run_times else None,
        "vote_average": data.get("vote_average"),
    }
    details = data.get("season_details") or {}
    seasons, episodes = [], []
    for summary in data.get("seasons") or []:
        number = summary["season_number"]
        full = details.get(number) or {}
        season_eps = full.get("episodes") or []
        seasons.append({
            "season_number": number,
            "name": full.get("name") or summary.get("name") or f"Season {number}",
            "overview": full.get("overview") or summary.get("overview"),
            "poster_path": full.get("poster_path") or summary.get("poster_path"),
            "air_date": full.get("air_date") or summary.get("air_date") or None,
            "episode_count": len(season_eps) or summary.get("episode_count") or 0,
        })
        for ep in season_eps:
            episodes.append({
                "season_number": number,
                "episode_number": ep["episode_number"],
                "name": ep.get("name"),
                "overview": ep.get("overview"),
                "air_date": ep.get("air_date") or None,
                "runtime": ep.get("runtime"),
                "still_path": ep.get("still_path"),
            })
    episodes.sort(key=_key)
    return show, seasons, episodes


def parse_movie(data):
    return {
        "id": data["id"],
        "title": data.get("title") or data.get("original_title") or "Untitled",
        "original_title": data.get("original_title"),
        "overview": data.get("overview"),
        "tagline": data.get("tagline"),
        "poster_path": data.get("poster_path"),
        "backdrop_path": data.get("backdrop_path"),
        "release_date": data.get("release_date") or None,
        "runtime": data.get("runtime") or None,
        "genres": _names(data.get("genres")),
        "status": data.get("status"),
        "vote_average": data.get("vote_average"),
    }


# --- storing -----------------------------------------------------------------------

def store_show(conn, data, user_status=None, added_at=None):
    """Insert or refresh a show with all of its episodes. Returns the number of new updates recorded."""
    show, seasons, episodes = parse_show(data)
    show_id = show["id"]
    old = conn.execute("SELECT * FROM shows WHERE id = ?", (show_id,)).fetchone()
    old_seasons = {r["season_number"]: dict(r) for r in conn.execute("SELECT * FROM seasons WHERE show_id = ?", (show_id,))}
    now = now_iso()
    values = [show[f] for f in SHOW_FIELDS]

    if old is None:
        conn.execute(
            f"INSERT INTO shows (id, {', '.join(SHOW_FIELDS)}, user_status, added_at, synced_at) "
            f"VALUES ({', '.join('?' * (len(SHOW_FIELDS) + 4))})",
            (show_id, *values, user_status or "watching", added_at or now, now),
        )
    else:
        conn.execute(
            f"UPDATE shows SET {', '.join(f'{f} = ?' for f in SHOW_FIELDS)}, synced_at = ? WHERE id = ?",
            (*values, now, show_id),
        )
        if user_status:
            conn.execute("UPDATE shows SET user_status = ? WHERE id = ?", (user_status, show_id))

    conn.execute("DELETE FROM seasons WHERE show_id = ?", (show_id,))
    conn.executemany(
        "INSERT OR REPLACE INTO seasons (show_id, season_number, name, overview, poster_path, air_date, episode_count) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(show_id, s["season_number"], s["name"], s["overview"], s["poster_path"], s["air_date"], s["episode_count"])
         for s in seasons],
    )
    conn.execute("DELETE FROM episodes WHERE show_id = ?", (show_id,))
    conn.executemany(
        "INSERT OR REPLACE INTO episodes (show_id, season_number, episode_number, name, overview, air_date, runtime, still_path) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(show_id, e["season_number"], e["episode_number"], e["name"], e["overview"], e["air_date"], e["runtime"], e["still_path"])
         for e in episodes],
    )

    if old is None or old["user_status"] == "dropped":
        return 0
    return _record_updates(conn, old, old_seasons, show, seasons, episodes)


def _record_updates(conn, old, old_seasons, show, seasons, episodes):
    """Compare a refreshed show with what we had before and store anything worth telling the user."""
    today = today_iso()
    since = (old["synced_at"] or old["added_at"])[:10]
    found = []  # (kind, ref, message); ref keeps the same news from being recorded twice

    old_status, new_status = old["status"], show["status"]
    if new_status and new_status != old_status:
        if new_status == "Ended":
            found.append(("status", new_status, "The series has ended"))
        elif new_status == "Canceled":
            found.append(("status", new_status, "The series has been canceled"))
        elif old_status in ENDED:
            found.append(("status", new_status, "The series is coming back"))

    for season in seasons:
        number, air = season["season_number"], season["air_date"]
        if number == 0:
            continue
        before = old_seasons.get(number)
        if before is None:
            if air and air <= since:  # an old season TMDB only just listed, not news
                continue
            message = f"Season {number} has been announced"
            if air and air > today:
                message += f" and premieres {human_date(air)}"
            found.append(("season", f"S{number}", message))
        elif air and air > today and air != before["air_date"]:
            if before["air_date"]:
                message = f"Season {number} premiere moved to {human_date(air)}"
            else:
                message = f"Season {number} premieres {human_date(air)}"
            found.append(("premiere", f"S{number}:{air}", message))

    fresh = [e for e in episodes if e["season_number"] > 0 and e["air_date"] and since < e["air_date"] <= today]
    if fresh:
        first, last = fresh[0], fresh[-1]
        if len(fresh) == 1:
            message = f"New episode out: {ep_code(*_key(first))}"
            if first["name"]:
                message += f" “{first['name']}”"
        else:
            message = f"{len(fresh)} new episodes out: {ep_code(*_key(first))} – {ep_code(*_key(last))}"
        premiere = next((e for e in fresh if e["episode_number"] == 1), None)
        if premiere:
            message = f"Season {premiere['season_number']} has premiered! {message}"
        found.append(("episodes", f"{ep_code(*_key(first))}-{ep_code(*_key(last))}", message))

    now = now_iso()
    added = 0
    for kind, ref, message in found:
        cur = conn.execute(
            "INSERT OR IGNORE INTO updates (show_id, kind, ref, message, created_at) VALUES (?, ?, ?, ?, ?)",
            (show["id"], kind, ref, message, now),
        )
        added += cur.rowcount
    return added


def store_movie(conn, data, user_status=None, added_at=None):
    movie = parse_movie(data)
    values = [movie[f] for f in MOVIE_FIELDS]
    now = now_iso()
    if conn.execute("SELECT 1 FROM movies WHERE id = ?", (movie["id"],)).fetchone():
        conn.execute(
            f"UPDATE movies SET {', '.join(f'{f} = ?' for f in MOVIE_FIELDS)}, synced_at = ? WHERE id = ?",
            (*values, now, movie["id"]),
        )
    else:
        conn.execute(
            f"INSERT INTO movies (id, {', '.join(MOVIE_FIELDS)}, user_status, added_at, synced_at) "
            f"VALUES ({', '.join('?' * (len(MOVIE_FIELDS) + 4))})",
            (movie["id"], *values, user_status or "watchlist", added_at or now, now),
        )


def update_movie(conn, movie_id, changes):
    """Apply user changes (user_status, watched_at, rating) to a movie in the library."""
    row = conn.execute("SELECT * FROM movies WHERE id = ?", (movie_id,)).fetchone()
    fields = {}
    status = changes.get("user_status")
    if status == "watched":
        fields.update(user_status=status, watched_at=changes.get("watched_at") or row["watched_at"] or today_iso())
    elif status == "watchlist":
        fields.update(user_status=status, watched_at=None, rating=None)
    elif changes.get("watched_at"):
        fields["watched_at"] = changes["watched_at"]
    if "rating" in changes and (status or row["user_status"]) == "watched":
        fields["rating"] = changes["rating"]
    if fields:
        conn.execute(
            f"UPDATE movies SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
            (*fields.values(), movie_id),
        )


# --- reading -----------------------------------------------------------------------

def _filter(show_id):
    return ("WHERE show_id = ?", (show_id,)) if show_id is not None else ("", ())


def _episodes(conn, show_id=None):
    where, args = _filter(show_id)
    out = {}
    for row in conn.execute(f"SELECT * FROM episodes {where} ORDER BY show_id, season_number, episode_number", args):
        out.setdefault(row["show_id"], []).append(dict(row))
    return out


def _seasons(conn, show_id=None):
    where, args = _filter(show_id)
    out = {}
    for row in conn.execute(f"SELECT * FROM seasons {where} ORDER BY show_id, season_number", args):
        out.setdefault(row["show_id"], []).append(dict(row))
    return out


def _watches(conn, show_id=None):
    where, args = _filter(show_id)
    out = {}
    for row in conn.execute(f"SELECT * FROM watches {where}", args):
        out.setdefault(row["show_id"], {})[(row["season_number"], row["episode_number"])] = row["watched_at"]
    return out


def compute_progress(show, episodes, watched, today):
    """Progress over regular seasons (specials don't count). `episodes` must be in episode order."""
    regular = [e for e in episodes if e["season_number"] > 0]
    aired = [e for e in regular if is_aired(e, show["status"], today)]
    unwatched = [e for e in aired if _key(e) not in watched]
    # Up next: the first unwatched episode after the furthest one watched, else the earliest gap.
    furthest = max((i for i, e in enumerate(aired) if _key(e) in watched), default=-1)
    next_ep = next((e for e in aired[furthest + 1:] if _key(e) not in watched), None)
    if next_ep is None and unwatched:
        next_ep = unwatched[0]
    upcoming = next((e for e in regular if e["air_date"] and e["air_date"] >= today and _key(e) not in watched), None)
    watched_aired = len(aired) - len(unwatched)
    return {
        "total": len(regular),
        "aired": len(aired),
        "watched": sum(1 for e in regular if _key(e) in watched),
        "remaining": len(unwatched),
        "percent": round(100 * watched_aired / len(aired)) if aired else 0,
        "next": next_ep,
        "upcoming": upcoming,
    }


def _progress_numbers(p):
    return {k: p[k] for k in ("total", "aired", "watched", "remaining", "percent")}


def _summary(show, p):
    return {
        **{k: show[k] for k in ("id", "name", "poster_path", "backdrop_path", "first_air_date", "status",
                                 "user_status", "added_at", "last_watched_at")},
        "progress": _progress_numbers(p),
        "next": p["next"],
        "upcoming": p["upcoming"],
    }


def list_shows(conn):
    today = today_iso()
    episodes, watches = _episodes(conn), _watches(conn)
    out = []
    for row in conn.execute("SELECT * FROM shows"):
        show = dict(row)
        p = compute_progress(show, episodes.get(show["id"], []), watches.get(show["id"], {}), today)
        out.append(_summary(show, p))
    return out


def _detail(show, seasons, episodes, watched, in_library):
    today = today_iso()
    p = compute_progress(show, episodes, watched, today)
    by_season = {}
    for ep in episodes:
        key = _key(ep)
        by_season.setdefault(ep["season_number"], []).append({
            **ep,
            "runtime": ep["runtime"] or show["episode_run_time"],
            "aired": is_aired(ep, show["status"], today),
            "watched": key in watched,
            "watched_at": watched.get(key),
        })
    out = []
    for season in sorted(seasons, key=lambda s: (s["season_number"] == 0, s["season_number"])):  # specials last
        eps = by_season.get(season["season_number"], [])
        out.append({
            **{k: season[k] for k in ("season_number", "name", "overview", "poster_path", "air_date", "episode_count")},
            "episodes": eps,
            "aired": sum(e["aired"] for e in eps),
            "watched": sum(e["watched"] for e in eps),
        })
    return {
        "in_library": in_library,
        "show": show,
        "seasons": out,
        "progress": _progress_numbers(p),
        "next": p["next"],
        "upcoming": p["upcoming"],
    }


def show_detail(conn, show_id):
    row = conn.execute("SELECT * FROM shows WHERE id = ?", (show_id,)).fetchone()
    if row is None:
        return None
    return _detail(
        dict(row),
        _seasons(conn, show_id).get(show_id, []),
        _episodes(conn, show_id).get(show_id, []),
        _watches(conn, show_id).get(show_id, {}),
        in_library=True,
    )


def preview_show(data):
    """Detail view for a show that isn't in the library yet."""
    show, seasons, episodes = parse_show(data)
    show.update(user_status=None, added_at=None, last_watched_at=None)
    return _detail(show, seasons, episodes, {}, in_library=False)


def movie_detail(conn, movie_id):
    row = conn.execute("SELECT * FROM movies WHERE id = ?", (movie_id,)).fetchone()
    return {"in_library": True, "movie": dict(row)} if row else None


def preview_movie(data):
    movie = parse_movie(data)
    movie.update(user_status=None, watched_at=None, rating=None, added_at=None)
    return {"in_library": False, "movie": movie}


def list_movies(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM movies")]


# --- watching ----------------------------------------------------------------------

def set_watched(conn, show_id, action, season=None, episode=None, watched=True):
    """Mark episodes watched/unwatched. action: episode | season | up_to | all."""
    show = conn.execute("SELECT status FROM shows WHERE id = ?", (show_id,)).fetchone()
    today = today_iso()
    episodes = _episodes(conn, show_id).get(show_id, [])

    def aired(ep):
        return is_aired(ep, show["status"], today)

    if action == "episode":
        keys = [(season, episode)]
    elif action == "season":
        keys = [_key(e) for e in episodes if e["season_number"] == season and (aired(e) or not watched)]
    elif action == "up_to":
        watched = True
        keys = [_key(e) for e in episodes if e["season_number"] > 0 and aired(e) and _key(e) <= (season, episode)]
        if (season, episode) not in keys:
            keys.append((season, episode))
    elif action == "all":
        keys = [_key(e) for e in episodes if e["season_number"] > 0 and (aired(e) or not watched)]
    else:
        raise ValueError(f"Unknown action: {action}")

    if watched:
        now = now_iso()
        conn.executemany(
            "INSERT OR IGNORE INTO watches (show_id, season_number, episode_number, watched_at) VALUES (?, ?, ?, ?)",
            [(show_id, s, e, now) for s, e in keys],
        )
        if keys:
            conn.execute("UPDATE shows SET last_watched_at = ? WHERE id = ?", (now, show_id))
    else:
        conn.executemany(
            "DELETE FROM watches WHERE show_id = ? AND season_number = ? AND episode_number = ?",
            [(show_id, s, e) for s, e in keys],
        )
    auto_status(conn, show_id, after_watch=watched)
    return len(keys)


def set_show_status(conn, show_id, status):
    conn.execute("UPDATE shows SET user_status = ? WHERE id = ?", (status, show_id))
    if status == "completed":  # finishing a show means you've seen every aired episode
        set_watched(conn, show_id, "all", watched=True)


def auto_status(conn, show_id, after_watch=False):
    """Keep the user's status for a show in line with their progress."""
    show = dict(conn.execute("SELECT * FROM shows WHERE id = ?", (show_id,)).fetchone())
    p = compute_progress(show, _episodes(conn, show_id).get(show_id, []), _watches(conn, show_id).get(show_id, {}), today_iso())
    status = show["user_status"]
    if after_watch and status in ("watchlist", "paused", "dropped") and p["watched"]:
        status = "watching"
    if status == "watching" and p["watched"] and not p["remaining"] and show["status"] in ENDED:
        status = "completed"
    elif status == "completed" and p["remaining"]:  # e.g. a finished show got new episodes
        status = "watching"
    if status != show["user_status"]:
        conn.execute("UPDATE shows SET user_status = ? WHERE id = ?", (status, show_id))


def dismiss_updates(conn, ids=None):
    if ids is None:
        conn.execute("UPDATE updates SET dismissed = 1")
    else:
        conn.executemany("UPDATE updates SET dismissed = 1 WHERE id = ?", [(i,) for i in ids])


# --- dashboard ---------------------------------------------------------------------

def _coming_for_show(show, p, seasons, episodes, today):
    base = {"type": "show", "id": show["id"], "title": show["name"], "poster_path": show["poster_path"]}
    up = p["upcoming"]
    if up:
        return {**base, "date": up["air_date"], "season": up["season_number"], "episode": up["episode_number"],
                "episode_name": up["name"], "premiere": up["episode_number"] == 1}
    if show["status"] in ENDED:
        return None
    # A season TMDB lists beyond the last aired one = announced (maybe without a date yet).
    latest = max((e["season_number"] for e in episodes if e["season_number"] > 0 and is_aired(e, show["status"], today)), default=0)
    future = [s for s in seasons if s["season_number"] > latest and (not s["air_date"] or s["air_date"] >= today)]
    if not future:
        return None
    season = min(future, key=lambda s: s["season_number"])
    return {**base, "date": season["air_date"], "season": season["season_number"], "episode": None,
            "episode_name": None, "premiere": True}


def stats(conn):
    ep = conn.execute(
        """SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(e.runtime, s.episode_run_time, 0)), 0) AS minutes
           FROM watches w
           JOIN shows s ON s.id = w.show_id
           LEFT JOIN episodes e ON e.show_id = w.show_id AND e.season_number = w.season_number
                               AND e.episode_number = w.episode_number"""
    ).fetchone()
    mv = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(runtime), 0) AS minutes FROM movies WHERE user_status = 'watched'"
    ).fetchone()
    watchlist = conn.execute("SELECT COUNT(*) FROM movies WHERE user_status = 'watchlist'").fetchone()[0]
    shows = {r["user_status"]: r["n"] for r in conn.execute("SELECT user_status, COUNT(*) AS n FROM shows GROUP BY user_status")}
    return {
        "episodes_watched": ep["n"],
        "movies_watched": mv["n"],
        "movies_watchlist": watchlist,
        "minutes": ep["minutes"] + mv["minutes"],
        "shows": shows,
        "shows_total": sum(shows.values()),
    }


def dashboard(conn):
    today = today_iso()
    episodes, watches, seasons = _episodes(conn), _watches(conn), _seasons(conn)
    continue_watching, coming = [], []
    for row in conn.execute("SELECT * FROM shows"):
        show = dict(row)
        show_eps = episodes.get(show["id"], [])
        p = compute_progress(show, show_eps, watches.get(show["id"], {}), today)
        if show["user_status"] == "watching" and p["next"]:
            continue_watching.append(_summary(show, p))
        if show["user_status"] != "dropped":
            item = _coming_for_show(show, p, seasons.get(show["id"], []), show_eps, today)
            if item:
                coming.append(item)
    for movie in conn.execute("SELECT * FROM movies WHERE user_status = 'watchlist' AND release_date >= ?", (today,)):
        coming.append({"type": "movie", "id": movie["id"], "title": movie["title"], "poster_path": movie["poster_path"],
                       "date": movie["release_date"], "season": None, "episode": None, "episode_name": None, "premiere": False})

    continue_watching.sort(key=lambda s: s["last_watched_at"] or s["added_at"] or "", reverse=True)
    coming.sort(key=lambda c: (c["date"] is None, c["date"] or "", c["title"]))
    updates = [dict(r) for r in conn.execute(
        """SELECT u.id, u.show_id, u.kind, u.message, u.created_at, s.name, s.poster_path
           FROM updates u JOIN shows s ON s.id = u.show_id
           WHERE u.dismissed = 0 ORDER BY u.created_at DESC, u.id DESC LIMIT 50"""
    )]
    s = stats(conn)
    return {
        "library_empty": not s["shows_total"] and not s["movies_watched"] and not s["movies_watchlist"],
        "stats": s,
        "updates": updates,
        "continue_watching": continue_watching,
        "coming_soon": coming,
    }


# --- talking to TMDB -----------------------------------------------------------------

async def search(api_key, query, page=1):
    async with TMDB(api_key) as tmdb:
        data = await tmdb.search(query, page)
    with connect() as conn:
        shows = {r["id"]: r["user_status"] for r in conn.execute("SELECT id, user_status FROM shows")}
        movies = {r["id"]: r["user_status"] for r in conn.execute("SELECT id, user_status FROM movies")}
    results = []
    for item in data.get("results") or []:
        if item.get("media_type") == "tv":
            results.append({"type": "show", "id": item["id"], "title": item.get("name") or item.get("original_name"),
                            "date": item.get("first_air_date") or None, "poster_path": item.get("poster_path"),
                            "overview": item.get("overview"), "user_status": shows.get(item["id"])})
        elif item.get("media_type") == "movie":
            results.append({"type": "movie", "id": item["id"], "title": item.get("title") or item.get("original_title"),
                            "date": item.get("release_date") or None, "poster_path": item.get("poster_path"),
                            "overview": item.get("overview"), "user_status": movies.get(item["id"])})
    return {"results": results, "page": data.get("page", page), "total_pages": data.get("total_pages", 1)}


_sync_lock = asyncio.Lock()


def _stale(synced_at, max_age, now):
    if not synced_at:
        return True
    try:
        return now - datetime.fromisoformat(synced_at) > max_age
    except ValueError:
        return True


def _show_max_age(row):
    if row["user_status"] == "dropped":
        return timedelta(days=30)
    if row["status"] in ENDED:
        return timedelta(days=7)
    return timedelta(hours=12)


async def sync_library(api_key, force=False):
    """Refresh shows (and upcoming watchlist movies) whose TMDB data is getting old."""
    async with _sync_lock:
        backup_db()
        now = datetime.now()
        recent = (date.today() - timedelta(days=14)).isoformat()
        with connect() as conn:
            shows = [r["id"] for r in conn.execute("SELECT id, status, user_status, synced_at FROM shows")
                     if force or _stale(r["synced_at"], _show_max_age(r), now)]
            movies = [r["id"] for r in conn.execute(
                "SELECT id, synced_at FROM movies WHERE user_status = 'watchlist' AND (release_date IS NULL OR release_date >= ?)",
                (recent,)) if force or _stale(r["synced_at"], timedelta(days=3), now)]
        result = {"shows": 0, "movies": 0, "updates": 0, "errors": []}
        if not shows and not movies:
            return result

        sem = asyncio.Semaphore(CONCURRENCY)
        async with TMDB(api_key) as tmdb:
            async def refresh_show(show_id):
                async with sem:
                    data = await tmdb.show(show_id)
                with connect() as conn:
                    result["updates"] += store_show(conn, data)
                    auto_status(conn, show_id)
                result["shows"] += 1

            async def refresh_movie(movie_id):
                async with sem:
                    data = await tmdb.movie(movie_id)
                with connect() as conn:
                    store_movie(conn, data)
                result["movies"] += 1

            outcomes = await asyncio.gather(*map(refresh_show, shows), *map(refresh_movie, movies), return_exceptions=True)

        failures = [o for o in outcomes if isinstance(o, Exception)]
        for failure in failures:
            log.warning("Refresh failed: %r", failure)
        result["errors"] = sorted({str(f) for f in failures})
        return result


# --- backup ---------------------------------------------------------------------------

def export_library(conn):
    watches = _watches(conn)
    shows = [{
        "tmdb_id": row["id"],
        "name": row["name"],
        "user_status": row["user_status"],
        "added_at": row["added_at"],
        "last_watched_at": row["last_watched_at"],
        "watched": [{"season": s, "episode": e, "watched_at": at}
                    for (s, e), at in sorted(watches.get(row["id"], {}).items())],
    } for row in conn.execute("SELECT * FROM shows ORDER BY name COLLATE NOCASE")]
    movies = [{
        "tmdb_id": row["id"],
        "title": row["title"],
        "user_status": row["user_status"],
        "watched_at": row["watched_at"],
        "rating": row["rating"],
        "added_at": row["added_at"],
    } for row in conn.execute("SELECT * FROM movies ORDER BY title COLLATE NOCASE")]
    return {"app": "MovieTracker", "format": 1, "exported_at": now_iso(), "shows": shows, "movies": movies}


async def import_library(api_key, payload):
    """Restore an export. Show/movie info is re-downloaded from TMDB; watch history is merged in."""
    shows = [s for s in payload.get("shows") or [] if isinstance(s, dict) and s.get("tmdb_id")]
    movies = [m for m in payload.get("movies") or [] if isinstance(m, dict) and m.get("tmdb_id")]
    result = {"shows": 0, "movies": 0, "errors": []}
    sem = asyncio.Semaphore(CONCURRENCY)

    async with TMDB(api_key) as tmdb:
        async def import_show(item):
            show_id = int(item["tmdb_id"])
            async with sem:
                data = await tmdb.show(show_id)
            status = item.get("user_status") if item.get("user_status") in SHOW_STATUSES else "watching"
            watched = [(show_id, int(w["season"]), int(w["episode"]), w.get("watched_at") or now_iso())
                       for w in item.get("watched") or []]
            with connect() as conn:
                store_show(conn, data, user_status=status, added_at=item.get("added_at"))
                conn.executemany(
                    "INSERT OR IGNORE INTO watches (show_id, season_number, episode_number, watched_at) VALUES (?, ?, ?, ?)",
                    watched,
                )
                if item.get("last_watched_at"):
                    conn.execute(
                        "UPDATE shows SET last_watched_at = MAX(COALESCE(last_watched_at, ''), ?) WHERE id = ?",
                        (item["last_watched_at"], show_id),
                    )
            result["shows"] += 1

        async def import_movie(item):
            movie_id = int(item["tmdb_id"])
            async with sem:
                data = await tmdb.movie(movie_id)
            status = item.get("user_status") if item.get("user_status") in MOVIE_STATUSES else "watchlist"
            with connect() as conn:
                store_movie(conn, data, user_status=status, added_at=item.get("added_at"))
                conn.execute(
                    "UPDATE movies SET user_status = ?, watched_at = ?, rating = ? WHERE id = ?",
                    (status, item.get("watched_at") if status == "watched" else None,
                     item.get("rating") if status == "watched" else None, movie_id),
                )
            result["movies"] += 1

        async def safely(coro, label):
            try:
                await coro
            except (TMDBError, KeyError, TypeError, ValueError) as exc:
                result["errors"].append(f"{label}: {exc}")

        await asyncio.gather(
            *(safely(import_show(s), s.get("name") or s["tmdb_id"]) for s in shows),
            *(safely(import_movie(m), m.get("title") or m["tmdb_id"]) for m in movies),
        )
    return result
