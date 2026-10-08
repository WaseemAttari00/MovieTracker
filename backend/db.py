"""SQLite storage: schema, connections, settings and daily backups."""
import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("MOVIETRACKER_DATA_DIR") or ROOT_DIR / "data")
DB_PATH = DATA_DIR / "tracker.db"
BACKUP_DIR = DATA_DIR / "backups"
BACKUPS_TO_KEEP = 14

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS shows (
    id               INTEGER PRIMARY KEY,          -- TMDB id
    name             TEXT NOT NULL,
    original_name    TEXT,
    overview         TEXT,
    tagline          TEXT,
    poster_path      TEXT,
    backdrop_path    TEXT,
    first_air_date   TEXT,
    last_air_date    TEXT,
    status           TEXT,                         -- TMDB: Returning Series, Ended, Canceled, ...
    networks         TEXT,
    genres           TEXT,
    episode_run_time INTEGER,
    vote_average     REAL,
    user_status      TEXT NOT NULL DEFAULT 'watching',  -- watching | watchlist | paused | completed | dropped
    added_at         TEXT NOT NULL,
    last_watched_at  TEXT,
    synced_at        TEXT                          -- last refresh from TMDB
);

CREATE TABLE IF NOT EXISTS seasons (
    show_id       INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,                -- 0 = specials
    name          TEXT,
    overview      TEXT,
    poster_path   TEXT,
    air_date      TEXT,
    episode_count INTEGER,
    PRIMARY KEY (show_id, season_number)
);

CREATE TABLE IF NOT EXISTS episodes (
    show_id        INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    season_number  INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    name           TEXT,
    overview       TEXT,
    air_date       TEXT,
    runtime        INTEGER,
    still_path     TEXT,
    PRIMARY KEY (show_id, season_number, episode_number)
);

-- Kept separate from episodes so refreshing TMDB data never touches watch history.
CREATE TABLE IF NOT EXISTS watches (
    show_id        INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    season_number  INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    watched_at     TEXT NOT NULL,
    PRIMARY KEY (show_id, season_number, episode_number)
);

CREATE TABLE IF NOT EXISTS movies (
    id             INTEGER PRIMARY KEY,            -- TMDB id
    title          TEXT NOT NULL,
    original_title TEXT,
    overview       TEXT,
    tagline        TEXT,
    poster_path    TEXT,
    backdrop_path  TEXT,
    release_date   TEXT,
    runtime        INTEGER,
    genres         TEXT,
    status         TEXT,
    vote_average   REAL,
    user_status    TEXT NOT NULL,                  -- watched | watchlist
    watched_at     TEXT,                           -- YYYY-MM-DD
    rating         INTEGER,                        -- 1..5
    added_at       TEXT NOT NULL,
    synced_at      TEXT
);

-- "What's new" feed: season announcements, premiere dates, new episodes, status changes.
CREATE TABLE IF NOT EXISTS updates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id    INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    ref        TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    dismissed  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (show_id, kind, ref)
);
"""


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def today_iso():
    return date.today().isoformat()


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)


def get_setting(key, default=None):
    with connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    with connect() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def backup_db():
    """Keep one snapshot of the database per day, for the last BACKUPS_TO_KEEP days."""
    if not DB_PATH.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"tracker-{today_iso()}.db"
    if target.exists():
        return
    src, dst = sqlite3.connect(DB_PATH), sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    for old in sorted(BACKUP_DIR.glob("tracker-*.db"))[:-BACKUPS_TO_KEEP]:
        old.unlink()
