/* ExamTrip – app.js */
'use strict';

// ─── Storage keys ────────────────────────────────────────────────────────────
const LS_SEARCH  = 'et_last_search';
const LS_RESULT  = 'et_last_result';
const LS_CHECKS  = 'et_checklist';

// ─── State ───────────────────────────────────────────────────────────────────
let _data        = null;   // last API response
let _map         = null;   // Leaflet map instance
let _checks      = {};     // { itemKey: true }
let _budgetNights = 1;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (v, suffix = '') => (v == null ? '<span class="dash">—</span>' : `${v}${suffix}`);
const fmtNum = (v, decimals = 0) =>
  v == null ? '<span class="dash">—</span>' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: decimals });
const fmtINR = (v) => v == null ? '<span class="dash">—</span>' : `₹${Number(v).toLocaleString('en-IN')}`;
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const distFmt = (m) => m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

function starsHtml(rating) {
  if (rating == null) return '<span class="dash">—</span>';
  return `<span class="stars"></span> ${Number(rating).toFixed(1)}`;
}

// ─── Tab management ──────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${panel}`));
      if (panel === 'overview' && _data) { setTimeout(() => _map && _map.invalidateSize(), 100); }
    });
  });
}

// ─── Form validation ─────────────────────────────────────────────────────────
function validateField(input, msgEl, rules) {
  const v = input.value.trim();
  for (const [test, msg] of rules) {
    if (!test(v)) {
      input.classList.add('invalid');
      msgEl.textContent = msg;
      msgEl.classList.add('visible');
      return false;
    }
  }
  input.classList.remove('invalid');
  msgEl.classList.remove('visible');
  return true;
}

function validateForm() {
  const today = new Date().toISOString().slice(0, 10);
  let ok = true;

  ok = validateField($('f-centre'), $('e-centre'), [
    [v => v.length > 0, 'Enter the exam centre address.'],
  ]) && ok;

  ok = validateField($('f-city'), $('e-city'), [
    [v => v.length > 0, 'Enter the city name.'],
  ]) && ok;

  ok = validateField($('f-date'), $('e-date'), [
    [v => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date.'],
    [v => v >= today, 'Exam date must be today or in the future.'],
  ]) && ok;

  ok = validateField($('f-time'), $('e-time'), [
    [v => /^\d{2}:\d{2}$/.test(v), 'Enter time as HH:MM (24-hour).'],
  ]) && ok;

  ok = validateField($('f-budget'), $('e-budget'), [
    [v => /^\d+$/.test(v) && Number(v) > 0, 'Enter a positive budget amount.'],
  ]) && ok;

  ok = validateField($('f-people'), $('e-people'), [
    [v => /^\d+$/.test(v) && Number(v) > 0, 'Enter at least 1 traveller.'],
  ]) && ok;

  return ok;
}

// ─── Search ──────────────────────────────────────────────────────────────────
async function runSearch(payload) {
  const btn     = $('search-btn');
  const alertEl = $('search-alert');
  alertEl.className = 'alert';

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Planning…';

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();

    if (!res.ok) {
      const msg = json.error || `Server error (${res.status})`;
      alertEl.innerHTML = `<span>${lucide.icons['alert-circle'] ? iconSvg('alert-circle', 16) : '⚠'}</span> ${esc(msg)}`;
      alertEl.className = 'alert alert-error visible';
      return;
    }

    _data = json;
    localStorage.setItem(LS_SEARCH, JSON.stringify(payload));
    localStorage.setItem(LS_RESULT, JSON.stringify(json));
    renderResults(json, payload);
  } catch (err) {
    alertEl.innerHTML = `<span>⚠</span> Network error: ${esc(err.message)}`;
    alertEl.className = 'alert alert-error visible';
  } finally {
    btn.disabled = false;
    btn.innerHTML = iconSvg('search', 16) + ' Find My Exam Trip';
  }
}

// ─── Icon helper (Lucide) ─────────────────────────────────────────────────────
// Lucide UMD exposes lucide.icons[name] as [svgTag, defaultAttrs, [[childTag, childAttrs], ...]]
function iconSvg(name, size = 16) {
  if (typeof lucide === 'undefined') return '';
  const icon = lucide?.icons?.[name];
  if (!icon) return '';
  // icon = ['svg', defaultSvgAttrs, [[childTag, childAttrs], ...]]
  const [, , children] = icon;
  const svgAttrs = [
    `xmlns="http://www.w3.org/2000/svg"`,
    `width="${size}"`, `height="${size}"`,
    `viewBox="0 0 24 24"`,
    `fill="none"`,
    `stroke="currentColor"`,
    `stroke-width="2"`,
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`,
    `style="display:inline-block;vertical-align:-2px;flex-shrink:0"`,
    `aria-hidden="true"`,
  ].join(' ');
  const inner = (children || []).map(([ct, ca]) => {
    if (!ca) return '';
    const attrs = Object.entries(ca).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${ct} ${attrs}/>`;
  }).join('');
  return `<svg ${svgAttrs}>${inner}</svg>`;
}

// ─── Render results ───────────────────────────────────────────────────────────
function renderResults(data, payload) {
  const resultsEl = $('results');
  resultsEl.classList.add('visible');

  renderSummaryBar(data, payload);
  renderMetrics(data);
  renderOverview(data);
  renderStays(data);
  renderRoute(data, payload);
  renderFood(data);
  renderEssentials(data);
  renderBudget(data, payload);
  renderChecklist(data, payload);

  // switch to first tab
  document.querySelector('.tab-btn[data-tab="overview"]').click();

  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Summary bar ─────────────────────────────────────────────────────────────
function renderSummaryBar(data, payload) {
  const el = $('summary-bar');
  const date = new Date(payload.exam_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  el.innerHTML = `
    <strong>${esc(data.centre?.title ?? payload.centre_address)}</strong>
    <span>${iconSvg('calendar',13)} ${esc(date)}</span>
    <span>${iconSvg('clock',13)} Reporting ${esc(payload.reporting_time)}</span>
    <span>${iconSvg('users',13)} ${esc(payload.people)} traveller${payload.people > 1 ? 's' : ''}</span>
    <span>${iconSvg('banknote',13)} Max ₹${Number(payload.max_budget).toLocaleString('en-IN')}/night</span>
    <button class="edit-btn" onclick="scrollToSearch()">${iconSvg('pencil',13)} Edit</button>
  `;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
function renderMetrics(data) {
  const bp = data.best_pick;
  const r  = bp?.route;

  $('m-price').innerHTML       = fmtINR(bp?.price_inr);
  $('m-price-sub').textContent = 'per night';

  $('m-drive').innerHTML       = fmt(r?.drive_fmt);
  $('m-drive-sub').textContent = r ? 'from best pick' : '';

  $('m-leave').innerHTML       = fmt(r?.leave_by);
  $('m-leave-sub').textContent = r ? 'to arrive on time' : '';

  // Fourth card is updated live by the budget tab; seed it now.
  updateTripCostMetric();
}

// Called by renderBudget's update() so the metric card stays in sync.
function updateTripCostMetric() {
  const el = $('m-trip');
  if (!el) return;
  const totalEl = $('b-total');
  if (totalEl && totalEl.textContent && totalEl.textContent !== '₹0') {
    el.textContent = totalEl.textContent;
  } else {
    el.innerHTML = '<span class="dash">—</span>';
  }
  const subEl = $('m-trip-sub');
  if (subEl) subEl.textContent = 'from budget planner';
}

// ─── Overview tab ─────────────────────────────────────────────────────────────
function renderOverview(data) {
  const bp  = data.best_pick;
  const r   = bp?.route;
  const el  = $('best-pick-card');

  const imgHtml = bp?.thumbnail
    ? `<img class="best-card-img" src="${esc(bp.thumbnail)}" alt="${esc(bp.name)}" loading="lazy">`
    : `<div class="best-card-img stay-img-placeholder">${iconSvg('building-2', 36)}</div>`;

  el.innerHTML = `
    ${imgHtml}
    <div class="best-card-body">
      <div class="best-badge">${iconSvg('star',12)} Best Pick</div>
      <h3>${esc(bp?.name ?? '—')}</h3>
      <div style="font-size:22px;font-weight:700;color:var(--navy);margin-bottom:8px;">${fmtINR(bp?.price_inr)}<span style="font-size:14px;font-weight:400;color:var(--muted)"> /night</span></div>
      <div class="stay-meta">
        ${bp?.rating != null ? `<span>${starsHtml(bp.rating)}${bp.reviews ? ` (${bp.reviews.toLocaleString('en-IN')})` : ''}</span>` : ''}
        ${r ? `<span>${iconSvg('car',13)} ${esc(r.drive_fmt)}</span>` : ''}
        ${r?.walk_fmt ? `<span>${iconSvg('footprints',13)} ${esc(r.walk_fmt)}</span>` : ''}
        ${r ? `<span>${iconSvg('map-pin',13)} ${distFmt(r.distance_m)}</span>` : ''}
        ${r ? `<span>${iconSvg('clock',13)} Leave by ${esc(r.leave_by)}</span>` : ''}
      </div>
      ${bp?.link ? `<a class="stay-link" href="${esc(bp.link)}" target="_blank" rel="noopener">View hotel ${iconSvg('external-link',12)}</a>` : ''}
    </div>
  `;

  renderMap(data);
}

// ─── Map ─────────────────────────────────────────────────────────────────────
function renderMap(data) {
  const c = data.centre;
  if (!c?.latitude) return;

  if (_map) { _map.remove(); _map = null; }

  _map = L.map('map').setView([c.latitude, c.longitude], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(_map);

  // Centre marker
  const centreIcon = L.divIcon({
    html: `<div style="background:var(--primary);border-radius:50%;width:14px;height:14px;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    className: '', iconSize: [14, 14], iconAnchor: [7, 7],
  });
  L.marker([c.latitude, c.longitude], { icon: centreIcon })
    .addTo(_map)
    .bindPopup(`<strong>${esc(c.title)}</strong><br>${esc(c.address ?? '')}`);

  // Stay markers
  (data.stays || []).forEach((stay, i) => {
    if (stay.latitude == null || stay.longitude == null) return;
    const isBest = data.best_pick?.name === stay.name;
    const stayIcon = L.divIcon({
      html: `<div style="background:${isBest ? '#16A36A' : '#F59E0B'};border-radius:50%;width:12px;height:12px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`,
      className: '', iconSize: [12, 12], iconAnchor: [6, 6],
    });
    L.marker([stay.latitude, stay.longitude], { icon: stayIcon })
      .addTo(_map)
      .bindPopup(`<strong>${esc(stay.name)}</strong><br>${fmtINR(stay.price_inr)}/night${stay.route ? `<br>${esc(stay.route.drive_fmt)} drive` : ''}`);
  });

  const bounds = [
    [c.latitude, c.longitude],
    ...(data.stays || []).filter(s => s.latitude != null).map(s => [s.latitude, s.longitude]),
  ];
  if (bounds.length > 1) _map.fitBounds(bounds, { padding: [30, 30] });
}

// ─── Stays tab ────────────────────────────────────────────────────────────────
function renderStays(data) {
  const stays = data.stays || [];
  let filtered = [...stays];

  function render(list) {
    const grid = $('stays-grid');
    if (!list.length) {
      grid.innerHTML = '<p style="color:var(--muted)">No stays match the current filter.</p>';
      return;
    }
    grid.innerHTML = list.map(stay => stayCardHtml(stay, data.best_pick?.name === stay.name)).join('');
  }

  function update() {
    const sort  = $('sort-by').value;
    const maxPr = parseFloat($('filter-price').value) || Infinity;
    filtered = stays.filter(s => s.price_inr <= maxPr);
    if (sort === 'drive')  filtered.sort((a,b) => (a.route?.drive_s ?? 999999) - (b.route?.drive_s ?? 999999));
    if (sort === 'price')  filtered.sort((a,b) => a.price_inr - b.price_inr);
    if (sort === 'rating') filtered.sort((a,b) => (b.rating ?? 0) - (a.rating ?? 0));
    render(filtered);
  }

  $('sort-by').addEventListener('change', update);
  $('filter-price').addEventListener('input', update);
  update();
}

function stayCardHtml(stay, isBest) {
  const r = stay.route;
  const imgHtml = stay.thumbnail
    ? `<img class="stay-img" src="${esc(stay.thumbnail)}" alt="${esc(stay.name)}" loading="lazy">`
    : `<div class="stay-img-placeholder">${iconSvg('building-2', 36)}</div>`;

  return `
    <div class="stay-card">
      ${imgHtml}
      <div class="stay-body">
        ${isBest ? `<div class="best-badge" style="margin-bottom:6px;">${iconSvg('star',11)} Best Pick</div>` : ''}
        <div class="stay-name">${esc(stay.name)}</div>
        <div class="stay-price">${fmtINR(stay.price_inr)}<span style="font-size:13px;font-weight:400;color:var(--muted)">/night</span></div>
        <div class="stay-meta">
          ${stay.rating != null ? `<span>${starsHtml(stay.rating)}${stay.reviews ? ` (${stay.reviews.toLocaleString('en-IN')})` : ''}</span>` : ''}
          ${r ? `<span>${iconSvg('car',12)} ${esc(r.drive_fmt)}</span>` : ''}
          ${r?.walk_fmt ? `<span>${iconSvg('footprints',12)} ${esc(r.walk_fmt)}</span>` : ''}
          ${r ? `<span>${iconSvg('map-pin',12)} ${distFmt(r.distance_m)}</span>` : ''}
          ${r ? `<span>${iconSvg('clock',12)} Leave ${esc(r.leave_by)}</span>` : ''}
        </div>
        ${stay.link ? `<a class="stay-link" href="${esc(stay.link)}" target="_blank" rel="noopener">View hotel ${iconSvg('external-link',11)}</a>` : ''}
      </div>
    </div>
  `;
}

// ─── Route tab ────────────────────────────────────────────────────────────────
function renderRoute(data, payload) {
  const centre = data.centre;
  const cLat   = centre?.latitude;
  const cLng   = centre?.longitude;

  function routeCard(title, route, dirUrl) {
    return `
      <div class="route-card">
        <h3>${iconSvg('navigation',14)} ${esc(title)}</h3>
        ${route ? `
        <div class="route-row">
          <div class="route-kv"><span class="rk">Drive time</span><span class="rv">${esc(route.drive_fmt || '—')}</span></div>
          <div class="route-kv"><span class="rk">Walk time</span><span class="rv">${esc(route.walk_fmt || '—')}</span></div>
          <div class="route-kv"><span class="rk">Distance</span><span class="rv">${distFmt(route.distance_m)}</span></div>
          <div class="route-kv"><span class="rk">Leave by</span><span class="rv" style="color:var(--primary)">${esc(route.leave_by || '—')}</span></div>
        </div>
        ${dirUrl ? `<div style="margin-top:14px;"><a href="${esc(dirUrl)}" target="_blank" rel="noopener" style="font-weight:600;font-size:13px;">${iconSvg('external-link',13)} Open directions in Google Maps</a></div>` : ''}
        ` : '<p style="color:var(--muted);font-size:14px;">Route data unavailable.</p>'}
        <div class="route-note">${iconSvg('info',13)} Verify the centre and gate on your official admit card.</div>
      </div>
    `;
  }

  const bp = data.best_pick;
  const stationTitle = `${payload.city} Railway Station → ${centre?.title ?? 'Centre'}`;
  const bestTitle    = `${bp?.name ?? 'Best Pick'} → ${centre?.title ?? 'Centre'}`;

  // Station: use city name as text origin (no lat/lng available)
  const stationDirUrl = (cLat != null && cLng != null)
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(payload.city + ' railway station')}&destination=${cLat},${cLng}`
    : null;

  // Best pick: use its GPS coordinates
  const bestDirUrl = (bp?.latitude != null && bp?.longitude != null && cLat != null && cLng != null)
    ? `https://www.google.com/maps/dir/?api=1&origin=${bp.latitude},${bp.longitude}&destination=${cLat},${cLng}`
    : null;

  $('route-content').innerHTML =
    routeCard(stationTitle, data.station_route, stationDirUrl) +
    routeCard(bestTitle, bp?.route, bestDirUrl);
}

// ─── Food tab ─────────────────────────────────────────────────────────────────
function renderFood(data) {
  const food = data.food || [];
  $('food-list').innerHTML = food.length
    ? food.map(f => placeCardHtml(f)).join('')
    : '<p style="color:var(--muted)">No food results available.</p>';
}

// ─── Essentials tab ───────────────────────────────────────────────────────────
function renderEssentials(data) {
  const ess = data.essentials;
  const ps  = ess?.print_shops  || [];
  const ph  = ess?.pharmacies   || [];

  $('print-list').innerHTML = ps.length
    ? ps.map(p => placeCardHtml(p)).join('')
    : '<p style="color:var(--muted)">No print shops found nearby.</p>';

  $('pharmacy-list').innerHTML = ph.length
    ? ph.map(p => placeCardHtml(p)).join('')
    : '<p style="color:var(--muted)">No pharmacies found nearby.</p>';
}

function placeCardHtml(place) {
  const openCls  = /open/i.test(place.open_state || '') ? 'open-yes' : place.open_state ? 'open-no' : '';
  return `
    <div class="place-card">
      <div>
        <div class="pc-title">${esc(place.title)}</div>
        <div class="pc-addr">${esc(place.address || '')}</div>
      </div>
      <div class="pc-right">
        ${place.rating != null ? `<div class="pc-rating">${starsHtml(place.rating)}</div>` : ''}
        <div class="pc-dist">${distFmt(place.distance_m)}</div>
        ${place.open_state ? `<div class="pc-open ${openCls}">${esc(place.open_state)}</div>` : ''}
        ${place.price ? `<div class="pc-dist">${esc(place.price)}</div>` : ''}
      </div>
    </div>
  `;
}

// ─── Budget tab ───────────────────────────────────────────────────────────────
function renderBudget(data, payload) {
  const bp       = data.best_pick;
  const people   = Number(payload.people) || 1;
  const priceINR = bp?.price_inr ?? 0;

  // seed defaults
  $('b-nights').value   = 1;
  $('b-food').value     = 300;
  $('b-transport').value = 200;
  $('b-other').value    = 0;
  $('b-maxbudget').value = Number(payload.max_budget) * people;

  _budgetNights = 1;

  function update() {
    const nights   = Math.max(1, Number($('b-nights').value) || 1);
    const food     = Number($('b-food').value)     || 0;
    const trans    = Number($('b-transport').value) || 0;
    const other    = Number($('b-other').value)     || 0;
    const maxB     = Number($('b-maxbudget').value) || 0;

    const stayTotal  = priceINR * nights;
    const foodTotal  = food * people * nights;
    const transTotal = trans * nights;
    const total      = stayTotal + foodTotal + transTotal + other;
    const perPerson  = people > 0 ? total / people : total;

    const pct  = maxB > 0 ? Math.min(100, (total / maxB) * 100) : 0;
    const over = maxB > 0 && total > maxB;

    $('b-stay-cost').textContent    = `₹${stayTotal.toLocaleString('en-IN')}`;
    $('b-food-cost').textContent    = `₹${foodTotal.toLocaleString('en-IN')}`;
    $('b-trans-cost').textContent   = `₹${transTotal.toLocaleString('en-IN')}`;
    $('b-other-cost').textContent   = `₹${other.toLocaleString('en-IN')}`;
    $('b-total').textContent        = `₹${total.toLocaleString('en-IN')}`;
    $('b-per-person').textContent   = `₹${Math.round(perPerson).toLocaleString('en-IN')} per person`;
    $('b-progress').style.width     = `${pct}%`;
    $('b-progress').className       = `progress-bar${over ? ' over' : ''}`;
    $('b-progress-label-used').textContent = `₹${total.toLocaleString('en-IN')}`;
    $('b-progress-label-max').textContent  = maxB > 0 ? `of ₹${maxB.toLocaleString('en-IN')}` : '';
    $('b-stay-label').textContent   = `Stay (${nights} night${nights>1?'s':''} × ₹${priceINR.toLocaleString('en-IN')})`;
    $('b-food-label').textContent   = `Food (est. ₹${food}/person/day × ${people} × ${nights} days)`;
    $('b-trans-label').textContent  = `Local transport (est. ₹${trans}/day × ${nights} days)`;

    // Keep the metric card in sync
    updateTripCostMetric();
  }

  ['b-nights','b-food','b-transport','b-other','b-maxbudget'].forEach(id => {
    $(id).addEventListener('input', update);
  });

  update();
}

// ─── Checklist tab ────────────────────────────────────────────────────────────
function renderChecklist(data, payload) {
  _checks = JSON.parse(localStorage.getItem(LS_CHECKS) || '{}');
  const bp = data.best_pick;
  const leaveBy = bp?.route?.leave_by || '06:00';

  // Build timeline relative to leave-by
  function addMins(hhmm, delta) {
    const [h, m] = hhmm.split(':').map(Number);
    const total  = h * 60 + m + delta;
    const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60).toString().padStart(2, '0');
    const mm = (((total % 1440) + 1440) % 1440 % 60).toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // Compute arrival time = leave-by + drive time in seconds
  const driveS = bp?.route?.drive_s ?? 0;
  const arrivalTime = addMins(leaveBy, Math.round(driveS / 60));

  const evening = [
    { key: 'adm-card',   time: 'Evening before', label: 'Print your admit card and read its instructions' },
    { key: 'id-proof',   time: 'Evening before', label: 'Keep the ID and documents your admit card asks for' },
    { key: 'pack-bag',   time: 'Evening before', label: 'Pack only the items your admit card allows' },
    { key: 'alarm',      time: 'Evening before', label: `Set alarm for ${addMins(leaveBy, -90)}` },
    { key: 'sleep',      time: 'Evening before', label: 'Get a good night\'s sleep' },
  ];

  const morning = [
    { key: 'wake',      time: addMins(leaveBy, -90), label: 'Wake up and get ready' },
    { key: 'eat',       time: addMins(leaveBy, -60), label: 'Have a light breakfast' },
    { key: 'check-bag', time: addMins(leaveBy, -30), label: 'Double-check bag: admit card, ID, and documents' },
    { key: 'leave',     time: leaveBy,                label: `Leave for ${esc(data.centre?.title ?? 'exam centre')}` },
    { key: 'arrive',    time: arrivalTime,             label: `Reach the centre by ${arrivalTime}, 30 minutes before your ${payload.reporting_time} reporting time` },
  ];

  function itemHtml(item) {
    const done = !!_checks[item.key];
    return `
      <div class="checklist-item${done ? ' done' : ''}" onclick="toggleCheck('${esc(item.key)}')" data-key="${esc(item.key)}">
        <input type="checkbox" ${done ? 'checked' : ''} aria-label="${esc(item.label)}" tabindex="-1" style="width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--primary)">
        <span class="cl-time">${esc(item.time)}</span>
        <span class="cl-label">${esc(item.label)}</span>
      </div>
    `;
  }

  $('checklist-content').innerHTML = `
    <div class="checklist-section">
      <h3>${iconSvg('moon',15)} Evening Before</h3>
      ${evening.map(itemHtml).join('')}
    </div>
    <div class="checklist-section">
      <h3>${iconSvg('sunrise',15)} Exam Morning</h3>
      ${morning.map(itemHtml).join('')}
    </div>
  `;
}

function toggleCheck(key) {
  _checks[key] = !_checks[key];
  localStorage.setItem(LS_CHECKS, JSON.stringify(_checks));
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el) {
    el.classList.toggle('done', _checks[key]);
    el.querySelector('input[type="checkbox"]').checked = !!_checks[key];
  }
}

// ─── Scroll helpers ───────────────────────────────────────────────────────────
function scrollToSearch() {
  $('search').scrollIntoView({ behavior: 'smooth' });
}

// ─── Restore from localStorage ────────────────────────────────────────────────
function restoreFromStorage() {
  try {
    const savedSearch = localStorage.getItem(LS_SEARCH);
    const savedResult = localStorage.getItem(LS_RESULT);
    if (!savedSearch || !savedResult) return;

    const payload = JSON.parse(savedSearch);
    const data    = JSON.parse(savedResult);

    // Restore form fields
    if ($('f-centre'))  $('f-centre').value  = payload.centre_address || '';
    if ($('f-city'))    $('f-city').value    = payload.city           || '';
    if ($('f-date'))    $('f-date').value    = payload.exam_date      || '';
    if ($('f-time'))    $('f-time').value    = payload.reporting_time || '';
    if ($('f-budget'))  $('f-budget').value  = payload.max_budget     || '';
    if ($('f-people'))  $('f-people').value  = payload.people         || '';

    _data = data;
    renderResults(data, payload);
  } catch (_) {
    // Silently ignore corrupted storage
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();

  // Set min date to today
  const today = new Date().toISOString().slice(0, 10);
  $('f-date').min = today;

  // Form submit
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    runSearch({
      centre_address: $('f-centre').value.trim(),
      city:           $('f-city').value.trim(),
      exam_date:      $('f-date').value,
      reporting_time: $('f-time').value,
      max_budget:     Number($('f-budget').value),
      people:         Number($('f-people').value),
    });
  });

  // Nav "Plan My Trip" button
  document.querySelectorAll('[data-scroll="search"]').forEach(el => {
    el.addEventListener('click', () => scrollToSearch());
  });

  // Restore last session
  restoreFromStorage();
});
