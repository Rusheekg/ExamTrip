"""
serp_client.py
~~~~~~~~~~~~~~
Thin wrapper around SerpApi with disk-based caching.

Cache strategy
--------------
Results are cached in `.serp_cache/` as JSON files whose names are the
SHA-256 hash of all request params **except** ``api_key``.  A cached file is
considered fresh for CACHE_TTL_DAYS days.  Set CACHE_TTL_DAYS=0 to always hit
the live API.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, TypedDict

from dotenv import load_dotenv
from serpapi import GoogleSearch

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

load_dotenv(Path(__file__).resolve().parent / ".env")

CACHE_DIR = Path(__file__).resolve().parent / ".serp_cache"
CACHE_TTL_DAYS: int = 7


def has_api_key() -> bool:
    """Return True when SERPAPI_API_KEY is set to a real value."""
    key = os.getenv("SERPAPI_API_KEY", "")
    return bool(key) and key != "PASTE_KEY_HERE"


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

def _cache_key(params: dict[str, Any]) -> str:
    """Stable SHA-256 hash of *params* with ``api_key`` removed."""
    clean = {k: v for k, v in params.items() if k != "api_key"}
    serialised = json.dumps(clean, sort_keys=True)
    return hashlib.sha256(serialised.encode()).hexdigest()


def _cache_path(params: dict[str, Any]) -> Path:
    return CACHE_DIR / f"{_cache_key(params)}.json"


def _load_cache(params: dict[str, Any]) -> dict | None:
    path = _cache_path(params)
    if not path.exists():
        return None
    age_seconds = time.time() - path.stat().st_mtime
    if CACHE_TTL_DAYS > 0 and age_seconds > CACHE_TTL_DAYS * 86400:
        return None  # stale
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _save_cache(params: dict[str, Any], data: dict) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    path = _cache_path(params)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


# ---------------------------------------------------------------------------
# Generic search
# ---------------------------------------------------------------------------

def serp_search(params: dict[str, Any]) -> dict:
    """Execute a SerpApi search described by *params* and return the full
    result dict.  The ``api_key`` is injected automatically from the
    environment; callers must not include it.

    Results are cached on disk keyed by a hash of all params (api_key
    excluded) and reused within CACHE_TTL_DAYS days.

    Raises
    ------
    EnvironmentError
        If ``SERPAPI_API_KEY`` is not configured.
    """
    api_key = os.getenv("SERPAPI_API_KEY", "")
    if not api_key or api_key == "PASTE_KEY_HERE":
        raise EnvironmentError(
            "SERPAPI_API_KEY is not set. "
            "Add your key to the .env file and restart."
        )

    cached = _load_cache(params)
    if cached is not None:
        return cached

    full_params = {**params, "api_key": api_key}
    results = GoogleSearch(full_params).get_dict()

    _save_cache(params, results)
    return results


# ---------------------------------------------------------------------------
# Centre lookup (Google Maps)
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
    """
    params = {
        "engine": "google_maps",
        "q": place,
        "type": "search",
    }
    results = serp_search(params)

    local_results = results.get("local_results") or []
    if not local_results:
        raise ValueError(f"No local results found for: {place!r}")

    first = local_results[0]
    gps = first.get("gps_coordinates", {})

    return CentreInfo(
        title=first.get("title", ""),
        address=first.get("address", ""),
        latitude=gps.get("latitude", float("nan")),
        longitude=gps.get("longitude", float("nan")),
    )


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
