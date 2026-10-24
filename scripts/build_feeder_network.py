"""Build the statewide feeder network GeoJSON used by the /planner map.

Data sources (PG&E DRPComplianceRelProd FeatureServer):
  * Layer 2 (FeederDetail)  -> one generalized polyline per feeder (~3.3k features)
  * Layer 3 (LineDetail/ICA) -> server-side per-feeder min/max of LoadCapacity_kW and
                                GenCapacity_kW via outStatistics + groupBy (no 2M-row download)

Output: static/data/feeder_network.geojson with properties
  fid, name, sub, kv, div, load_min_mw, load_max_mw, gen_min_mw, gen_max_mw, sections

Usage:  .venv/bin/python scripts/build_feeder_network.py [--tolerance 0.0002]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import httpx

BASE = "https://services2.arcgis.com/mJaJSax0KPHoCNB6/ArcGIS/rest/services/DRPComplianceRelProd/FeatureServer"
OUT = Path(__file__).resolve().parent.parent / "static" / "data" / "feeder_network.geojson"
PAGE = 2000

client = httpx.Client(verify=False, timeout=120.0)


def _get(layer: int, params: Dict[str, Any]) -> Dict[str, Any]:
    for attempt in range(4):
        try:
            r = client.get(f"{BASE}/{layer}/query", params={**params, "f": "json"})
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(data["error"])
            return data
        except Exception as exc:  # noqa: BLE001
            if attempt == 3:
                raise
            wait = 2 ** attempt
            print(f"  retry in {wait}s ({exc})", file=sys.stderr)
            time.sleep(wait)
    return {}


def fetch_feeder_geometry(tolerance: float) -> List[Dict[str, Any]]:
    feats: List[Dict[str, Any]] = []
    offset = 0
    while True:
        data = _get(2, {
            "where": "1=1",
            "outFields": "FeederID,Feeder_Name,Substation,Nominal_Voltage,Division",
            "returnGeometry": "true",
            "outSR": 4326,
            "maxAllowableOffset": tolerance,
            "geometryPrecision": 5,
            "orderByFields": "OBJECTID",
            "resultOffset": offset,
            "resultRecordCount": PAGE,
        })
        batch = data.get("features", [])
        feats.extend(batch)
        print(f"  layer 2: {len(feats)} feeders")
        if not data.get("exceededTransferLimit") or not batch:
            break
        offset += len(batch)
    return feats


def fetch_capacity_stats() -> Dict[str, Dict[str, Any]]:
    stats_def = json.dumps([
        {"statisticType": "min", "onStatisticField": "LoadCapacity_kW", "outStatisticFieldName": "load_min"},
        {"statisticType": "max", "onStatisticField": "LoadCapacity_kW", "outStatisticFieldName": "load_max"},
        {"statisticType": "min", "onStatisticField": "GenCapacity_kW", "outStatisticFieldName": "gen_min"},
        {"statisticType": "max", "onStatisticField": "GenCapacity_kW", "outStatisticFieldName": "gen_max"},
        {"statisticType": "count", "onStatisticField": "OBJECTID", "outStatisticFieldName": "n"},
    ])
    out: Dict[str, Dict[str, Any]] = {}
    offset = 0
    while True:
        data = _get(3, {
            "where": "1=1",
            "outStatistics": stats_def,
            "groupByFieldsForStatistics": "FeederId",
            "orderByFields": "FeederId",
            "resultOffset": offset,
            "resultRecordCount": PAGE,
        })
        batch = data.get("features", [])
        for f in batch:
            a = f["attributes"]
            out[str(a["FeederId"]).strip()] = a
        print(f"  layer 3 stats: {len(out)} feeders")
        if not data.get("exceededTransferLimit") or not batch:
            break
        offset += len(batch)
    return out


def kw_to_mw(v: Any) -> Any:
    return None if v is None else round(float(v) / 1000.0, 3)


def norm_id(fid: Any) -> str:
    return str(fid or "").strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tolerance", type=float, default=0.0002, help="generalization in degrees (~20 m)")
    args = ap.parse_args()

    t0 = time.time()
    print("Fetching feeder geometry (layer 2)...")
    geoms = fetch_feeder_geometry(args.tolerance)
    print("Fetching per-feeder ICA statistics (layer 3)...")
    stats = fetch_capacity_stats()

    # Layer 2 IDs are sometimes missing the leading zero used in layer 3 (and vice versa)
    stats_lookup = dict(stats)
    for k, v in stats.items():
        stats_lookup.setdefault(k.lstrip("0"), v)

    features = []
    matched = 0
    for f in geoms:
        paths = (f.get("geometry") or {}).get("paths") or []
        if not paths:
            continue
        a = f["attributes"]
        fid = norm_id(a.get("FeederID"))
        s = stats_lookup.get(fid) or stats_lookup.get(fid.lstrip("0")) or {}
        if s:
            matched += 1
        features.append({
            "type": "Feature",
            "id": len(features),
            "geometry": {"type": "MultiLineString", "coordinates": paths},
            "properties": {
                "fid": fid,
                "name": a.get("Feeder_Name") or fid,
                "sub": a.get("Substation"),
                "kv": a.get("Nominal_Voltage"),
                "div": a.get("Division"),
                "load_min_mw": kw_to_mw(s.get("load_min")),
                "load_max_mw": kw_to_mw(s.get("load_max")),
                "gen_min_mw": kw_to_mw(s.get("gen_min")),
                "gen_max_mw": kw_to_mw(s.get("gen_max")),
                "sections": s.get("n", 0),
            },
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    size_mb = OUT.stat().st_size / 1e6
    print(f"Wrote {len(features)} feeders ({matched} with ICA stats) -> {OUT} [{size_mb:.1f} MB] in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
