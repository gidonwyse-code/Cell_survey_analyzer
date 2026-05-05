# OD Viewer — User Manual

## Prerequisites

### To run with Docker
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

### To run without Docker
- Python 3.11+
- Node.js 18+ and npm

---

## Step 1 — Run the Ingestion Script

This step converts the raw data files into the Parquet files the app needs.
**You only need to do this once** (or again if the raw data changes).

Open a terminal, navigate to the project root, and run:

```
cd C:\CELL_SURVEY_ANALYZER\od-viewer

python scripts\ingest.py ^
  --shapefile  "C:\CELL_SURVEY_ANALYZER\data\Shape_files\1270_zones.shp" ^
  --zone-data  "C:\CELL_SURVEY_ANALYZER\data\Shape_files\zone_data.xlsx" ^
  --weekday    "C:\CELL_SURVEY_ANALYZER\data\OD_matrices\AvgDayHourlyTrips201819_1270_weekday.csv" ^
  --friday     "C:\CELL_SURVEY_ANALYZER\data\OD_matrices\AvgDayHourlyTrips201819_1270_friday.csv" ^
  --saturday   "C:\CELL_SURVEY_ANALYZER\data\OD_matrices\AvgDayHourlyTrips201819_1270_saturday.csv" ^
  --output-dir "C:\CELL_SURVEY_ANALYZER\od-viewer\data"
```

> The `^` character is the Windows command-line continuation character. You can also write the whole command on one line.

### What ingestion produces

The script writes these files to `od-viewer\data\`:

| File | Contents |
|------|----------|
| `zones.parquet` | All 1,270 TAZ polygons with zone names |
| `zones_250.parquet` | 250-zone dissolved polygons |
| `zones_33.parquet` | 33-zone dissolved polygons |
| `zones_15.parquet` | 15-zone dissolved polygons |
| `zones_city.parquet` | City-level dissolved polygons |
| `od_matrix.parquet` | Full OD flow data (all days & hours) |

### Expected output

The script prints a summary when it finishes, for example:

```
Ingestion summary:
  Total OD rows   : 4,521,600
  Days            : ['friday', 'saturday', 'weekday']
  Trip range      : 0.001 – 12345.0
  OD zones        : 1,270
  Shapefile zones : 1,270
  All OD zones matched shapefile zones.
  Saved -> data\od_matrix.parquet (142.3 MB)
```

If you see `WARNING: N zones have no zone_name` or `WARNING: N OD zone IDs not in shapefile`, the data loaded but some zone names or IDs could not be matched — the app will still work, but those zones will show numeric IDs instead of names.

---

## Step 2 — Start the App

Choose one of the two options below.

---

### Option A — Docker (recommended)

From the `od-viewer` directory:

```
cd C:\CELL_SURVEY_ANALYZER\od-viewer

docker-compose up --build
```

The first run downloads and builds Docker images — this takes a few minutes. Subsequent starts are faster (`docker-compose up` without `--build`).

Once you see log lines like `Uvicorn running` and the Nginx container is up, open your browser:

| Service | URL |
|---------|-----|
| **App (frontend)** | http://localhost |
| **API (backend)** | http://localhost:8000 |

To stop:

```
docker-compose down
```

---

### Option B — Without Docker (PowerShell script)

A convenience script `dev.ps1` handles everything: it kills any processes already on the ports, starts the backend in one PowerShell window, waits for it to be ready, then starts the frontend in a second window.

**First-time setup — install dependencies once:**

```powershell
# Python dependencies
pip install fastapi "uvicorn[standard]" gunicorn geopandas pyarrow duckdb shapely pandas openpyxl python-dotenv

# Node dependencies
cd C:\CELL_SURVEY_ANALYZER\od-viewer\frontend
npm install
```

**Start the app:**

```powershell
cd C:\CELL_SURVEY_ANALYZER\od-viewer
.\dev.ps1
```

Two new PowerShell windows will open (one for the backend, one for the frontend). The script waits for the backend to be ready before launching the frontend.

Open your browser at **http://localhost:5173**

**Stop the app:**

```powershell
.\dev.ps1 stop
```

This kills any processes on ports 8000 and 5173, then closes. You can also just close the two terminal windows manually.

> If PowerShell blocks the script with "cannot be loaded because running scripts is disabled", run this once to allow local scripts:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

---

## Troubleshooting

**`FileNotFoundError` on startup** — The backend cannot find a Parquet file. Make sure Step 1 completed successfully and all 6 `.parquet` files exist in `od-viewer\data\`.

**`ModuleNotFoundError` during ingestion or backend start** — A Python dependency is missing. Re-run the `pip install` command for the relevant step.

**`docker-compose: command not found`** — Docker Desktop is not installed or not running. Start Docker Desktop and try again, or use Option B.

**Port 80 already in use (Docker)** — Edit `docker-compose.yml`, change `"80:80"` to `"8080:80"`, then access the app at http://localhost:8080.

**Port 8000 already in use** — Another process is using port 8000. Stop it, or start the backend on a different port (`--port 8001`) and update `vite.config.ts` to proxy to `http://localhost:8001` instead.

**Frontend shows blank map or API errors** — Confirm the backend is running and `DATA_DIR` points to the folder containing the `.parquet` files.
