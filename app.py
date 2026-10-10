"""
app.py
~~~~~~
Streamlit front-end for ExamTrip.
Run with:  streamlit run app.py
"""

from __future__ import annotations

from datetime import date, time, timedelta

import streamlit as st
import serp_client  # loads .env via explicit path at import time

# ── page config (must be first Streamlit call) ──────────────────────────────
st.set_page_config(page_title="ExamTrip", page_icon="🎓", layout="centered")

st.title("ExamTrip")
st.caption("Plan your stay and travel for exam day.")

# ── input form ───────────────────────────────────────────────────────────────
with st.form("trip_form"):
    centre_address = st.text_input(
        "Exam centre address",
        placeholder="e.g. IIT Delhi, Hauz Khas, New Delhi",
    )
    city = st.text_input(
        "City",
        placeholder="e.g. New Delhi",
    )
    col1, col2 = st.columns(2)
    with col1:
        exam_date = st.date_input(
            "Exam date",
            value=date.today() + timedelta(weeks=3),
            min_value=date.today(),
        )
    with col2:
        reporting_time = st.time_input(
            "Reporting time",
            value=time(8, 30),
        )
    col3, col4 = st.columns(2)
    with col3:
        max_budget = st.number_input(
            "Max budget per night (INR)",
            min_value=500,
            max_value=50_000,
            value=2500,
            step=100,
        )
    with col4:
        people = st.number_input(
            "Number of people",
            min_value=1,
            max_value=10,
            value=2,
            step=1,
        )
    submitted = st.form_submit_button("Plan my trip", use_container_width=True)

# ── run plan ─────────────────────────────────────────────────────────────────
if submitted:
    # --- input validation ---
    if not centre_address.strip():
        st.error("Please enter the exam centre address.")
        st.stop()
    if not city.strip():
        st.error("Please enter the city name.")
        st.stop()

    # --- check API key (serp_client already loaded .env) ---
    if not serp_client.has_api_key():
        st.error(
            "**SERPAPI_API_KEY is not configured.**  "
            "Add your key to the `.env` file and restart the app."
        )
        st.stop()

    # --- call plan_trip inside a spinner ---
    from examtrip import plan_trip

    reporting_str = reporting_time.strftime("%H:%M")

    try:
        with st.spinner("Fetching data from SerpApi…"):
            plan = plan_trip(
                centre_address=centre_address.strip(),
                city=city.strip(),
                exam_date=exam_date,
                reporting_time=reporting_str,
                max_budget=int(max_budget),
                people=int(people),
            )
    except EnvironmentError as exc:
        st.error(str(exc))
        st.stop()
    except ValueError as exc:
        msg = str(exc)
        if "No local results" in msg:
            st.error(f"Exam centre not found: **{centre_address}**.  Try a more specific address.")
        else:
            st.error(msg)
        st.stop()
    except Exception as exc:
        st.error(f"Something went wrong while contacting SerpApi: {exc}")
        st.stop()

    stays = plan["stays"]
    if not stays:
        st.warning(
            f"No stays found near **{plan['centre']['title']}** "
            f"within ₹{max_budget:,}/night.  "
            "Try increasing the budget."
        )
        st.stop()

    # ── 1. Exam centre ────────────────────────────────────────────────────────
    c = plan["centre"]
    st.header("Exam centre")
    st.markdown(f"**{c['title']}**  \n{c['address']}")

    # ── 2. Best pick ──────────────────────────────────────────────────────────
    best = stays[0]
    r = best.get("route")
    st.header("Best pick")
    with st.container(border=True):
        st.markdown(f"### {best['name']}")
        col_a, col_b, col_c = st.columns(3)
        col_a.metric("Price / night", f"₹{best['price_inr']:,.0f}")
        col_b.metric("Drive to centre", r["drive_fmt"] if r else "—")
        col_c.metric("Leave by", r["leave_by"] if r else "—")

    # ── 3. All stays table ────────────────────────────────────────────────────
    st.header("All shortlisted stays")

    import pandas as pd

    rows = []
    for s in stays:
        ro = s.get("route")
        rows.append({
            "Name": s["name"],
            "INR / night": f"₹{s['price_inr']:,.0f}",
            "Rating": s["rating"] if s["rating"] is not None else "—",
            "Drive": ro["drive_fmt"] if ro else "—",
            "Walk": (ro["walk_fmt"] or "—") if ro else "—",
            "Dist (km)": f"{ro['distance_m'] / 1000:.1f}" if ro else "—",
            "Leave by": ro["leave_by"] if ro else "—",
            "Link": s["link"] or "",
        })

    df = pd.DataFrame(rows)

    # Render clickable links via st.dataframe column_config
    st.dataframe(
        df,
        column_config={
            "Link": st.column_config.LinkColumn("Link", display_text="Open"),
        },
        hide_index=True,
        use_container_width=True,
    )

    # ── 4. Station route ──────────────────────────────────────────────────────
    st.header("From the railway station")
    sr = plan["station_route"]
    if sr:
        col_x, col_y, col_z = st.columns(3)
        col_x.metric("Drive time", sr["drive_fmt"])
        col_y.metric("Distance", f"{sr['distance_m'] / 1000:.1f} km")
        col_z.metric("Leave the station by", sr["leave_by"])
    else:
        st.info("Station route not available.")

    # ── 5. Places to eat ─────────────────────────────────────────────────────
    st.header("Places to eat near the centre")
    food = plan.get("food") or []
    if food:
        food_rows = []
        for f in food:
            food_rows.append({
                "Name": f["title"],
                "Rating": f["rating"] if f["rating"] is not None else "—",
                "Price level": f["price"] or "—",
                "Dist (m)": f["distance_m"],
                "Address": f["address"],
            })
        st.dataframe(
            pd.DataFrame(food_rows),
            hide_index=True,
            use_container_width=True,
        )
    else:
        st.info("No restaurant data found near the centre.")

    # ── caption ───────────────────────────────────────────────────────────────
    st.caption(
        "Live data from SerpApi: Google Maps, Google Hotels, "
        "and Google Maps Directions."
    )
