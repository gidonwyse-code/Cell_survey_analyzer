import json
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

# ── Dataset config ─────────────────────────────────────────────────────────
# Loaded at startup from dataset_config.json (written by ingest_generic.py).
# Falls back to the original hardcoded layout when the file is absent.

_FALLBACK_LEVELS = [
    {"id": "TAZ_1270", "name": "TAZ 1270", "file": "zones.parquet"},
    {"id": "TAZ_250",  "name": "TAZ 250",  "file": "zones_250.parquet"},
    {"id": "TAZ_33",   "name": "TAZ 33",   "file": "zones_33.parquet"},
    {"id": "TAZ_15",   "name": "TAZ 15",   "file": "zones_15.parquet"},
    {"id": "CITY",     "name": "City",     "file": "zones_city.parquet"},
]
_FALLBACK_DAYS = ["weekday", "friday", "saturday"]
_FALLBACK_BBOX = [34.2, 29.5, 35.9, 33.3]

def _load_dataset_config() -> tuple[str, list[dict], list[str], list[float]]:
    cfg_path = DATA_DIR / "dataset_config.json"
    if not cfg_path.exists():
        logger.info("dataset_config.json not found — using fallback hardcoded config")
        base = _FALLBACK_LEVELS[0]["id"]
        return base, _FALLBACK_LEVELS, _FALLBACK_DAYS, _FALLBACK_BBOX
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    base = cfg["base_level"]
    levels = cfg["levels"]
    days = cfg.get("days", _FALLBACK_DAYS)
    bbox = cfg.get("bbox", _FALLBACK_BBOX)
    logger.info(f"Loaded dataset_config.json: base={base}, levels={[l['id'] for l in levels]}, days={days}")
    return base, levels, days, bbox

BASE_LEVEL: str = ""
LEVEL_META: list[dict] = []   # list of {id, name, file}
LEVEL_FILES: dict[str, str] = {}
VALID_LEVELS: list[str] = []
VALID_DAYS: list[str] = []
DATASET_BBOX: list[float] = []

zones_gdf: dict = {}
zones_geojson_cache: dict = {}
con: duckdb.DuckDBPyConnection = None
_duckdb_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global zones_gdf, zones_geojson_cache, con
    global BASE_LEVEL, LEVEL_META, LEVEL_FILES, VALID_LEVELS, VALID_DAYS, DATASET_BBOX

    BASE_LEVEL, LEVEL_META, VALID_DAYS, DATASET_BBOX = _load_dataset_config()
    LEVEL_FILES = {lv["id"]: lv["file"] for lv in LEVEL_META}
    VALID_LEVELS = [lv["id"] for lv in LEVEL_META]

    logger.info(f"Loading zone parquets from {DATA_DIR} ...")
    for level, filename in LEVEL_FILES.items():
        path = DATA_DIR / filename
        gdf = gpd.read_parquet(path)
        zones_gdf[level] = gdf

        export = gdf.copy()
        if level == BASE_LEVEL:
            export = export.rename(columns={BASE_LEVEL: "id", "zone_name": "label"})
        else:
            export = export.rename(columns={"group_id": "id"})

        keep = ["id", "label", "centroid_lat", "centroid_lon", "geometry"]
        export = export[[c for c in keep if c in export.columns]]
        zones_geojson_cache[level] = export.to_json()
        logger.info(f"  {level}: {len(gdf)} features")

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
def get_zones(level: str = Query(default=None)):
    if level is None:
        level = BASE_LEVEL
    if level not in VALID_LEVELS:
        raise HTTPException(400, f"Invalid level '{level}'. Valid: {VALID_LEVELS}")
    t0 = time.time()
    body = zones_geojson_cache[level]
    logger.info(f"GET /api/zones level={level} {len(body):,} bytes {time.time()-t0:.3f}s")
    return Response(content=body, media_type="application/json")


@app.get("/api/od/metadata")
def get_metadata():
    max_trips = con.execute("SELECT MAX(trips) FROM od_matrix").fetchone()[0]
    days = con.execute("SELECT DISTINCT day FROM od_matrix ORDER BY day").df()["day"].tolist()
    return {
        "days": days,
        "hours": {"min": 0, "max": 23},
        "trips": {"min": 1, "max": float(max_trips)},
        "levels": [{"id": lv["id"], "name": lv["name"]} for lv in LEVEL_META],
        "bbox": DATASET_BBOX,
    }


def _build_lookup(base_gdf, level: str):
    base_col = BASE_LEVEL
    if level == base_col:
        lk = base_gdf[[base_col]].copy()
        lk.columns = ["taz_base"]
        lk["group_id"] = lk["taz_base"]
    else:
        lk = base_gdf[[base_col, level]].copy()
        lk.columns = ["taz_base", "group_id"]
    lk["taz_base"] = lk["taz_base"].astype(str)
    lk["group_id"] = lk["group_id"].astype(str)
    return lk


@app.get("/api/od")
def get_od(
    level:        Optional[str] = Query(None),
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
    if day and VALID_DAYS and day not in VALID_DAYS:
        raise HTTPException(400, f"Invalid day '{day}'")

    base_gdf = zones_gdf[BASE_LEVEL]
    orig_lookup = _build_lookup(base_gdf, eff_orig)
    dest_lookup = _build_lookup(base_gdf, eff_dest)

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
            conditions.append("ip.orig_gid IS NULL")

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
        JOIN orig_lookup orig ON od.from_zone = orig.taz_base
        JOIN dest_lookup dest ON od.to_zone   = dest.taz_base
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
