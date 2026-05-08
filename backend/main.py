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


def _build_lookup(base_gdf, level: str):
    if level == "TAZ_1270":
        lk = base_gdf[["TAZ_1270"]].copy()
        lk.columns = ["taz_1270"]
        lk["group_id"] = lk["taz_1270"]
    else:
        lk = base_gdf[["TAZ_1270", level]].copy()
        lk.columns = ["taz_1270", "group_id"]
    lk["taz_1270"] = lk["taz_1270"].astype(str)
    lk["group_id"] = lk["group_id"].astype(str)
    return lk


@app.get("/api/od")
def get_od(
    level:        Optional[str] = Query(None),   # backward-compat alias
    origin_level: Optional[str] = Query(None),
    dest_level:   Optional[str] = Query(None),
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

    eff_orig = origin_level or level
    eff_dest = dest_level   or level
    if not eff_orig or not eff_dest:
        raise HTTPException(400, "Provide 'level', or both 'origin_level' and 'dest_level'")
    if eff_orig not in VALID_LEVELS:
        raise HTTPException(400, f"Invalid origin_level '{eff_orig}'")
    if eff_dest not in VALID_LEVELS:
        raise HTTPException(400, f"Invalid dest_level '{eff_dest}'")
    if day and day not in ("weekday", "friday", "saturday"):
        raise HTTPException(400, f"Invalid day '{day}'")

    base_gdf = zones_gdf["TAZ_1270"]
    orig_lookup = _build_lookup(base_gdf, eff_orig)
    dest_lookup = _build_lookup(base_gdf, eff_dest)

    # Build internal-pairs lookup for cross-level hierarchical self-loop filtering.
    # A flow (A, B) is "hierarchically internal" when A contains B or B contains A
    # in the zone hierarchy — i.e. they share any TAZ_1270 row in zones.parquet.
    internal_pairs_df = None
    if not include_self_loops and eff_orig != eff_dest:
        ip = base_gdf[[eff_orig, eff_dest]].drop_duplicates().copy()
        ip.columns = ["orig_gid", "dest_gid"]
        ip["orig_gid"] = ip["orig_gid"].astype(str)
        ip["dest_gid"] = ip["dest_gid"].astype(str)
        internal_pairs_df = ip

    conditions = [
        f"od.hour >= {int(hour_min)}",
        f"od.hour < {int(hour_max)}",
    ]
    if day:
        conditions.append(f"od.day = '{day}'")
    if not include_self_loops:
        if eff_orig == eff_dest:
            conditions.append("orig.group_id != dest.group_id")
        else:
            conditions.append("ip.orig_gid IS NULL")  # anti-join: not in internal_pairs

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

    join_extra = (
        "LEFT JOIN internal_pairs ip "
        "ON ip.orig_gid = orig.group_id AND ip.dest_gid = dest.group_id"
        if internal_pairs_df is not None else ""
    )

    sql = f"""
        SELECT
            orig.group_id  AS origin_id,
            dest.group_id  AS dest_id,
            SUM(od.trips)  AS trips
        FROM od_matrix od
        JOIN orig_lookup orig ON od.from_zone = orig.taz_1270
        JOIN dest_lookup dest ON od.to_zone   = dest.taz_1270
        {join_extra}
        WHERE {where_clause}
        GROUP BY orig.group_id, dest.group_id
        HAVING SUM(od.trips) >= {float(min_trips)}
        ORDER BY trips DESC
        LIMIT 5001
    """

    with _duckdb_lock:
        con.register("orig_lookup", orig_lookup)
        con.register("dest_lookup", dest_lookup)
        if internal_pairs_df is not None:
            con.register("internal_pairs", internal_pairs_df)
        rows = con.execute(sql).fetchall()
    truncated = len(rows) > 5000
    data = [{"origin_id": r[0], "dest_id": r[1], "trips": float(r[2])} for r in rows[:5000]]

    elapsed = time.time() - t0
    logger.info(
        f"GET /api/od orig={eff_orig} dest={eff_dest} day={day} rows={len(data)} truncated={truncated} {elapsed:.3f}s"
    )
    return {"data": data, "truncated": truncated}
