# OD Viewer — Generic Ingestion Guide

This guide covers everything you need to prepare your own dataset and load it into the OD Viewer using `scripts/ingest_generic.py`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Quick Start](#3-quick-start)
4. [Input Data Requirements](#4-input-data-requirements)
   - 4.1 [Shapefile (zone geometries)](#41-shapefile-zone-geometries)
   - 4.2 [Zone Labels File (optional)](#42-zone-labels-file-optional)
   - 4.3 [OD Matrix Files](#43-od-matrix-files)
5. [Config File Reference](#5-config-file-reference)
   - 5.1 [`shapefile` block](#51-shapefile-block)
   - 5.2 [`zone_labels` block](#52-zone_labels-block)
   - 5.3 [`od_files` block](#53-od_files-block)
   - 5.4 [`od_columns` block](#54-od_columns-block)
   - 5.5 [`output_dir`](#55-output_dir)
6. [Running the Script](#6-running-the-script)
7. [Understanding the Output](#7-understanding-the-output)
8. [Connecting to the Backend](#8-connecting-to-the-backend)
9. [Complete Config Examples](#9-complete-config-examples)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

The ingestion script converts your raw geographic and trip data into the format the OD Viewer backend expects. You describe your data in a YAML config file and the script does the rest.

**What it does:**

1. Reads your shapefile (zone polygons), reprojects to WGS 84 (EPSG:4326), and computes centroids.
2. Joins human-readable zone names from an optional labels file.
3. Dissolves zones into each aggregation level and computes those centroids.
4. Reads your OD CSV/Excel files, normalises them to a common long format, and drops zero-trip rows.
5. Writes GeoParquet files and a `dataset_config.json` that the backend reads at startup.

---

## 2. Prerequisites

**Python version:** 3.10 or later (type hint syntax used internally).

**Required packages** — install from the backend requirements file:

```bash
pip install -r od-viewer/backend/requirements.txt
```

This installs: `geopandas`, `pandas`, `pyarrow`, `openpyxl`, `pyyaml`, and their dependencies.

If you only need the ingestion script (not the backend), you can install just what the script needs:

```bash
pip install geopandas pandas pyarrow openpyxl pyyaml
```

**GDAL note:** GeoPandas requires GDAL. On Windows the easiest path is to install via conda:

```bash
conda install -c conda-forge geopandas
```

Or use the pre-built wheel from https://www.lfd.uci.edu/~gohlke/pythonlibs/ if you prefer pip only.

---

## 3. Quick Start

```bash
# 1. Copy the example config
cp od-viewer/scripts/dataset.yaml.example my_dataset.yaml

# 2. Edit my_dataset.yaml — set your file paths and column names

# 3. Run
python od-viewer/scripts/ingest_generic.py --config my_dataset.yaml

# 4. Point the backend at the output directory (see Section 8)
```

---

## 4. Input Data Requirements

### 4.1 Shapefile (zone geometries)

A standard ESRI Shapefile (`.shp` + companions `.dbf`, `.prj`, `.shx`). Any projected or geographic CRS is accepted — the script always reprojects to WGS 84 (EPSG:4326).

**Required:**
- One column whose values uniquely identify each base-level zone (the finest granularity your OD data is measured at). This is your `base_zone_col`.

**Optional:**
- One or more columns that assign each base zone to a coarser aggregation group (district, region, city, etc.). These become your `aggregation_levels`.
- A column with human-readable zone names (alternative to a separate labels file).

**Example attribute table:**

| ZONE_ID | DISTRICT | REGION | zone_name        |
|---------|----------|--------|------------------|
| 1001    | D01      | R1     | Central Station  |
| 1002    | D01      | R1     | Old Market       |
| 1003    | D02      | R1     | University Hill  |
| 1004    | D02      | R2     | Airport          |

In this example:
- `base_zone_col = "ZONE_ID"` — 4 fine zones, each row of OD data uses these IDs
- `aggregation_levels`: `DISTRICT` (2 groups), `REGION` (2 groups)
- `label_col = "zone_name"` — used directly as the display name without a separate labels file

**Zone ID types:** IDs can be integers or strings. The script converts everything to strings internally, so `1001` and `"1001"` are treated the same. Your OD file must use the same IDs.

**Encoding:** Most shapefiles use UTF-8. Legacy files (especially those with non-Latin characters) may use a different encoding (e.g., `iso-8859-8` for Hebrew, `cp1250` for Central European). Set `encoding` in the config if the default fails.

---

### 4.2 Zone Labels File (optional)

An Excel (`.xlsx`/`.xls`) or CSV file with human-readable names for zones. You only need this if zone names are not already in the shapefile.

**Minimum required columns:**

| ZONE_ID | zone_name        |
|---------|------------------|
| 1001    | Central Station  |
| 1002    | Old Market       |

- `join_col` — the column to match against `base_zone_col` (must contain the same IDs).
- `label_col` — the column with the display name.

**Per-level names (optional):** If you want human-readable names for aggregation levels too (e.g., "Downtown" instead of "D01"), you can add extra sheets to the same Excel file:

Sheet `"districts"`:

| id  | NAME      |
|-----|-----------|
| D01 | Downtown  |
| D02 | Suburbs   |

Sheet `"regions"`:

| reg | NAME    |
|-----|---------|
| R1  | North   |
| R2  | South   |

You then reference these sheets under `zone_labels.level_labels` in the config (see Section 5.2).

**What happens without a labels file:** The script falls back to using the base zone ID as the display name. This works fine — zones will show their numeric/string ID in the UI instead of a name.

---

### 4.3 OD Matrix Files

One CSV or Excel file per day type (weekday, Saturday, peak hour, etc.). The script combines all files into a single OD matrix.

#### Format A — Wide prefix (most common)

One row per origin–destination pair; one column per hour.

| FromZone | ToZone | h0  | h1  | h2  | ... | h23 |
|----------|--------|-----|-----|-----|-----|-----|
| 1001     | 1002   | 0   | 0   | 5   | ... | 12  |
| 1001     | 1003   | 3   | 0   | 0   | ... | 8   |
| 1002     | 1001   | 0   | 2   | 0   | ... | 6   |

- The prefix can be anything (`h`, `Hour`, `T`, etc.) — set `od_columns.hours.prefix` to match.
- The script auto-detects how many hour columns exist by looking for `{prefix}{integer}` column names.
- Columns do **not** need to start at 0 or be consecutive (gaps are handled).
- Any extra columns (e.g., metadata columns) are ignored as long as they don't accidentally match the prefix pattern.

#### Format B — Long format

One row per origin–destination–hour combination. More rows but simpler structure.

| from_zone | to_zone | hour | trips |
|-----------|---------|------|-------|
| 1001      | 1002    | 2    | 5     |
| 1001      | 1003    | 0    | 3     |
| 1002      | 1001    | 1    | 2     |

Column names are configurable via `od_columns.hours.hour_col` and `od_columns.hours.trips_col`.

**General rules for OD files:**

- **Column name matching is case-insensitive.** `FromZone`, `fromzone`, and `FROMZONE` all match `from_zone: "FromZone"` in the config.
- **Zero trips are dropped** automatically — you don't need to pre-filter.
- **Self-loops** (`from_zone == to_zone`) are kept in storage and can be shown/hidden at query time via the "Include self-loops" checkbox in the UI.
- **File format:** `.csv` or `.xlsx`/`.xls`. For Excel files the script reads the first sheet.
- **Zone IDs** must match the `base_zone_col` values in the shapefile exactly (after string conversion).

---

## 5. Config File Reference

Start from the example:

```bash
cp od-viewer/scripts/dataset.yaml.example my_dataset.yaml
```

Then edit. Below is the complete field reference.

---

### 5.1 `shapefile` block

```yaml
shapefile:
  path: "data/zones.shp"      # REQUIRED. Relative or absolute path to the .shp file.
  encoding: "utf-8"            # Optional. Default: "utf-8".
  base_zone_col: "ZONE_ID"    # REQUIRED. Column with the finest-grain zone ID.
  base_name: "Zone"            # Optional. UI display name for the base level. Default: same as base_zone_col.
  aggregation_levels:          # Optional. List of coarser levels.
    - col: "DISTRICT"          # Column name in the shapefile.
      name: "District"         # UI display name (shown in the Level Selector).
    - col: "REGION"
      name: "Region"
  label_col: null              # Optional. Shapefile column with zone names.
                               # Only used when zone_labels block is absent.
```

**`aggregation_levels` ordering:** List levels from **finest to coarsest**. The UI assigns higher map zoom thresholds to levels listed first: the first aggregation level shows labels at zoom ≥ 8, all subsequent ones at zoom ≥ 6. The base level always shows labels at zoom ≥ 10.

**`label_col` vs `zone_labels`:** If both are set, the `zone_labels` block takes priority.

---

### 5.2 `zone_labels` block

Omit this block entirely if zone names are in the shapefile (`label_col`) or if numeric IDs are acceptable as display names.

```yaml
zone_labels:
  path: "data/labels.xlsx"    # REQUIRED within block. xlsx, xls, or csv.
  join_col: "ZONE_ID"         # Column to join on. Must match base_zone_col values.
  label_col: "zone_name"      # Column containing the human-readable name.

  level_labels:               # Optional. Per-aggregation-level name lookup.
    DISTRICT:                 # Key = column name from aggregation_levels.
      sheet: "districts"      # xlsx sheet name. Omit (or set to 0) for the first sheet.
      id_col: "id"            # Column with the aggregation level ID.
      name_col: "NAME"        # Column with the human-readable name.
    REGION:
      sheet: "regions"
      id_col: "reg"
      name_col: "NAME"
```

**`level_labels` details:**
- Each key under `level_labels` must exactly match a `col` value from `aggregation_levels`.
- If a level is listed under `aggregation_levels` but not under `level_labels`, the numeric ID is used as the display name (no error).
- IDs that look like floats stored as integers (`300001.0`) are automatically normalised to `300001`.
- Duplicate rows (same ID, different names) — the first occurrence is kept.

---

### 5.3 `od_files` block

```yaml
od_files:
  - path: "data/weekday.csv"
    day: "weekday"
  - path: "data/saturday.csv"
    day: "saturday"
  - path: "data/peak.xlsx"
    day: "peak"
```

- **`path`** — relative or absolute path to the file. Both `.csv` and `.xlsx`/`.xls` are accepted.
- **`day`** — a string label that appears in the Day filter in the UI. Can be any value; it is not validated against a fixed list.
- You can have **any number of entries**, including just one. All entries are combined into a single `od_matrix.parquet`.
- The same `od_columns` settings apply to every file. If your files have different column names, you will need to rename columns before running the script.

---

### 5.4 `od_columns` block

```yaml
od_columns:
  from_zone: "FromZone"       # Column name for the origin zone ID (case-insensitive match).
  to_zone:   "ToZone"         # Column name for the destination zone ID (case-insensitive match).

  hours:
    format: "wide_prefix"     # "wide_prefix" or "long". See below.
    prefix: "h"               # (wide_prefix) Prefix before the hour number.
    # hour_col:  "hour"       # (long) Column with the integer hour value.
    # trips_col: "trips"      # (long) Column with the trip count.
```

#### `hours.format: "wide_prefix"`

Use this when each hour is a separate column:

```
FromZone, ToZone, h0, h1, h2, ..., h23
```

- Set `prefix` to whatever precedes the hour number. Examples:
  - Columns `h0`…`h23` → `prefix: "h"`
  - Columns `Hour0`…`Hour23` → `prefix: "Hour"`
  - Columns `T6`…`T22` (only some hours) → `prefix: "T"` — the script detects all matching columns automatically
- Hours do **not** need to start at 0 or be a full 24-column set.
- Non-hour columns (e.g., a `district` metadata column) are ignored as long as they don't match `{prefix}{integer}`.

#### `hours.format: "long"`

Use this when the data is already in a row-per-hour layout:

```
from_zone, to_zone, hour, trips
```

- `hour_col` — the column containing the integer hour (e.g., `0`, `6`, `23`).
- `trips_col` — the column containing the trip count (can be float; values ≤ 0 are dropped).

---

### 5.5 `output_dir`

```yaml
output_dir: "output_data/"
```

Where the output files are written. Created automatically (including parent directories) if it does not exist. Use an absolute path if you want to be explicit:

```yaml
output_dir: "C:/od-viewer/data"
```

---

## 6. Running the Script

From the repository root:

```bash
python od-viewer/scripts/ingest_generic.py --config my_dataset.yaml
```

Or from inside the `od-viewer` directory:

```bash
python scripts/ingest_generic.py --config ../my_dataset.yaml
```

**Typical console output:**

```
Loading shapefile: data/zones.shp
  1270 zones loaded, reprojected to EPSG:4326
Loading zone labels: data/labels.xlsx
  Loaded 250 names for level 'DISTRICT'
  Loaded 33 names for level 'REGION'
Saved zones.parquet -> output_data/zones.parquet (2.4 MB)

Building aggregated zone parquets...
  Dissolving zones for level 'DISTRICT' (District) ...
    Saved 250 groups -> output_data/zones_DISTRICT.parquet
  Dissolving zones for level 'REGION' (Region) ...
    Saved 33 groups -> output_data/zones_REGION.parquet

Building od_matrix.parquet...
  Processing 'weekday': data/weekday.csv
    4,821,340 rows after zero-filter
  Processing 'saturday': data/saturday.csv
    3,104,892 rows after zero-filter

Ingestion summary:
  Total OD rows   : 7,926,232
  Days            : ['saturday', 'weekday']
  Trip range      : 0.001 – 12,450.000
  OD zones        : 1,270
  Shapefile zones : 1,270
  All OD zones matched shapefile zones.
  Saved -> output_data/od_matrix.parquet (48.3 MB)

Wrote dataset_config.json -> output_data/dataset_config.json
```

**Runtime:** Depends on data size. For millions of OD rows, expect 30–120 seconds, most of which is the `melt` (wide→long) and parquet write. The shapefile dissolve step can also be slow for complex polygons.

---

## 7. Understanding the Output

After a successful run, the output directory contains:

```
output_data/
  zones.parquet            — Base-level zone polygons + centroids + labels
  zones_DISTRICT.parquet   — Dissolved district polygons + centroids + labels
  zones_REGION.parquet     — Dissolved region polygons + centroids + labels
  od_matrix.parquet        — Long-format OD trip data (all day types combined)
  dataset_config.json      — Metadata consumed by the backend at startup
```

One `zones_{col}.parquet` is created for each entry in `aggregation_levels`. The naming uses the `col` value (the shapefile column name), not the `name` display name.

### File schemas

**`zones.parquet`**

| Column         | Type      | Notes                                      |
|----------------|-----------|--------------------------------------------|
| `{base_col}`   | string    | Base zone ID (e.g., `ZONE_ID`)             |
| `{agg_col_1}`  | string    | First aggregation level column             |
| `{agg_col_2}`  | string    | Second aggregation level column            |
| `zone_name`    | string    | Human-readable zone label                  |
| `name_{col_1}` | string    | Display name for aggregation level 1       |
| `name_{col_2}` | string    | Display name for aggregation level 2       |
| `centroid_lat` | float64   | Latitude of zone centroid (WGS 84)         |
| `centroid_lon` | float64   | Longitude of zone centroid (WGS 84)        |
| `geometry`     | geometry  | Zone polygon (WGS 84)                      |

**`zones_{col}.parquet`** (one per aggregation level)

| Column         | Type     | Notes                              |
|----------------|----------|------------------------------------|
| `group_id`     | string   | Aggregation level zone ID          |
| `label`        | string   | Human-readable name for this group |
| `centroid_lat` | float64  | Centroid of the dissolved polygon  |
| `centroid_lon` | float64  | Centroid of the dissolved polygon  |
| `geometry`     | geometry | Dissolved polygon (WGS 84)         |

**`od_matrix.parquet`**

| Column       | Type    | Notes                              |
|--------------|---------|------------------------------------|
| `from_zone`  | string  | Origin zone ID (base level)        |
| `to_zone`    | string  | Destination zone ID (base level)   |
| `day`        | string  | Day label from `od_files[].day`    |
| `hour`       | int64   | Hour of day (integer, e.g. 0–23)   |
| `trips`      | float64 | Trip count (rows with ≤ 0 dropped) |

**`dataset_config.json`**

```json
{
  "base_level": "ZONE_ID",
  "levels": [
    { "id": "ZONE_ID",   "name": "Zone",     "file": "zones.parquet" },
    { "id": "DISTRICT",  "name": "District", "file": "zones_DISTRICT.parquet" },
    { "id": "REGION",    "name": "Region",   "file": "zones_REGION.parquet" }
  ],
  "days": ["saturday", "weekday"],
  "bbox": [34.2, 29.5, 35.9, 33.3]
}
```

The backend reads this file at startup to discover which levels and day types exist. The UI's Level Selector and Day Filter are populated entirely from this file — no code changes are needed.

---

## 8. Connecting to the Backend

Point the backend's `DATA_DIR` environment variable at the output directory:

**Running directly:**

```bash
DATA_DIR=/path/to/output_data uvicorn backend.main:app --reload
```

**Via Docker Compose** — edit `docker-compose.yml`:

```yaml
backend:
  environment:
    DATA_DIR: /app/data
  volumes:
    - /path/to/output_data:/app/data:ro
```

**Verification:** After starting the backend, open:

```
http://localhost:8000/api/od/metadata
```

You should see your levels, days, and bbox:

```json
{
  "days": ["saturday", "weekday"],
  "hours": {"min": 0, "max": 23},
  "trips": {"min": 1, "max": 12450.0},
  "levels": [
    {"id": "ZONE_ID", "name": "Zone"},
    {"id": "DISTRICT", "name": "District"},
    {"id": "REGION", "name": "Region"}
  ],
  "bbox": [34.2, 29.5, 35.9, 33.3]
}
```

The frontend will automatically adapt its Level Selector, Day Filter, and initial map view to match.

---

## 9. Complete Config Examples

### Minimal — no aggregation levels, labels in shapefile, long-format OD

```yaml
shapefile:
  path: "data/zones.shp"
  base_zone_col: "ID"
  label_col: "name"

od_files:
  - path: "data/od.csv"
    day: "all"

od_columns:
  from_zone: "origin"
  to_zone:   "destination"
  hours:
    format: "long"
    hour_col:  "hour"
    trips_col: "count"

output_dir: "output/"
```

### Full — multiple levels, external label file with per-level sheets, wide OD

```yaml
shapefile:
  path: "data/census_zones.shp"
  encoding: "utf-8"
  base_zone_col: "LSOA_CODE"
  base_name: "LSOA"
  aggregation_levels:
    - col: "MSOA_CODE"
      name: "MSOA"
    - col: "LAD_CODE"
      name: "Local Authority"
    - col: "REGION_CODE"
      name: "Region"

zone_labels:
  path: "data/zone_names.xlsx"
  join_col: "LSOA_CODE"
  label_col: "LSOA_NAME"
  level_labels:
    MSOA_CODE:
      sheet: "msoa"
      id_col: "msoa_code"
      name_col: "msoa_name"
    LAD_CODE:
      sheet: "lad"
      id_col: "lad_code"
      name_col: "lad_name"
    REGION_CODE:
      sheet: "regions"
      id_col: "rgn_code"
      name_col: "rgn_name"

od_files:
  - path: "data/od_am_peak.csv"
    day: "AM peak"
  - path: "data/od_pm_peak.csv"
    day: "PM peak"
  - path: "data/od_offpeak.csv"
    day: "Off-peak"

od_columns:
  from_zone: "Origin"
  to_zone:   "Destination"
  hours:
    format: "wide_prefix"
    prefix: "T"

output_dir: "C:/od-viewer/data"
```

### Israeli mobile data (original dataset, using the generic script)

```yaml
shapefile:
  path: "data_import/celular1819_v1.3/Shape_files/1270_zones.shp"
  encoding: "iso-8859-8"
  base_zone_col: "TAZ_1270"
  base_name: "TAZ 1270"
  aggregation_levels:
    - col: "TAZ_250"
      name: "TAZ 250"
    - col: "TAZ_33"
      name: "TAZ 33"
    - col: "TAZ_15"
      name: "TAZ 15"
    - col: "CITY"
      name: "City"

zone_labels:
  path: "data_import/celular1819_v1.3/Shape_files/zone_data.xlsx"
  join_col: "TAZ_1270"
  label_col: "zone_name"
  level_labels:
    TAZ_250:
      sheet: "250"
      id_col: "TAZ_250"
      name_col: "NAME"
    TAZ_33:
      sheet: "33"
      id_col: "TAZ_33"
      name_col: "NAME"
    TAZ_15:
      sheet: "15"
      id_col: "TAZ_15"
      name_col: "NAME"

od_files:
  - path: "data_import/celular1819_v1.3/OD_matrices/AvgDayHourlyTrips201819_1270_weekday_v1.csv"
    day: "weekday"
  - path: "data_import/celular1819_v1.3/OD_matrices/AvgDayHourlyTrips201819_1270_friday_v1.csv"
    day: "friday"
  - path: "data_import/celular1819_v1.3/OD_matrices/AvgDayHourlyTrips201819_1270_saturday_v1.csv"
    day: "saturday"

od_columns:
  from_zone: "FromZone"
  to_zone:   "ToZone"
  hours:
    format: "wide_prefix"
    prefix: "h"

output_dir: "od-viewer/data/"
```

---

## 10. Troubleshooting

### "Config errors: shapefile.path is required"

You left a required field blank or misspelled the YAML key. Double-check that `shapefile.path`, `shapefile.base_zone_col`, `od_files`, `od_columns.from_zone`, `od_columns.to_zone`, and `output_dir` are all present.

### "ERROR: Shapefile missing columns: ['DISTRICT']"

The column named in `aggregation_levels` or `base_zone_col` does not exist in the shapefile. Common causes:
- Typo in the config (column names are case-sensitive).
- The shapefile attribute table uses a different name. Open the shapefile in QGIS or run `geopandas.read_file("zones.shp").columns` to see the actual column names.

### "ERROR: no columns matching prefix 'h' + digits found"

Your wide-format OD file doesn't have columns named `h0`, `h1`, etc. Check the actual column names:

```python
import pandas as pd
print(pd.read_csv("od.csv").columns.tolist())
```

Then set `od_columns.hours.prefix` to match the actual prefix.

### "ERROR: '{path}' missing column 'FromZone'"

The from/to zone column names in the config don't match the actual file. The match is case-insensitive, so `FromZone` will match `fromzone` and `FROMZONE`. Check the actual column name with `pd.read_csv("od.csv").columns.tolist()`.

### "WARNING: N zones have no label in zone labels file"

Some base zone IDs from the shapefile have no corresponding row in the labels file. Those zones will display their ID as their label. To investigate:

```python
import geopandas as gpd, pandas as pd
gdf = gpd.read_file("zones.shp")[["ZONE_ID"]]
labels = pd.read_excel("labels.xlsx", usecols=["ZONE_ID", "zone_name"])
missing = gdf[~gdf["ZONE_ID"].astype(str).isin(labels["ZONE_ID"].astype(str))]
print(missing)
```

### "WARNING: N OD zone IDs not in shapefile"

OD data references zone IDs that have no polygon in the shapefile. Those flows will silently be dropped during API queries (they can't be mapped to a geometry). Causes:
- IDs stored differently — e.g., shapefile has `"001"` but OD file has `"1"`. Both become `"1"` after string conversion, so this specific case is handled. But leading-zero strings like `"001"` vs `1` are **not** the same.
- The OD data covers a wider geographic area than the shapefile.

### Centroids appear in the wrong place

If zone labels or flow lines appear in the ocean or far from the expected location, the shapefile's CRS may not be set correctly (missing `.prj` file). The script reprojects using whatever CRS is declared. Fix the CRS in the shapefile first using QGIS (`Layer → Set CRS`) or GeoPandas:

```python
import geopandas as gpd
gdf = gpd.read_file("zones.shp")
gdf = gdf.set_crs("EPSG:27700")   # set the correct CRS
gdf.to_file("zones_fixed.shp")
```

### The dissolve step is very slow

Dissolving complex polygons (e.g., detailed coastline geometry) can be slow. If the aggregation-level display in the UI doesn't need full precision, simplify the geometry first:

```python
import geopandas as gpd
gdf = gpd.read_file("zones.shp")
gdf["geometry"] = gdf.simplify(tolerance=0.001, preserve_topology=True)
gdf.to_file("zones_simplified.shp")
```

`tolerance` is in the CRS units (degrees for WGS 84, metres for projected). `0.001` degrees ≈ 100 m.

### Backend starts but `/api/od/metadata` shows old levels

The backend cached the old `dataset_config.json` in memory. Restart the backend process — it re-reads the config on every startup.

### The map opens but shows no zones

Check the browser console for network errors. If `/api/zones` returns a 400, the `level` parameter may not match any level ID in `dataset_config.json`. Ensure the backend was restarted after re-running ingestion.
