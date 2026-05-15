"""
Generic data ingestion script: shapefile + OD CSVs/Excel -> GeoParquet + dataset_config.json

Usage:
  python scripts/ingest_generic.py --config dataset.yaml

See scripts/dataset.yaml.example for a fully-annotated config reference.
"""
import argparse
import json
import re
import sys
import warnings
from pathlib import Path

import geopandas as gpd
import pandas as pd
import yaml


# ---------------------------------------------------------------------------
# Config loading & validation
# ---------------------------------------------------------------------------

def load_config(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    errors = []

    shp = cfg.get("shapefile", {})
    if not shp.get("path"):
        errors.append("shapefile.path is required")
    if not shp.get("base_zone_col"):
        errors.append("shapefile.base_zone_col is required")

    od_files = cfg.get("od_files")
    if not od_files:
        errors.append("od_files list is required (at least one entry)")

    od_cols = cfg.get("od_columns", {})
    if not od_cols.get("from_zone"):
        errors.append("od_columns.from_zone is required")
    if not od_cols.get("to_zone"):
        errors.append("od_columns.to_zone is required")

    if not cfg.get("output_dir"):
        errors.append("output_dir is required")

    if errors:
        sys.exit("Config errors:\n" + "\n".join(f"  - {e}" for e in errors))

    return cfg


# ---------------------------------------------------------------------------
# Zone loading
# ---------------------------------------------------------------------------

def load_zones(cfg: dict) -> gpd.GeoDataFrame:
    shp_cfg = cfg["shapefile"]
    path = Path(shp_cfg["path"])
    encoding = shp_cfg.get("encoding", "utf-8")
    base_col = shp_cfg["base_zone_col"]
    agg_levels = shp_cfg.get("aggregation_levels", [])  # list of {col, name}
    shp_label_col = shp_cfg.get("label_col")            # optional in-shapefile label

    print(f"Loading shapefile: {path}")
    gdf = gpd.read_file(path, encoding=encoding)

    required_cols = [base_col] + [lv["col"] for lv in agg_levels]
    missing = [c for c in required_cols if c not in gdf.columns]
    if missing:
        sys.exit(f"ERROR: Shapefile missing columns: {missing}. Found: {list(gdf.columns)}")

    keep = list(dict.fromkeys(required_cols + ["geometry"]))
    if shp_label_col and shp_label_col in gdf.columns:
        keep.append(shp_label_col)
    gdf = gdf[keep].copy()
    gdf = gdf.to_crs("EPSG:4326")

    # Normalize IDs to string
    for col in required_cols:
        gdf[col] = gdf[col].astype(str).str.strip()

    print(f"  {len(gdf)} zones loaded, reprojected to EPSG:4326")

    # ── Base zone labels ────────────────────────────────────────────────────
    zl_cfg = cfg.get("zone_labels", {})
    if zl_cfg and zl_cfg.get("path"):
        zl_path = Path(zl_cfg["path"])
        join_col = zl_cfg.get("join_col", base_col)
        label_col = zl_cfg.get("label_col", "zone_name")
        print(f"Loading zone labels: {zl_path}")

        if zl_path.suffix.lower() in (".xlsx", ".xls"):
            zd = pd.read_excel(zl_path, usecols=[join_col, label_col])
        else:
            zd = pd.read_csv(zl_path, usecols=[join_col, label_col])

        zd[join_col] = zd[join_col].astype(str).str.strip()
        gdf = gdf.merge(zd[[join_col, label_col]].rename(columns={join_col: base_col}),
                        on=base_col, how="left")
        missing_names = gdf[label_col].isna().sum()
        if missing_names:
            print(f"  WARNING: {missing_names} zones have no label in zone labels file")
        gdf = gdf.rename(columns={label_col: "zone_name"})

    elif shp_label_col and shp_label_col in gdf.columns:
        gdf = gdf.rename(columns={shp_label_col: "zone_name"})
    else:
        # Fall back to using the base zone ID as label
        gdf["zone_name"] = gdf[base_col]
        print("  WARNING: no label source configured; using base zone ID as label")

    # ── Per-level labels ────────────────────────────────────────────────────
    ll_cfg = (zl_cfg or {}).get("level_labels", {})
    if ll_cfg and zl_cfg.get("path"):
        zl_path = Path(zl_cfg["path"])
        for agg in agg_levels:
            col = agg["col"]
            if col not in ll_cfg:
                gdf[f"name_{col}"] = gdf[col]
                continue
            spec = ll_cfg[col]
            if zl_path.suffix.lower() in (".xlsx", ".xls"):
                sheet = spec.get("sheet", 0)
                df = pd.read_excel(zl_path, sheet_name=sheet)
            else:
                df = pd.read_csv(zl_path)
            df.columns = [str(c).strip() for c in df.columns]
            id_col = spec.get("id_col", df.columns[0])
            name_col_src = spec.get("name_col", "NAME")
            if id_col not in df.columns or name_col_src not in df.columns:
                print(f"  WARNING: level_labels for '{col}' missing columns; using ID as label")
                gdf[f"name_{col}"] = gdf[col]
                continue
            df = df[[id_col, name_col_src]].rename(columns={id_col: col, name_col_src: f"name_{col}"})
            df = df.dropna(subset=[col])
            numeric = pd.to_numeric(df[col], errors="coerce")
            if numeric.notna().all():
                df[col] = numeric.astype(int).astype(str)
            else:
                df[col] = df[col].astype(str).str.strip()
            df = df.drop_duplicates(subset=col)
            gdf = gdf.merge(df, on=col, how="left")
            print(f"  Loaded {len(df)} names for level '{col}'")
    else:
        for agg in agg_levels:
            col = agg["col"]
            if f"name_{col}" not in gdf.columns:
                gdf[f"name_{col}"] = gdf[col]

    # ── Centroids ───────────────────────────────────────────────────────────
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        centroids = gdf.geometry.centroid
    gdf["centroid_lat"] = centroids.y
    gdf["centroid_lon"] = centroids.x

    return gdf


# ---------------------------------------------------------------------------
# Aggregated zone parquets
# ---------------------------------------------------------------------------

def build_aggregated_parquets(gdf: gpd.GeoDataFrame, agg_levels: list, output_dir: Path) -> list[dict]:
    level_meta = []
    for agg in agg_levels:
        col = agg["col"]
        name = agg["name"]
        label_col = f"name_{col}" if f"name_{col}" in gdf.columns else col
        print(f"  Dissolving zones for level '{col}' ({name}) ...")

        sel_cols = list(dict.fromkeys(["geometry", col, label_col]))
        dissolved = gdf[sel_cols].dissolve(by=col, as_index=False)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            c = dissolved.geometry.centroid
        dissolved["centroid_lat"] = c.y
        dissolved["centroid_lon"] = c.x
        dissolved = dissolved.rename(columns={col: "group_id"})
        if label_col == col:
            dissolved["label"] = dissolved["group_id"]
        else:
            dissolved = dissolved.rename(columns={label_col: "label"})
        out = dissolved[["group_id", "label", "centroid_lat", "centroid_lon", "geometry"]]
        filename = f"zones_{col}.parquet"
        out_path = output_dir / filename
        out.to_parquet(out_path)
        print(f"    Saved {len(out)} groups -> {out_path}")
        level_meta.append({"id": col, "name": name, "file": filename})

    return level_meta


# ---------------------------------------------------------------------------
# OD matrix
# ---------------------------------------------------------------------------

def _read_od_wide_prefix(df: pd.DataFrame, from_col: str, to_col: str,
                          prefix: str) -> pd.DataFrame:
    hour_cols = sorted(
        [c for c in df.columns if re.fullmatch(re.escape(prefix) + r"\d+", c)],
        key=lambda c: int(c[len(prefix):])
    )
    if not hour_cols:
        sys.exit(f"ERROR: no columns matching prefix '{prefix}' + digits found. Columns: {list(df.columns)}")
    df_long = df.melt(
        id_vars=[from_col, to_col],
        value_vars=hour_cols,
        var_name="hour_str",
        value_name="trips",
    )
    df_long["hour"] = df_long["hour_str"].str[len(prefix):].astype(int)
    return df_long[[from_col, to_col, "hour", "trips"]]


def _read_od_long(df: pd.DataFrame, from_col: str, to_col: str,
                  hour_col: str, trips_col: str) -> pd.DataFrame:
    for c in [hour_col, trips_col]:
        if c not in df.columns:
            sys.exit(f"ERROR: long-format OD missing column '{c}'. Found: {list(df.columns)}")
    return df[[from_col, to_col, hour_col, trips_col]].rename(
        columns={hour_col: "hour", trips_col: "trips"}
    )


def build_od_matrix(cfg: dict, shp_zones: set, output_dir: Path) -> list[str]:
    od_cfg = cfg["od_files"]
    col_cfg = cfg.get("od_columns", {})
    from_zone_col = col_cfg.get("from_zone", "FromZone")
    to_zone_col = col_cfg.get("to_zone", "ToZone")

    hours_cfg = col_cfg.get("hours", {})
    fmt = hours_cfg.get("format", "wide_prefix")
    prefix = hours_cfg.get("prefix", "h")
    hour_col = hours_cfg.get("hour_col", "hour")
    trips_col = hours_cfg.get("trips_col", "trips")

    dfs = []
    days_found = []

    for entry in od_cfg:
        path = Path(entry["path"])
        day = entry["day"]
        print(f"  Processing '{day}': {path}")

        if path.suffix.lower() in (".xlsx", ".xls"):
            df = pd.read_excel(path)
        else:
            df = pd.read_csv(path)

        df.columns = [c.strip() for c in df.columns]
        # Case-insensitive lookup for from/to columns
        col_map = {c.lower(): c for c in df.columns}
        from_key = col_map.get(from_zone_col.lower(), from_zone_col)
        to_key   = col_map.get(to_zone_col.lower(), to_zone_col)

        for key, label in [(from_key, from_zone_col), (to_key, to_zone_col)]:
            if key not in df.columns:
                sys.exit(f"ERROR: '{path}' missing column '{label}'. Found: {list(df.columns)}")

        df = df.rename(columns={from_key: "from_zone", to_key: "to_zone"})
        df["from_zone"] = df["from_zone"].astype(str).str.strip()
        df["to_zone"]   = df["to_zone"].astype(str).str.strip()

        if fmt == "wide_prefix":
            df_long = _read_od_wide_prefix(df, "from_zone", "to_zone", prefix)
        elif fmt == "long":
            df_long = _read_od_long(df, "from_zone", "to_zone", hour_col, trips_col)
        else:
            sys.exit(f"ERROR: unsupported od_columns.hours.format '{fmt}'. Use 'wide_prefix' or 'long'.")

        df_long["day"] = day
        df_long = df_long[df_long["trips"] > 0][["from_zone", "to_zone", "day", "hour", "trips"]]
        print(f"    {len(df_long):,} rows after zero-filter")
        dfs.append(df_long)
        days_found.append(day)

    od = pd.concat(dfs, ignore_index=True)
    out_path = output_dir / "od_matrix.parquet"
    od.to_parquet(out_path, index=False)

    od_zones = set(od["from_zone"].unique()) | set(od["to_zone"].unique())
    missing = od_zones - shp_zones
    print(f"\nIngestion summary:")
    print(f"  Total OD rows   : {len(od):,}")
    print(f"  Days            : {sorted(od['day'].unique())}")
    print(f"  Trip range      : {od['trips'].min():.3f} – {od['trips'].max():.3f}")
    print(f"  OD zones        : {len(od_zones):,}")
    print(f"  Shapefile zones : {len(shp_zones):,}")
    if missing:
        print(f"  WARNING: {len(missing)} OD zone IDs not in shapefile: {sorted(missing)[:20]}")
    else:
        print(f"  All OD zones matched shapefile zones.")
    print(f"  Saved -> {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")

    return sorted(od["day"].unique().tolist())


# ---------------------------------------------------------------------------
# dataset_config.json
# ---------------------------------------------------------------------------

def write_dataset_config(
    base_col: str,
    base_name: str,
    level_meta: list[dict],
    days: list[str],
    bbox: list[float],
    output_dir: Path,
) -> None:
    levels = [{"id": base_col, "name": base_name, "file": "zones.parquet"}] + level_meta
    config = {
        "base_level": base_col,
        "levels": levels,
        "days": days,
        "bbox": bbox,
    }
    out = output_dir / "dataset_config.json"
    out.write_text(json.dumps(config, ensure_ascii=False, indent=2))
    print(f"\nWrote dataset_config.json -> {out}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generic OD data ingestion")
    parser.add_argument("--config", required=True, help="Path to dataset.yaml config file")
    args = parser.parse_args()

    cfg = load_config(Path(args.config))

    output_dir = Path(cfg["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    shp_cfg = cfg["shapefile"]
    base_col = shp_cfg["base_zone_col"]
    base_name = shp_cfg.get("base_name", base_col)
    agg_levels = shp_cfg.get("aggregation_levels", [])

    # Step 1: zones.parquet
    gdf = load_zones(cfg)
    zones_path = output_dir / "zones.parquet"
    gdf.to_parquet(zones_path)
    print(f"Saved zones.parquet -> {zones_path} ({zones_path.stat().st_size / 1e6:.1f} MB)")

    # Compute bbox from all zone geometries
    bounds = gdf.geometry.total_bounds  # [minx, miny, maxx, maxy]
    bbox = [round(float(bounds[0]), 6), round(float(bounds[1]), 6),
            round(float(bounds[2]), 6), round(float(bounds[3]), 6)]

    # Step 2: aggregated zone parquets
    print("\nBuilding aggregated zone parquets...")
    level_meta = build_aggregated_parquets(gdf, agg_levels, output_dir)

    # Step 3: od_matrix.parquet
    print("\nBuilding od_matrix.parquet...")
    shp_zones = set(gdf[base_col].unique())
    days = build_od_matrix(cfg, shp_zones, output_dir)

    # Step 4: dataset_config.json
    write_dataset_config(base_col, base_name, level_meta, days, bbox, output_dir)


if __name__ == "__main__":
    main()
