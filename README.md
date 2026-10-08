# MovieTracker

A personal TV show and movie tracker that runs on your own computer, inspired by TV Time shutting down.

## Why I built this

For years I used TV Time to keep track of which episode I was on, which movies I had watched, and when
my shows were coming back. When TV Time shut down, I lost all of that. I tried the alternatives, but none of
them felt right to me, so I decided to build my own: a simple tracker that does what TV Time did for me
and keeps my data on my own computer.

If you're in the same situation, feel free to use it too. Setup takes a few minutes (see below).

## Features

- **Track episodes**: tick off episodes one by one, a whole season at once, or "watched up to here".
- **Continue watching**: see the next episode of every show you're watching and mark it watched in one click.
- **What's new**: when you open the app it checks your shows and tells you about new episodes,
  newly announced seasons, premiere dates and shows that ended or got canceled.
- **Coming soon**: upcoming episodes, season premieres and watchlist movie releases, sorted by date.
- **Movies**: a watched list (with date and a 1–5 star rating) and a watchlist.
- **Your data stays with you**: everything is stored in one SQLite file on your computer, with a
  daily automatic backup and JSON export/import.

Show and movie data comes from [TMDB](https://www.themoviedb.org/). No accounts, no ads, no tracking.

## Getting started

### 1. Get a free TMDB API key

1. Create an account at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to [Settings → API](https://www.themoviedb.org/settings/api) and request a key.
   Choose **personal use**; for the app URL you can put `http://localhost`.
3. Keep the page open: you'll paste the **API Key** (or the **API Read Access Token**) into MovieTracker.

### 2. Install Python

You need **Python 3.10 or newer** ([download](https://www.python.org/downloads/)).
On Windows, tick **"Add python.exe to PATH"** during installation.

### 3. Download and start MovieTracker

```bash
git clone https://github.com/WaseemAttari00/MovieTracker.git
cd MovieTracker
```

(or download the ZIP from GitHub and extract it)

- **Windows:** double-click `start.bat`
- **macOS / Linux:** run `./start.sh`

The first start creates a private Python environment in `.venv` and installs the dependencies, which takes
a minute. Then your browser opens at <http://127.0.0.1:8765>. Paste your TMDB key in **Settings** and start
searching.

To stop MovieTracker, close the terminal window (or press `Ctrl+C` in it).

<details>
<summary>Starting it manually</summary>

```bash
python -m venv .venv
.venv/Scripts/activate            # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python run.py                     # options: --port 9000, --no-browser
```

You can also provide the key with the `TMDB_API_KEY` environment variable instead of the Settings page.
</details>

## Your data

| What | Where |
| --- | --- |
| Library (shows, episodes watched, movies, ratings) | `data/tracker.db` |
| Daily backups (last 14 days) | `data/backups/` |
| TMDB API key | stored in `data/tracker.db` |

The `data/` folder is in `.gitignore`, so your library and key are never committed or shared.
Use **Settings → Export library** to save everything as a JSON file, and **Import backup** to restore it
(on any computer, with any TMDB key).

To keep your data somewhere else (e.g. a OneDrive or Dropbox folder), set the `MOVIETRACKER_DATA_DIR`
environment variable to that folder.

## Updating

```bash
git pull
```

Then start MovieTracker as usual. New dependencies are installed automatically.

## How it works

```
run.py               starts the local server and opens your browser
backend/
  main.py            HTTP API (FastAPI) + serves the web interface
  library.py         progress, "what's new" detection, dashboard, sync, import/export
  tmdb.py            TMDB API client
  db.py              SQLite schema, settings, daily backups
frontend/            plain HTML/CSS/JavaScript, no build step
  js/views/          one file per page (home, shows, show, movies, movie, search, settings)
```

- The server only listens on `127.0.0.1`, so it's only reachable from your own computer.
- When you open the app it refreshes shows whose info is older than 12 hours (ended shows: 7 days)
  and compares the new data with what it had before to produce the **What's new** list.
- Specials (season 0) are shown on each show's page but don't count towards progress.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.
Icons from [Feather](https://feathericons.com/) (MIT).

## License

[MIT](LICENSE)
