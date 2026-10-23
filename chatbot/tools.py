"""Abstracted LangChain tools for ArcGIS DRP / GRIP electric distribution APIs.

Optimized for ultra-low latency, robust error handling, and relaxed parameter types
to prevent Pydantic validation failures from LLM calls passing None or unexpected types.
"""

import json
from typing import Any, Dict, List, Optional, Union
from langchain_core.tools import tool
from .arcgis_service import arcgis_service


def escape_sql(val: Any) -> str:
    """Escape single quotes for ArcGIS SQL WHERE clauses."""
    return str(val).replace("'", "''")


def to_str(val: Any) -> str:
    """Safely convert any value to string, stripping whitespace and treating None as empty string."""
    if val is None:
        return ""
    return str(val).strip()


def to_int(val: Any, default: int = 5) -> int:
    """Safely convert any value to int with fallback default."""
    if val is None or val == "":
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def to_float(val: Any) -> Optional[float]:
    """Safely convert any value to float or return None."""
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


@tool
def search_substations(
    name: Optional[str] = None,
    substation_id: Optional[str] = None,
    division: Optional[str] = None,
    min_existing_dg_kw: Optional[Union[float, int, str]] = None,
    limit: Optional[Union[int, str]] = 5,
) -> str:
    """Search electric distribution substations by name, ID, division, or existing DG (kW).
    
    Args:
        name: Substation name or partial name (e.g. 'MISSION', 'OAKLAND').
        substation_id: Substation ID string (e.g. '02201').
        division: Geographic division (e.g. 'San Francisco', 'East Bay', 'Peninsula').
        min_existing_dg_kw: Minimum installed distributed generation capacity in kW.
        limit: Max results to return (default: 5).
    """
    clean_name = to_str(name)
    clean_id = to_str(substation_id)
    clean_div = to_str(division)
    min_dg = to_float(min_existing_dg_kw)
    lim = to_int(limit, default=5)

    conditions = []
    if clean_name:
        conditions.append(f"(UPPER(SubstationName) LIKE UPPER('%{escape_sql(clean_name)}%'))")
    if clean_id:
        conditions.append(f"(SubstationID = '{escape_sql(clean_id)}')")
    if clean_div:
        conditions.append(f"(UPPER(Division) LIKE UPPER('%{escape_sql(clean_div)}%'))")
    if min_dg is not None:
        conditions.append(f"(Existing_DG >= {min_dg})")

    where = " AND ".join(conditions) if conditions else "1=1"
    res = arcgis_service.query(
        layer=0,
        where=where,
        out_fields="OBJECTID,SubstationName,SubstationID,Division,Voltage_kV,NUMBANKS,UNGROUNDEDBANKS,Existing_DG,Queued_DG,Total_DG",
        limit=lim,
        order_by="SubstationName ASC",
        return_geometry=True,
    )

    features = res.get("features", [])
    if not features:
        return f"No substations found matching criteria: {where}"

    output = []
    for f in features:
        attrs = f.get("attributes", {})
        geom = f.get("geometry", {})
        output.append({
            "name": attrs.get("SubstationName"),
            "id": attrs.get("SubstationID"),
            "division": attrs.get("Division"),
            "voltage_kv": attrs.get("Voltage_kV"),
            "num_banks": attrs.get("NUMBANKS"),
            "existing_dg_kw": attrs.get("Existing_DG"),
            "queued_dg_kw": attrs.get("Queued_DG"),
            "total_dg_kw": attrs.get("Total_DG"),
            "coordinates": {"lat": geom.get("y"), "lon": geom.get("x")},
        })
    return json.dumps({"count": len(output), "substations": output}, indent=2)


@tool
def search_feeders(
    feeder_id: Optional[str] = None,
    feeder_name: Optional[str] = None,
    substation_name: Optional[str] = None,
    division: Optional[str] = None,
    limit: Optional[Union[int, str]] = 5,
) -> str:
    """Search distribution feeders/circuits by ID, name, parent substation, or division.
    
    Args:
        feeder_id: Feeder ID string (e.g. '022390402').
        feeder_name: Feeder name or partial name (e.g. '0402').
        substation_name: Parent substation name.
        division: Operating division.
        limit: Max results (default: 5).
    """
    clean_feeder = to_str(feeder_id)
    clean_name = to_str(feeder_name)
    clean_sub = to_str(substation_name)
    clean_div = to_str(division)
    lim = to_int(limit, default=5)

    conditions = []
    if clean_feeder:
        conditions.append(f"(FeederID LIKE '%{escape_sql(clean_feeder)}%')")
    if clean_name:
        conditions.append(f"(Feeder_Name LIKE '%{escape_sql(clean_name)}%')")
    if clean_sub:
        conditions.append(f"(UPPER(Substation) LIKE UPPER('%{escape_sql(clean_sub)}%'))")
    if clean_div:
        conditions.append(f"(UPPER(Division) LIKE UPPER('%{escape_sql(clean_div)}%'))")

    where = " AND ".join(conditions) if conditions else "1=1"
    res = arcgis_service.query(
        layer=2,
        where=where,
        out_fields="OBJECTID,FeederID,Feeder_Name,Substation,Nominal_Voltage,ResCust,ComCust,IndCust,AgrCust,OthCust,Existing_DG,Queued_DG,Total_DG,Division",
        limit=lim,
        order_by="FeederID ASC",
        return_geometry=False,  # Skip heavy polyline geometries for instant response
    )

    features = res.get("features", [])
    if not features:
        return f"No feeders found matching criteria: {where}"

    output = []
    for f in features:
        a = f.get("attributes", {})
        res_c = a.get("ResCust") or 0
        com_c = a.get("ComCust") or 0
        ind_c = a.get("IndCust") or 0
        agr_c = a.get("AgrCust") or 0
        oth_c = a.get("OthCust") or 0
        total_c = res_c + com_c + ind_c + agr_c + oth_c
        output.append({
            "feeder_id": a.get("FeederID"),
            "feeder_name": a.get("Feeder_Name"),
            "substation": a.get("Substation"),
            "voltage": a.get("Nominal_Voltage"),
            "customers": {
                "residential": res_c,
                "commercial": com_c,
                "industrial": ind_c,
                "agricultural": agr_c,
                "other": oth_c,
                "total": total_c,
            },
            "dg_kw": {
                "existing": a.get("Existing_DG"),
                "queued": a.get("Queued_DG"),
                "total": a.get("Total_DG"),
            },
            "division": a.get("Division"),
        })
    return json.dumps({"count": len(output), "feeders": output}, indent=2)


@tool
def check_ica_hosting_capacity(
    feeder_id: Optional[Union[str, int]] = None,
    line_section: Optional[Union[str, int]] = None,
    min_gen_capacity_kw: Optional[Union[float, int, str]] = None,
    limit: Optional[Union[int, str]] = 5,
) -> str:
    """Check Integration Capacity Analysis (ICA) hosting capacity for line sections (load capacity kW, gen capacity kW, Screen L status).
    
    Args:
        feeder_id: Feeder ID (e.g. '022390402').
        line_section: CSV line section identifier.
        min_gen_capacity_kw: Minimum generation hosting capacity (kW).
        limit: Max line sections to return.
    """
    clean_feeder = to_str(feeder_id)
    clean_section = to_str(line_section)
    min_gen = to_float(min_gen_capacity_kw)
    lim = to_int(limit, default=5)

    conditions = []
    if clean_feeder:
        conditions.append(f"(FeederId = '{escape_sql(clean_feeder)}')")
    if clean_section:
        conditions.append(f"(CSV_LineSection = '{escape_sql(clean_section)}')")
    if min_gen is not None:
        conditions.append(f"(GenCapacity_kW >= {min_gen})")

    where = " AND ".join(conditions) if conditions else "1=1"
    res = arcgis_service.query(
        layer=3,
        where=where,
        out_fields="FeederId,FeederName,CSV_LineSection,LoadCapacity_kW,GenCapacity_kW,GenericPVCapacity_kW,ScreenL,phase_cnt,limiting_criteria,ICA_Analysis_Date",
        limit=lim,
        order_by="GenCapacity_kW DESC",
        return_geometry=False,  # Skip polyline geometry for fast response
    )

    features = res.get("features", [])
    if not features and clean_feeder:
        # Check if listed in Layer 4 (ICA Not Available)
        unavail = arcgis_service.query(
            layer=4,
            where=f"feeder_id = '{escape_sql(clean_feeder)}'",
            out_fields="feeder_id,numberofphases,division",
            limit=1,
            return_geometry=False,
        )
        if unavail.get("features"):
            return json.dumps({
                "status": "ICA_UNAVAILABLE",
                "message": f"Feeder {clean_feeder} is explicitly listed in Layer 4 (ICA Not Available). Hosting capacity calculations are not published for this circuit.",
            }, indent=2)
        return f"No ICA line sections found for query: {where}"

    sections = []
    for f in features:
        a = f.get("attributes", {})
        sections.append({
            "feeder_id": a.get("FeederId"),
            "section": a.get("CSV_LineSection"),
            "load_capacity_kw": a.get("LoadCapacity_kW"),
            "gen_capacity_kw": a.get("GenCapacity_kW"),
            "pv_capacity_kw": a.get("GenericPVCapacity_kW"),
            "screen_l": a.get("ScreenL"),
            "phases": a.get("phase_cnt"),
            "limiting_criteria": a.get("limiting_criteria"),
            "analysis_date": a.get("ICA_Analysis_Date"),
        })
    return json.dumps({"status": "AVAILABLE", "count": len(sections), "sections": sections}, indent=2)


@tool
def get_load_profile_summary(
    target_type: Optional[str] = "feeder",
    target_id: Optional[Union[str, int]] = None,
    month: Optional[Union[str, int]] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[Union[str, int]] = None,
) -> str:
    """Retrieve 8760 hourly load profiles and summary metrics (peak high, minimum low, averages) for a Feeder or Substation.
    
    Args:
        target_type: 'feeder' or 'substation' (default: 'feeder').
        target_id: Feeder numeric ID (e.g. '22390402') or Substation ID/Name (e.g. 'SF X (MISSION)').
        month: Two-digit month string ('01' to '12') or month integer (1 to 12) for month-specific analysis.
    """
    # Handle aliases
    t_type = to_str(target_type or entity_type or "feeder").lower()
    t_id = to_str(target_id or entity_id)
    m_str = to_str(month)

    is_sub = "sub" in t_type
    table_id = 25 if is_sub else 23

    conditions = []
    if is_sub:
        if t_id.isdigit():
            conditions.append(f"(subid = {int(t_id)})")
        elif t_id:
            conditions.append(f"(UPPER(subname) LIKE UPPER('%{escape_sql(t_id)}%'))")
        if m_str:
            conditions.append(f"(monthhour LIKE '{m_str.zfill(2)}_%')")
        order_by = "monthhour ASC"
    else:
        clean_digits = "".join(filter(str.isdigit, t_id))
        if clean_digits:
            conditions.append(f"(FeederID = {int(clean_digits)})")
        if m_str:
            conditions.append(f"(MonthHour LIKE '{m_str.zfill(2)}_%')")
        order_by = "MonthHour ASC"

    where = " AND ".join(conditions) if conditions else "1=1"
    res = arcgis_service.query(
        layer=table_id,
        where=where,
        limit=24 if m_str else 288,
        order_by=order_by,
        return_geometry=False,
    )

    features = res.get("features", [])
    if not features:
        return f"No load profile data found for query: {where}"

    lows, highs = [], []
    for f in features:
        a = f.get("attributes", {})
        l = a.get("Low") if not is_sub else a.get("low")
        h = a.get("High") if not is_sub else a.get("high")
        if l is not None:
            lows.append(float(l))
        if h is not None:
            highs.append(float(h))

    units = "MW" if is_sub else "kW"
    summary = {
        "target_type": "substation" if is_sub else "feeder",
        "target_id": t_id,
        "month": m_str or "all",
        "record_count": len(features),
        "units": units,
        "peak_high": max(highs) if highs else None,
        "min_low": min(lows) if lows else None,
        "avg_high": round(sum(highs) / len(highs), 1) if highs else None,
        "avg_low": round(sum(lows) / len(lows), 1) if lows else None,
        "sample_points": [f.get("attributes") for f in features[:6]],
    }
    return json.dumps(summary, indent=2)


@tool
def check_fire_hazard_zone(
    longitude: Optional[Union[float, str]] = None,
    latitude: Optional[Union[float, str]] = None,
    tier: Optional[Union[int, str]] = None,
) -> str:
    """Check if a coordinate location falls inside a CPUC High Fire Threat District (Tier 2 or Tier 3).
    
    Args:
        longitude: WGS84 longitude (e.g. -122.4194).
        latitude: WGS84 latitude (e.g. 37.7749).
        tier: CPUC Tier level filter (2 or 3).
    """
    lon = to_float(longitude)
    lat = to_float(latitude)
    t_val = to_int(tier, default=0) if tier else None

    if lon is not None and lat is not None:
        res = arcgis_service.spatial_query(
            layer=18,
            longitude=lon,
            latitude=lat,
            distance_meters=100.0,
            out_fields="OBJECTID,hftd,cpuc_tier,cpuc_fire_map,data_source",
            limit=5,
        )
        features = res.get("features", [])
        if features:
            attrs = [f.get("attributes") for f in features]
            return json.dumps({
                "in_fire_threat_district": True,
                "coordinates": {"lat": lat, "lon": lon},
                "districts": attrs,
            }, indent=2)
        return json.dumps({
            "in_fire_threat_district": False,
            "coordinates": {"lat": lat, "lon": lon},
            "note": "Location is NOT within a CPUC Tier 2 or Tier 3 High Fire Threat District.",
        }, indent=2)

    where = f"cpuc_tier = {t_val}" if t_val else "1=1"
    res = arcgis_service.query(layer=18, where=where, limit=5, out_fields="OBJECTID,hftd,cpuc_tier,cpuc_fire_map", return_geometry=False)
    return json.dumps({
        "query_tier": t_val or "all",
        "districts": [f.get("attributes") for f in res.get("features", [])],
    }, indent=2)


@tool
def check_grid_deficiencies(
    substation_name: Optional[str] = None,
    circuit_name: Optional[str] = None,
    limit: Optional[Union[int, str]] = 5,
) -> str:
    """Query Grid Needs Assessment (GNA) facility deficiencies (overload MW/%) and LNBA planned investments.
    
    Args:
        substation_name: Substation name pattern.
        circuit_name: Circuit name pattern.
        limit: Max records (default: 5).
    """
    clean_sub = to_str(substation_name)
    clean_circuit = to_str(circuit_name)
    lim = to_int(limit, default=5)

    conditions = []
    if clean_sub:
        conditions.append(f"(UPPER(substationname) LIKE UPPER('%{escape_sql(clean_sub)}%'))")
    if clean_circuit:
        conditions.append(f"(UPPER(circuitname) LIKE UPPER('%{escape_sql(clean_circuit)}%'))")

    where = " AND ".join(conditions) if conditions else "1=1"
    gna_res = arcgis_service.query(
        layer=28,
        where=where,
        limit=lim,
        return_geometry=False,
    )
    
    lnba_where = f"UPPER(substationid) LIKE UPPER('%{escape_sql(clean_sub)}%')" if clean_sub else "1=1"
    lnba_res = arcgis_service.query(
        layer=29,
        where=lnba_where,
        limit=lim,
        out_fields="projectname,projecttype,distributionservicerequired,lnbadollarsperunitperyr,deferrableyesorno",
        return_geometry=False,
    )

    return json.dumps({
        "deficiencies_count": len(gna_res.get("features", [])),
        "deficiencies": [f.get("attributes") for f in gna_res.get("features", [])],
        "planned_investments_lnba": [f.get("attributes") for f in lnba_res.get("features", [])],
    }, indent=2)


@tool
def query_layer_direct(
    layer: Optional[Union[str, int]] = 0,
    where: Optional[str] = "1=1",
    out_fields: Optional[str] = "*",
    limit: Optional[Union[int, str]] = 10,
) -> str:
    """Direct SQL attribute query for any layer or table in the ArcGIS FeatureServer catalog.
    
    Args:
        layer: Layer name or ID (e.g. 'TransmissionLines', 'KnownLoad', 'Climate_Zone', 0, 2, 5, 19).
        where: SQL WHERE clause (default '1=1').
        out_fields: Comma-separated field names (default '*').
        limit: Maximum records to return.
    """
    target_layer = layer if layer is not None else 0
    w_clause = to_str(where) or "1=1"
    fields = to_str(out_fields) or "*"
    lim = to_int(limit, default=10)

    # Security check: Block SQL injection / destructive statements in WHERE clause
    upper_w = w_clause.upper()
    dangerous_keywords = ["DROP ", "DELETE ", "UPDATE ", "INSERT ", "EXEC ", "TRUNCATE ", "ALTER ", "--", ";", "XP_"]
    for kw in dangerous_keywords:
        if kw in upper_w:
            return json.dumps({
                "error": f"Security validation failed: SQL keyword or pattern '{kw.strip()}' is disallowed in read-only queries."
            }, indent=2)

    res = arcgis_service.query(
        layer=target_layer,
        where=w_clause,
        out_fields=fields,
        limit=lim,
        return_geometry=False,
    )
    features = res.get("features", [])
    records = [f.get("attributes") for f in features]
    return json.dumps({
        "layer": target_layer,
        "count": len(records),
        "records": records,
    }, indent=2)


ARCGIS_TOOLS = [
    search_substations,
    search_feeders,
    check_ica_hosting_capacity,
    get_load_profile_summary,
    check_fire_hazard_zone,
    check_grid_deficiencies,
    query_layer_direct,
]
