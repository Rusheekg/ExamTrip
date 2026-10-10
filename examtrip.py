"""
examtrip.py
~~~~~~~~~~~
Plan a trip to an exam centre: find nearby budget stays, get routes from each
stay (and from the railway station) to the centre, rank by driving time then
price, and compute the leave-by time.

Primary entry point
-------------------
    plan_trip(centre_address, city, exam_date, reporting_time,
              max_budget, people) -> dict

Usage
-----
    python examtrip.py
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import TypedDict
from zoneinfo import ZoneInfo

from serp_client import CentreInfo, lookup_centre, serp_search

_IST = ZoneInfo("Asia/Kolkata")
_BUFFER_MINUTES = 30


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class RouteInfo(TypedDict):
    drive_s: int             # Driving duration in seconds
    drive_fmt: str           # e.g. "14 min"
    walk_s: int | None       # Walking duration in seconds (None if unavailable)
    walk_fmt: str | None     # e.g. "40 min"
    distance_m: int          # metres (Driving route)
    leave_by: str            # "HH:MM" IST


class StayResult(TypedDict):
    name: str
    price_inr: float
    rating: float | None
    reviews: int | None
    distance_km: float
    link: str
    route: RouteInfo | None
    thumbnail: str | None
    latitude: float
    longitude: float


class FoodResult(TypedDict):
    title: str
    rating: float | None
    reviews: int | None
    price: str | None        # e.g. "$", "$$", None
    address: str
    distance_m: int          # straight-line distance from the centre


class TripPlan(TypedDict):
    centre: CentreInfo
    stays: list[StayResult]       # ranked by drive_s then price
    station_route: RouteInfo | None
    arrive_by_accepted: bool      # True if the timed request succeeded
    food: list[FoodResult]        # up to 5 rated restaurants near the centre


# ---------------------------------------------------------------------------
# Haversine
# ---------------------------------------------------------------------------

_EARTH_R_KM = 6371.0


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in km between two GPS points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2)
    return 2 * _EARTH_R_KM * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Arrive-by timestamp
# ---------------------------------------------------------------------------

def _arrive_by_ts(exam_date: date, reporting_time: str) -> int:
    """Return a Unix timestamp (int) for *exam_date* at *reporting_time* IST.

    Parameters
    ----------
    exam_date:
        The date of the exam, e.g. ``date(2026, 10, 31)``.
    reporting_time:
        24-hour ``"HH:MM"`` string, e.g. ``"08:30"``.
    """
    hh, mm = map(int, reporting_time.split(":"))
    dt = datetime(exam_date.year, exam_date.month, exam_date.day,
                  hh, mm, tzinfo=_IST)
    return int(dt.timestamp())


# ---------------------------------------------------------------------------
# Leave-by calculation
# ---------------------------------------------------------------------------

def _leave_by(arrive_ts: int, duration_s: int) -> str:
    """Return the leave-by time as ``"HH:MM"`` IST.

    Subtracts *duration_s* + BUFFER_MINUTES from *arrive_ts*.
    """
    leave_ts = arrive_ts - duration_s - _BUFFER_MINUTES * 60
    leave_dt = datetime.fromtimestamp(leave_ts, tz=_IST)
    return leave_dt.strftime("%H:%M")


# ---------------------------------------------------------------------------
# Route lookup (Google Maps Directions)
# ---------------------------------------------------------------------------

def _extract_drive_walk(directions: list[dict]) -> tuple[dict | None, dict | None]:
    """Scan *directions[]* and return the best Driving and Walking entries.

    "Best" means lowest duration among all entries with that travel_mode.
    Returns (driving_entry, walking_entry); either may be None.
    """
    driving: dict | None = None
    walking: dict | None = None
    for entry in directions:
        mode = (entry.get("travel_mode") or "").lower()
        if mode == "driving":
            if driving is None or entry.get("duration", 999_999) < driving.get("duration", 999_999):
                driving = entry
        elif mode == "walking":
            if walking is None or entry.get("duration", 999_999) < walking.get("duration", 999_999):
                walking = entry
    return driving, walking


def get_route(
    start_coords: str | None,
    end_coords: str,
    arrive_ts: int,
    start_addr: str | None = None,
) -> tuple[RouteInfo | None, bool]:
    """Fetch driving + walking durations from *start* to *end*.

    Strategy
    --------
    1. Request with ``time="arrive_by:<arrive_ts>"``.  On error or no
       directions, retry once **without** the time parameter.
    2. From the response, scan ``directions[]`` for entries whose
       ``travel_mode`` is ``"Driving"`` or ``"Walking"``.
    3. If no Driving entry is found in the initial response, make one more
       request with ``travel_mode=0`` (Driving) to get a driving duration.

    Returns
    -------
    (RouteInfo | None, arrive_by_accepted: bool)
        ``arrive_by_accepted`` is True when the timed request succeeded.

    Parameters
    ----------
    start_coords:
        ``"<lat>,<lng>"`` string, or ``None`` if *start_addr* is used.
    end_coords:
        ``"<lat>,<lng>"`` string for the destination.
    arrive_ts:
        Unix timestamp for the arrive-by constraint.
    start_addr:
        Free-text address used when *start_coords* is ``None``.
    """
    base: dict = {
        "engine": "google_maps_directions",
        "end_coords": end_coords,
        "distance_unit": "0",
        "hl": "en",
        "gl": "in",
    }
    if start_coords is not None:
        base["start_coords"] = start_coords
    else:
        base["start_addr"] = start_addr

    # --- step 1: timed request, fall back to plain ---
    arrive_by_accepted = False
    results: dict | None = None
    for attempt in ("timed", "plain"):
        params = dict(base)
        if attempt == "timed":
            params["time"] = f"arrive_by:{arrive_ts}"
        r = serp_search(params)
        if not r.get("error") and r.get("directions"):
            results = r
            arrive_by_accepted = (attempt == "timed")
            break

    if results is None:
        return None, False

    # --- step 2: extract Driving and Walking from directions[] ---
    driving, walking = _extract_drive_walk(results.get("directions") or [])

    # --- step 3: if no Driving entry, fetch driving-only route ---
    if driving is None:
        drive_params = {**base, "travel_mode": "0"}
        drive_results = serp_search(drive_params)
        if not drive_results.get("error") and drive_results.get("directions"):
            driving, _ = _extract_drive_walk(drive_results.get("directions") or [])
            # fall back to directions[0] of the driving-only response if still None
            if driving is None:
                dirs = drive_results.get("directions") or []
                if dirs:
                    driving = dirs[0]

    if driving is None:
        return None, arrive_by_accepted

    walk_s   = walking.get("duration")   if walking else None
    walk_fmt = walking.get("formatted_duration") if walking else None

    return RouteInfo(
        drive_s=driving.get("duration", 0),
        drive_fmt=driving.get("formatted_duration", ""),
        walk_s=walk_s,
        walk_fmt=walk_fmt,
        distance_m=driving.get("distance", 0),
        leave_by="",   # filled in by caller
    ), arrive_by_accepted


# ---------------------------------------------------------------------------
# Stays search
# ---------------------------------------------------------------------------

def search_stays(
    centre: CentreInfo,
    city: str,
    exam_date: date,
    max_budget: int,
    people: int,
    top_n: int = 5,
) -> list[StayResult]:
    """Search Google Hotels near *centre* and return the *top_n* closest stays.

    The check-in date is the eve of *exam_date* and check-out is *exam_date*.
    Properties with no price or no GPS coordinates are skipped.
    """
    checkin  = (exam_date - timedelta(days=1)).strftime("%Y-%m-%d")
    checkout = exam_date.strftime("%Y-%m-%d")

    query = f"hotels near {centre['title']}, {city}"
    params = {
        "engine": "google_hotels",
        "q": query,
        "check_in_date": checkin,
        "check_out_date": checkout,
        "adults": str(people),
        "currency": "INR",
        "gl": "in",
        "hl": "en",
        "sort_by": "3",              # price ascending
        "max_price": str(max_budget),
    }

    results = serp_search(params)
    properties = results.get("properties") or []

    stays: list[StayResult] = []
    for prop in properties:
        rate_info = prop.get("rate_per_night") or {}
        price_raw = rate_info.get("extracted_lowest")
        if price_raw is None:
            continue

        gps = prop.get("gps_coordinates") or {}
        lat = gps.get("latitude")
        lon = gps.get("longitude")
        if lat is None or lon is None:
            continue

        dist_km = haversine(centre["latitude"], centre["longitude"], lat, lon)

        images = prop.get("images") or []
        thumbnail = images[0].get("thumbnail") if images else None

        entry = StayResult(
            name=prop.get("name", ""),
            price_inr=float(price_raw),
            rating=prop.get("overall_rating"),
            reviews=prop.get("reviews"),
            distance_km=round(dist_km, 2),
            link=prop.get("link", ""),
            route=None,
            thumbnail=thumbnail,
            latitude=lat,
            longitude=lon,
        )
        # Stash raw coords for route lookup (not part of the public schema)
        entry["_lat"] = lat   # type: ignore[typeddict-unknown-key]
        entry["_lon"] = lon   # type: ignore[typeddict-unknown-key]
        stays.append(entry)

    stays.sort(key=lambda s: s["distance_km"])
    return stays[:top_n]


# ---------------------------------------------------------------------------
# Food search
# ---------------------------------------------------------------------------

def search_food(centre: CentreInfo, top_n: int = 5) -> list[FoodResult]:
    """Return up to *top_n* rated restaurants near *centre*, sorted by
    straight-line distance from the centre.

    Uses ``engine=google_maps`` with a ``ll`` (location/zoom) parameter so
    the results are centred on the exam venue.
    """
    c_lat = centre["latitude"]
    c_lon = centre["longitude"]
    params = {
        "engine": "google_maps",
        "type": "search",
        "q": "budget restaurants",
        "ll": f"@{c_lat},{c_lon},16z",
        "hl": "en",
    }
    results = serp_search(params)
    local_results = results.get("local_results") or []

    food: list[FoodResult] = []
    for item in local_results:
        if item.get("rating") is None:
            continue
        gps = item.get("gps_coordinates") or {}
        r_lat = gps.get("latitude")
        r_lon = gps.get("longitude")
        dist_m = (
            int(haversine(c_lat, c_lon, r_lat, r_lon) * 1000)
            if r_lat is not None and r_lon is not None
            else 0
        )
        food.append(FoodResult(
            title=item.get("title", ""),
            rating=item.get("rating"),
            reviews=item.get("reviews"),
            price=item.get("price"),
            address=item.get("address", ""),
            distance_m=dist_m,
        ))

    food.sort(key=lambda x: x["distance_m"])
    return food[:top_n]


# ---------------------------------------------------------------------------
# Main planner
# ---------------------------------------------------------------------------

def plan_trip(
    centre_address: str,
    city: str,
    exam_date: date,
    reporting_time: str,
    max_budget: int,
    people: int,
) -> TripPlan:
    """Plan a trip to an exam centre.

    Parameters
    ----------
    centre_address:
        Free-text address used to locate the centre, e.g.
        ``"IIT Delhi, Hauz Khas, New Delhi"``.
    city:
        City name used in hotel and station queries, e.g. ``"New Delhi"``.
    exam_date:
        Date of the exam.
    reporting_time:
        Reporting / arrival time at the centre as ``"HH:MM"`` (24-hour, IST).
    max_budget:
        Maximum price per night in INR.
    people:
        Number of adults.

    Returns
    -------
    TripPlan
        Dict with keys ``centre``, ``stays`` (ranked), ``station_route``.
    """
    centre = lookup_centre(centre_address)
    arrive_ts = _arrive_by_ts(exam_date, reporting_time)
    end_coords = f"{centre['latitude']},{centre['longitude']}"

    # --- shortlist stays ---
    stays = search_stays(centre, city, exam_date, max_budget, people)

    # --- fetch route for each stay and fill leave_by ---
    # Track whether arrive_by was accepted across all requests (first hit wins)
    arrive_by_accepted: bool | None = None
    for stay in stays:
        lat = stay.get("_lat")   # type: ignore[typeddict-item]
        lon = stay.get("_lon")   # type: ignore[typeddict-item]
        if lat is None or lon is None:
            continue
        route, accepted = get_route(f"{lat},{lon}", end_coords, arrive_ts)
        if arrive_by_accepted is None:
            arrive_by_accepted = accepted
        if route is not None:
            route["leave_by"] = _leave_by(arrive_ts, route["drive_s"])
        stay["route"] = route

    # --- station route ---
    station_addr = f"{city} railway station"
    station_route, st_accepted = get_route(None, end_coords, arrive_ts, start_addr=station_addr)
    if arrive_by_accepted is None:
        arrive_by_accepted = st_accepted
    if station_route is not None:
        station_route["leave_by"] = _leave_by(arrive_ts, station_route["drive_s"])

    # --- rank: drive_s asc, then price asc; no-route stays go last ---
    def _rank_key(s: StayResult) -> tuple:
        drive = s["route"]["drive_s"] if s.get("route") else 999_999
        return (drive, s["price_inr"])

    stays.sort(key=_rank_key)

    # --- food near the centre ---
    food = search_food(centre)

    return TripPlan(
        centre=centre,
        stays=stays,
        station_route=station_route,
        arrive_by_accepted=bool(arrive_by_accepted),
        food=food,
    )


# ---------------------------------------------------------------------------
# Best-pick selection
# ---------------------------------------------------------------------------

_DRIVE_WINDOW_S = 5 * 60   # 5 minutes in seconds
_MIN_RATING     = 3.5


def pick_best_stay(stays: list[StayResult]) -> StayResult:
    """Choose the best stay from a ranked list.

    Algorithm
    ---------
    1. Find the fastest drive time among all stays with a route.
    2. Keep every stay whose drive time is within 5 minutes of that fastest.
    3. Among those, prefer stays rated >= 3.5; if none qualify, use all of them.
    4. Return the cheapest of the resulting group.

    Falls back to ``stays[0]`` if no stay has a route.
    """
    with_route = [s for s in stays if s.get("route")]
    if not with_route:
        return stays[0]

    fastest_s = min(s["route"]["drive_s"] for s in with_route)  # type: ignore[index]
    window = [s for s in with_route if s["route"]["drive_s"] <= fastest_s + _DRIVE_WINDOW_S]  # type: ignore[index]

    rated = [s for s in window if (s["rating"] or 0) >= _MIN_RATING]
    candidates = rated if rated else window

    return min(candidates, key=lambda s: s["price_inr"])


# ---------------------------------------------------------------------------
# CLI / smoke-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from datetime import date as _date

    plan = plan_trip(
        centre_address="IIT Delhi, Hauz Khas, New Delhi",
        city="New Delhi",
        exam_date=_date(2026, 10, 31),
        reporting_time="08:30",
        max_budget=2500,
        people=2,
    )

    c = plan["centre"]
    print(f"Centre : {c['title']}")
    print(f"         {c['address']}")
    flag = "accepted" if plan["arrive_by_accepted"] else "not accepted (used plain fallback)"
    print(f"arrive_by parameter: {flag}")
    print()

    stays = plan["stays"]
    if not stays:
        print("No stays found matching the criteria.")
    else:
        hdr = (f"{'#':<3}  {'Name':<40}  {'INR':>6}"
               f"  {'Drive':>8}  {'Walk':>8}  {'Dist km':>7}  {'Leave by':>8}")
        print(hdr)
        print("-" * len(hdr))
        for i, s in enumerate(stays, 1):
            r = s.get("route")
            drive    = r["drive_fmt"]                      if r else "n/a"
            walk     = (r["walk_fmt"] or "n/a")            if r else "n/a"
            dist_km  = f"{r['distance_m'] / 1000:.1f}"    if r else "n/a"
            leave_by = r["leave_by"]                       if r else "n/a"
            print(
                f"{i:<3}  {s['name']:<40}  {s['price_inr']:>6.0f}"
                f"  {drive:>8}  {walk:>8}  {dist_km:>7}  {leave_by:>8}"
            )

    print()
    sr = plan["station_route"]
    if sr:
        print("Station route (New Delhi railway station -> centre)")
        print(f"  Drive    : {sr['drive_fmt']}")
        print(f"  Walk     : {sr['walk_fmt'] or 'n/a'}")
        print(f"  Distance : {sr['distance_m'] / 1000:.1f} km")
        print(f"  Leave by : {sr['leave_by']}")
    else:
        print("Station route: not available.")

    print()
    print("Places to eat near the centre")
    print("-" * 50)
    for f in plan["food"]:
        price_str = f" ({f['price']})" if f.get("price") else ""
        print(f"  {f['title']:<35} {f['rating']} stars{price_str}")
        print(f"    {f['address']}")
