"""
Data ingestion script: raw shapefiles + OD CSVs -> GeoParquet + od_matrix.parquet

Usage:
  python scripts/ingest.py \
    --shapefile  <path/to/1270_zones.shp> \
    --zone-data  <path/to/zone_data.xlsx> \
    --weekday    <path/to/weekday.csv> \
    --friday     <path/to/friday.csv> \
    --saturday   <path/to/saturday.csv> \
    --output-dir <output_directory>
"""
import argparse
import sys
import warnings
from pathlib import Path

import geopandas as gpd
import pandas as pd


def load_zones(shapefile: Path, zone_data: Path) -> gpd.GeoDataFrame:
    print(f"Loading shapefile: {shapefile}")
    gdf = gpd.read_file(shapefile, encoding="iso-8859-8")

    keep = ["TAZ_1270", "TAZ_250", "TAZ_33", "TAZ_15", "CITY", "geometry"]
    missing = [c for c in keep[:-1] if c not in gdf.columns]
    if missing:
        sys.exit(f"ERROR: Shapefile missing expected columns: {missing}. Found: {list(gdf.columns)}")

    gdf = gdf[keep].copy()
    gdf = gdf.to_crs("EPSG:4326")
    gdf["CITY"] = gdf["CITY"].str.strip()

    for col in ["TAZ_1270", "TAZ_250", "TAZ_33", "TAZ_15"]:
        gdf[col] = gdf[col].astype(str)

    print(f"  {len(gdf)} zones loaded, CRS reprojected to EPSG:4326")

    # --- Main sheet: TAZ_1270 zone names ---
    print(f"Loading zone metadata: {zone_data}")
    zd = pd.read_excel(zone_data, usecols=[0, 1, 2, 3, 6], header=0, skiprows=[1])
    zd.columns = ["TAZ_1270", "TAZ_250", "TAZ_33", "TAZ_15", "zone_name"]
    zd["TAZ_1270"] = zd["TAZ_1270"].astype(str)
    gdf = gdf.merge(zd[["TAZ_1270", "zone_name"]], on="TAZ_1270", how="left")
    missing_names = gdf["zone_name"].isna().sum()
    if missing_names:
        print(f"  WARNING: {missing_names} zones have no zone_name in zone_data.xlsx")

    # --- Additional sheets: aggregated level names ---
    xl = pd.ExcelFile(zone_data)
    for level_suffix, group_col in [("250", "TAZ_250"), ("33", "TAZ_33"), ("15", "TAZ_15")]:
        if level_suffix in xl.sheet_names:
            sheet = pd.read_excel(zone_data, sheet_name=level_suffix)
            sheet.columns = [str(c).strip() for c in sheet.columns]
            id_cols = [c for c in sheet.columns if c.upper() != "NAME"]
            if not id_cols or "NAME" not in sheet.columns:
                print(f"  WARNING: sheet '{level_suffix}' missing expected columns; falling back to numeric ID")
                gdf[f"name_{level_suffix}"] = gdf[group_col]
                continue
            id_col = id_cols[0]
            name_col = f"name_{level_suffix}"
            sheet = sheet[[id_col, "NAME"]].rename(columns={id_col: group_col, "NAME": name_col})
            sheet = sheet.dropna(subset=[group_col])  # drop NaN sub-header row
            # Normalize IDs: float-stored integers (300001.0) → '300001'
            numeric = pd.to_numeric(sheet[group_col], errors="coerce")
            if numeric.notna().all():
                sheet[group_col] = numeric.astype(int).astype(str)
            else:
                sheet[group_col] = sheet[group_col].astype(str)
            sheet = sheet.drop_duplicates(subset=group_col)
            gdf = gdf.merge(sheet, on=group_col, how="left")
            print(f"  Loaded {len(sheet)} names from sheet '{level_suffix}'")
        else:
            print(f"  Sheet '{level_suffix}' not found in zone_data.xlsx; using numeric ID as label")
            gdf[f"name_{level_suffix}"] = gdf[group_col]

    # Centroids — compute in projected CRS for accuracy, extract degrees
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        centroids = gdf.geometry.centroid
    gdf["centroid_lat"] = centroids.y
    gdf["centroid_lon"] = centroids.x

    return gdf


def build_aggregated_parquets(gdf: gpd.GeoDataFrame, output_dir: Path) -> None:
    levels = [
        ("250",  "TAZ_250", "name_250"),
        ("33",   "TAZ_33",  "name_33"),
        ("15",   "TAZ_15",  "name_15"),
        ("city", "CITY",    "CITY"),
    ]
    for suffix, group_col, label_col in levels:
        print(f"  Dissolving zones for level {suffix} ...")
        # Deduplicate columns (CITY level: group_col == label_col)
        sel_cols = list(dict.fromkeys(["geometry", group_col, label_col]))
        dissolved = gdf[sel_cols].dissolve(by=group_col, as_index=False)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            c = dissolved.geometry.centroid
        dissolved["centroid_lat"] = c.y
        dissolved["centroid_lon"] = c.x
        dissolved = dissolved.rename(columns={group_col: "group_id"})
        if label_col == group_col:
            dissolved["label"] = dissolved["group_id"]
        else:
            dissolved = dissolved.rename(columns={label_col: "label"})
        out = dissolved[["group_id", "label", "centroid_lat", "centroid_lon", "geometry"]]
        out_path = output_dir / f"zones_{suffix}.parquet"
        out.to_parquet(out_path)
        print(f"    Saved {len(out)} groups -> {out_path}")


def build_od_matrix(weekday: Path, friday: Path, saturday: Path,
                    shp_zones: set, output_dir: Path) -> None:
    HOUR_COLS = [f"h{i}" for i in range(24)]
    dfs = []

    for day, path in [("weekday", weekday), ("friday", friday), ("saturday", saturday)]:
        print(f"  Processing {day}: {path}")
        df = pd.read_csv(path)
        df.columns = [c.lower() for c in df.columns]

        if "fromzone" not in df.columns or "tozone" not in df.columns:
            sys.exit(f"ERROR: {path} missing fromZone/ToZone columns. Found: {list(df.columns)}")
        missing_hours = [h for h in HOUR_COLS if h not in df.columns]
        if missing_hours:
            sys.exit(f"ERROR: {path} missing hour columns: {missing_hours}")

        df = df.rename(columns={"fromzone": "from_zone", "tozone": "to_zone"})
        df["from_zone"] = df["from_zone"].astype(str)
        df["to_zone"]   = df["to_zone"].astype(str)

        df_long = df.melt(
            id_vars=["from_zone", "to_zone"],
            value_vars=HOUR_COLS,
            var_name="hour_str",
            value_name="trips",
        )
        df_long["hour"] = df_long["hour_str"].str[1:].astype(int)
        df_long["day"] = day
        df_long = df_long[df_long["trips"] > 0][["from_zone", "to_zone", "day", "hour", "trips"]]
        print(f"    {len(df_long):,} rows after zero-filter")
        dfs.append(df_long)

    od = pd.concat(dfs, ignore_index=True)
    out_path = output_dir / "od_matrix.parquet"
    od.to_parquet(out_path, index=False)

    # Summary
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


def main():
    parser = argparse.ArgumentParser(description="Ingest OD matrix data to Parquet")
    parser.add_argument("--shapefile",  required=True)
    parser.add_argument("--zone-data",  required=True)
    parser.add_argument("--weekday",    required=True)
    parser.add_argument("--friday",     required=True)
    parser.add_argument("--saturday",   required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: zones.parquet
    gdf = load_zones(Path(args.shapefile), Path(args.zone_data))
    zones_path = output_dir / "zones.parquet"
    gdf.to_parquet(zones_path)
    print(f"Saved zones.parquet -> {zones_path} ({zones_path.stat().st_size / 1e6:.1f} MB)")

    # Step 2: aggregated zone parquets
    print("\nBuilding aggregated zone parquets...")
    build_aggregated_parquets(gdf, output_dir)

    # Step 3: od_matrix.parquet
    print("\nBuilding od_matrix.parquet...")
    shp_zones = set(gdf["TAZ_1270"].unique())
    build_od_matrix(
        Path(args.weekday), Path(args.friday), Path(args.saturday),
        shp_zones, output_dir,
    )


if __name__ == "__main__":
    main()
