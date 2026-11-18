'use strict';

// chicken-vs-people dashboard
// Heavy lifting (cleaning, aggregation, growth, formatting decisions) happens in
// scripts/prepare.py. This file only fetches the packaged JSON and renders it,
// plus simple filter/sort/select interactions.

const DATA_URL = 'data/chickens_people.json';

const state = {
  data: null,
  sortKey: 'ratio',
  sortDir: -1, // -1 = descending, 1 = ascending
  query: '',
  selectedGeo: null,
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

// ---- render: hero ----
function renderHero(d) {
  const winners = d.rows.filter((r) => r.more_chickens_than_people);
  const losers = d.rows.filter((r) => !r.more_chickens_than_people);
  $('#hero-count').textContent = winners.length;
  $('.hero__denom').textContent = '/ ' + d.rows.length;
  const loserTxt = losers.map((l) => l.name + ' (' + fmtRatio(l.ratio) + '\u00d7)').join(' and ');
  $('#hero-losers').textContent = 'The only exceptions: ' + loserTxt + '.';
  $('#hero-meta').textContent =
    'Reference year ' + d.reference_year +
    ' \u00b7 chickens and people compared within the same year, per country.';
}

// ---- render: scope / inclusion-criterion note ----
function renderScopeNote(d) {
  const total = d.rows.length + d.excluded.length;
  $('#scope-note').innerHTML =
    '\u201cEuropean\u201d here means the ' + total + ' countries of <em>Eurostat-demographic Europe</em> \u2014 ' +
    'the EU-27, EFTA (Iceland, Liechtenstein, Norway, Switzerland), the United Kingdom, and the EU ' +
    'candidate / potential-candidate countries. A country is included when both a FAOSTAT chicken-stock ' +
    'figure and a Eurostat population figure exist for a common year; ' + d.rows.length + ' of the ' + total +
    ' do. Countries without a clean figure are omitted \u2014 reasons in ' +
    '<a href="../docs/uncertainties.md">docs/uncertainties.md</a>.';
}

// ---- render: bar chart ----
function yearBadge(r, d) {
  if (r.year === d.reference_year) return '';
  return '<span class="year-badge" title="' + escapeHtml(r.data_note) + '">' + r.year + '</span>';
}

function renderBars(d) {
  state.maxRatio = Math.max.apply(null, d.rows.map((r) => r.ratio));
  const chart = $('#barchart');
  const lis = d.rows.map((r) => {
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

// ---- render: table ----
function visibleRows() {
  if (!state.query) return state.data.rows.slice();
  const q = state.query.toLowerCase();
  return state.data.rows.filter((r) => r.name.toLowerCase().includes(q));
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
    const selected = state.selectedGeo === r.geo;
    parts.push(
      '<tr class="row' + (selected ? ' is-selected' : '') + '" data-geo="' + r.geo + '">' +
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

// ---- render: interactive line chart (normalized people vs chickens) ----
function buildCountrySelect() {
  const sel = $('#country-select');
  const opts = state.data.rows
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => '<option value="' + r.geo + '"' +
      (r.geo === state.selectedGeo ? ' selected' : '') + '>' + escapeHtml(r.name) + '</option>')
    .join('');
  sel.innerHTML = opts;
}

function seriesSegments(series) {
  const segs = [];
  let cur = [];
  for (const p of series) {
    if (cur.length && p.year !== cur[cur.length - 1].year + 1) {
      segs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

function renderLineChart(geo) {
  const d = state.data;
  const row = d.rows.find((r) => r.geo === geo);
  const name = row ? row.name : geo;
  const chart = $('#linechart');

  const W = 680, H = 320;
  const padL = 50, padR = 18, padT = 18, padB = 38;
  const minYear = d.trend_start, maxYear = d.reference_year;

  const byYear = {};
  for (const t of d.timeseries) {
    if (t.geo === geo) byYear[t.year] = t;
  }

  const basePop = num(byYear[minYear] && byYear[minYear].population);
  const baseChick = num(byYear[minYear] && byYear[minYear].chickens);

  const pop = [], chick = [];
  for (let y = minYear; y <= maxYear; y++) {
    const t = byYear[y];
    if (!t) continue;
    const p = num(t.population);
    const c = num(t.chickens);
    if (p !== null && basePop) pop.push({ year: y, value: p / basePop * 100 });
    if (c !== null && baseChick) chick.push({ year: y, value: c / baseChick * 100 });
  }

  const allVals = pop.concat(chick).map((p) => p.value);
  if (!allVals.length) {
    chart.innerHTML = '<p class="muted">No data for ' + escapeHtml(name) + '.</p>';
    return;
  }
  const lo = Math.min(100, Math.min.apply(null, allVals));
  const hi = Math.max(100, Math.max.apply(null, allVals));
  const span = (hi - lo) || 10;
  const yLo = lo - span * 0.12;
  const yHi = hi + span * 0.12;

  const x = (year) => padL + (year - minYear) / (maxYear - minYear) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - yLo) / (yHi - yLo)) * (H - padT - padB);

  const pathFor = (series, cls) => seriesSegments(series).map((s) => {
    const pts = s.map((p) => x(p.year).toFixed(1) + ',' + y(p.value).toFixed(1)).join(' ');
    return '<polyline class="' + cls + '" points="' + pts + '" />';
  }).join('');

  const dotsFor = (series, cls) => series.map((p) =>
    '<circle class="' + cls + '" cx="' + x(p.year).toFixed(1) +
    '" cy="' + y(p.value).toFixed(1) + '" r="3" />'
  ).join('');

  const tickCount = 5;
  const ticks = [];
  for (let i = 0; i < tickCount; i++) {
    ticks.push(yLo + (yHi - yLo) * i / (tickCount - 1));
  }
  const gridlines = ticks.map((v) =>
    '<line class="gridline" x1="' + padL + '" y1="' + y(v).toFixed(1) +
    '" x2="' + (W - padR) + '" y2="' + y(v).toFixed(1) + '" />'
  ).join('');
  const yLabels = ticks.map((v) =>
    '<text class="axis-label" x="' + (padL - 8) + '" y="' + (y(v) + 3.5).toFixed(1) +
    '" text-anchor="end">' + Math.round(v) + '</text>'
  ).join('');
  const xLabels = [];
  for (let yr = minYear; yr <= maxYear; yr++) {
    xLabels.push('<text class="axis-label" x="' + x(yr).toFixed(1) +
      '" y="' + (H - padB + 16) + '" text-anchor="middle">' + yr + '</text>');
  }

  const svg =
    '<svg class="linechart__svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="' + escapeHtml(name) + ' people vs chickens, indexed to ' + minYear + '">' +
      gridlines +
      '<line class="baseline" x1="' + padL + '" y1="' + y(100).toFixed(1) +
        '" x2="' + (W - padR) + '" y2="' + y(100).toFixed(1) + '" />' +
      '<line class="axis" x1="' + padL + '" y1="' + padT +
        '" x2="' + padL + '" y2="' + (H - padB) + '" />' +
      '<line class="axis" x1="' + padL + '" y1="' + (H - padB) +
        '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" />' +
      pathFor(pop, 'line-pop') + pathFor(chick, 'line-chick') +
      dotsFor(pop, 'dot-pop') + dotsFor(chick, 'dot-chick') +
      yLabels + xLabels.join('') +
    '</svg>';

  chart.innerHTML = svg +
    '<p class="muted linechart__note">' + escapeHtml(name) +
    ' \u2014 indexed to 100 in ' + minYear + '. Dashed line = 2015 level.</p>';
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

function selectCountry(geo) {
  state.selectedGeo = geo;
  $('#country-select').value = geo;
  renderLineChart(geo);
  renderTableBody();
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

  $('#tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.row');
    if (!tr) return;
    selectCountry(tr.dataset.geo);
    const chart = $('#linechart');
    if (chart && chart.scrollIntoView) chart.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  state.selectedGeo = state.data.rows[0] ? state.data.rows[0].geo : null;
  $('#app').hidden = false;
  renderHero(state.data);
  renderBars(state.data);
  renderScopeNote(state.data);
  buildCountrySelect();
  renderLineChart(state.selectedGeo);
  renderTableBody();
  updateSortIndicators();
  setupEvents();
}

window.addEventListener('resize', layoutThreshold);
init();
