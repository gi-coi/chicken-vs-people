'use strict';

// chicken-vs-people dashboard (EU-27 focus)
// Heavy lifting (cleaning, aggregation, growth, formatting decisions) happens in
// scripts/prepare.py. This file only fetches the packaged JSON and renders it,
// plus simple filter/sort/select interactions.

const DATA_URL = 'data/chickens_people.json';

const state = {
  data: null,
  sortKey: 'ratio',
  sortDir: -1, // -1 = descending, 1 = ascending
  query: '',
  selected: 'EU', // 'EU' or a country geo code
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

// ---- the currently selected entity (EU aggregate or a country) ----
function selectedEntity() {
  if (state.selected === 'EU') {
    const eu = state.data.eu_total;
    return { isEU: true, name: 'EU', ratio: eu.ratio, chickens: eu.chickens, population: eu.population, year: eu.year };
  }
  const r = euRows().find((x) => x.geo === state.selected);
  return { isEU: false, geo: r.geo, name: r.name, ratio: r.ratio, chickens: r.chickens, population: r.population, year: r.year };
}

function displayName(name) {
  if (name === 'EU') return 'the EU';
  if (name === 'Netherlands') return 'the Netherlands';
  return name;
}

// ---- render: pictogram (floor(ratio) chickens + a fractional one) ----
function renderPictogram(ratio) {
  const full = Math.floor(ratio);
  const frac = ratio - full;
  const icons = [];
  for (let i = 0; i < full; i++) {
    icons.push('<svg class="picto" viewBox="0 0 40 40" width="40" height="40"><use href="#icon-chicken"/></svg>');
  }
  if (frac > 0.02) {
    const w = (frac * 40).toFixed(1);
    icons.push(
      '<svg class="picto" viewBox="0 0 40 40" width="40" height="40" aria-label="' + frac.toFixed(2) + ' of a chicken">' +
        '<defs><clipPath id="frac-clip"><rect x="0" y="0" width="' + w + '" height="40"/></clipPath></defs>' +
        '<g opacity="0.25"><use href="#icon-chicken"/></g>' +
        '<g clip-path="url(#frac-clip)"><use href="#icon-chicken"/></g>' +
      '</svg>'
    );
  }
  $('#pictogram-icons').innerHTML = icons.join('');
}

// ---- render: hero ----
function renderHero() {
  const d = state.data;
  const ent = selectedEntity();
  $('#hero-who').textContent = displayName(ent.name);
  $('#hero-ratio').textContent = fmtRatio(ent.ratio);
  renderPictogram(ent.ratio);
  $('#hero-eu').textContent =
    'That\u2019s ' + fmtBig(ent.chickens) + ' chickens and ' + fmtBig(ent.population) + ' people.';

  if (ent.isEU) {
    const rows = euRows();
    const winners = rows.filter((r) => r.more_chickens_than_people);
    const losers = rows.filter((r) => !r.more_chickens_than_people);
    $('#hero-countline').textContent =
      winners.length + ' of ' + rows.length + ' EU countries have more chickens than people' +
      (losers.length
        ? ' \u2014 the only exception is ' +
          losers.map((l) => l.name + ' (' + fmtRatio(l.ratio) + '\u00d7)').join(', ') + '.'
        : '.');
    $('#hero-countline').hidden = false;
  } else {
    $('#hero-countline').hidden = true;
  }

  const yearNote = (!ent.isEU && ent.year !== d.reference_year)
    ? 'Chickens from ' + ent.year + ' (latest available). '
    : '';
  $('#hero-meta').textContent =
    'Reference year ' + d.reference_year + ' \u00b7 ' + yearNote +
    'chickens and people compared within the same year.';
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

// ---- render: slopegraph (level + change in chickens-per-person) ----
function renderSlopeChart() {
  const d = state.data;
  const byYear = {};
  for (const t of d.timeseries) (byYear[t.geo] = byYear[t.geo] || {})[t.year] = t;

  const items = euRows().map((r) => {
    const t0 = byYear[r.geo] && byYear[r.geo][d.trend_start];
    const p0 = num(t0 && t0.population);
    const c0 = num(t0 && t0.chickens);
    const r0 = (p0 && c0) ? c0 / p0 : null;
    return { geo: r.geo, name: r.name, year: r.year, r0: r0, r1: r.ratio, delta: r0 !== null ? r.ratio - r0 : null };
  }).filter((it) => it.delta !== null)
    .sort((a, b) => b.r1 - a.r1); // sorted by latest ratio

  const axisMax = Math.ceil(Math.max.apply(null, items.map((i) => i.r1)));
  const n = items.length;
  const rowH = 32, topPad = 30, bottomPad = 26;
  const W = 880;
  const H = topPad + n * rowH + bottomPad;
  const nameX = 130, x0 = 165, x1 = 650, textX = 872;
  const x = (r) => x0 + (r / axisMax) * (x1 - x0);
  const y = (i) => topPad + i * rowH + rowH / 2;

  const highlight = state.selected; // 'EU' (none) or a geo
  const parts = [];
  items.forEach((it, i) => {
    const yy = y(i);
    const xa = x(it.r0), xb = x(it.r1);
    const dir = it.delta > 0 ? 'up' : (it.delta < 0 ? 'down' : 'flat');
    const col = dir === 'up' ? C_ORANGE : (dir === 'down' ? C_BLUE : [140, 140, 140]);
    const rgb = 'rgb(' + col.join(',') + ')';
    const name = it.name + (it.year !== d.reference_year ? '*' : '');
    const dim = (highlight !== 'EU' && it.geo !== highlight) ? 0.18 : 1;

    parts.push(
      '<g opacity="' + dim + '">' +
        '<line class="slope-line" x1="' + xa.toFixed(1) + '" y1="' + yy + '" x2="' + xb.toFixed(1) + '" y2="' + yy + '" stroke="' + rgb + '"/>' +
        '<circle class="slope-dot" cx="' + xa.toFixed(1) + '" cy="' + yy + '" r="4"/>' +
        '<circle class="slope-dot slope-dot--end" cx="' + xb.toFixed(1) + '" cy="' + yy + '" r="4.5" style="fill:' + rgb + '"/>' +
        '<text class="slope-name" x="' + nameX + '" y="' + (yy + 4.5) + '" text-anchor="end">' + escapeHtml(name) + '</text>' +
        '<text class="slope-vals" x="' + textX + '" y="' + (yy + 4.5) + '" text-anchor="end">' +
          it.r0.toFixed(2) + '\u00d7 \u2192 ' +
          '<tspan class="slope-vals--end" fill="' + rgb + '">' + it.r1.toFixed(2) + '\u00d7</tspan>' +
        '</text>' +
      '</g>'
    );
  });

  let axis = '<line class="slope-axis" x1="' + x0 + '" y1="' + (H - bottomPad) + '" x2="' + x1 + '" y2="' + (H - bottomPad) + '"/>';
  for (let t = 0; t <= axisMax; t++) {
    axis += '<line class="slope-tick" x1="' + x(t) + '" y1="' + (H - bottomPad) + '" x2="' + x(t) + '" y2="' + (H - bottomPad + 4) + '"/>' +
      '<text class="slope-ticklabel" x="' + x(t) + '" y="' + (H - bottomPad + 17) + '" text-anchor="middle">' + t + '</text>';
  }
  const xth = x(1.0).toFixed(1);

  $('#slopechart').innerHTML =
    '<div class="slope-scroll">' +
      '<svg class="slope__svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
        'aria-label="Chickens per person, 2015 to latest, by EU country">' +
        '<line class="slope-threshold" x1="' + xth + '" y1="' + (topPad - 12) + '" x2="' + xth + '" y2="' + (H - bottomPad) + '"/>' +
        '<text class="slope-threshold-label" x="' + xth + '" y="' + (topPad - 16) + '" text-anchor="middle">1.0\u00d7</text>' +
        axis + parts.join('') +
      '</svg>' +
    '</div>' +
    '<p class="muted slope-note">Open dot = 2015, filled dot = latest year. Orange = rose, blue = fell. Dashed line = 1.0\u00d7 (equal). * = chicken figure from 2020 or 2023 (latest available).</p>';
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

function buildCountrySelect() {
  const sel = $('#country-select');
  const opts = ['<option value="EU">European Union (27)</option>'];
  for (const r of euRows().slice().sort((a, b) => a.name.localeCompare(b.name))) {
    opts.push('<option value="' + r.geo + '">' + escapeHtml(r.name) + '</option>');
  }
  sel.innerHTML = opts.join('');
}

function selectCountry(geo) {
  state.selected = geo;
  renderHero();
  renderSlopeChart();
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

  $('#country-select').addEventListener('change', (e) => {
    selectCountry(e.target.value);
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
  buildCountrySelect();
  renderHero();
  renderSlopeChart();
  renderScopeNote(state.data);
  renderTableBody();
  updateSortIndicators();
  setupEvents();
}

init();
