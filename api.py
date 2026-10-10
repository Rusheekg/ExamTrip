"""
api.py
~~~~~~
FastAPI web API for ExamTrip.

Run with:
    uvicorn api:app --reload
"""

from __future__ import annotations

import math
import os
from datetime import date
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

import serp_client  # loads .env via explicit path at import time
from essentials import find_essentials
from examtrip import TripPlan, plan_trip, pick_best_stay

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="ExamTrip API")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean(obj: Any) -> Any:
    """Recursively replace float inf / nan with None so JSON serialisation
    never produces invalid tokens."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    return obj


def _strip_private(stays: list) -> list:
    """Remove the internal ``_lat`` / ``_lon`` scratch keys from each stay."""
    cleaned = []
    for stay in stays:
        cleaned.append({k: v for k, v in stay.items() if not k.startswith("_")})
    return cleaned


def _error(message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class PlanRequest(BaseModel):
    centre_address: str
    city: str
    exam_date: str          # YYYY-MM-DD
    reporting_time: str     # HH:MM
    max_budget: int
    people: int

    @field_validator("exam_date")
    @classmethod
    def _validate_date(cls, v: str) -> str:
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("exam_date must be YYYY-MM-DD")
        return v

    @field_validator("reporting_time")
    @classmethod
    def _validate_time(cls, v: str) -> str:
        parts = v.split(":")
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            raise ValueError("reporting_time must be HH:MM")
        hh, mm = int(parts[0]), int(parts[1])
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            raise ValueError("reporting_time must be a valid 24-hour time")
        return v

    @field_validator("max_budget")
    @classmethod
    def _validate_budget(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("max_budget must be a positive integer")
        return v

    @field_validator("people")
    @classmethod
    def _validate_people(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("people must be a positive integer")
        return v


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "has_key": serp_client.has_api_key()}


@app.post("/api/plan")
async def plan(req: PlanRequest) -> JSONResponse:
    # --- validate non-empty strings ---
    if not req.centre_address.strip():
        return _error("centre_address must not be blank", 400)
    if not req.city.strip():
        return _error("city must not be blank", 400)

    # --- API key check ---
    if not serp_client.has_api_key():
        return _error(
            "SERPAPI_API_KEY is not configured. Add your key to the .env file.",
            503,
        )

    # --- call plan_trip ---
    try:
        trip: TripPlan = plan_trip(
            centre_address=req.centre_address.strip(),
            city=req.city.strip(),
            exam_date=date.fromisoformat(req.exam_date),
            reporting_time=req.reporting_time,
            max_budget=req.max_budget,
            people=req.people,
        )
    except EnvironmentError as exc:
        return _error(str(exc), 503)
    except ValueError as exc:
        msg = str(exc)
        if "No local results" in msg:
            return _error(
                f"Exam centre not found: {req.centre_address!r}. "
                "Try a more specific address.",
                404,
            )
        return _error(msg, 400)
    except ConnectionError as exc:
        return _error(f"Network error contacting SerpApi: {exc}", 502)
    except Exception as exc:
        # Catch SerpApi HTTP errors (they may surface as generic exceptions)
        msg = str(exc)
        if "api_key" in msg.lower() or "SERPAPI_API_KEY" in msg:
            # Never leak the key
            return _error("SerpApi authentication failed.", 503)
        return _error(f"SerpApi error: {exc}", 502)

    stays = trip["stays"]
    if not stays:
        return _error(
            f"No stays found near {trip['centre']['title']!r} "
            f"within ₹{req.max_budget}/night. Try increasing the budget.",
            404,
        )

    # --- best pick ---
    best = pick_best_stay(stays)

    # --- essentials (best-effort) ---
    essentials: dict | None = None
    try:
        c_lat = trip["centre"]["latitude"]
        c_lng = trip["centre"]["longitude"]
        essentials = find_essentials(c_lat, c_lng)
    except Exception:
        essentials = None

    # --- assemble response ---
    response: dict[str, Any] = {
        "centre": trip["centre"],
        "stays": _strip_private(stays),
        "best_pick": {k: v for k, v in best.items() if not k.startswith("_")},
        "station_route": trip["station_route"],
        "arrive_by_accepted": trip["arrive_by_accepted"],
        "food": trip["food"],
        "essentials": essentials,
    }

    return JSONResponse(_clean(response))


# ---------------------------------------------------------------------------
# Validation error handler — return {"error": ...} shape, not FastAPI default
# ---------------------------------------------------------------------------

from fastapi.exceptions import RequestValidationError  # noqa: E402


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    first = exc.errors()[0]
    return _error(first.get("msg", "Invalid request"), 400)


# ---------------------------------------------------------------------------
# Static files (served last so API routes take priority)
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory="web", html=True), name="static")
