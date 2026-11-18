# Sources

Running log of every data source used.

## Data used

| Source | URL | Publisher | Access date | What it provides |
| ------ | --- | --------- | ----------- | ---------------- |
| `demo_gind` — Demographic balance indicators (indicator `JAN`) | https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_gind | Eurostat (European Commission) | 2026-11-18 | Population on 1 January (usually resident), 2015–2026, EU27 + EFTA + UK + candidates. **Used for "people"** (broader/recent coverage than `demo_pjan`). |
| FAOSTAT — "Chickens" (item 1057), element "Stocks" (5112), domain Crops & livestock products (QCL) | https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip | FAO (UN) | 2026-11-18 | Number of chickens (Gallus gallus), 1000 head, all countries, 1961–2024. **Used for "chickens"**. Note: series stops early for some EU countries (see uncertainties). |
| FAOSTAT QCL flag legend | (inside the QCL zip) `Production_Crops_Livestock_E_Flags.csv` | FAO (UN) | 2026-11-18 | Flag meanings: A = official, E = estimated, I = imputed by receiving agency, M = missing, X = external org. |
| Moldova NBS — "Livestock as of January 1" (AGR030100) | https://statbank.statistica.md/PxWeb/pxweb/en/40%20Statistica%20economica/40%20Statistica%20economica__16%20AGR__AGR030/AGR030100.px/ | National Bureau of Statistics, Republic of Moldova | 2026-11-18 | Official poultry population ("all birds") ~3.3–4.1 M (2019–2024). Used to fact-check (and reject) FAOSTAT's ~48.5 M imputed figure. |

## Reviewed and rejected / superseded

| Source | URL | Publisher | Access date | What it provides / why not used |
| ------ | --- | --------- | ----------- | ------------------------------- |
| `demo_pjan` — Population on 1 January by age and sex | https://ec.europa.eu/eurostat/databrowser/view/demo_pjan/default/table | Eurostat | 2026-11-18 | Resident population by age/sex. *Superseded by `demo_gind` for the total*: age "TOTAL" is missing for Albania/UK/Bosnia etc. in recent years. |
| `tps00001` — Population on 1 January (total) | https://ec.europa.eu/eurostat/databrowser/view/tps00001/default/table | Eurostat | 2026-11-18 | Derived from `demo_gind`; same data, narrower. |
| `apro_ec_poula` — Poultry, annual data | https://ec.europa.eu/eurostat/databrowser/view/APRO_EC_POULA/default/table | Eurostat | 2026-11-18 | Poultry (multi-species) + hatchery activity. *Rejected* — not "chickens". |
| `apro_mt_lsavch_r` — Average livestock population of chicken by NUTS 2 region | https://doi.org/10.2908/apro_mt_lsavch_r | Eurostat | 2026-11-18 | Chicken stock, regional (NUTS2) and 2025 only. *Rejected* — not national/current. |
| `apro_ec_lshen` — Laying hens population | https://ec.europa.eu/eurostat/databrowser/view/apro_ec_lshen/default/table | Eurostat | 2026-11-18 | Laying hens only, 1960–2012. *Rejected* — discontinued, excludes broilers. |
