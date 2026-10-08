"""Small async client for The Movie Database (TMDB) API."""
import asyncio
import os

import httpx

API_BASE = os.environ.get("TMDB_API_BASE", "https://api.themoviedb.org/3")
APPEND_LIMIT = 20  # TMDB accepts at most 20 items in append_to_response


class TMDBError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.status_code = status_code


def _retry_after(resp, attempt):
    try:
        return min(float(resp.headers.get("Retry-After", "")), 10)
    except ValueError:
        return 1 + attempt


class TMDB:
    """Use as `async with TMDB(key) as tmdb: ...`. Accepts a v3 API key or a v4 read access token."""

    def __init__(self, api_key, language="en-US"):
        key = api_key.strip()
        headers = {"Accept": "application/json"}
        params = {"language": language}
        if key.startswith("eyJ"):  # v4 "API Read Access Token" (a JWT)
            headers["Authorization"] = f"Bearer {key}"
        else:  # v3 "API Key"
            params["api_key"] = key
        self._client = httpx.AsyncClient(base_url=API_BASE, headers=headers, params=params, timeout=20)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self._client.aclose()

    async def _get(self, path, **params):
        for attempt in range(4):
            try:
                resp = await self._client.get(path, params=params)
            except httpx.HTTPError as exc:
                if attempt == 3:
                    raise TMDBError("Could not reach TMDB. Are you connected to the internet?") from exc
                await asyncio.sleep(1 + attempt)
                continue
            if resp.status_code == 429:  # rate limited: wait and retry
                await asyncio.sleep(_retry_after(resp, attempt))
                continue
            if resp.status_code == 401:
                raise TMDBError("TMDB rejected the API key. Check it in Settings.", 401)
            if resp.status_code == 404:
                raise TMDBError("Not found on TMDB.", 404)
            if resp.is_error:
                raise TMDBError(f"TMDB returned an error ({resp.status_code}).")
            return resp.json()
        raise TMDBError("TMDB is busy right now. Try again in a moment.", 503)

    async def validate(self):
        await self._get("/configuration")

    async def search(self, query, page=1):
        return await self._get("/search/multi", query=query, page=page, include_adult="false")

    async def movie(self, movie_id):
        return await self._get(f"/movie/{movie_id}")

    async def show(self, show_id):
        """Show details plus every season (with its episodes) under "season_details"."""
        data = await self._get(f"/tv/{show_id}")
        numbers = [s["season_number"] for s in data.get("seasons") or []]
        details = {}
        for i in range(0, len(numbers), APPEND_LIMIT):
            batch = numbers[i : i + APPEND_LIMIT]
            extra = await self._get(f"/tv/{show_id}", append_to_response=",".join(f"season/{n}" for n in batch))
            for n in batch:
                if f"season/{n}" in extra:
                    details[n] = extra[f"season/{n}"]
        data["season_details"] = details
        return data
