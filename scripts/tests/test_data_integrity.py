"""Data-integrity tests for the chicken-vs-people dataset.

These encode the checks from the fact-check-data skill (sections 3-7) as
assertions so they fail loudly if the data ever changes or breaks.

Run with:  uv run pytest
"""
import csv
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PROC = ROOT / "data" / "processed"
DASH = ROOT / "dashboard" / "data"


@pytest.fixture(scope="module")
def rows():
    with (PROC / "chickens_people_2024.csv").open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def timeseries():
    with (PROC / "chickens_people_timeseries.csv").open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---- Stage 6: row count and uniqueness ----

def test_joined_has_38_rows(rows):
    assert len(rows) == 38


def test_geos_are_unique(rows):
    geos = [r["geo"] for r in rows]
    assert len(geos) == len(set(geos)) == 38


def test_names_are_unique(rows):
    names = [r["name"] for r in rows]
    assert len(names) == len(set(names))


# ---- Stage 3: types ----

def test_numeric_fields_parse(rows):
    for r in rows:
        for k in ("population", "chickens", "ratio", "year"):
            float(r[k])  # raises if not numeric


# ---- Stage 7: logical rules ----

def test_ratio_equals_chickens_over_population(rows):
    for r in rows:
        expected = int(r["chickens"]) / int(r["population"])
        assert abs(expected - float(r["ratio"])) < 0.01, r["name"]


def test_more_chickens_flag_consistent(rows):
    for r in rows:
        expected = int(r["chickens"]) > int(r["population"])
        assert r["more_chickens_than_people"] == str(expected), r["name"]


def test_no_negative_or_zero_values(rows):
    for r in rows:
        assert int(r["population"]) > 0, r["name"]
        assert int(r["chickens"]) > 0, r["name"]


# ---- Stage 4: value ranges / outliers ----

def test_ratios_in_plausible_range(rows):
    # Every matched country should be within [0.1, 10] chickens per person.
    for r in rows:
        assert 0.1 <= float(r["ratio"]) <= 10, (r["name"], r["ratio"])


def test_moldova_is_excluded(rows):
    # Moldova is dropped (no clean chickens figure), so it must not appear.
    assert all(r["name"] != "Moldova" for r in rows)


# ---- EU membership flag & EU aggregate ----

def test_eu_flag_counts(rows):
    eu = [r for r in rows if r["is_eu"] == "True"]
    non_eu = [r for r in rows if r["is_eu"] == "False"]
    assert len(eu) == 27, len(eu)
    assert len(non_eu) == 11, len(non_eu)
    # every row has a valid is_eu value
    assert all(r["is_eu"] in ("True", "False") for r in rows)


def test_eu_total_in_dashboard_json():
    payload = json.loads((DASH / "chickens_people.json").read_text(encoding="utf-8"))
    eu = payload["eu_total"]
    assert eu is not None
    assert eu["population"] == 450_054_483
    assert eu["chickens"] == 1_475_406_000
    assert eu["chicken_flag"] == "E"  # FAO estimated aggregate
    assert eu["more_chickens_than_people"] is True
    assert abs(eu["ratio"] - 3.278) < 0.001


# ---- Stage 2: control totals (spot-check against published FAOSTAT figures) ----

@pytest.mark.parametrize(
    ("name", "year", "expected_chickens"),
    [
        ("Poland", "2024", 244_680_000),
        ("France", "2024", 229_317_000),
        ("United Kingdom", "2024", 166_986_000),
        ("Netherlands", "2024", 89_231_000),
        ("Türkiye", "2024", 379_627_000),
        ("Germany", "2023", 156_301_000),
        ("Romania", "2023", 74_068_000),
        ("Belgium", "2023", 48_754_000),
        ("Spain", "2020", 193_476_000),
        ("Italy", "2020", 142_503_000),
        ("Ireland", "2020", 15_236_000),
        ("Bulgaria", "2020", 17_177_000),
    ],
)
def test_control_total_chickens(rows, name, year, expected_chickens):
    row = next(r for r in rows if r["name"] == name)
    assert row["year"] == year, f"{name} should use {year}, got {row['year']}"
    assert int(row["chickens"]) == expected_chickens, name


# ---- Stage 3: flag values ----

def test_chicken_flags_are_known_values(rows):
    allowed = {"A", "I", "E", "X"}  # official, imputed, estimated, external
    for r in rows:
        assert r["chicken_flag"] in allowed, (r["name"], r["chicken_flag"])


def test_reference_year_in_range(rows):
    for r in rows:
        assert 2020 <= int(r["year"]) <= 2024, (r["name"], r["year"])


# ---- Stage 6: timeseries ----

def test_timeseries_unique_geo_year(timeseries):
    keys = [(r["geo"], r["year"]) for r in timeseries]
    assert len(keys) == len(set(keys))


def test_timeseries_year_range(timeseries):
    years = {int(r["year"]) for r in timeseries}
    assert years == set(range(2015, 2025)), years


# ---- Dashboard JSON payload is present and consistent ----

def test_dashboard_json_matches_csv(rows):
    payload = json.loads((DASH / "chickens_people.json").read_text(encoding="utf-8"))
    assert payload["reference_year"] == 2024
    assert len(payload["rows"]) == len(rows) == 38
    csv_by_geo = {r["geo"]: r for r in rows}
    for r in payload["rows"]:
        assert float(r["ratio"]) == float(csv_by_geo[r["geo"]]["ratio"])
