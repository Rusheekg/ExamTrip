"""
serp_client.py
~~~~~~~~~~~~~~
Thin wrapper around SerpApi's Google Maps / Local results to look up exam
centres and extract their coordinates.

Cache strategy
--------------
Results are cached on disk in `.serp_cache/` as JSON files whose names are
the SHA-256 hash of the query string.  A cached file is considered fresh for
CACHE_TTL_DAYS days.  Set CACHE_TTL_DAYS=0 to always hit the live API.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import TypedDict

from dotenv import load_dotenv
from serpapi import GoogleSearch

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

load_dotenv()  # reads SERPAPI_API_KEY from .env if present

CACHE_DIR = Path(".serp_cache")
CACHE_TTL_DAYS: int = 7


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class CentreInfo(TypedDict):
    title: str
    address: str
    latitude: float
    longitude: float


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_path(query: str) -> Path:
    key = hashlib.sha256(query.encode()).hexdigest()
    return CACHE_DIR / f"{key}.json"


def _load_cache(query: str) -> dict | None:
    path = _cache_path(query)
    if not path.exists():
        return None
    age_seconds = time.time() - path.stat().st_mtime
    if CACHE_TTL_DAYS > 0 and age_seconds > CACHE_TTL_DAYS * 86400:
        return None  # stale
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _save_cache(query: str, data: dict) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    path = _cache_path(query)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


# ---------------------------------------------------------------------------
# Core lookup
# ---------------------------------------------------------------------------

def lookup_centre(place: str) -> CentreInfo:
    """Return title and GPS coordinates for *place* via Google Maps results.

    Parameters
    ----------
    place:
        Free-text description of the exam centre, e.g.
        ``"IIT Delhi, Hauz Khas, New Delhi"``.

    Returns
    -------
    CentreInfo
        Dictionary with keys ``title``, ``address``, ``latitude``,
        ``longitude``.

    Raises
    ------
    ValueError
        If the API returns no local results for the query.
    EnvironmentError
        If ``SERPAPI_API_KEY`` is not set.
    """
    api_key = os.getenv("SERPAPI_API_KEY", "")
    if not api_key or api_key == "PASTE_KEY_HERE":
        raise EnvironmentError(
            "SERPAPI_API_KEY is not set. "
            "Add your key to the .env file and restart."
        )

    cached = _load_cache(place)
    if cached is not None:
        return cached  # type: ignore[return-value]

    params = {
        "engine": "google_maps",
        "q": place,
        "type": "search",
        "api_key": api_key,
    }
    results = GoogleSearch(params).get_dict()

    local_results = results.get("local_results") or []
    if not local_results:
        raise ValueError(f"No local results found for: {place!r}")

    first = local_results[0]
    gps = first.get("gps_coordinates", {})

    info: CentreInfo = {
        "title": first.get("title", ""),
        "address": first.get("address", ""),
        "latitude": gps.get("latitude", float("nan")),
        "longitude": gps.get("longitude", float("nan")),
    }

    _save_cache(place, info)
    return info


# ---------------------------------------------------------------------------
# Quick smoke-test (run: python serp_client.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    query = "IIT Delhi, Hauz Khas, New Delhi"
    print(f"Looking up: {query!r}")
    info = lookup_centre(query)
    print(f"  Title    : {info['title']}")
    print(f"  Address  : {info['address']}")
    print(f"  Latitude : {info['latitude']}")
    print(f"  Longitude: {info['longitude']}")
