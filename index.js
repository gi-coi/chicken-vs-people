'use strict';

// chicken-vs-people dashboard
// Heavy lifting (cleaning, aggregation, growth, formatting decisions) happens in
// scripts/prepare.py. This file only fetches the packaged JSON and renders it,
// plus simple filter/sort/expand interactions.

const DATA_URL = 'data/chickens_people.json';

const state = {
  data: null,
  sortKey: 'ratio',
  sortDir: -1, // -1 = descending, 1 = ascending
  query: '',
  expanded: null,
  maxRatio: 1,
};

const $ = (sel) => document.querySelector(sel);

// ---- formatting helpers ----
const fmtInt = (n) => Number(n).toLocaleString('en-US');
const fmtRatio = (r) => Number(r).toFixed(2);
const fmtM = (n) => (Number(n) / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
const fmtGrowth = (g) => {
  if (g === null || g === undefined || g === '') return '\u2014';
  const v = Number(g).toFixed(1);
  return Number(g) > 0 ? '+' + v + '%' : v + '%';
};

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
    const an = Number(a[key]);
    const bn = Number(b[key]);
    if (key === 'growth_pct') {
      const av = a[key] === null || a[key] === undefined || a[key] === '' ? -Infinity : an;
      const bv = b[key] === null || b[key] === undefined || b[key] === '' ? -Infinity : bn;
      return dir * (av - bv);
    }
    return dir * (an - bn);
  });
}

function renderTableBody() {
  const d = state.data;
  const rows = sortedRows(visibleRows());
  const parts = [];
  rows.forEach((r, i) => {
    const badge = r.year !== d.reference_year ? yearBadge(r, d) : r.year;
    const growthCls = r.growth_pct > 0 ? 'pos' : (r.growth_pct < 0 ? 'neg' : 'zero');
    const expanded = state.expanded === r.geo;
    parts.push(
      '<tr class="row' + (expanded ? ' is-expanded' : '') + '" data-geo="' + r.geo + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + escapeHtml(r.name) + '</td>' +
        '<td class="num">' + badge + '</td>' +
        '<td class="num">' + fmtInt(r.chickens) + '</td>' +
        '<td class="num">' + fmtInt(r.population) + '</td>' +
        '<td class="num"><strong>' + fmtRatio(r.ratio) + '\u00d7</strong></td>' +
        '<td class="num ' + growthCls + '" title="Chicken stock, 2015 \u2192 ' + r.year + '">' +
          fmtGrowth(r.growth_pct) + '</td>' +
      '</tr>'
    );
    if (expanded) {
      parts.push('<tr class="detail"><td colspan="7">' + sparklineHTML(r.geo) + '</td></tr>');
    }
  });
  $('#tbody').innerHTML = parts.join('');
}

// ---- render: sparkline (SVG, no external lib) ----
function sparklineHTML(geo) {
  const d = state.data;
  const pts = d.timeseries
    .filter((t) => t.geo === geo && t.chickens !== '' && t.chickens != null)
    .sort((a, b) => a.year - b.year);
  if (pts.length < 2) return '<p class="muted">Not enough data for a trend.</p>';

  const W = 620, H = 150, padL = 12, padR = 12, padT = 14, padB = 12;
  const minYear = d.trend_start, maxYear = d.reference_year;
  const maxV = Math.max.apply(null, pts.map((p) => p.chickens));
  const x = (year) => padL + (year - minYear) / (maxYear - minYear) * (W - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);

  const linePts = pts.map((p) => x(p.year).toFixed(1) + ',' + y(p.chickens).toFixed(1)).join(' ');
  const areaPts = x(pts[0].year).toFixed(1) + ',' + (H - padB) + ' ' + linePts + ' ' +
    x(pts[pts.length - 1].year).toFixed(1) + ',' + (H - padB);
  const dots = pts.map((p) => {
    const hollow = p.chicken_flag !== 'A';
    return '<circle cx="' + x(p.year).toFixed(1) + '" cy="' + y(p.chickens).toFixed(1) +
      '" r="3" class="spark-dot' + (hollow ? ' is-imputed' : '') + '" />';
  }).join('');

  const first = pts[0], last = pts[pts.length - 1];
  return (
    '<div class="spark">' +
      '<svg class="spark__svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
        'aria-label="Chicken stock ' + first.year + ' to ' + last.year + '">' +
        '<polygon points="' + areaPts + '" class="spark-area"></polygon>' +
        '<polyline points="' + linePts + '" class="spark-line"></polyline>' +
        dots +
      '</svg>' +
      '<div class="spark__meta">' +
        '<span>' + first.year + '</span>' +
        '<span class="spark__values">' + fmtM(first.chickens) + ' \u2192 ' + fmtM(last.chickens) + ' head</span>' +
        '<span>' + last.year + '</span>' +
      '</div>' +
      '<p class="muted spark__note">Chicken stock (head), ' + d.trend_start + '\u2013' + d.reference_year +
        '. Hollow dots = FAO imputed/estimated values.</p>' +
    '</div>'
  );
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

  $('#tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.row');
    if (!tr) return;
    const geo = tr.dataset.geo;
    state.expanded = state.expanded === geo ? null : geo;
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
  renderScopeNote(state.data);
  renderTableBody();
  updateSortIndicators();
  setupEvents();
}

window.addEventListener('resize', layoutThreshold);
init();
