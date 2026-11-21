# chicken-vs-people

Which EU countries have more chickens than people?

An interactive dashboard comparing the number of **chickens** (FAOSTAT) against the
**human population** (Eurostat) for the 27 EU member states.

The headline finding: in the EU there are **3.28 chickens for every person**, and
**26 of 27 EU countries have more chickens than people** — Luxembourg is the only one
with more people than chickens.

## View it

**https://gi-coi.github.io/chicken-vs-people/**

## Run locally

The dashboard fetches `dashboard/data/chickens_people.json`, so it needs to be served
over HTTP (browsers block `fetch()` on `file://`):

```sh
git clone https://github.com/gi-coi/chicken-vs-people.git
cd chicken-vs-people
python3 -m http.server
# then open http://localhost:8000/dashboard/
```

## Regenerate the data

The packaged data is built from cached raw sources in `data/raw/` (gitignored):

```sh
uv run python scripts/prepare.py   # rebuild data/processed + dashboard/data JSON
uv run pytest                      # 28 data-integrity tests
```

## Data & caveats

- **Chickens** — FAOSTAT QCL, item 1057 "Chickens", element "Stocks" (1000 head).
- **People** — Eurostat `demo_gind`, indicator JAN (population on 1 January).
- Reference year **2024**; where a country's chicken series ends earlier
  (2020 or 2023), both chickens and people use that latest common year.
- The EU-27 total is FAO's own estimate (flag E), since member-state series
  stop in 2020–2023.

Full provenance and known uncertainties:
[`docs/sources.md`](docs/sources.md) · [`docs/uncertainties.md`](docs/uncertainties.md).

## Structure

```
dashboard/   the static site (HTML/CSS/JS + packaged JSON)
scripts/     data pipeline (prepare.py) and fact-check (factcheck.py)
data/        processed outputs + cached raw sources (gitignored)
docs/        sources, uncertainties, and notes
```

## Deploying

The dashboard is published to GitHub Pages from a `gh-pages` branch that mirrors
`dashboard/`. To redeploy after changing the dashboard:

```sh
git subtree push --prefix dashboard origin gh-pages
```
