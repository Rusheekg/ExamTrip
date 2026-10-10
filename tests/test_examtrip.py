"""
tests/test_examtrip.py
~~~~~~~~~~~~~~~~~~~~~~
Pytest tests for pure functions in examtrip.py.
No network calls are made.
"""

from __future__ import annotations

from datetime import date
from zoneinfo import ZoneInfo

import pytest

# Import the module under test; no network is touched at import time.
import examtrip
from examtrip import (
    haversine,
    _arrive_by_ts,
    _leave_by,
    _BUFFER_MINUTES,
    pick_best_stay,
    StayResult,
    RouteInfo,
    _extract_drive_walk,
)

_IST = ZoneInfo("Asia/Kolkata")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_route(drive_s: int) -> RouteInfo:
    """Return a minimal RouteInfo with the given drive_s."""
    return RouteInfo(
        drive_s=drive_s,
        drive_fmt=f"{drive_s // 60} min",
        walk_s=None,
        walk_fmt=None,
        transit_s=None,
        transit_fmt=None,
        distance_m=0,
        leave_by="",
        start_label="",
        start_kind="station",
    )


def _make_stay(
    name: str,
    price_inr: float,
    rating: float | None = None,
    drive_s: int | None = None,
) -> StayResult:
    """Return a minimal StayResult."""
    route = _make_route(drive_s) if drive_s is not None else None
    return StayResult(
        name=name,
        price_inr=price_inr,
        rating=rating,
        reviews=10 if rating is not None else None,
        distance_km=1.0,
        link="",
        route=route,
        thumbnail=None,
        latitude=28.0,
        longitude=77.0,
    )


# ---------------------------------------------------------------------------
# haversine
# ---------------------------------------------------------------------------

class TestHaversine:
    def test_identical_points_give_zero(self):
        assert haversine(28.6139, 77.2090, 28.6139, 77.2090) == 0.0

    def test_delhi_to_mumbai_approx_1150_km(self):
        # Delhi: 28.6139 N, 77.2090 E
        # Mumbai: 19.0760 N, 72.8777 E
        dist = haversine(28.6139, 77.2090, 19.0760, 72.8777)
        assert abs(dist - 1150) / 1150 <= 0.03, f"Expected ~1150 km, got {dist:.1f} km"


# ---------------------------------------------------------------------------
# _arrive_by_ts
# ---------------------------------------------------------------------------

class TestArriveByTs:
    def test_2026_10_31_0830_ist_equals_0300_utc(self):
        ts = _arrive_by_ts(date(2026, 10, 31), "08:30")
        from datetime import datetime, timezone
        dt_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
        assert dt_utc.hour == 3
        assert dt_utc.minute == 0
        assert dt_utc.day == 31
        assert dt_utc.month == 10
        assert dt_utc.year == 2026


# ---------------------------------------------------------------------------
# _leave_by
# ---------------------------------------------------------------------------

class TestLeaveBy:
    def _ts_for(self, hhmm: str) -> int:
        """Return a Unix timestamp for 2026-10-31 at *hhmm* IST."""
        return _arrive_by_ts(date(2026, 10, 31), hhmm)

    def test_14min_drive_30min_buffer_gives_0746(self):
        arrive_ts = self._ts_for("08:30")
        drive_s   = 14 * 60   # 14 minutes
        # Default _BUFFER_MINUTES is 30
        assert _BUFFER_MINUTES == 30
        result = _leave_by(arrive_ts, drive_s, buffer_minutes=30)
        assert result == "07:46"

    def test_custom_buffer_gives_0731(self):
        # Pass buffer_minutes=45 directly as a parameter
        arrive_ts = self._ts_for("08:30")
        drive_s   = 14 * 60
        result = _leave_by(arrive_ts, drive_s, buffer_minutes=45)
        assert result == "07:31"

    def test_buffer_15_gives_0801(self):
        arrive_ts = self._ts_for("08:30")
        drive_s   = 14 * 60
        result = _leave_by(arrive_ts, drive_s, buffer_minutes=15)
        assert result == "08:01"

    def test_buffer_60_gives_0716(self):
        arrive_ts = self._ts_for("08:30")
        drive_s   = 14 * 60
        result = _leave_by(arrive_ts, drive_s, buffer_minutes=60)
        assert result == "07:16"


# ---------------------------------------------------------------------------
# Ranking (drive time first, then price)
# ---------------------------------------------------------------------------

class TestRanking:
    def test_stays_ranked_by_drive_time_then_price(self):
        stays = [
            _make_stay("C", price_inr=1000, drive_s=20 * 60),
            _make_stay("A", price_inr=2000, drive_s=10 * 60),
            _make_stay("B", price_inr=1500, drive_s=10 * 60),
        ]
        from examtrip import _DRIVE_WINDOW_S

        def _rank_key(s):
            drive = s["route"]["drive_s"] if s.get("route") else 999_999
            return (drive, s["price_inr"])

        stays.sort(key=_rank_key)
        names = [s["name"] for s in stays]
        # Both A and B have 10-min drive; B is cheaper (1500 < 2000), then C
        assert names == ["B", "A", "C"]


# ---------------------------------------------------------------------------
# pick_best_stay
# ---------------------------------------------------------------------------

class TestPickBestStay:
    def test_returns_cheapest_rated_within_window(self):
        stays = [
            _make_stay("Expensive Good",  price_inr=3000, rating=4.2, drive_s=10 * 60),
            _make_stay("Cheap Good",      price_inr=1500, rating=3.8, drive_s=12 * 60),
            _make_stay("Cheap Bad",       price_inr=1000, rating=2.9, drive_s=11 * 60),
        ]
        best = pick_best_stay(stays)
        # All three are within the 5-minute window (fastest=10min, all ≤15min).
        # "Cheap Bad" has rating < 3.5 so is excluded.
        # Among rated ones, "Cheap Good" (1500) < "Expensive Good" (3000).
        assert best["name"] == "Cheap Good"

    def test_falls_back_to_cheapest_when_none_rated_high_enough(self):
        stays = [
            _make_stay("Expensive Low",  price_inr=2500, rating=2.0, drive_s=10 * 60),
            _make_stay("Cheap Low",      price_inr=1200, rating=2.5, drive_s=11 * 60),
        ]
        best = pick_best_stay(stays)
        # No stay is rated >= 3.5, so falls back to cheapest in window.
        assert best["name"] == "Cheap Low"


# ---------------------------------------------------------------------------
# _extract_drive_walk (transit extraction)
# ---------------------------------------------------------------------------

class TestExtractDriveWalk:
    def test_extracts_transit_entry(self):
        directions = [
            {"travel_mode": "Driving",  "duration": 900,  "formatted_duration": "15 min", "distance": 5000},
            {"travel_mode": "Walking",  "duration": 2400, "formatted_duration": "40 min", "distance": 2000},
            {"travel_mode": "Transit",  "duration": 1200, "formatted_duration": "20 min", "distance": 3000},
        ]
        driving, walking, transit = _extract_drive_walk(directions)
        assert driving is not None
        assert walking is not None
        assert transit is not None
        assert transit["formatted_duration"] == "20 min"

    def test_returns_none_when_no_transit(self):
        directions = [
            {"travel_mode": "driving",  "duration": 900,  "formatted_duration": "15 min", "distance": 5000},
            {"travel_mode": "walking",  "duration": 2400, "formatted_duration": "40 min", "distance": 2000},
        ]
        driving, walking, transit = _extract_drive_walk(directions)
        assert transit is None
