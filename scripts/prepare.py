#!/usr/bin/env python3
"""Prepare chicken-vs-people data.

Reads:
  - data/raw/faostat_qcl.zip   (FAOSTAT QCL bulk; extracts item 1057 "Chickens", element "Stocks")
  - data/raw/eurostat_demo_gind.json  (Eurostat demo_gind, indic_de=JAN = population on 1 Jan)

Matches the two on a fixed Europe country list and writes:
  - data/processed/chickens_people_2024.csv       (2024 snapshot)
  - data/processed/chickens_people_timeseries.csv (2015-2024 long form)
  - dashboard/data/chickens_people.json           (frontend payload)
"""
from __future__ import annotations

import csv
import io
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
DASH_DATA = ROOT / "dashboard" / "data"

FAOSTAT_ZIP = RAW / "faostat_qcl.zip"
FAOSTAT_CSV_NAME = "Production_Crops_Livestock_E_All_Data_(Normalized).csv"
EUROSTAT_JSON = RAW / "eurostat_demo_gind.json"

# Reference year and trend window.
REF_YEAR = 2024
TREND_START = 2015

# Scope: "Eurostat-demographic Europe" (EU27 + EFTA + UK + candidates/potential).
# eurostat_geo -> (M49 code, display name)
SCOPE: dict[str, tuple[int | None, str]] = {
    # EU27
    "AT": (40, "Austria"),
    "BE": (56, "Belgium"),
    "BG": (100, "Bulgaria"),
    "HR": (191, "Croatia"),
    "CY": (196, "Cyprus"),
    "CZ": (203, "Czechia"),
    "DK": (208, "Denmark"),
    "EE": (233, "Estonia"),
    "FI": (246, "Finland"),
    "FR": (250, "France"),
    "DE": (276, "Germany"),
    "EL": (300, "Greece"),
    "HU": (348, "Hungary"),
    "IE": (372, "Ireland"),
    "IT": (380, "Italy"),
    "LV": (428, "Latvia"),
    "LT": (440, "Lithuania"),
    "LU": (442, "Luxembourg"),
    "MT": (470, "Malta"),
    "NL": (528, "Netherlands"),
    "PL": (616, "Poland"),
    "PT": (620, "Portugal"),
    "RO": (642, "Romania"),
    "SK": (703, "Slovakia"),
    "SI": (705, "Slovenia"),
    "ES": (724, "Spain"),
    "SE": (752, "Sweden"),
    # EFTA
    "IS": (352, "Iceland"),
    "LI": (438, "Liechtenstein"),
    "NO": (578, "Norway"),
    "CH": (756, "Switzerland"),
    # UK
    "UK": (826, "United Kingdom"),
    # Candidates / potential candidates
    "AL": (8, "Albania"),
    "BA": (70, "Bosnia and Herzegovina"),
    "GE": (268, "Georgia"),
    "MD": (498, "Moldova"),
    "ME": (499, "Montenegro"),
    "MK": (807, "North Macedonia"),
    "RS": (688, "Serbia"),
    "TR": (792, "Türkiye"),
    "UA": (804, "Ukraine"),
    "XK": (None, "Kosovo"),  # no standard M49; matched by name below
}

# EU-27 member states (2020 membership) — used to flag countries as EU.
EU27_GEOS = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "EL",
    "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
    "SI", "ES", "SE",
}

# EU-27 aggregate (added to the dashboard payload as a reference total).
EU_AGG_AREA = "European Union (27)"   # FAOSTAT aggregate area name
EU_AGG_GEO = "EU27_2020"              # Eurostat demo_gind aggregate geo

# Fallback area names for FAOSTAT (used when M49 is absent, e.g. Kosovo).
NAME_OVERRIDES = {
    "XK": "Kosovo",
}

# Countries excluded from the analysis (data-quality reasons), keyed by Eurostat geo.
# - Moldova: FAOSTAT "Chickens" (48.45M) is imputed and ~10x too high, and NBS only
#   publishes poultry-total (~4.0M), not chickens-only. Consistent with our decision
#   to reject poultry-only figures (e.g. Eurostat), there is no clean "chickens"
#   figure for Moldova, so it is dropped rather than approximated (see docs/).
EXCLUDE: dict[str, str] = {
    "MD": "no clean chickens figure (FAOSTAT imputed ~10x high; NBS publishes poultry-total only)",
}


def load_eurostat_population() -> dict[str, dict[int, float]]:
    """Return {geo: {year: population}} from the SDMX-JSON 2.0 response.

    Works for demo_gind (dims freq/indic_de/geo/time) with indic_de=JAN.
    """
    d = json.loads(EUROSTAT_JSON.read_text(encoding="utf-8"))
    dim_ids = d["id"]
    sizes = d["size"]

    # SDMX-JSON 2.0: dimension.category.index maps code -> position index.
    # Build position -> code for the two variable dimensions.
    code_by_pos: dict[str, dict[int, str]] = {}
    for dim_id in dim_ids:
        index = d["dimension"][dim_id]["category"]["index"]
        code_by_pos[dim_id] = {pos: code for code, pos in index.items()}

    # freq/unit/age/sex were filtered to size 1; only geo and time vary.
    geo_idx = dim_ids.index("geo")
    time_idx = dim_ids.index("time")
    n_geo, n_time = sizes[geo_idx], sizes[time_idx]
    geo_by_pos = code_by_pos["geo"]
    time_by_pos = {pos: int(code) for pos, code in code_by_pos["time"].items()}

    # Position layout: time varies fastest (stride 1), geo next.
    out: dict[str, dict[int, float]] = {}
    for pos_str, value in d["value"].items():
        pos = int(pos_str)
        ti = pos % n_time
        gi = (pos // n_time) % n_geo
        geo = geo_by_pos[gi]
        year = time_by_pos[ti]
        try:
            out.setdefault(geo, {})[year] = float(value)
        except (TypeError, ValueError):
            continue
    return out


def main() -> None:
    PROC.mkdir(parents=True, exist_ok=True)
    DASH_DATA.mkdir(parents=True, exist_ok=True)

    chickens, m49_to_area = load_faostat_with_m49()
    population = load_eurostat_population()

    print(f"FAOSTAT chickens: {len(chickens)} areas, "
          f"years {min(min(v) for v in chickens.values() if v)}-"
          f"{max(max(v) for v in chickens.values() if v)}")

    # Report FAO areas that match our scope M49 codes.
    rows = []
    missing = []
    for geo, (m49, name) in SCOPE.items():
        if geo in EXCLUDE:
            missing.append(f"{name} ({geo}): {EXCLUDE[geo]}")
            continue

        # Resolve FAO area
        area = None
        if m49 is not None and m49 in m49_to_area:
            area = m49_to_area[m49]
        if area is None and geo in NAME_OVERRIDES:
            area = NAME_OVERRIDES[geo]
            if area not in chickens:
                area = None

        pop = population.get(geo, {})
        chk = chickens.get(area, {}) if area else {}

        # Comparison year: prefer REF_YEAR, else the latest chicken year <= REF_YEAR.
        # Both chickens AND people are taken from this same year (no cross-year mixing).
        comp_year = REF_YEAR
        if chk.get(REF_YEAR) is None:
            avail = [y for y in sorted(chk) if y <= REF_YEAR]
            comp_year = avail[-1] if avail else REF_YEAR

        chk_ref = chk.get(comp_year)
        pop_ref = pop.get(comp_year)

        if pop_ref is None:
            missing.append(f"{name} ({geo}): no population in {comp_year}")
        elif chk_ref is None:
            missing.append(f"{name} ({geo}): no chicken data (FAO area={area!r})")

        if pop_ref is None or chk_ref is None:
            continue

        # FAOSTAT chicken unit is "1000 Head" -> actual birds.
        chickens_count = chk_ref["value"] * 1000
        chicken_source = "FAOSTAT"
        notes = []
        if comp_year != REF_YEAR:
            notes.append(f"data from {comp_year} ({REF_YEAR} chicken data unavailable)")
        if chk_ref["flag"] == "I":
            notes.append("chicken figure imputed by FAO")
        ratio = chickens_count / pop_ref

        # Growth of the chicken stock since the start of the trend window
        # (chickens only). Baseline is the earliest available year in the window,
        # which is 2015 for every country in scope.
        window = [y for y in chk if TREND_START <= y <= REF_YEAR]
        growth_start_year = min(window) if window else TREND_START
        start_val = chk[growth_start_year]["value"] * 1000 if window else None
        growth_pct = (
            round((chickens_count - start_val) / start_val * 100, 1)
            if start_val
            else None
        )

        rows.append({
            "geo": geo,
            "name": name,
            "is_eu": geo in EU27_GEOS,
            "year": comp_year,
            "population": round(pop_ref),
            "chickens": round(chickens_count),
            "ratio": round(ratio, 3),
            "growth_pct": growth_pct,
            "growth_start_year": growth_start_year,
            "chicken_flag": chk_ref["flag"],
            "chicken_source": chicken_source,
            "more_chickens_than_people": chickens_count > pop_ref,
            "data_note": "; ".join(notes),
        })

    rows.sort(key=lambda r: r["ratio"], reverse=True)

    # ---- Write CSV ----
    csv_path = PROC / "chickens_people_2024.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    # ---- Timeseries (long form, both counts) ----
    included_geos = {r["geo"] for r in rows}
    ts_rows = []
    for geo, (m49, name) in SCOPE.items():
        if geo not in included_geos:
            continue
        area = None
        if m49 is not None and m49 in m49_to_area:
            area = m49_to_area[m49]
        if area is None and geo in NAME_OVERRIDES:
            area = NAME_OVERRIDES[geo]
        pop = population.get(geo, {})
        chk = chickens.get(area, {}) if area else {}
        for year in range(TREND_START, REF_YEAR + 1):
            p = pop.get(year)
            c = chk.get(year)
            ts_rows.append({
                "geo": geo,
                "name": name,
                "is_eu": geo in EU27_GEOS,
                "year": year,
                "population": round(p) if p is not None else "",
                "chickens": round(c["value"] * 1000) if c else "",
                "chicken_flag": c["flag"] if c else "",
            })
    ts_path = PROC / "chickens_people_timeseries.csv"
    with ts_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(ts_rows[0].keys()))
        w.writeheader()
        w.writerows(ts_rows)

    # ---- EU-27 aggregate (reference total for the dashboard) ----
    eu_chk = chickens.get(EU_AGG_AREA, {}).get(REF_YEAR)
    eu_pop = population.get(EU_AGG_GEO, {}).get(REF_YEAR)
    eu_total = None
    if eu_chk and eu_pop:
        eu_chickens = eu_chk["value"] * 1000
        eu_total = {
            "geo": EU_AGG_GEO,
            "name": "European Union (27)",
            "is_eu": True,
            "year": REF_YEAR,
            "population": round(eu_pop),
            "chickens": round(eu_chickens),
            "ratio": round(eu_chickens / eu_pop, 3),
            "chicken_flag": eu_chk["flag"],
            "chicken_source": "FAOSTAT",
            "more_chickens_than_people": eu_chickens > eu_pop,
            "data_note": (
                "EU-27 aggregate; FAOSTAT flag E (estimated — member-country "
                "series stop 2020-2023, so the total is FAO's own estimate)"
            ),
        }

    # ---- JSON for dashboard ----
    payload = {
        "reference_year": REF_YEAR,
        "trend_start": TREND_START,
        "scope": "Eurostat-demographic Europe (EU27 + EFTA + UK + candidates)",
        "sources": {
            "population": "Eurostat demo_gind (indic_de JAN) - population on 1 January, usually resident",
            "chickens": "FAOSTAT QCL, item 1057 'Chickens', element 'Stocks' (1000 head)",
        },
        "excluded": missing,
        "eu_total": eu_total,
        "rows": rows,
        "timeseries": ts_rows,
    }
    (DASH_DATA / "chickens_people.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ---- Summary to stdout ----
    print(f"\nCountries matched: {len(rows)} of {len(SCOPE)}")
    if missing:
        print("Missing / dropped:")
        for m in missing:
            print(f"  - {m}")
    winners = [r for r in rows if r["more_chickens_than_people"]]
    print(f"\nCountries with MORE chickens than people ({len(winners)}):")
    for r in winners:
        tag = f"[{r['year']}]" if r["year"] != REF_YEAR else ""
        print(f"  {r['name']:30s} ratio {r['ratio']:8.2f}  "
              f"({r['chickens']/1e6:7.1f}M chickens vs {r['population']/1e6:6.1f}M people) {tag}")
    offyear = [r for r in rows if r["year"] != REF_YEAR]
    if offyear:
        print(f"\n{len(offyear)} countries use a pre-{REF_YEAR} comparison year:")
        for r in offyear:
            print(f"  {r['name']:26s} -> {r['year']}")
    print("\nTop 10 by ratio:")
    for r in rows[:10]:
        print(f"  {r['name']:30s} {r['ratio']:8.2f} chickens/person")
    by_growth = sorted(rows, key=lambda r: r["growth_pct"], reverse=True)
    print("\nTop growth 2015->latest:")
    for r in by_growth[:5]:
        print(f"  {r['name']:30s} {r['growth_pct']:+.1f}%")
    print("Biggest shrinkers:")
    for r in by_growth[-5:]:
        print(f"  {r['name']:30s} {r['growth_pct']:+.1f}%")
    print(f"\nWrote {csv_path}, {ts_path}, {DASH_DATA / 'chickens_people.json'}")


def load_faostat_with_m49() -> tuple[dict[str, dict[int, dict]], dict[int, str]]:
    """Same as load_faostat_chickens but also returns M49 -> area name."""
    out: dict[str, dict[int, dict]] = {}
    m49_to_area: dict[int, str] = {}
    with zipfile.ZipFile(FAOSTAT_ZIP) as zf:
        with zf.open(FAOSTAT_CSV_NAME) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))
            for row in reader:
                if row["Item Code"] != "1057" or row["Element"] != "Stocks":
                    continue
                area = row["Area"]
                m49_raw = row["Area Code (M49)"].strip("'")
                if m49_raw.isdigit():
                    m49_to_area.setdefault(int(m49_raw), area)
                year = int(row["Year"])
                try:
                    value = float(row["Value"])
                except ValueError:
                    continue
                out.setdefault(area, {})[year] = {
                    "value": value,
                    "unit": row["Unit"],
                    "flag": row["Flag"],
                }
    return out, m49_to_area


if __name__ == "__main__":
    main()
