/* ═══════════════════════════════════════════════════════════
   ExamTrip — app.js
   All data from POST /api/plan. No sample or invented data.
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ─── Storage keys ────────────────────────────────────────────────────────────
const LS_SEARCH = 'et_last_search';
const LS_RESULT = 'et_last_result';
const LS_CHECKS = 'et_checklist';

// ─── State ───────────────────────────────────────────────────────────────────
let _data   = null;
let _map    = null;
let _checks = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt    = (v) => v == null ? '<span class="dash">—</span>' : String(v);
const fmtINR = (v) => v == null ? '<span class="dash">—</span>' : `₹${Number(v).toLocaleString('en-IN')}`;
const esc    = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const distFmt = (m) => m == null ? '—' : m >= 1000 ? `${(m/1000).toFixed(1)} km` : `${Math.round(m)} m`;

function starsHtml(rating) {
  if (rating == null) return '<span class="dash">—</span>';
  return `<span class="stars"></span> ${Number(rating).toFixed(1)}`;
}

// addMins: add delta minutes to "HH:MM", wrapping midnight
function addMins(hhmm, delta) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + delta;
  const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60).toString().padStart(2, '0');
  const mm = (((total % 1440) + 1440) % 1440 % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────
// Inline SVGs used throughout — all original, palette-aligned.

// Spinner (used in btn loading state)
function spinnerSvg() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round" aria-hidden="true"
    style="animation:spin .7s linear infinite;display:inline-block;vertical-align:-3px">
    <path d="M12 2a10 10 0 0 1 10 10"/>
  </svg>`;
}

// Small car icon inline
function carSvg(size=13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    style="display:inline-block;vertical-align:-2px;flex-shrink:0">
    <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
    <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
  </svg>`;
}

function clockSvg(size=13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    style="display:inline-block;vertical-align:-2px;flex-shrink:0">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>`;
}

function pinSvg(size=13, color='currentColor') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    style="display:inline-block;vertical-align:-2px;flex-shrink:0">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
  </svg>`;
}

function walkSvg(size=13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    style="display:inline-block;vertical-align:-2px;flex-shrink:0">
    <circle cx="12" cy="5" r="1"/><path d="M9 20l3-7 2 2 2-4"/><path d="M6.5 8.5l3.5 1.5"/>
  </svg>`;
}

function starSvg(size=13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#F59E0B" stroke="#F59E0B"
    stroke-width="1.5" aria-hidden="true"
    style="display:inline-block;vertical-align:-2px;flex-shrink:0">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>`;
}

function externalSvg(size=12) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    style="display:inline-block;vertical-align:-1px;flex-shrink:0">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>`;
}

function pencilSvg(size=12) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    style="display:inline-block;vertical-align:-1px;flex-shrink:0">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>`;
}

function infoSvg(size=13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    style="display:inline-block;vertical-align:-2px;flex-shrink:0">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8"/>
    <line x1="12" y1="12" x2="12" y2="16"/>
  </svg>`;
}

function printSvg(size=15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    style="display:inline-block;vertical-align:-2px;flex-shrink:0">
    <polyline points="6 9 6 2 18 2 18 9"/>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
    <rect x="6" y="14" width="12" height="8"/>
  </svg>`;
}

// ─── Tab management ──────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `tab-${panel}`)
      );
      if (panel === 'overview' && _data) setTimeout(() => _map?.invalidateSize(), 100);
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
  ok = validateField($('f-centre'), $('e-centre'), [[v => v.length > 0, 'Enter the exam centre address.']]) && ok;
  ok = validateField($('f-city'),   $('e-city'),   [[v => v.length > 0, 'Enter the city name.']]) && ok;
  ok = validateField($('f-date'),   $('e-date'),   [
    [v => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date.'],
    [v => v >= today, 'Exam date must be today or in the future.'],
  ]) && ok;
  ok = validateField($('f-time'),   $('e-time'),   [[v => /^\d{2}:\d{2}$/.test(v), 'Enter time as HH:MM (24-hour).']]) && ok;
  ok = validateField($('f-budget'), $('e-budget'), [[v => /^\d+$/.test(v) && Number(v) > 0, 'Enter a positive budget amount.']]) && ok;
  ok = validateField($('f-people'), $('e-people'), [[v => /^\d+$/.test(v) && Number(v) > 0, 'Enter at least 1 traveller.']]) && ok;
  return ok;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
function showSkeletons() {
  const grid = $('stays-grid');
  if (!grid) return;
  grid.innerHTML = Array.from({length: 4}, () => `
    <div class="skel-card">
      <div class="skeleton skel-img"></div>
      <div class="skel-body">
        <div class="skeleton skel-line w80 h20"></div>
        <div class="skeleton skel-line w60"></div>
        <div class="skeleton skel-line w40"></div>
      </div>
    </div>
  `).join('');
}

// ─── Search ──────────────────────────────────────────────────────────────────
async function runSearch(payload) {
  const btn     = $('search-btn');
  const alertEl = $('search-alert');
  alertEl.className = 'alert';

  btn.disabled = true;
  btn.innerHTML = `${spinnerSvg()} Planning…`;

  // Show skeleton while loading
  $('results').classList.add('visible');
  showSkeletons();
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res  = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();

    if (!res.ok) {
      const msg = json.error || `Server error (${res.status})`;
      alertEl.innerHTML = `<span>⚠</span> ${esc(msg)}`;
      alertEl.className = 'alert alert-error visible';
      $('results').classList.remove('visible');
      return;
    }

    _data = json;
    localStorage.setItem(LS_SEARCH, JSON.stringify(payload));
    localStorage.setItem(LS_RESULT, JSON.stringify(json));
    renderResults(json, payload);
  } catch (err) {
    alertEl.innerHTML = `
      <span>⚠</span>
      <div>
        <strong>Network error</strong><br>${esc(err.message)}
      </div>`;
    alertEl.className = 'alert alert-error visible';
    $('results').classList.remove('visible');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${pinSvg(16)} Find My Exam Trip`;
  }
}

// ─── Render results ───────────────────────────────────────────────────────────
function renderResults(data, payload) {
  const resultsEl = $('results');
  resultsEl.classList.add('visible');

  renderTripPass(data, payload);
  renderJourneyStrip(data, payload);
  renderMetrics(data);
  renderOverview(data);
  renderStays(data);
  renderRoute(data, payload);
  renderFood(data);
  renderEssentials(data);
  renderBudget(data, payload);
  renderChecklist(data, payload);

  document.querySelector('.tab-btn[data-tab="overview"]').click();
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Trip Pass ────────────────────────────────────────────────────────────────
function renderTripPass(data, payload) {
  const el   = $('trip-pass');
  const c    = data.centre;
  const bp   = data.best_pick;
  const r    = bp?.route;
  const leaveBy = r?.leave_by ?? '—';
  const dateStr = new Date(payload.exam_date).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });

  el.innerHTML = `
    <div class="pass-main">
      <div class="pass-label">Exam Centre</div>
      <div class="pass-centre-name" title="${esc(c?.title ?? payload.centre_address)}">${esc(c?.title ?? payload.centre_address)}</div>
      <div class="pass-centre-addr">${esc(c?.address ?? payload.centre_address)}</div>
    </div>
    <div class="pass-mid">
      <div class="pass-kv"><span class="pk">Date</span><span class="pv">${esc(dateStr)}</span></div>
      <div class="pass-kv"><span class="pk">Reporting</span><span class="pv">${esc(payload.reporting_time)}</span></div>
      <div class="pass-kv"><span class="pk">Travellers</span><span class="pv">${esc(payload.people)}</span></div>
    </div>
    <div class="pass-stub">
      <span class="ps-label">Leave By</span>
      <span class="ps-time">${esc(leaveBy)}</span>
      <span class="ps-sub">from best pick</span>
    </div>
    <button class="pass-edit-btn" onclick="scrollToSearch()" aria-label="Edit search">${pencilSvg(11)} Edit</button>
  `;
}

// ─── Journey Strip ────────────────────────────────────────────────────────────
function renderJourneyStrip(data, payload) {
  const el  = $('journey-strip');
  const bp  = data.best_pick;
  const r   = bp?.route;
  if (!r) { el.style.display = 'none'; return; }
  el.style.display = '';

  const leaveBy    = r.leave_by ?? '—';
  const driveS     = r.drive_s ?? 0;
  const arrivalTime = addMins(leaveBy, Math.round(driveS / 60));

  el.innerHTML = `
    <div class="journey-strip-title">${carSvg(12)} Your journey on exam day</div>
    <div class="journey-row">
      <div class="journey-pin">
        <div class="jp-dot start" title="Depart from stay"></div>
        <div class="jp-time">${esc(leaveBy)}</div>
        <div class="jp-label">${esc(bp.name ?? 'Your stay')}</div>
        <div class="jp-sub">Depart</div>
      </div>
      <div class="journey-line">
        <div class="jl-dashes"></div>
        <div class="jl-label">${carSvg(12)} ${esc(r.drive_fmt)}</div>
      </div>
      <div class="journey-pin">
        <div class="jp-dot end" title="Arrive at centre"></div>
        <div class="jp-time">${esc(arrivalTime)}</div>
        <div class="jp-label">${esc(data.centre?.title ?? 'Exam Centre')}</div>
        <div class="jp-sub">Arrive — 30 min before ${esc(payload.reporting_time)}</div>
      </div>
    </div>
  `;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
function renderMetrics(data) {
  const bp = data.best_pick;
  const r  = bp?.route;

  $('m-price').innerHTML       = fmtINR(bp?.price_inr);
  $('m-price-sub').textContent = 'per night';

  $('m-drive').textContent     = r?.drive_fmt ?? '—';
  $('m-drive-sub').textContent = r ? 'from best pick' : '';

  $('m-leave').textContent     = r?.leave_by ?? '—';
  $('m-leave-sub').textContent = r ? 'to arrive on time' : '';

  updateTripCostMetric();
}

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

// ─── Compute stay badges ──────────────────────────────────────────────────────
function computeBadges(stays, bestPickName) {
  // Find absolute bests across the full list
  const withRoute = stays.filter(s => s.route?.drive_s != null);
  const minDrive  = withRoute.length ? Math.min(...withRoute.map(s => s.route.drive_s)) : null;
  const minPrice  = stays.length ? Math.min(...stays.map(s => s.price_inr)) : null;
  const withRating = stays.filter(s => s.rating != null);
  const maxRating  = withRating.length ? Math.max(...withRating.map(s => s.rating)) : null;

  return stays.map(s => {
    const badges = [];
    if (s.name === bestPickName) badges.push('best');
    if (minDrive != null && s.route?.drive_s === minDrive && s.name !== bestPickName) badges.push('drive');
    if (minPrice != null && s.price_inr === minPrice && s.name !== bestPickName) badges.push('price');
    if (maxRating != null && s.rating === maxRating && s.name !== bestPickName) badges.push('rated');
    return badges;
  });
}

// ─── Overview tab ─────────────────────────────────────────────────────────────
function renderOverview(data) {
  const bp = data.best_pick;
  const r  = bp?.route;

  const imgHtml = bp?.thumbnail
    ? `<img class="best-card-img" src="${esc(bp.thumbnail)}" alt="${esc(bp.name)}" loading="lazy">`
    : `<div class="best-card-img stay-img-placeholder" aria-label="Hotel placeholder">${buildingPlaceholderSvg()}</div>`;

  $('best-pick-card').innerHTML = `
    ${imgHtml}
    <div class="best-card-body">
      <div class="best-badge">${starSvg(11)} Best Pick</div>
      <h3>${esc(bp?.name ?? '—')}</h3>
      <div style="font-size:22px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;color:var(--navy);margin-bottom:8px;">
        ${fmtINR(bp?.price_inr)}<span style="font-size:14px;font-weight:400;color:var(--muted)"> /night</span>
      </div>
      <div class="stay-meta">
        ${bp?.rating != null ? `<span>${starsHtml(bp.rating)}${bp.reviews ? ` (${bp.reviews.toLocaleString('en-IN')})` : ''}</span>` : ''}
        ${r ? `<span>${carSvg(13)} ${esc(r.drive_fmt)}</span>` : ''}
        ${r?.walk_fmt ? `<span>${walkSvg(13)} ${esc(r.walk_fmt)}</span>` : ''}
        ${r ? `<span>${pinSvg(13)} ${distFmt(r.distance_m)}</span>` : ''}
        ${r ? `<span>${clockSvg(13)} Leave by ${esc(r.leave_by)}</span>` : ''}
      </div>
      ${bp?.link ? `<a class="stay-link" href="${esc(bp.link)}" target="_blank" rel="noopener">View hotel ${externalSvg(12)}</a>` : ''}
    </div>
  `;

  renderMap(data);
}

// Small building SVG for placeholder
function buildingPlaceholderSvg() {
  return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="1"/>
    <path d="M8 21V10h8v11M8 10h8M3 7h18"/>
    <rect x="9" y="14" width="2" height="2"/><rect x="13" y="14" width="2" height="2"/>
  </svg>`;
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

  // Centre marker — blue pin
  const centreIcon = L.divIcon({
    html: `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg" aria-label="Exam centre">
      <ellipse cx="14" cy="34" rx="5" ry="2" fill="rgba(0,0,0,.2)"/>
      <path d="M14 1C7.37 1 2 6.37 2 13c0 9 12 22 12 22S26 22 26 13C26 6.37 20.63 1 14 1z" fill="#2563EB" stroke="#fff" stroke-width="2"/>
      <path d="M10 13h4m0 0h4m-4 0v-4m0 4v4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    className: '', iconSize: [28, 36], iconAnchor: [14, 34],
  });
  L.marker([c.latitude, c.longitude], { icon: centreIcon })
    .addTo(_map)
    .bindPopup(`<strong>${esc(c.title)}</strong><br><small>${esc(c.address ?? '')}</small>`);

  const badgesArr = computeBadges(data.stays || [], data.best_pick?.name);

  // Stay markers
  (data.stays || []).forEach((stay, i) => {
    if (stay.latitude == null || stay.longitude == null) return;
    const isBest = data.best_pick?.name === stay.name;
    const fill   = isBest ? '#16A34A' : '#F59E0B';
    const stayIcon = L.divIcon({
      html: `<svg width="22" height="28" viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg" aria-label="${esc(stay.name)}">
        <ellipse cx="11" cy="26.5" rx="4" ry="1.5" fill="rgba(0,0,0,.18)"/>
        <path d="M11 1C5.48 1 1 5.48 1 11c0 7 10 17 10 17S21 18 21 11C21 5.48 16.52 1 11 1z" fill="${fill}" stroke="#fff" stroke-width="1.5"/>
      </svg>`,
      className: '', iconSize: [22, 28], iconAnchor: [11, 26],
    });
    L.marker([stay.latitude, stay.longitude], { icon: stayIcon })
      .addTo(_map)
      .bindPopup(`<strong>${esc(stay.name)}</strong><br>${fmtINR(stay.price_inr)}/night${stay.route ? `<br>${esc(stay.route.drive_fmt)} drive` : ''}`);
  });

  const bounds = [
    [c.latitude, c.longitude],
    ...(data.stays || []).filter(s => s.latitude != null).map(s => [s.latitude, s.longitude]),
  ];
  if (bounds.length > 1) _map.fitBounds(bounds, { padding: [36, 36] });
}

// ─── Stays tab ────────────────────────────────────────────────────────────────
function renderStays(data) {
  const stays = data.stays || [];
  let filtered = [...stays];
  const badgesArr = computeBadges(stays, data.best_pick?.name);

  function render(list) {
    const grid = $('stays-grid');
    if (!list.length) {
      grid.innerHTML = emptyStateSvg('No stays match the current filter.', 'hotel');
      return;
    }
    grid.innerHTML = list.map(stay => {
      const idx    = stays.indexOf(stay);
      const badges = idx >= 0 ? badgesArr[idx] : [];
      return stayCardHtml(stay, badges);
    }).join('');
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

function badgeHtml(type) {
  const map = {
    best:  { cls: 'badge-best',  label: '★ Best Pick' },
    drive: { cls: 'badge-drive', label: '⚡ Shortest drive' },
    price: { cls: 'badge-price', label: '💰 Lowest price' },
    rated: { cls: 'badge-rated', label: '★ Top rated' },
  };
  const b = map[type];
  return b ? `<span class="badge ${b.cls}">${b.label}</span>` : '';
}

function stayCardHtml(stay, badges = []) {
  const r = stay.route;
  const imgHtml = stay.thumbnail
    ? `<img class="stay-img" src="${esc(stay.thumbnail)}" alt="${esc(stay.name)}" loading="lazy">`
    : `<div class="stay-img-placeholder" aria-label="Hotel photo unavailable">${buildingPlaceholderSvg()}</div>`;

  const badgeMarkup = badges.length
    ? `<div class="stay-badges">${badges.map(badgeHtml).join('')}</div>`
    : '';

  return `
    <div class="stay-card">
      <div class="stay-img-wrap">
        ${imgHtml}
        ${badgeMarkup}
      </div>
      <div class="stay-body">
        <div class="stay-name">${esc(stay.name)}</div>
        <div class="stay-price">${fmtINR(stay.price_inr)}<span style="font-size:13px;font-weight:500;color:var(--muted)">/night</span></div>
        <div class="stay-meta">
          ${stay.rating != null ? `<span>${starsHtml(stay.rating)}${stay.reviews ? ` (${stay.reviews.toLocaleString('en-IN')})` : ''}</span>` : ''}
          ${r ? `<span>${carSvg(12)} ${esc(r.drive_fmt)}</span>` : ''}
          ${r?.walk_fmt ? `<span>${walkSvg(12)} ${esc(r.walk_fmt)}</span>` : ''}
          ${r ? `<span>${pinSvg(12)} ${distFmt(r.distance_m)}</span>` : ''}
          ${r ? `<span>${clockSvg(12)} Leave ${esc(r.leave_by)}</span>` : ''}
        </div>
        ${stay.link ? `<a class="stay-link" href="${esc(stay.link)}" target="_blank" rel="noopener">View hotel ${externalSvg(11)}</a>` : ''}
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
        <h3>${carSvg(15)} ${esc(title)}</h3>
        ${route ? `
          <div class="route-row">
            <div class="route-kv"><span class="rk">Drive time</span><span class="rv">${esc(route.drive_fmt || '—')}</span></div>
            <div class="route-kv"><span class="rk">Walk time</span><span class="rv">${esc(route.walk_fmt || '—')}</span></div>
            <div class="route-kv"><span class="rk">Distance</span><span class="rv">${distFmt(route.distance_m)}</span></div>
            <div class="route-kv"><span class="rk">Leave by</span><span class="rv" style="color:var(--primary)">${esc(route.leave_by || '—')}</span></div>
          </div>
          ${dirUrl ? `<div style="margin-top:14px"><a href="${esc(dirUrl)}" target="_blank" rel="noopener" style="font-weight:700;font-size:13px;display:inline-flex;align-items:center;gap:4px;">${externalSvg(13)} Open in Google Maps</a></div>` : ''}
        ` : '<p style="color:var(--muted);font-size:14px;">Route data unavailable.</p>'}
        <div class="route-note">${infoSvg(13)} Verify the centre and gate on your official admit card.</div>
      </div>
    `;
  }

  const bp = data.best_pick;
  const stationTitle = `${payload.city} Railway Station → ${centre?.title ?? 'Centre'}`;
  const bestTitle    = `${bp?.name ?? 'Best Pick'} → ${centre?.title ?? 'Centre'}`;

  const stationDirUrl = (cLat != null && cLng != null)
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(payload.city + ' railway station')}&destination=${cLat},${cLng}`
    : null;

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
    : emptyStateSvg('No restaurants found near the centre.', 'food');
}

// ─── Essentials tab ───────────────────────────────────────────────────────────
function renderEssentials(data) {
  const ess = data.essentials;
  const ps  = ess?.print_shops || [];
  const ph  = ess?.pharmacies  || [];

  $('print-list').innerHTML = ps.length
    ? ps.map(p => placeCardHtml(p)).join('')
    : emptyStateSvg('No print shops found nearby.', 'print');

  $('pharmacy-list').innerHTML = ph.length
    ? ph.map(p => placeCardHtml(p)).join('')
    : emptyStateSvg('No pharmacies found nearby.', 'pharmacy');
}

function placeCardHtml(place) {
  const openCls = /open/i.test(place.open_state || '') ? 'open-yes' : place.open_state ? 'open-no' : '';
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

// ─── Empty state ──────────────────────────────────────────────────────────────
function emptyStateSvg(msg, type) {
  const icon = {
    hotel:    `<path d="M3 21V7l9-4 9 4v14"/><path d="M10 21V14h4v7"/><rect x="13" y="9" width="3" height="3"/><rect x="8" y="9" width="3" height="3"/>`,
    food:     `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>`,
    print:    `<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>`,
    pharmacy: `<path d="M8 2h8m-4-2v7m-8 0h16v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"/>`,
  }[type] || `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/>`;

  return `
    <div class="empty-state">
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">${icon}</svg>
      <p>${esc(msg)}</p>
    </div>`;
}

// ─── Budget tab ───────────────────────────────────────────────────────────────
function renderBudget(data, payload) {
  const bp       = data.best_pick;
  const people   = Number(payload.people) || 1;
  const priceINR = bp?.price_inr ?? 0;

  $('b-nights').value    = 1;
  $('b-food').value      = 300;
  $('b-transport').value = 200;
  $('b-other').value     = 0;
  $('b-maxbudget').value = Number(payload.max_budget) * people;

  function update() {
    const nights  = Math.max(1, Number($('b-nights').value) || 1);
    const food    = Number($('b-food').value)     || 0;
    const trans   = Number($('b-transport').value) || 0;
    const other   = Number($('b-other').value)     || 0;
    const maxB    = Number($('b-maxbudget').value) || 0;

    const stayTotal  = priceINR * nights;
    const foodTotal  = food * people * nights;
    const transTotal = trans * nights;
    const total      = stayTotal + foodTotal + transTotal + other;
    const perPerson  = people > 0 ? total / people : total;
    const pct        = maxB > 0 ? Math.min(100, (total / maxB) * 100) : 0;
    const over       = maxB > 0 && total > maxB;

    $('b-stay-cost').textContent  = `₹${stayTotal.toLocaleString('en-IN')}`;
    $('b-food-cost').textContent  = `₹${foodTotal.toLocaleString('en-IN')}`;
    $('b-trans-cost').textContent = `₹${transTotal.toLocaleString('en-IN')}`;
    $('b-other-cost').textContent = `₹${other.toLocaleString('en-IN')}`;
    $('b-total').textContent      = `₹${total.toLocaleString('en-IN')}`;
    $('b-per-person').textContent = `₹${Math.round(perPerson).toLocaleString('en-IN')} per person`;
    $('b-progress').style.width   = `${pct}%`;
    $('b-progress').className     = `progress-bar${over ? ' over' : ''}`;
    $('b-progress-label-used').textContent = `₹${total.toLocaleString('en-IN')}`;
    $('b-progress-label-max').textContent  = maxB > 0 ? `of ₹${maxB.toLocaleString('en-IN')}` : '';
    $('b-stay-label').textContent  = `Stay (${nights} night${nights>1?'s':''} × ₹${priceINR.toLocaleString('en-IN')})`;
    $('b-food-label').textContent  = `Food (est. ₹${food}/person/day × ${people} × ${nights} days)`;
    $('b-trans-label').textContent = `Local transport (est. ₹${trans}/day × ${nights} days)`;
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
  const bp       = data.best_pick;
  const leaveBy  = bp?.route?.leave_by || '06:00';
  const driveS   = bp?.route?.drive_s ?? 0;
  const arrTime  = addMins(leaveBy, Math.round(driveS / 60));

  const evening = [
    { key: 'adm-card', time: 'Evening before', label: 'Print your admit card and read its instructions' },
    { key: 'id-proof', time: 'Evening before', label: 'Keep the ID and documents your admit card asks for' },
    { key: 'pack-bag', time: 'Evening before', label: 'Pack only the items your admit card allows' },
    { key: 'alarm',    time: 'Evening before', label: `Set alarm for ${addMins(leaveBy, -90)}` },
    { key: 'sleep',    time: 'Evening before', label: "Get a good night's sleep" },
  ];

  const morning = [
    { key: 'wake',      time: addMins(leaveBy, -90), label: 'Wake up and get ready' },
    { key: 'eat',       time: addMins(leaveBy, -60), label: 'Have a light breakfast' },
    { key: 'check-bag', time: addMins(leaveBy, -30), label: 'Double-check bag: admit card, ID, and documents' },
    { key: 'leave',     time: leaveBy,               label: `Leave for ${data.centre?.title ?? 'exam centre'}` },
    { key: 'arrive',    time: arrTime,                label: `Reach the centre by ${arrTime}, 30 minutes before your ${payload.reporting_time} reporting time` },
  ];

  function itemHtml(item) {
    const done = !!_checks[item.key];
    return `
      <div class="checklist-item${done ? ' done' : ''}" onclick="toggleCheck('${esc(item.key)}')" data-key="${esc(item.key)}">
        <input type="checkbox" ${done ? 'checked' : ''} aria-label="${esc(item.label)}" tabindex="-1"
          style="width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--primary)">
        <span class="cl-time">${esc(item.time)}</span>
        <span class="cl-label">${esc(item.label)}</span>
      </div>
    `;
  }

  $('checklist-content').innerHTML = `
    <div class="checklist-section">
      <h3>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        Evening Before
      </h3>
      <div class="cl-timeline">${evening.map(itemHtml).join('')}</div>
    </div>
    <div class="checklist-section">
      <h3>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        Exam Morning
      </h3>
      <div class="cl-timeline">${morning.map(itemHtml).join('')}</div>
    </div>
  `;
}

function toggleCheck(key) {
  _checks[key] = !_checks[key];
  localStorage.setItem(LS_CHECKS, JSON.stringify(_checks));
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el) {
    el.classList.toggle('done', !!_checks[key]);
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

  $('f-date').min = new Date().toISOString().slice(0, 10);

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

  document.querySelectorAll('[data-scroll="search"]').forEach(el => {
    el.addEventListener('click', () => scrollToSearch());
  });

  $('print-btn')?.addEventListener('click', () => window.print());

  restoreFromStorage();
});
