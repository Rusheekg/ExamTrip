"""
essentials.py
~~~~~~~~~~~~~
Find nearby essential services (print shops, pharmacies) around an exam centre
using Google Maps via SerpApi.
"""

from __future__ import annotations

import math
from typing import Any

from serp_client import serp_search


# ---------------------------------------------------------------------------
# Haversine distance
# ---------------------------------------------------------------------------

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return the great-circle distance in metres between two GPS points."""
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Core helper
# ---------------------------------------------------------------------------

def _fetch_nearby(category: str, lat: float, lng: float) -> list[dict[str, Any]]:
    """Search Google Maps for *category* near (*lat*, *lng*) and return the
    3 nearest results, each with title, rating, address, open_state, and
    distance_m.  Returns an empty list if the API returns nothing."""
    params = {
        "engine": "google_maps",
        "type": "search",
        "q": category,
        "ll": f"@{lat},{lng},16z",
        "hl": "en",
    }

    try:
        results = serp_search(params)
    except Exception as exc:
        print(f"[essentials] serp_search failed for {category!r}: {exc}")
        return []

    local_results: list[dict] = results.get("local_results") or []

    places = []
    for place in local_results:
        gps = place.get("gps_coordinates") or {}
        place_lat = gps.get("latitude")
        place_lng = gps.get("longitude")

        if place_lat is None or place_lng is None:
            # Cannot compute distance — skip rather than crash
            distance_m = float("inf")
        else:
            distance_m = _haversine_m(lat, lng, place_lat, place_lng)

        places.append(
            {
                "title": place.get("title") or "",
                "rating": place.get("rating"),          # may be None
                "address": place.get("address") or "",
                "open_state": place.get("open_state") or "",
                "distance_m": round(distance_m, 1),
            }
        )

    # Sort by distance and keep the 3 nearest
    places.sort(key=lambda p: p["distance_m"])
    return places[:3]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def find_essentials(lat: float, lng: float) -> dict[str, list[dict[str, Any]]]:
    """Return nearby print shops and pharmacies around the given coordinates.

    Parameters
    ----------
    lat, lng:
        GPS coordinates of the exam centre.

    Returns
    -------
    dict with keys ``"print_shops"`` and ``"pharmacies"``, each a list of up
    to 3 places sorted by straight-line distance from the centre.  Every place
    dict has: ``title``, ``rating``, ``address``, ``open_state``,
    ``distance_m``.
    """
    return {
        "print_shops": _fetch_nearby("photocopy and print shop", lat, lng),
        "pharmacies": _fetch_nearby("pharmacy", lat, lng),
    }


# ---------------------------------------------------------------------------
# Quick test (run: python essentials.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    # Force UTF-8 output so Windows consoles don't crash on Unicode characters
    # embedded in addresses returned by the API.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    LAT, LNG = 28.545718, 77.192768
    print(f"Finding essentials near ({LAT}, {LNG}) ...\n")

    essentials = find_essentials(LAT, LNG)

    print("=== Print Shops ===")
    for i, p in enumerate(essentials["print_shops"], 1):
        print(
            f"  {i}. {p['title']}\n"
            f"     Rating    : {p['rating']}\n"
            f"     Address   : {p['address']}\n"
            f"     Open state: {p['open_state']}\n"
            f"     Distance  : {p['distance_m']} m\n"
        )
    if not essentials["print_shops"]:
        print("  (no results)\n")

    print("=== Pharmacies ===")
    for i, p in enumerate(essentials["pharmacies"], 1):
        print(
            f"  {i}. {p['title']}\n"
            f"     Rating    : {p['rating']}\n"
            f"     Address   : {p['address']}\n"
            f"     Open state: {p['open_state']}\n"
            f"     Distance  : {p['distance_m']} m\n"
        )
    if not essentials["pharmacies"]:
        print("  (no results)\n")
