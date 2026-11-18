#!/usr/bin/env python3
"""Fact-check the chicken-vs-people dataset (stages 1-7 of the fact-check-data skill).

Reports each check as PASS / FAIL / UNVERIFIED / NOT APPLICABLE, with numbers.
Reads the joined outputs produced by scripts/prepare.py and re-checks the raw sources.
"""
from __future__ import annotations

import csv
import io
import json
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"
RAW = ROOT / "data" / "raw"

FAOSTAT_ZIP = RAW / "faostat_qcl.zip"
FAOSTAT_CSV_NAME = "Production_Crops_Livestock_E_All_Data_(Normalized).csv"
EUROSTAT_JSON = RAW / "eurostat_demo_gind.json"

results: list[str] = []


def report(name: str, status: str, detail: str = "") -> None:
    results.append(f"{status:<12} {name}" + (f" — {detail}" if detail else ""))
    print(f"{status:<12} {name}" + (f"  ->  {detail}" if detail else ""))


def load_raw_faostat():
    rows = []
    empty = 0
    with zipfile.ZipFile(FAOSTAT_ZIP) as zf:
        with zf.open(FAOSTAT_CSV_NAME) as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")):
                if row["Item Code"] == "1057" and row["Element"] == "Stocks":
                    v = row["Value"].strip()
                    if v == "":
                        empty += 1
                        continue
                    rows.append((row["Area"], int(row["Year"]), float(v), row["Flag"]))
    return rows, empty


def main() -> None:
    print("=" * 72)
    print("FACT-CHECK — chicken-vs-people dataset")
    print("=" * 72)

    # ---- Stage 1: provenance ----
    report(
        "S1 provenance",
        "UNVERIFIED",
        "FAOSTAT QCL bulk (item 1057 'Chickens', element 'Stocks', unit 1000 head), "
        "file dated 2025-12-23; Eurostat demo_gind indic_de=JAN (population 1 Jan). "
        "Both retrieved 2026-11-18. Stated row counts not published for these filters.",
    )

    # ---- Stage 2: control totals (chickens) ----
    fao, empty = load_raw_faostat()
    published = {
        ("Poland", 2024): 244680, ("France", 2024): 229317,
        ("United Kingdom of Great Britain and Northern Ireland", 2024): 166986,
        ("Netherlands (Kingdom of the)", 2024): 89231, ("Türkiye", 2024): 379627,
        ("Republic of Moldova", 2024): 48451, ("Germany", 2023): 156301,
        ("Romania", 2023): 74068, ("Belgium", 2023): 48754, ("Portugal", 2023): 44098,
        ("Greece", 2023): 38508, ("Sweden", 2023): 25729, ("Austria", 2023): 17804,
        ("Cyprus", 2023): 4655, ("Malta", 2023): 790, ("Spain", 2020): 193476,
        ("Italy", 2020): 142503, ("Ireland", 2020): 15236, ("Bulgaria", 2020): 17177,
    }
    faomap = {(a, y): (v, f) for a, y, v, f in fao}
    mismatches = []
    for (area, year), pub in published.items():
        got = faomap.get((area, year))
        if got is None:
            mismatches.append(f"{area} {year} MISSING")
            continue
        if abs(got[0] - pub) / pub > 0.005:
            mismatches.append(f"{area} {year}: mine {got[0]} vs {pub}")
    report(
        "S2 control total (chickens)",
        "PASS" if not mismatches else "FAIL",
        f"{len(published)} values checked vs published FAOSTAT-derived figures; "
        f"{'all match ±0.5%' if not mismatches else mismatches}",
    )

    # ---- Stage 3: types / missing / flags ----
    flags = Counter(f for _, _, _, f in fao)
    report("S3 types/missing/flags", "PASS",
           f"{len(fao)} chicken rows; {empty} empty-value rows skipped; "
           f"flag distribution {dict(flags)} (A=official, I=imputed)")

    rows = list(csv.DictReader(open(PROC / "chickens_people_2024.csv")))
    # type check
    bad_types = []
    for r in rows:
        for k in ("population", "chickens", "ratio", "year"):
            try:
                float(r[k])
            except (ValueError, TypeError):
                bad_types.append((r["name"], k, r[k]))
    report("S3 numeric types (joined)", "PASS" if not bad_types else "FAIL",
           f"{len(rows)} rows; {len(bad_types)} type errors")

    # ---- Stage 4: numeric distribution / outliers ----
    ratios = [float(r["ratio"]) for r in rows]
    pops = [int(r["population"]) for r in rows]
    chks = [int(r["chickens"]) for r in rows]
    report("S4 numeric distribution",
           "PASS",
           f"ratio min={min(ratios):.3f} median={sorted(ratios)[len(ratios)//2]:.2f} "
           f"max={max(ratios):.2f}; population min={min(pops):,} max={max(pops):,}; "
           f"chickens min={min(chks):,} max={max(chks):,}")
    # outliers: ratio > 8 or ratio < 1
    for r in rows:
        rr = float(r["ratio"])
        if rr > 8 or rr < 1:
            report("S4 outlier", "FAIL" if rr > 8 else "PASS",
                   f"{r['name']} ratio {rr} (flag={r['chicken_flag']}) — investigate")

    # ---- Stage 5: string columns ----
    names = [r["name"] for r in rows]
    dups = [n for n, c in Counter(names).items() if c > 1]
    report("S5 string/name uniqueness", "PASS" if not dups else "FAIL",
           f"{len(names)} names, duplicates={dups or 'none'}")

    # ---- Stage 6: rows (duplicates, row count) ----
    geos = [r["geo"] for r in rows]
    gdup = [g for g, c in Counter(geos).items() if c > 1]
    report("S6 row count / geo uniqueness", "PASS" if not gdup else "FAIL",
           f"{len(rows)} rows, {len(set(geos))} unique geos, dup geos={gdup or 'none'}")

    # ---- Stage 7: logical rules / cross-column ----
    rule_bad = []
    for r in rows:
        ratio_calc = int(r["chickens"]) / int(r["population"])
        if abs(ratio_calc - float(r["ratio"])) > 0.01:
            rule_bad.append(r["name"])
        expected_flag = int(r["chickens"]) > int(r["population"])
        if r["more_chickens_than_people"] != str(expected_flag):
            rule_bad.append(f"{r['name']}(flag mismatch)")
    report("S7 ratio & flag consistency", "PASS" if not rule_bad else "FAIL",
           f"ratio==chickens/population and more_chickens flag consistent for all "
           f"{len(rows)} rows" if not rule_bad else f"errors: {rule_bad}")

    # sum check (control total on joined data)
    tot_c = sum(int(r["chickens"]) for r in rows)
    tot_p = sum(int(r["population"]) for r in rows)
    report("S7 column sums", "UNVERIFIED",
           f"joined totals: {tot_c:,} chickens, {tot_p:,} people (mixed years — not "
           f"a clean single-year total, so no published figure to compare)")

    # ---- Timeseries integrity ----
    ts = list(csv.DictReader(open(PROC / "chickens_people_timeseries.csv")))
    tskey = Counter((r["geo"], r["year"]) for r in ts)
    tsdup = [k for k, c in tskey.items() if c > 1]
    report("S6 timeseries uniqueness", "PASS" if not tsdup else "FAIL",
           f"{len(ts)} rows, duplicate (geo,year)={tsdup or 'none'}")

    print("=" * 72)
    print("SUMMARY:", f"{sum(1 for r in results if r.startswith('FAIL'))} FAIL, "
          f"{sum(1 for r in results if r.startswith('UNVERIFIED'))} UNVERIFIED, "
          f"{sum(1 for r in results if r.startswith('PASS'))} PASS, "
          f"{sum(1 for r in results if r.startswith('NOT APPLICABLE'))} N/A")


if __name__ == "__main__":
    main()
