"""HTTP API and static file server for MovieTracker."""
import mimetypes
import os
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import library
from .db import DATA_DIR, backup_db, connect, get_setting, init_db, set_setting, today_iso
from .tmdb import TMDB, TMDBError

# Some Windows setups map .js to text/plain in the registry, which stops browsers loading ES modules.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

ShowStatus = Literal["watching", "watchlist", "paused", "completed", "dropped"]
MovieStatus = Literal["watched", "watchlist"]


@asynccontextmanager
async def lifespan(app):
    init_db()
    backup_db()
    yield


app = FastAPI(title="MovieTracker", lifespan=lifespan)


@app.exception_handler(TMDBError)
async def tmdb_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=exc.status_code)


@app.middleware("http")
async def revalidate_static_files(request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"  # pick up new versions after a `git pull`
    return response


def tmdb_key():
    key = os.environ.get("TMDB_API_KEY") or get_setting("tmdb_api_key")
    if not key:
        raise HTTPException(400, "Add your TMDB API key in Settings first.")
    return key


def require_show(conn, show_id):
    if not conn.execute("SELECT 1 FROM shows WHERE id = ?", (show_id,)).fetchone():
        raise HTTPException(404, "That show isn't in your library.")


def require_movie(conn, movie_id):
    if not conn.execute("SELECT 1 FROM movies WHERE id = ?", (movie_id,)).fetchone():
        raise HTTPException(404, "That movie isn't in your library.")


async def ensure_show(show_id, user_status="watching"):
    """Add a show to the library (downloading it from TMDB) if it isn't there yet."""
    with connect() as conn:
        if conn.execute("SELECT 1 FROM shows WHERE id = ?", (show_id,)).fetchone():
            return
    async with TMDB(tmdb_key()) as tmdb:
        data = await tmdb.show(show_id)
    with connect() as conn:
        library.store_show(conn, data, user_status=user_status)


# --- settings ------------------------------------------------------------------------

class ApiKeyIn(BaseModel):
    tmdb_api_key: str


@app.get("/api/health")
def health():
    return {"app": "MovieTracker", "ok": True}


@app.get("/api/settings")
def read_settings():
    from_env = bool(os.environ.get("TMDB_API_KEY"))
    return {
        "has_api_key": from_env or bool(get_setting("tmdb_api_key")),
        "api_key_from_env": from_env,
        "data_dir": str(DATA_DIR),
    }


@app.put("/api/settings")
async def save_settings(body: ApiKeyIn):
    key = body.tmdb_api_key.strip()
    if not key:
        raise HTTPException(400, "Paste your TMDB API key first.")
    async with TMDB(key) as tmdb:
        await tmdb.validate()
    set_setting("tmdb_api_key", key)
    return read_settings()


# --- dashboard, search, sync -------------------------------------------------------------

@app.get("/api/dashboard")
def get_dashboard():
    with connect() as conn:
        data = library.dashboard(conn)
    data["has_api_key"] = read_settings()["has_api_key"]
    return data


@app.get("/api/search")
async def search(q: str = Query(min_length=1, max_length=200), page: int = Query(1, ge=1, le=500)):
    return await library.search(tmdb_key(), q, page)


@app.post("/api/sync")
async def sync(force: bool = False):
    return await library.sync_library(tmdb_key(), force=force)


class DismissIn(BaseModel):
    ids: list[int] | None = None  # None = dismiss everything


@app.post("/api/updates/dismiss")
def dismiss(body: DismissIn):
    with connect() as conn:
        library.dismiss_updates(conn, body.ids)
    return {"ok": True}


# --- shows -----------------------------------------------------------------------------

class ShowStatusIn(BaseModel):
    user_status: ShowStatus = "watching"


class WatchIn(BaseModel):
    action: Literal["episode", "season", "up_to", "all"]
    season: int | None = None
    episode: int | None = None
    watched: bool = True


@app.get("/api/shows")
def list_shows():
    with connect() as conn:
        return library.list_shows(conn)


@app.get("/api/shows/{show_id}")
async def get_show(show_id: int):
    with connect() as conn:
        detail = library.show_detail(conn, show_id)
    if detail:
        return detail
    async with TMDB(tmdb_key()) as tmdb:
        return library.preview_show(await tmdb.show(show_id))


@app.post("/api/shows/{show_id}")
async def add_show(show_id: int, body: ShowStatusIn):
    await ensure_show(show_id, body.user_status)
    with connect() as conn:
        library.set_show_status(conn, show_id, body.user_status)
        return library.show_detail(conn, show_id)


@app.patch("/api/shows/{show_id}")
def update_show(show_id: int, body: ShowStatusIn):
    with connect() as conn:
        require_show(conn, show_id)
        library.set_show_status(conn, show_id, body.user_status)
        return library.show_detail(conn, show_id)


@app.delete("/api/shows/{show_id}")
def delete_show(show_id: int):
    with connect() as conn:
        conn.execute("DELETE FROM shows WHERE id = ?", (show_id,))
    return {"ok": True}


@app.post("/api/shows/{show_id}/refresh")
async def refresh_show(show_id: int):
    with connect() as conn:
        require_show(conn, show_id)
    async with TMDB(tmdb_key()) as tmdb:
        data = await tmdb.show(show_id)
    with connect() as conn:
        library.store_show(conn, data)
        library.auto_status(conn, show_id)
        return library.show_detail(conn, show_id)


@app.post("/api/shows/{show_id}/watch")
async def watch(show_id: int, body: WatchIn):
    if body.action in ("episode", "up_to") and (body.season is None or body.episode is None):
        raise HTTPException(422, "season and episode are required")
    if body.action == "season" and body.season is None:
        raise HTTPException(422, "season is required")
    await ensure_show(show_id)  # marking an episode of a new show adds it, like TV Time did
    with connect() as conn:
        library.set_watched(conn, show_id, body.action, body.season, body.episode, body.watched)
        return library.show_detail(conn, show_id)


# --- movies ----------------------------------------------------------------------------

class MovieIn(BaseModel):
    user_status: MovieStatus | None = None
    watched_at: date | None = None
    rating: int | None = Field(default=None, ge=1, le=5)


@app.get("/api/movies")
def list_movies():
    with connect() as conn:
        return library.list_movies(conn)


@app.get("/api/movies/{movie_id}")
async def get_movie(movie_id: int):
    with connect() as conn:
        detail = library.movie_detail(conn, movie_id)
    if detail:
        return detail
    async with TMDB(tmdb_key()) as tmdb:
        return library.preview_movie(await tmdb.movie(movie_id))


@app.post("/api/movies/{movie_id}")
async def save_movie(movie_id: int, body: MovieIn):
    """Add a movie to the library and/or change its status, watch date or rating."""
    changes = body.model_dump(exclude_unset=True)
    if changes.get("watched_at"):
        changes["watched_at"] = changes["watched_at"].isoformat()
    with connect() as conn:
        exists = conn.execute("SELECT 1 FROM movies WHERE id = ?", (movie_id,)).fetchone()
    if not exists:
        async with TMDB(tmdb_key()) as tmdb:
            data = await tmdb.movie(movie_id)
        with connect() as conn:
            library.store_movie(conn, data, user_status=changes.get("user_status") or "watchlist")
    with connect() as conn:
        library.update_movie(conn, movie_id, changes)
        return library.movie_detail(conn, movie_id)


@app.delete("/api/movies/{movie_id}")
def delete_movie(movie_id: int):
    with connect() as conn:
        conn.execute("DELETE FROM movies WHERE id = ?", (movie_id,))
    return {"ok": True}


# --- backup ----------------------------------------------------------------------------

@app.get("/api/export")
def export_library():
    with connect() as conn:
        data = library.export_library(conn)
    filename = f"movietracker-backup-{today_iso()}.json"
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/api/import")
async def import_library(payload: dict):
    if not isinstance(payload.get("shows", []), list) or not isinstance(payload.get("movies", []), list) \
            or not ("shows" in payload or "movies" in payload):
        raise HTTPException(400, "That file doesn't look like a MovieTracker backup.")
    return await library.import_library(tmdb_key(), payload)


# Everything that isn't /api is the web interface.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
