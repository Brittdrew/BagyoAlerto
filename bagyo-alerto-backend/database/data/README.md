# Surigao City historical typhoon data

`surigao_pagasa_labels.json` contains Tropical Cyclone Wind Signal labels resolved for Surigao City from original PAGASA bulletin PDFs. The public [`pagasa-parser/bulletin-archive`](https://github.com/pagasa-parser/bulletin-archive) mirror supplies the PDFs because PAGASA removes old bulletins from its current-bulletin page. Every manifest row retains the PDF URL and SHA-256 digest.

Only bulletins issued after PAGASA introduced the revised five-level TCWS system on 23 March 2022 are included. This avoids treating older and newer signal numbers as equivalent. The initial event set is Agaton, Paeng, Kabayan, Aghon, Kristine, Tino, Verbena, Ada, and Basyang. Events were selected from the official [NOAA IBTrACS](https://www.ncei.noaa.gov/products/international-best-track-archive) Western Pacific tracks when a track point came within 500 km of Surigao City; the manifest retains each IBTrACS storm ID and calculated minimum distance.

Signal resolution follows these rules:

1. An explicit `Surigao City` entry wins.
2. A signal for all of `Surigao del Norte` applies to the city.
3. If PAGASA divides the province, an enumerated city or the province's `rest` entry is used.
4. Siargao, Bucas Grande, Surigao del Sur, and other island-only entries do not apply to Surigao City.
5. If none applies, the label is `Normal` (TCWS 0) for that bulletin time.

`surigao_typhoon_history.csv` joins those labels to hourly [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) ECMWF IFS values at every Surigao City barangay coordinate currently stored in the database. Run this command to rebuild it after barangays or the label manifest change:

```shell
php artisan ml:build-history
```

Then retrain and evaluate:

```shell
php artisan ml:train
php artisan ml:evaluate
```

TCWS is a forecast warning for winds expected within a future time window. The CSV weather fields describe conditions at bulletin issue time, so the ML result is a historical pattern comparison—not a replacement for a current PAGASA warning. The application retains its deterministic wind thresholds and current PAGASA signal floor for safety.
