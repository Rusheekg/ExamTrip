# ExamTrip

**Your Exam Journey, Planned Smarter.**

ExamTrip takes an exam centre address, a reporting time, and a budget, and returns a shortlist of nearby budget stays, door-to-door drive times, a leave-by time, food options, and a timed exam-day checklist. All travel and accommodation data is fetched live from Google via SerpApi.

Built for the **SerpApi India Hackathon 2026, Travel & Local Discovery track.**

---

## The problem

Every year, students across India travel to unfamiliar cities to sit competitive exams, often with a parent and a tight budget. The admit card gives only a centre address. They then have to work out where to stay nearby, how long it takes to reach the centre by the reporting time, and where to eat. A wrong guess means an expensive room far away or a late arrival at the gate.

---

## What it does

### Search form

Fill in the centre address, city, exam date, reporting time (24-hour), number of travellers, and maximum budget per night. Three optional inputs refine the plan:

- **Starting from** — a free-text address such as a railway station or bus stand. If left empty, the app uses the city's main railway station.
- **Use my current location** — a button that reads the browser's GPS coordinates and uses them as the starting point.
- **Arrive early by** — a dropdown with four options (15, 30, 45, or 60 minutes). Defaults to 30 minutes. This buffer is subtracted from the reporting time when computing the leave-by time.

### Trip pass

After the search, a trip pass card shows the resolved centre name and address, the best-pick hotel, the leave-by time, the drive time, and the buffer used.

### "Not the right centre?" choices

If the address query returns more than one result from Google Maps, up to three alternative centre names and addresses are shown beneath the trip pass. Each is a button that re-runs the search with that centre selected.

### Seven result tabs

| # | Tab | Content |
|---|-----|---------|
| 1 | **Route** | Drive time and leave-by time from the starting point (station or custom) and from the best-pick hotel to the centre. Walking and public-transport times are shown where Google returns them. |
| 2 | **Stays** | All hotels returned within the budget, sortable by drive time, price, or rating, and filterable by a maximum price. Each card shows the hotel name, price per night, rating, distance from the centre, drive time, leave-by time, and a link to book. |
| 3 | **Food** | Up to 15 rated budget restaurants near the centre, sortable by nearest or top-rated. Each entry shows the name, rating, price tier, open state, and address. |
| 4 | **Overview** | The best-pick hotel card plus a Leaflet map with pins for the exam centre, the best pick, and all other shortlisted stays. |
| 5 | **Budget** | An editable breakdown: the stay cost is populated from live hotel data; food per person per day, local transport per day, and other expenses are user estimates. The total and a per-person figure update immediately. A progress bar shows spend against a total budget figure. |
| 6 | **Essentials** | The three nearest print shops and the three nearest pharmacies to the exam centre, with name, rating, address, and open state. |
| 7 | **Checklist** | A timed exam-day checklist built backwards from the leave-by time. Tick states are saved in the browser. |

### Sharing

Three buttons appear above the results:

- **Print my trip plan** — sends the page to the browser's print dialogue.
- **Copy trip summary** — copies a plain-text summary to the clipboard.
- **Share on WhatsApp** — opens a pre-filled WhatsApp message with the trip summary.

---

## How the key numbers are worked out

### Leave-by time

The leave-by time is computed in [`_leave_by()`](examtrip.py:123):

```
leave_ts = arrive_ts - drive_seconds - buffer_minutes × 60
```

`arrive_ts` is a Unix timestamp for the reporting time on the exam date in IST. The result is formatted as HH:MM IST. The buffer can be 15, 30, 45, or 60 minutes; the default is 30 minutes.

### Best-pick rule

[`pick_best_stay()`](examtrip.py:511) selects the recommended hotel in three steps:

1. Find the fastest drive time among all stays that have a route.
2. Keep every stay whose drive time is within **5 minutes** of that fastest.
3. Among those, prefer stays with a rating of **3.5 or above**. If none qualify, use all stays in the window.
4. Return the **cheapest** of the resulting group.

If no stay has a route at all, the first stay in the list is returned.

### Nearest-five shortlist

[`search_stays()`](examtrip.py:270) fetches hotels from Google Hotels sorted by price ascending, filters out any property with no price or no GPS coordinates, computes the straight-line (haversine) distance from the exam centre to each property, sorts by distance, and keeps the **five nearest** (`top_n=5`). Routes are then fetched only for those five, and the full list is re-sorted by drive time, then price.

---

## How it uses SerpApi

Every stay, route, and place shown in ExamTrip is live data fetched from SerpApi at plan time.

| Step | SerpApi engine | What is read |
|------|---------------|--------------|
| Locate exam centre | `google_maps` | `place_results` or first `local_results` entry: title, address, GPS coordinates, and up to 3 alternatives |
| Search budget stays | `google_hotels` | `properties[].name`, `rate_per_night.extracted_lowest`, `gps_coordinates`, `overall_rating`, `reviews`, `link`, `images` |
| Get route from stay to centre | `google_maps_directions` | `directions[].travel_mode`, `duration`, `formatted_duration`, `distance`; covers Driving, Walking, and Transit modes |
| Get route from starting point to centre | `google_maps_directions` | Same fields as above; starting point is the city's main railway station unless overridden |
| Find food near centre | `google_maps` | `local_results[].title`, `rating`, `reviews`, `price`, `open_state`, `address`, `gps_coordinates` |
| Find print shops near centre | `google_maps` | `local_results[].title`, `rating`, `address`, `open_state`, `gps_coordinates` |
| Find pharmacies near centre | `google_maps` | `local_results[].title`, `rating`, `address`, `open_state`, `gps_coordinates` |

### On-disk cache

Results are cached in `.serp_cache/` as JSON files. Each file is named after the SHA-256 hash of the request parameters **with `api_key` removed**, so the API key is never stored in the cache. A cached file is considered fresh for 7 days; set `CACHE_TTL_DAYS=0` in the environment to always hit the live API.

### Approximate call count per new trip plan

A typical uncached trip plan makes roughly **12 SerpApi calls**:

- 1 call to locate the centre
- 1 call to search hotels
- 5 calls for stay routes (one per shortlisted stay; a failed timed request adds one fallback, a missing driving entry adds one more)
- 1 call for the station or starting-point route
- 1 call for food
- 2 calls for essentials (one for print shops, one for pharmacies)

Subsequent searches for the same inputs are served from the cache without any API calls.

---

## Setup

Requires **Python 3.9 or later**.

```bash
git clone https://github.com/Rusheekg/ExamTrip.git
cd ExamTrip
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and add your SerpApi key:

```
SERPAPI_API_KEY=your_key_here
```

Start the server:

```bash
python -m uvicorn api:app
```

Open [http://localhost:8000](http://localhost:8000) in a browser.

A health check endpoint is available at [http://localhost:8000/api/health](http://localhost:8000/api/health). It returns `{"ok": true, "has_key": true}` when the API key is configured.

---

## Example

The inputs below match the smoke-test built into [`examtrip.py`](examtrip.py):

| Field | Value |
|-------|-------|
| Exam centre address | IIT Delhi, Hauz Khas, New Delhi |
| City | New Delhi |
| Exam date | Any future date |
| Reporting time | 08:30 |
| Travellers | 2 |
| Max budget per night (₹) | 2500 |

Results are live and will vary with availability and date.

---

## Running the tests

```bash
python -m pytest
```

The test suite in [`tests/test_examtrip.py`](tests/test_examtrip.py) covers the haversine function, the arrive-by timestamp calculation, leave-by times for all four buffer values, the stay ranking sort, `pick_best_stay` logic, and transit extraction. No network calls are made.

---

## Project structure

| File or folder | Purpose |
|----------------|---------|
| `api.py` | FastAPI web API. Exposes `POST /api/plan` and `GET /api/health`. Validates requests, calls `plan_trip`, selects the best pick, fetches essentials, and returns a JSON response. Serves the `web/` folder as static files. |
| `examtrip.py` | Core planning logic. `plan_trip()` orchestrates centre lookup, hotel search, route fetching, food search, and ranking. Also contains `pick_best_stay()`, `get_route()`, and the leave-by calculation. |
| `serp_client.py` | Thin wrapper around SerpApi. `serp_search()` injects the API key, checks the disk cache, and saves new results. `lookup_centre()` resolves a free-text address to GPS coordinates using `google_maps`. |
| `essentials.py` | Fetches the three nearest print shops and pharmacies to the exam centre using `google_maps`. |
| `app.py` | Earlier Streamlit interface for the same planning logic. Retained for reference. |
| `web/index.html` | Single-page HTML front-end with the search form, trip pass, seven result tabs, and sharing buttons. |
| `web/app.js` | Front-end JavaScript. Handles form submission, renders all result tabs, manages the budget calculator and checklist, and drives the Leaflet map. |
| `web/styles.css` | All CSS for the web front-end. |
| `web/404.html` | Custom 404 page served by the static file mount. |
| `tests/test_examtrip.py` | Pytest tests for pure functions in `examtrip.py`. No network calls. |
| `requirements.txt` | Python dependencies: `google-search-results`, `python-dotenv`, `fastapi`, `uvicorn`, `streamlit`, `pandas`, `pytest`. |
| `.env.example` | Template for the `.env` file. Contains one variable: `SERPAPI_API_KEY`. |
| `.serp_cache/` | Auto-created directory for on-disk API response cache. |

---

## Limitations

- Budget stays may be sparse or unavailable in smaller towns where Google Hotels has limited coverage.
- Drive times are estimates from Google Maps Directions and may not reflect actual traffic on exam day.
- Public transport times appear only where Google has route data for that city. Many routes will show driving and walking only.
- Budget inputs in the Budget tab other than the stay price (food, transport, other) are the user's own estimates and are not fetched from any data source.
- The checklist is general guidance. The official admit card instructions always take precedence.
- When no starting point is given, the default is the city's main railway station, resolved by appending "railway station" to the city name.

---

## AI tools used

**IBM Bob:** generated the application code from our written specifications, one phase at a time. We reviewed, tested, and corrected the output.

**Claude (Anthropic):** used to compare project ideas, plan the build phases, check the SerpApi documentation, and draft specifications.

---

## Team

**Rusheek (@Rusheekg):** trip planning logic, SerpApi client, web API, and interface.

**Aluvala Sai Shailu Sri (@aluvala-shailusri):** exam-day essentials feature (`essentials.py`).
