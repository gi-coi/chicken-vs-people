# Uncertainties

What was unclear or uncertain during the process, and how it was resolved.

## Scope decisions (2026-11-18)

- **"European countries"** = *Eurostat-demographic Europe*: EU27 + EFTA (Iceland, Liechtenstein, Norway, Switzerland) + United Kingdom + EU candidate and potential-candidate countries (Albania, Bosnia and Herzegovina, Georgia, Moldova, Montenegro, North Macedonia, Serbia, Türkiye, Ukraine, Kosovo). ≈ 42 countries.
- **"chickens"** = all *Gallus gallus* (broilers + laying hens), i.e. FAOSTAT item 1057 "Chickens", element "Stocks".
- **"people"** = resident ("usually resident") population on 1 January, from Eurostat.
- **Reference year** = 2024.

## Uncertainties

1. **Population source switched `demo_pjan` → `demo_gind`.** `demo_pjan`'s age "TOTAL" is missing for several non-EU countries in recent years (Albania 2024 gap, UK stops 2020, Bosnia stops 2012). `demo_gind` (indicator "JAN", "population on 1 January") has the same concept but far better coverage — recovers Albania, UK, Bosnia at 2024. *Resolved: use `demo_gind`.*
2. **FAOSTAT "Chickens" series is discontinued for some EU countries.** The "Chickens" (item 1057) stock stops at 2020 for Spain, Italy, Ireland, Bulgaria; at 2023 for Germany, Belgium, Portugal, Romania, Greece, Sweden, Austria, Cyprus, Malta. So 13 of 39 countries use pre-2024 chicken data (latest available). Likely linked to the EU livestock-statistics regulation change. *Resolved: use latest available year per country and record the comparison `year` (chickens + population both from that same year).*
   - **Cross-checked against Eurostat Farm Structure Survey (`ef_lsk_poultry`):** summing FSS "broilers" + "laying hens" for Germany 2023 gives 156,301 thousand — an exact match with FAOSTAT's "Chickens". This confirms FAOSTAT "Chickens" = broilers + layers, and validates the values for countries where FAOSTAT reports.
   - **No clean source fills the gap to 2024.** The FSS is 2023-only and has no data for Spain/Italy; Eurostat's only 2025 chicken series (`apro_mt_lsavch_r`) is regional and an "annual average" (~4× lower than "stocks"). National offices would be heterogeneous. So the 2020/2023 staleness for those 13 countries is retained, labelled per country.
3. **Moldova's chickens are FAO-imputed (flag "I") and ~10× too high (fact-checked).** FAOSTAT reports 48.5M "Chickens" (2024, flag "I"), but Moldova's National Bureau of Statistics reports ~4.0M poultry ("all birds", as of 1 Jan 2024: 3,972.1 thousand), and independent sources (MDPI 2026 review; Moldpres) say ~4–6M birds. FAOSTAT's value has been imputed (and ~10× inflated) for the whole 2019–2024 period. *Resolved: replaced with NBS "all poultry" 3,972,100 (1 Jan 2024), recorded as a footnote — the NBS figure is all poultry, so it is an upper bound for chickens, but it is an order of magnitude closer to the truth than FAOSTAT's imputation.*
4. **Three countries dropped.** Liechtenstein has no FAO chicken data; Ukraine and Kosovo have no 2024 Eurostat population (war / non-reporting). *Resolved: exclude and note.*
5. **Stock vs. annual average.** FAOSTAT "Stocks" is a point-in-time count near year-start; broilers live ~5–7 weeks, so this understates birds raised in a year. We use "Stocks" consistently; don't mix with Eurostat's annual-average concept.
6. **Enumeration-date alignment.** FAOSTAT "Stocks" is enumerated "closest to the beginning of the calendar year"; Eurostat population is 1 January. Close but not identical.

<!-- Add entries as they come up during research -->
