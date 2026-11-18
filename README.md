# chicken-vs-people

Identify European countries with more chickens than people.

A simple static HTML dashboard, plus documentation of data sources and uncertainties.

## Dashboard

`dashboard/index.html` fetches `dashboard/data/chickens_people.json`, so open it through a
static server (browsers block `fetch()` over `file://`):

```sh
# in the repo root
python3 -m http.server
# then open http://localhost:8000/dashboard/
```

It also works as-is on GitHub Pages.

## Data

Reproduce the data and dashboard payload from the cached raw sources:

```sh
uv run python scripts/prepare.py
uv run pytest
```

Sources and caveats: `docs/sources.md` · `docs/uncertainties.md`.
