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

class AlternativeCentre(TypedDict):
    title: str
    address: str


class CentreInfo(TypedDict):
    title: str
    address: str
    latitude: float
    longitude: float
    alternatives: list  # list[AlternativeCentre]


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

def lookup_centre(address: str, city: str = "") -> CentreInfo:
    """Return title and GPS coordinates for an exam centre in India.

    Parameters
    ----------
    address:
        Free-text address of the exam centre, e.g.
        ``"IIT Delhi, Hauz Khas, New Delhi"``.
    city:
        Optional city hint used to build more targeted fallback queries.

    Returns
    -------
    CentreInfo
        Dictionary with keys ``title``, ``address``, ``latitude``,
        ``longitude``.

    Raises
    ------
    ValueError
        If none of the fallback queries return a result.
    """
    address = address.strip()
    city    = city.strip()

    # Build the ordered list of query strings to try
    queries: list[str] = []
    if city:
        queries.append(f"{address}, {city}")
        queries.append(f"{address} {city} exam centre")
    queries.append(address)

    def _first_result(results: dict) -> dict | None:
        """Return the first usable place from place_results or local_results."""
        place = results.get("place_results")
        if place:
            return place
        local = results.get("local_results") or []
        return local[0] if local else None

    for q in queries:
        params = {
            "engine": "google_maps",
            "q": q,
            "type": "search",
            "hl": "en",
        }
        results = serp_search(params)
        hit = _first_result(results)
        if hit:
            gps = hit.get("gps_coordinates") or {}
            # Collect up to 3 other local_results as alternatives
            local = results.get("local_results") or []
            alternatives: list[AlternativeCentre] = []
            for other in local:
                if other is hit:
                    continue
                t = other.get("title", "")
                a = other.get("address", "")
                if t or a:
                    alternatives.append(AlternativeCentre(title=t, address=a))
                if len(alternatives) >= 3:
                    break
            return CentreInfo(
                title=hit.get("title", ""),
                address=hit.get("address", ""),
                latitude=gps.get("latitude", float("nan")),
                longitude=gps.get("longitude", float("nan")),
                alternatives=alternatives,
            )

    raise ValueError(
        "Exam centre not found. Add the area, a landmark, "
        "or the PIN code from your admit card."
    )


# ---------------------------------------------------------------------------
# Quick smoke-test (run: python serp_client.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    query = "IIT Delhi, Hauz Khas"
    city  = "New Delhi"
    print(f"Looking up: {query!r} (city={city!r})")
    info = lookup_centre(query, city)
    print(f"  Title    : {info['title']}")
    print(f"  Address  : {info['address']}")
    print(f"  Latitude : {info['latitude']}")
    print(f"  Longitude: {info['longitude']}")
