'use strict';

// chicken-vs-people dashboard
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

// ---- render: bar chart (current ratio) ----
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

// ---- render: change chart (delta in chickens-per-person, 2015 -> latest) ----
function renderChangeChart(d) {
  const byYear = {};
  for (const t of d.timeseries) {
    (byYear[t.geo] = byYear[t.geo] || {})[t.year] = t;
  }

  const changes = d.rows.map((r) => {
    const t0 = byYear[r.geo] && byYear[r.geo][d.trend_start];
    const pop0 = num(t0 && t0.population);
    const chk0 = num(t0 && t0.chickens);
    const ratio0 = (pop0 && chk0) ? chk0 / pop0 : null;
    return {
      geo: r.geo, name: r.name, year: r.year, data_note: r.data_note,
      ratio0: ratio0, ratio1: r.ratio,
      delta: ratio0 !== null ? r.ratio - ratio0 : null,
    };
  }).filter((c) => c.delta !== null);

  const maxAbs = Math.max.apply(null, changes.map((c) => Math.abs(c.delta)));
  const sorted = changes.slice().sort((a, b) => b.delta - a.delta);

  const lis = sorted.map((c) => {
    const w = (Math.abs(c.delta) / maxAbs) * 50;
    const dir = c.delta > 0 ? 'up' : (c.delta < 0 ? 'down' : 'flat');
    const sign = c.delta > 0 ? '+' : (c.delta < 0 ? '\u2212' : '\u00b1');
    const deltaTxt = sign + Math.abs(c.delta).toFixed(2).replace(/\.?0+$/, '') + '\u00d7';
    const badge = c.year !== d.reference_year ? yearBadge(c, d) : '';
    return (
      '<li class="change-row">' +
        '<span class="change-label">' + escapeHtml(c.name) + badge + '</span>' +
        '<span class="change-track"><span class="change-bar change-bar--' + dir +
          '" style="width:' + w.toFixed(2) + '%"></span></span>' +
        '<span class="change-value">' +
          '<span class="change-delta change-delta--' + dir + '">' + deltaTxt + '</span>' +
          '<span class="change-range">' + c.ratio0.toFixed(2) + '\u00d7 \u2192 ' +
            c.ratio1.toFixed(2) + '\u00d7</span>' +
        '</span>' +
      '</li>'
    );
  }).join('');

  $('#changechart').innerHTML = '<ul class="change-list">' + lis + '</ul>';
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
  renderChangeChart(state.data);
  renderScopeNote(state.data);
  renderTableBody();
  updateSortIndicators();
  setupEvents();
}

window.addEventListener('resize', layoutThreshold);
init();
