'use strict';

// chicken-vs-people dashboard (EU-27 focus)
// Heavy lifting (cleaning, aggregation, growth, formatting decisions) happens in
// scripts/prepare.py. This file only fetches the packaged JSON and renders it,
// plus simple filter/sort interactions.

const DATA_URL = 'data/chickens_people.json';

const state = {
  data: null,
  sortKey: 'ratio',
  sortDir: -1, // -1 = descending, 1 = ascending
  query: '',
  maxRatio: 1,
};

const $ = (sel) => document.querySelector(sel);

// Accessible (colour-blind-friendly) diverging scale: blue <-> orange.
const C_BLUE = [44, 123, 182];    // #2c7bb6 — more people / ratio fell
const C_ORANGE = [224, 123, 57];  // #e07b39 — more chickens / ratio rose

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

// ---- load ----
function showLoadError(err) {
  const banner = $('#load-error');
  banner.hidden = false;
  $('#load-error-detail').textContent = err && err.message ? err.message : String(err);
}

async function loadData() {
  const res = await fetch(DATA_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  return res.json();
}

const euRows = () => state.data.rows.filter((r) => r.is_eu);

// ---- render: hero ----
function renderHero(d) {
  const rows = euRows();
  const winners = rows.filter((r) => r.more_chickens_than_people);
  const losers = rows.filter((r) => !r.more_chickens_than_people);
  const eu = d.eu_total;
  $('#hero-ratio').textContent = fmtRatio(eu.ratio);
  $('#hero-eu').textContent = eu
    ? 'That\u2019s ' + fmtBig(eu.chickens) + ' chickens and ' + fmtBig(eu.population) + ' people.'
    : '';
  $('#hero-countline').textContent =
    winners.length + ' of ' + rows.length + ' EU countries have more chickens than people' +
    (losers.length
      ? ' \u2014 the only exception is ' +
        losers.map((l) => l.name + ' (' + fmtRatio(l.ratio) + '\u00d7)').join(', ') + '.'
      : '.');
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

// ---- shared: year badge ----
function yearBadge(r, d) {
  if (r.year === d.reference_year) return '';
  return '<span class="year-badge" title="' + escapeHtml(r.data_note) + '">' + r.year + '</span>';
}

// ---- render: bar chart (current ratio, ranked) ----
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

// ---- render: slopegraph (change in chickens-per-person, 2015 -> latest) ----
function renderSlopeChart(d) {
  const byYear = {};
  for (const t of d.timeseries) (byYear[t.geo] = byYear[t.geo] || {})[t.year] = t;

  const items = euRows().map((r) => {
    const t0 = byYear[r.geo] && byYear[r.geo][d.trend_start];
    const p0 = num(t0 && t0.population);
    const c0 = num(t0 && t0.chickens);
    const r0 = (p0 && c0) ? c0 / p0 : null;
    return { name: r.name, year: r.year, r0: r0, r1: r.ratio, delta: r0 !== null ? r.ratio - r0 : null };
  }).filter((it) => it.delta !== null)
    .sort((a, b) => b.r1 - a.r1); // sorted by latest ratio (matches the ranked bars)

  const axisMax = Math.ceil(Math.max.apply(null, items.map((i) => i.r1)));
  const n = items.length;
  const rowH = 26, topPad = 28, bottomPad = 24;
  const W = 880;
  const H = topPad + n * rowH + bottomPad;
  const nameX = 130, x0 = 165, x1 = 650, textX = 872;
  const x = (r) => x0 + (r / axisMax) * (x1 - x0);
  const y = (i) => topPad + i * rowH + rowH / 2;

  const parts = [];
  items.forEach((it, i) => {
    const yy = y(i);
    const xa = x(it.r0), xb = x(it.r1);
    const dir = it.delta > 0 ? 'up' : (it.delta < 0 ? 'down' : 'flat');
    const col = dir === 'up' ? C_ORANGE : (dir === 'down' ? C_BLUE : [140, 140, 140]);
    const rgb = 'rgb(' + col.join(',') + ')';
    const name = it.name + (it.year !== d.reference_year ? ' (' + it.year + ')' : '');
    parts.push(
      '<line class="slope-line" x1="' + xa.toFixed(1) + '" y1="' + yy + '" x2="' + xb.toFixed(1) + '" y2="' + yy + '" stroke="' + rgb + '"/>' +
      '<circle class="slope-dot" cx="' + xa.toFixed(1) + '" cy="' + yy + '" r="3.5"/>' +
      '<circle class="slope-dot slope-dot--end" cx="' + xb.toFixed(1) + '" cy="' + yy + '" r="4.5" fill="' + rgb + '"/>' +
      '<text class="slope-name" x="' + nameX + '" y="' + (yy + 3.5) + '" text-anchor="end">' + escapeHtml(name) + '</text>' +
      '<text class="slope-vals" x="' + textX + '" y="' + (yy + 3.5) + '" text-anchor="end">' +
        it.r0.toFixed(2) + '\u00d7 \u2192 ' +
        '<tspan class="slope-vals--end" fill="' + rgb + '">' + it.r1.toFixed(2) + '\u00d7</tspan>' +
      '</text>'
    );
  });

  let axis = '<line class="slope-axis" x1="' + x0 + '" y1="' + (H - bottomPad) + '" x2="' + x1 + '" y2="' + (H - bottomPad) + '"/>';
  for (let t = 0; t <= axisMax; t++) {
    axis += '<line class="slope-tick" x1="' + x(t) + '" y1="' + (H - bottomPad) + '" x2="' + x(t) + '" y2="' + (H - bottomPad + 4) + '"/>' +
      '<text class="slope-ticklabel" x="' + x(t) + '" y="' + (H - bottomPad + 15) + '" text-anchor="middle">' + t + '</text>';
  }
  const xth = x(1.0).toFixed(1);

  $('#slopechart').innerHTML =
    '<svg class="slope__svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Change in chickens per person, 2015 to latest, by EU country">' +
      '<line class="slope-threshold" x1="' + xth + '" y1="' + (topPad - 12) + '" x2="' + xth + '" y2="' + (H - bottomPad) + '"/>' +
      '<text class="slope-threshold-label" x="' + xth + '" y="' + (topPad - 16) + '" text-anchor="middle">1.0\u00d7</text>' +
      axis + parts.join('') +
    '</svg>' +
    '<p class="muted slope-note">Open circle = 2015, filled = latest year. Orange = rose, blue = fell. Dashed line = 1.0\u00d7 (equal).</p>';
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
    state.data = await loadData();
  } catch (err) {
    showLoadError(err);
    return;
  }
  $('#app').hidden = false;
  renderHero(state.data);
  renderBars(state.data);
  renderSlopeChart(state.data);
  renderScopeNote(state.data);
  renderTableBody();
  updateSortIndicators();
  setupEvents();
}

window.addEventListener('resize', layoutThreshold);
init();
