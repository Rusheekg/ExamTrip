"""
examtrip.py
~~~~~~~~~~~
Given an exam centre name, find nearby budget stays via Google Hotels and
return the 5 closest by straight-line (haversine) distance.

Usage
-----
    python examtrip.py
"""

from __future__ import annotations

import math
from typing import TypedDict

from serp_client import CentreInfo, lookup_centre, serp_search


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class StayResult(TypedDict):
    name: str
    price_inr: float
    rating: float | None
    reviews: int | None
    distance_km: float
    link: str


# ---------------------------------------------------------------------------
# Haversine
# ---------------------------------------------------------------------------

_EARTH_R_KM = 6371.0


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in km between two GPS points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * _EARTH_R_KM * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Stays search
# ---------------------------------------------------------------------------

_CHECK_IN  = "2026-10-30"
_CHECK_OUT = "2026-10-31"


def search_stays(centre: CentreInfo, top_n: int = 5) -> list[StayResult]:
    """Search Google Hotels near *centre* and return the *top_n* closest stays.

    Filters applied
    ---------------
    * Price ≤ ₹2,500 per night (``max_price=2500``, ``sort_by=3`` = price asc)
    * Properties with no price or no GPS coordinates are skipped.

    Parameters
    ----------
    centre:
        A :class:`~serp_client.CentreInfo` dict (from :func:`lookup_centre`).
    top_n:
        How many nearest stays to return (default 5).

    Returns
    -------
    list[StayResult]
        Sorted by ascending distance from the centre.
    """
    city = centre["address"].split(",")[-2].strip() if "," in centre["address"] else ""
    query = f"hotels near {centre['title']}, {city}"

    params = {
        "engine": "google_hotels",
        "q": query,
        "check_in_date": _CHECK_IN,
        "check_out_date": _CHECK_OUT,
        "adults": "2",
        "currency": "INR",
        "gl": "in",
        "hl": "en",
        "sort_by": "3",       # price ascending
        "max_price": "2500",
    }

    results = serp_search(params)
    properties = results.get("properties") or []

    stays: list[StayResult] = []
    for prop in properties:
        # --- price ---
        rate_info = prop.get("rate_per_night") or {}
        price_raw = rate_info.get("extracted_lowest")
        if price_raw is None:
            continue

        # --- coordinates ---
        gps = prop.get("gps_coordinates") or {}
        lat = gps.get("latitude")
        lon = gps.get("longitude")
        if lat is None or lon is None:
            continue

        dist_km = haversine(centre["latitude"], centre["longitude"], lat, lon)

        stays.append(StayResult(
            name=prop.get("name", ""),
            price_inr=float(price_raw),
            rating=prop.get("overall_rating"),
            reviews=prop.get("reviews"),
            distance_km=round(dist_km, 2),
            link=prop.get("link", ""),
        ))

    stays.sort(key=lambda s: s["distance_km"])
    return stays[:top_n]


# ---------------------------------------------------------------------------
# CLI / smoke-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    place = "IIT Delhi, Hauz Khas, New Delhi"

    print(f"Centre : {place}")
    centre = lookup_centre(place)
    print(f"  -> {centre['title']}")
    print(f"  -> {centre['address']}")
    print(f"  -> {centre['latitude']:.6f}, {centre['longitude']:.6f}")
    print()

    stays = search_stays(centre)

    if not stays:
        print("No stays found matching the criteria.")
    else:
        print(f"{'#':<3}  {'Name':<42}  {'INR/night':>9}  {'Rating':>6}  {'Dist km':>8}")
        print("-" * 75)
        for i, s in enumerate(stays, 1):
            rating_str = f"{s['rating']:.1f}" if s["rating"] is not None else "  n/a"
            print(
                f"{i:<3}  {s['name']:<42}  {s['price_inr']:>8.0f}  "
                f"{rating_str:>6}  {s['distance_km']:>7.2f}"
            )
