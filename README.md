# OD Viewer

Browser-based geographic visualization of Origin-Destination (OD) trip flows between traffic analysis zones (TAZs), built on FastAPI + DuckDB + MapLibre GL JS.

---

## Prerequisites

**Docker (recommended):** Docker Desktop

**Local dev:** Python 3.11+, Node 20+

---

## Input Data Format

### Shapefile

| Column    | Type       | Description                          |
|-----------|------------|--------------------------------------|
| TAZ_1270  | int/str    | Base zone ID — join key for OD data  |
| TAZ_250   | int/str    | Parent grouping (~250 zones)         |
| TAZ_33    | int/str    | Parent grouping (~33 zones)          |
| TAZ_15    | int/str    | Parent grouping (~15 zones)          |
| CITY      | str        | Municipality name (Hebrew, cp1255)   |

### Zone metadata (`zone_data.xlsx`)

**Main sheet (row 1 = header, row 2 = sub-headers to skip):**

| Column A   | Column B  | Column C | Column D | Column G  |
|------------|-----------|----------|----------|-----------|
| TAZ_1270   | TAZ_250   | TAZ_33   | TAZ_15   | zone_name |

**Additional sheets** named `"250"`, `"33"`, `"15"` — each contains a group ID column and a `NAME` column for human-readable aggregated zone labels.

### OD Matrix CSVs (weekday, friday, saturday)

| Column   | Type      | Description                         |
|----------|-----------|-------------------------------------|
| fromZone | int/str   | Origin zone (matches TAZ_1270)      |
| ToZone   | int/str   | Destination zone (matches TAZ_1270) |
| h0–h23   | float     | Average daily trips per hour        |

Rows where all hours are zero are dropped during ingestion. Self-loops (fromZone == ToZone) are retained in storage and filtered at query time by default.

---

## Ingestion

Run once after placing raw data files. Output goes to `od-viewer/data/`:

```bash
cd od-viewer
python scripts/ingest.py \
  --shapefile  "<path>/1270_zones.shp" \
  --zone-data  "<path>/zone_data.xlsx" \
  --weekday    "<path>/weekday.csv" \
  --friday     "<path>/friday.csv" \
  --saturday   "<path>/saturday.csv" \
  --output-dir "data/"
```

**Output files:**
- `data/zones.parquet` — 1,270 base zones with geometry, names, centroids
- `data/zones_250.parquet`, `zones_33.parquet`, `zones_15.parquet`, `zones_city.parquet` — dissolved aggregated zones
- `data/od_matrix.parquet` — long-format OD data (~50M rows)

The script prints a summary including any zone ID mismatches between the OD data and the shapefile.

---

## Local Development

**Terminal 1 — Backend:**
```bash
cd od-viewer/backend
pip install -r requirements.txt
DATA_DIR=../data uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd od-viewer/frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to `localhost:8000`.

---

## Docker

Parquets in `od-viewer/data/` must exist before building.

```bash
cd od-viewer
docker-compose up --build
```

Open `http://localhost`. Nginx proxies `/api/*` to the backend container.

---

## Deployment (Linux VM)

1. Copy the `od-viewer/` directory to the server.
2. Run ingestion to produce parquet files in `od-viewer/data/`.
3. `docker-compose up -d --build`
4. Configure Nginx on the host to reverse-proxy port 80, terminate HTTPS with Let's Encrypt.

Or without Docker: run gunicorn with a systemd service, and Nginx to serve the Vite build at `frontend/dist/`.

---

## Troubleshooting

**Zone labels don't appear on the map**
The MapLibre symbol layer requires a `glyphs` URL in the map style. It is set to `https://fonts.openmaptiles.org/{fontstack}/{range}.pbf` — ensure the browser can reach this URL.

**No flows are returned**
Zone ID type mismatch. Verify string types in the parquets:
```bash
python -c "import pandas as pd; print(pd.read_parquet('data/zones.parquet').dtypes)"
python -c "import pandas as pd; print(pd.read_parquet('data/od_matrix.parquet').dtypes)"
```
Both `TAZ_1270`/`from_zone`/`to_zone` must be `object` (string).

**Hebrew CITY names are garbled**
Set `encoding="cp1255"` in `gpd.read_file()`. The shapefile DBF uses Windows-1255 encoding.

**DuckDB path error on Windows**
Use forward slashes in the parquet path: `Path(DATA_DIR).as_posix()`.

**`zone_data.xlsx` reads wrong columns**
Confirm `skiprows=[1]` skips the sub-header row. Check that the extra sheets are named exactly `"250"`, `"33"`, `"15"` (case-sensitive).

**Backend startup is slow**
Normal — dissolving large polygon geometry at startup takes ~5s. The od_matrix view registration is fast.
