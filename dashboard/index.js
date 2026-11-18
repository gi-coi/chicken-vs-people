'use strict';

// chicken-vs-people dashboard (EU-27 focus)
// Heavy lifting (cleaning, aggregation, growth, formatting decisions) happens in
// scripts/prepare.py. This file only fetches the packaged JSON + map geometry and
// renders them, plus simple filter/sort interactions.

const DATA_URL = 'data/chickens_people.json';
const GEO_URL = 'data/europe.geojson';

const state = {
  data: null,
  geo: null,
  sortKey: 'ratio',
  sortDir: -1, // -1 = descending, 1 = ascending
  query: '',
  maxRatio: 1,
};

const $ = (sel) => document.querySelector(sel);

// ---- formatting helpers ----
const fmtInt = (n) => Number(n).toLocaleString('en-US');
const fmtRatio = (r) => Number(r).toFixed(2);
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

function fmtBig(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' billion';
  if (n >= 1e6) return Math.round(n / 1e6) + ' million';
  return fmtInt(n);
}

// "±2.84×" with a proper minus sign and trailing-zero trim
const signed = (d) =>
  (d > 0 ? '+' : d < 0 ? '\u2212' : '\u00b1') +
  Math.abs(d).toFixed(2).replace(/\.?0+$/, '') + '\u00d7';

// ---- load ----
function showLoadError(err) {
  const banner = $('#load-error');
  banner.hidden = false;
  $('#load-error-detail').textContent = err && err.message ? err.message : String(err);
}

async function loadData() {
  const [resData, resGeo] = await Promise.all([
    fetch(DATA_URL, { cache: 'no-store' }),
    fetch(GEO_URL, { cache: 'no-store' }),
  ]);
  if (!resData.ok) throw new Error('HTTP ' + resData.status + ' (data)');
  const data = await resData.json();
  const geo = resGeo.ok ? await resGeo.json() : null;
  return { data, geo };
}

const euRows = () => state.data.rows.filter((r) => r.is_eu);

// ---- render: hero ----
function renderHero(d) {
  const rows = euRows();
  const winners = rows.filter((r) => r.more_chickens_than_people);
  const losers = rows.filter((r) => !r.more_chickens_than_people);
  $('#hero-count').textContent = winners.length;
  $('.hero__denom').textContent = '/ ' + rows.length;
  $('#hero-losers').textContent = losers.length
    ? 'The only exception' + (losers.length > 1 ? 's' : '') + ': ' +
      losers.map((l) => l.name + ' (' + fmtRatio(l.ratio) + '\u00d7)').join(' and ') + '.'
    : '';
  const eu = d.eu_total;
  $('#hero-eu').textContent = eu
    ? 'The EU-27 as a whole: ' + fmtRatio(eu.ratio) + '\u00d7 chickens per person \u2014 ' +
      fmtBig(eu.chickens) + ' chickens vs ' + fmtBig(eu.population) + ' people.'
    : '';
  $('#hero-meta').textContent =
    'Reference year ' + d.reference_year +
    ' \u00b7 chickens and people compared within the same year, per country.';
}

// ---- render: scope / notes ----
function renderScopeNote(d) {
  const eu = d.eu_total;
  const euNote = eu
    ? ' The EU-27 total is FAO\u2019s own estimate (flag E) because member-state series stop in ' +
      '2020\u20132023.'
    : '';
  $('#scope-note').innerHTML =
    'This dashboard shows the 27 EU member states only \u2014 the wider ' +
    '<em>Eurostat-demographic Europe</em> set (EFTA, the UK, and candidate countries) is omitted.' + euNote;
}

// ---- render: bar chart (current ratio) ----
function yearBadge(r, d) {
  if (r.year === d.reference_year) return '';
  return '<span class="year-badge" title="' + escapeHtml(r.data_note) + '">' + r.year + '</span>';
}

function renderBars(d) {
  const rows = euRows();
  state.maxRatio = Math.max.apply(null, rows.map((r) => r.ratio));
  const chart = $('#barchart');
  const lis = rows.map((r) => {
    const width = (r.ratio / state.maxRatio) * 100;
    const cls = r.more_chickens_than_people ? 'is-win' : 'is-lose';
    return (
      '<li class="bar-row ' + cls + '" data-geo="' + r.geo + '">' +
        '<span class="bar-label">' + escapeHtml(r.name) + yearBadge(r, d) + '</span>' +
        '<span class="bar-track"><span class="bar" style="width:' + width.toFixed(2) + '%"></span></span>' +
        '<span class="bar-value">' + fmtRatio(r.ratio) + '\u00d7</span>' +
      '</li>'
    );
  }).join('');
  chart.innerHTML =
    '<div class="barchart__threshold"><span class="barchart__threshold-label">1.0\u00d7</span></div>' +
    '<ul class="bar-list">' + lis + '</ul>';
  layoutThreshold();
}

function layoutThreshold() {
  const chart = $('#barchart');
  const track = chart.querySelector('.bar-track');
  const line = chart.querySelector('.barchart__threshold');
  if (!track || !line) return;
  const c = chart.getBoundingClientRect();
  const t = track.getBoundingClientRect();
  line.style.left = (t.left - c.left + t.width * (1 / state.maxRatio)) + 'px';
}

// ---- render: choropleth map (change in ratio) ----
function featurePath(f, px) {
  const g = f.geometry;
  if (!g) return '';
  const polys = g.type === 'Polygon' ? [g.coordinates]
    : g.type === 'MultiPolygon' ? g.coordinates : [];
  const parts = [];
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length < 4) continue;
      const pts = ring.map((c) => {
        const p = px(c[0], c[1]);
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      });
      parts.push('M' + pts.join('L') + 'Z');
    }
  }
  return parts.join(' ');
}

function colorFor(t) {
  const a = Math.max(-1, Math.min(1, t));
  const neutral = [242, 240, 234];
  const green = [31, 122, 61];
  const red = [162, 44, 31];
  const end = a >= 0 ? green : red;
  const m = Math.abs(a);
  const c = neutral.map((n, i) => Math.round(n + (end[i] - n) * m));
  return 'rgb(' + c.join(',') + ')';
}

function renderMap(d) {
  const mapEl = $('#map');
  if (!state.geo) {
    mapEl.innerHTML = '<p class="muted">Map geometry could not be loaded.</p>';
    return;
  }

  // delta (change in chickens-per-person, 2015 -> latest) per EU country
  const byYear = {};
  for (const t of d.timeseries) (byYear[t.geo] = byYear[t.geo] || {})[t.year] = t;
  const infoByGeo = {};
  let maxAbs = 0;
  for (const r of euRows()) {
    const t0 = byYear[r.geo] && byYear[r.geo][d.trend_start];
    const p0 = num(t0 && t0.population);
    const c0 = num(t0 && t0.chickens);
    const r0 = (p0 && c0) ? c0 / p0 : null;
    if (r0 === null) continue;
    const delta = r.ratio - r0;
    infoByGeo[r.geo] = { name: r.name, delta: delta, ratio0: r0, ratio1: r.ratio };
    maxAbs = Math.max(maxAbs, Math.abs(delta));
  }
  if (!maxAbs) maxAbs = 1;

  // equirectangular projection over a fixed Europe window (cos-corrected);
  // the SVG viewport clips overseas territories (e.g. French Guiana).
  const W = 720, H = 940;
  const lonMin = -12, lonMax = 36, latMin = 33, latMax = 72;
  const lat0 = (latMin + latMax) / 2;
  const k = Math.cos(lat0 * Math.PI / 180);
  const scale = Math.min(W / ((lonMax - lonMin) * k), H / (latMax - latMin));
  const cxl = (lonMin + lonMax) / 2, cyl = (latMin + latMax) / 2;
  const px = (lon, lat) => [(lon - cxl) * k * scale + W / 2, (cyl - lat) * scale + H / 2];

  const ctxParts = [], euParts = [];
  for (const f of state.geo.features) {
    const dPath = featurePath(f, px);
    if (!dPath) continue;
    if (f.properties.eu) {
      const info = infoByGeo[f.properties.CNTR_ID];
      let fill = '#cfcbc1';
      let title = '';
      if (info) {
        fill = colorFor(info.delta / maxAbs);
        title = escapeHtml(info.name + ': ' + signed(info.delta) +
          ' (' + info.ratio0.toFixed(2) + '\u00d7 \u2192 ' + info.ratio1.toFixed(2) + '\u00d7)');
      }
      euParts.push('<path class="map-eu" fill="' + fill + '" fill-rule="evenodd" d="' + dPath + '">' +
        (title ? '<title>' + title + '</title>' : '') + '</path>');
    } else {
      ctxParts.push('<path class="map-ctx" fill-rule="evenodd" d="' + dPath + '"/>');
    }
  }

  mapEl.innerHTML =
    '<svg class="map__svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Map of the change in chickens per person across the EU">' +
      '<rect class="map__sea" x="0" y="0" width="' + W + '" height="' + H + '"/>' +
      ctxParts.join('') + euParts.join('') +
    '</svg>';

  renderMapLegend(maxAbs);
}

function renderMapLegend(maxAbs) {
  const svg =
    '<svg class="map-legend__svg" viewBox="0 0 300 16" aria-hidden="true">' +
      '<defs><linearGradient id="map-grad" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="rgb(162,44,31)"/>' +
        '<stop offset="0.5" stop-color="rgb(242,240,234)"/>' +
        '<stop offset="1" stop-color="rgb(31,122,61)"/>' +
      '</linearGradient></defs>' +
      '<rect x="0" y="0" width="300" height="12" rx="3" fill="url(#map-grad)"/>' +
    '</svg>';
  const labels =
    '<div class="map-legend__labels"><span>' + signed(-maxAbs) + '</span><span>0</span><span>' +
    signed(maxAbs) + '</span></div>';
  $('#map-legend').innerHTML = svg + labels;
}

// ---- render: table ----
function visibleRows() {
  const rows = euRows();
  if (!state.query) return rows.slice();
  const q = state.query.toLowerCase();
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

function sortedRows(rows) {
  const key = state.sortKey;
  const dir = state.sortDir;
  return rows.slice().sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name);
    return dir * (Number(a[key]) - Number(b[key]));
  });
}

function renderTableBody() {
  const d = state.data;
  const rows = sortedRows(visibleRows());
  const parts = [];
  rows.forEach((r, i) => {
    const badge = r.year !== d.reference_year ? yearBadge(r, d) : r.year;
    parts.push(
      '<tr class="row" data-geo="' + r.geo + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + escapeHtml(r.name) + '</td>' +
        '<td class="num">' + badge + '</td>' +
        '<td class="num">' + fmtInt(r.chickens) + '</td>' +
        '<td class="num">' + fmtInt(r.population) + '</td>' +
        '<td class="num"><strong>' + fmtRatio(r.ratio) + '\u00d7</strong></td>' +
      '</tr>'
    );
  });
  $('#tbody').innerHTML = parts.join('');
}

// ---- events ----
function updateSortIndicators() {
  document.querySelectorAll('#table th[data-sort]').forEach((th) => {
    if (th.dataset.sort === state.sortKey) {
      th.dataset.dir = state.sortDir === -1 ? 'desc' : 'asc';
      th.setAttribute('aria-sort', state.sortDir === -1 ? 'descending' : 'ascending');
    } else {
      delete th.dataset.dir;
      th.removeAttribute('aria-sort');
    }
  });
}

function setupEvents() {
  document.querySelectorAll('#table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === 'name' ? 1 : -1;
      }
      updateSortIndicators();
      renderTableBody();
    });
  });

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    renderTableBody();
  });
}

// ---- init ----
async function init() {
  try {
    const loaded = await loadData();
    state.data = loaded.data;
    state.geo = loaded.geo;
  } catch (err) {
    showLoadError(err);
    return;
  }
  $('#app').hidden = false;
  renderHero(state.data);
  renderMap(state.data);
  renderBars(state.data);
  renderScopeNote(state.data);
  renderTableBody();
  updateSortIndicators();
  setupEvents();
}

window.addEventListener('resize', layoutThreshold);
init();
