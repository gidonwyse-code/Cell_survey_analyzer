import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import duckdb
import geopandas as gpd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))

LEVEL_FILES = {
    "TAZ_1270": "zones.parquet",
    "TAZ_250":  "zones_250.parquet",
    "TAZ_33":   "zones_33.parquet",
    "TAZ_15":   "zones_15.parquet",
    "CITY":     "zones_city.parquet",
}
VALID_LEVELS = list(LEVEL_FILES.keys())

zones_gdf: dict = {}
zones_geojson_cache: dict = {}
con: duckdb.DuckDBPyConnection = None
_duckdb_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global zones_gdf, zones_geojson_cache, con

    logger.info(f"Loading zone parquets from {DATA_DIR} ...")
    for level, filename in LEVEL_FILES.items():
        path = DATA_DIR / filename
        gdf = gpd.read_parquet(path)
        zones_gdf[level] = gdf

        # Pre-build GeoJSON with normalized id/label properties
        export = gdf.copy()
        if level == "TAZ_1270":
            export = export.rename(columns={"TAZ_1270": "id", "zone_name": "label"})
        else:
            export = export.rename(columns={"group_id": "id"})

        keep = ["id", "label", "centroid_lat", "centroid_lon", "geometry"]
        export = export[[c for c in keep if c in export.columns]]
        zones_geojson_cache[level] = export.to_json()  # store raw string — never re-parse/re-serialize
        logger.info(f"  {level}: {len(gdf)} features")

    # Register od_matrix.parquet with DuckDB — never load into Pandas
    od_path = (DATA_DIR / "od_matrix.parquet").as_posix()
    con = duckdb.connect(":memory:")
    con.execute(f"CREATE VIEW od_matrix AS SELECT * FROM read_parquet('{od_path}')")
    count = con.execute("SELECT COUNT(*) FROM od_matrix").fetchone()[0]
    logger.info(f"DuckDB: od_matrix loaded with {count:,} rows")

    yield
    con.close()


app = FastAPI(title="OD Viewer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/zones")
def get_zones(level: str = "TAZ_1270"):
    if level not in VALID_LEVELS:
        raise HTTPException(400, f"Invalid level '{level}'. Valid: {VALID_LEVELS}")
    t0 = time.time()
    body = zones_geojson_cache[level]
    logger.info(f"GET /api/zones level={level} {len(body):,} bytes {time.time()-t0:.3f}s")
    return Response(content=body, media_type="application/json")


@app.get("/api/od/metadata")
def get_metadata():
    max_trips = con.execute("SELECT MAX(trips) FROM od_matrix").fetchone()[0]
    return {
        "days": ["weekday", "friday", "saturday"],
        "hours": {"min": 0, "max": 23},
        "trips": {"min": 1, "max": float(max_trips)},
        "levels": VALID_LEVELS,
    }


@app.get("/api/od")
def get_od(
    level: str = Query(...),
    day: Optional[str] = None,
    hour_min: int = 0,
    hour_max: int = 24,
    min_trips: float = 1.0,
    origin_ids: Optional[str] = None,
    dest_ids: Optional[str] = None,
    exclude_origin_ids: Optional[str] = None,
    exclude_dest_ids: Optional[str] = None,
    include_self_loops: bool = False,
):
    t0 = time.time()

    if level not in VALID_LEVELS:
        raise HTTPException(400, f"Invalid level '{level}'")
    if day and day not in ("weekday", "friday", "saturday"):
        raise HTTPException(400, f"Invalid day '{day}'")

    # Build TAZ_1270 → group_id lookup from the in-memory GeoDataFrame
    base_gdf = zones_gdf["TAZ_1270"]
    if level == "TAZ_1270":
        lookup = base_gdf[["TAZ_1270"]].copy()
        lookup.columns = ["taz_1270"]
        lookup["group_id"] = lookup["taz_1270"]
    else:
        lookup = base_gdf[["TAZ_1270", level]].copy()
        lookup.columns = ["taz_1270", "group_id"]
    lookup["taz_1270"] = lookup["taz_1270"].astype(str)
    lookup["group_id"] = lookup["group_id"].astype(str)

    conditions = [
        f"od.hour >= {int(hour_min)}",
        f"od.hour < {int(hour_max)}",
    ]
    if day:
        conditions.append(f"od.day = '{day}'")
    if not include_self_loops:
        conditions.append("orig.group_id != dest.group_id")

    def parse_ids(s: Optional[str]) -> list[str]:
        if not s:
            return []
        return [i.strip() for i in s.split(",") if i.strip()]

    orig_ids   = parse_ids(origin_ids)
    dst_ids    = parse_ids(dest_ids)
    ex_orig    = parse_ids(exclude_origin_ids)
    ex_dest    = parse_ids(exclude_dest_ids)

    def ids_to_sql(ids: list[str]) -> str:
        return ",".join(f"'{i}'" for i in ids)

    if orig_ids:
        conditions.append(f"orig.group_id IN ({ids_to_sql(orig_ids)})")
    if dst_ids:
        conditions.append(f"dest.group_id IN ({ids_to_sql(dst_ids)})")
    if ex_orig:
        conditions.append(f"orig.group_id NOT IN ({ids_to_sql(ex_orig)})")
    if ex_dest:
        conditions.append(f"dest.group_id NOT IN ({ids_to_sql(ex_dest)})")

    where_clause = " AND ".join(conditions)

    sql = f"""
        SELECT
            orig.group_id  AS origin_id,
            dest.group_id  AS dest_id,
            SUM(od.trips)  AS trips
        FROM od_matrix od
        JOIN taz_lookup orig ON od.from_zone = orig.taz_1270
        JOIN taz_lookup dest ON od.to_zone   = dest.taz_1270
        WHERE {where_clause}
        GROUP BY orig.group_id, dest.group_id
        HAVING SUM(od.trips) >= {float(min_trips)}
        ORDER BY trips DESC
        LIMIT 5001
    """

    with _duckdb_lock:
        con.register("taz_lookup", lookup)
        rows = con.execute(sql).fetchall()
    truncated = len(rows) > 5000
    data = [{"origin_id": r[0], "dest_id": r[1], "trips": float(r[2])} for r in rows[:5000]]

    elapsed = time.time() - t0
    logger.info(
        f"GET /api/od level={level} day={day} rows={len(data)} truncated={truncated} {elapsed:.3f}s"
    )
    return {"data": data, "truncated": truncated}
