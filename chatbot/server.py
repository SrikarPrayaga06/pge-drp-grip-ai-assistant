"""FastAPI Web Server for ArcGIS DRP Chatbot and Functionality Verification Suite."""

import asyncio
import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .agent import ArcGISChatbot, WORKFLOW_SKILLS
from .arcgis_service import arcgis_service
from .tools import (
    search_substations,
    search_feeders,
    check_ica_hosting_capacity,
    get_load_profile_summary,
    check_fire_hazard_zone,
    check_grid_deficiencies,
    query_layer_direct,
)

load_dotenv()

app = FastAPI(
    title="PG&E DRP Grid Planning Chatbot API",
    description="Conversational AI & Verification Suite for PG&E ArcGIS DRP Compliance Data",
    version="1.0.0",
)

# Enable CORS for local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Enable automatic gzip compression for responses >= 1KB
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Shared chatbot instance
chatbot_instance: Optional[ArcGISChatbot] = None


def get_chatbot() -> ArcGISChatbot:
    global chatbot_instance
    if chatbot_instance is None:
        chatbot_instance = ArcGISChatbot()
    return chatbot_instance


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"
    workflow: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    model: str
    last_used_model: Optional[str] = None


@app.get("/api/health")
async def health_check():
    """Verify system status, LLM engine, and ArcGIS FeatureServer connectivity."""
    bot = get_chatbot()
    client = arcgis_service

    fs_status = "unreachable"
    service_info = {}
    try:
        data = await asyncio.to_thread(client.get_service_metadata)
        if "layers" in data:
            fs_status = "connected"
            service_info = {
                "name": data.get("serviceDescription", "PG&E DRP Compliance FeatureServer"),
                "layer_count": len(data.get("layers", [])),
                "table_count": len(data.get("tables", [])),
            }
    except Exception as e:
        fs_status = f"error: {str(e)}"

    return {
        "status": "healthy",
        "featureserver_status": fs_status,
        "featureserver_info": service_info,
        "active_model": bot.active_model,
        "last_used_model": bot.last_used_model,
        "model_rotation_pool": bot.get_model_pool_status(),
        "database": str(bot.db_path),
        "total_tools": 7,
    }


@app.get("/api/models")
async def get_models():
    """Return model rotation pool status and active engine."""
    bot = get_chatbot()
    return bot.get_model_pool_status()


@app.post("/api/models/rotate")
async def rotate_model_endpoint():
    """Manually rotate active model to next available candidate in the pool."""
    bot = get_chatbot()
    new_active = bot.rotate_model()
    return {
        "message": f"Successfully rotated active model to {new_active}",
        "active_model": new_active,
        "status": bot.get_model_pool_status(),
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """Send user prompt to chatbot with persistent session thread and automatic model rotation on rate limits."""
    if not request.message or not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    bot = get_chatbot()
    session_id = request.session_id.strip() if request.session_id else "default"

    try:
        reply = await asyncio.to_thread(bot.chat, request.message, session_id=session_id, workflow=request.workflow)
        return ChatResponse(
            reply=reply,
            session_id=session_id,
            model=bot.active_model,
            last_used_model=bot.last_used_model,
        )
    except Exception as e:
        logger.error(f"Agent chat error: {e}")
        return ChatResponse(
            reply=f"Notice: The grid analysis encountered a query error: {str(e)}. Please try rephrasing with specific circuit or substation names.",
            session_id=session_id,
            model=bot.active_model,
            last_used_model=bot.last_used_model,
        )


@app.post("/api/chat/stream")
async def chat_stream_endpoint(request: ChatRequest):
    """Stream response tokens and live tool status events using Server-Sent Events (SSE)."""
    if not request.message or not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    bot = get_chatbot()
    session_id = request.session_id.strip() if request.session_id else "default"

    async def event_generator():
        q: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def run_stream():
            try:
                for event in bot.chat_stream(request.message, session_id=session_id, workflow=request.workflow):
                    loop.call_soon_threadsafe(q.put_nowait, event)
            except Exception as e:
                loop.call_soon_threadsafe(q.put_nowait, {"type": "error", "error": str(e)})
            finally:
                loop.call_soon_threadsafe(q.put_nowait, None)

        threading.Thread(target=run_stream, daemon=True).start()

        while True:
            item = await q.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/workflows")
async def get_workflows_endpoint():
    """Return available specialized workflow skills with titles, descriptions, and personas."""
    return {"workflows": WORKFLOW_SKILLS}


@app.get("/api/history/{session_id}")
async def get_history_endpoint(session_id: str):
    """Retrieve full conversation history for a session."""
    bot = get_chatbot()
    history = bot.get_history(session_id=session_id)
    return {
        "session_id": session_id,
        "count": len(history),
        "messages": history,
    }


@app.delete("/api/history/{session_id}")
async def delete_history_endpoint(session_id: str):
    """Clear conversation history for a given session."""
    bot = get_chatbot()
    bot.clear_history(session_id=session_id)
    return {"status": "ok", "session_id": session_id, "message": "History cleared."}


@app.get("/api/sessions")
async def get_sessions_endpoint():
    """List all persisted session IDs."""
    bot = get_chatbot()
    sessions = bot.list_sessions()
    return {"sessions": sessions}


@app.post("/api/sessions")
async def create_session_endpoint(payload: Dict[str, Any]):
    """Register or initialize a new session ID in SQLite."""
    session_id = payload.get("session_id", "default")
    title = payload.get("title", session_id)
    bot = get_chatbot()
    res = bot.create_session(session_id=session_id, title=title)
    return {"status": "ok", "session_id": res["session_id"], "title": res["title"]}


VERIFICATION_TESTS = [
    {
        "id": "substations",
        "name": "Substations Search (Layer 8)",
        "description": "Searches substations by name filter ('MISSION') and verifies SubstationID & Existing DG.",
        "tool_func": lambda: search_substations.invoke({"name": "MISSION"}),
        "validator": lambda res: (
            isinstance(res, dict) and "substations" in res and len(res["substations"]) > 0,
            lambda res: f"Found {len(res.get('substations', []))} substation(s): {res['substations'][0].get('name')} (ID: {res['substations'][0].get('substation_id')})",
        ),
    },
    {
        "id": "feeders",
        "name": "Feeder Demographics (Layer 2)",
        "description": "Looks up circuit '022390402' and calculates residential, commercial & total customer counts.",
        "tool_func": lambda: search_feeders.invoke({"feeder_id": "022390402"}),
        "validator": lambda res: (
            isinstance(res, dict) and "feeders" in res and len(res["feeders"]) > 0,
            lambda res: f"Feeder {res['feeders'][0].get('feeder_id')} has {res['feeders'][0].get('total_customers')} customers (Res: {res['feeders'][0].get('res_customers')}, Com: {res['feeders'][0].get('com_customers')})",
        ),
    },
    {
        "id": "ica",
        "name": "ICA Hosting Capacity (Layer 14)",
        "description": "Inspects line sections on feeder '022390402' for load & solar generation headroom (kW) and Screen L status.",
        "tool_func": lambda: check_ica_hosting_capacity.invoke({"feeder_id": "022390402"}),
        "validator": lambda res: (
            isinstance(res, dict) and "sections" in res and len(res["sections"]) > 0,
            lambda res: f"Inspected {len(res.get('sections', []))} section(s). First section has {res['sections'][0].get('load_capacity_kw')} kW load headroom.",
        ),
    },
    {
        "id": "load_profile",
        "name": "8760 Hourly Load Profiles (Layer 18)",
        "description": "Fetches 24-hour load consumption profile for July on feeder '22390402' and computes peak & average kW.",
        "tool_func": lambda: get_load_profile_summary.invoke({"target_type": "feeder", "target_id": "22390402", "month": "07"}),
        "validator": lambda res: (
            isinstance(res, dict) and "peak_high" in res,
            lambda res: f"July Peak: {res.get('peak_high')} kW, Avg: {res.get('avg_high')} kW across {res.get('record_count')} hourly timesteps.",
        ),
    },
    {
        "id": "fire_threat",
        "name": "CPUC Fire Hazard Zone (Layer 22)",
        "description": "Performs spatial point-in-polygon query for downtown San Francisco coordinates (-122.4194, 37.7749).",
        "tool_func": lambda: check_fire_hazard_zone.invoke({"longitude": -122.4194, "latitude": 37.7749}),
        "validator": lambda res: (
            isinstance(res, dict) and "in_fire_threat_district" in res,
            lambda res: f"Coordinates verified: High Fire Threat District = {res.get('in_fire_threat_district')} ({res.get('tier_details') or res.get('note')}).",
        ),
    },
    {
        "id": "grid_deficiencies",
        "name": "Grid Needs Assessment (Layers 20 & 21)",
        "description": "Retrieves planned grid deficiencies and Locational Net Benefits Analysis (LNBA) candidate deferrals.",
        "tool_func": lambda: check_grid_deficiencies.invoke({"limit": 5}),
        "validator": lambda res: (
            isinstance(res, dict) and "deficiencies" in res,
            lambda res: f"Retrieved {len(res.get('deficiencies', []))} projected deficiency record(s) with overload percentages.",
        ),
    },
]


async def run_single_check(test_meta: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    status = "failed"
    summary = "No response"
    data = None
    error = None

    try:
        raw_result = await asyncio.to_thread(test_meta["tool_func"])
        if isinstance(raw_result, str):
            try:
                data = json.loads(raw_result)
            except Exception:
                data = raw_result
        else:
            data = raw_result

        passed, summary_builder = test_meta["validator"](data)
        if passed:
            status = "passed"
            summary = summary_builder(data)
        else:
            status = "failed"
            summary = "Output failed validation schema check."
    except Exception as e:
        status = "failed"
        error = str(e)
        summary = f"Exception during execution: {error}"

    latency_ms = round((time.perf_counter() - t0) * 1000, 1)

    return {
        "id": test_meta["id"],
        "name": test_meta["name"],
        "description": test_meta["description"],
        "status": status,
        "latency_ms": latency_ms,
        "summary": summary,
        "error": error,
        "data": data,
    }


@app.post("/api/verify")
async def verify_all():
    """Run all verification tests across ArcGIS layers and return detailed diagnostics."""
    results = []
    for test in VERIFICATION_TESTS:
        res = await run_single_check(test)
        results.append(res)

    total_passed = sum(1 for r in results if r["status"] == "passed")
    return {
        "total": len(results),
        "passed": total_passed,
        "failed": len(results) - total_passed,
        "all_passed": total_passed == len(results),
        "results": results,
    }


@app.post("/api/verify/{check_id}")
async def verify_one(check_id: str):
    """Run a single verification check by ID."""
    match = next((t for t in VERIFICATION_TESTS if t["id"] == check_id), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Check '{check_id}' not found.")
    return await run_single_check(match)

# In-memory high-performance cache with TTL (1 hour)
_MAP_CACHE: Dict[str, Dict[str, Any]] = {}
_MAP_CACHE_TTL = 3600  # seconds


def _get_from_cache(key: str) -> Optional[Any]:
    if key in _MAP_CACHE:
        entry = _MAP_CACHE[key]
        if time.time() - entry["timestamp"] < _MAP_CACHE_TTL:
            return entry["data"]
        else:
            del _MAP_CACHE[key]
    return None


def _set_in_cache(key: str, data: Any) -> None:
    _MAP_CACHE[key] = {
        "data": data,
        "timestamp": time.time(),
    }


# =====================================================================
# OpenFreeMap / MapLibre GIS Endpoints
# =====================================================================

@app.get("/api/map/feeders-list")
async def get_map_feeders_list():
    """Return curated feeders with names, voltages, and parent substations for the map selector."""
    cache_key = "feeders_list_curated"
    cached = _get_from_cache(cache_key)
    if cached is not None:
        return cached

    client = arcgis_service
    try:
        data = await asyncio.to_thread(
            client.query,
            layer=2,
            where="Existing_DG > 1000",
            out_fields="FeederID,Feeder_Name,Substation,Nominal_Voltage,Existing_DG,Queued_DG,Total_DG,Division",
            limit=40,
            order_by="Existing_DG DESC",
        )
        feeders = []
        for f in data.get("features", []):
            attr = f.get("attributes", {})
            feeders.append({
                "feeder_id": str(attr.get("FeederID")),
                "name": attr.get("Feeder_Name") or f"Feeder {attr.get('FeederID')}",
                "substation": attr.get("Substation"),
                "voltage": str(attr.get("Nominal_Voltage")),
                "existing_dg_kw": attr.get("Existing_DG", 0),
                "queued_dg_kw": attr.get("Queued_DG", 0),
                "total_dg_kw": attr.get("Total_DG", 0),
                "division": attr.get("Division"),
            })
        result = {"feeders": feeders, "cached": False}
        _set_in_cache(cache_key, {"feeders": feeders, "cached": True})
        return result
    except Exception as e:
        return {"feeders": [], "error": str(e)}


@app.get("/api/map/feeder/{feeder_id}")
async def get_feeder_geojson(feeder_id: str):
    """Return GeoJSON FeatureCollection of feeder line sections (Layer 3) + parent substation (Layer 0)."""
    clean_id = feeder_id.strip()
    cache_key = f"feeder_geojson_{clean_id}"
    cached = _get_from_cache(cache_key)
    if cached is not None:
        return cached

    client = arcgis_service

    # 1. Query LineDetail (Layer 3) with WGS84 geometry
    line_data = await asyncio.to_thread(
        client.query,
        layer=3,
        where=f"FeederId = '{clean_id}' OR FeederId LIKE '%{clean_id}%'",
        out_fields="FeederId,FeederName,CSV_LineSection,LoadCapacity_kW,GenCapacity_kW,GenericPVCapacity_kW,ScreenL,limiting_criteria,limiting_month_hour,voltage_kv,phase_cnt",
        limit=500,
        return_geometry=True,
        out_sr=4326,
    )

    features = []
    min_lon, min_lat = 180.0, 90.0
    max_lon, max_lat = -180.0, -90.0

    for f in line_data.get("features", []):
        geom = f.get("geometry", {})
        paths = geom.get("paths", [])
        if not paths:
            continue

        for path in paths:
            for pt in path:
                lon, lat = pt[0], pt[1]
                if lon < min_lon: min_lon = lon
                if lon > max_lon: max_lon = lon
                if lat < min_lat: min_lat = lat
                if lat > max_lat: max_lat = lat

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "MultiLineString" if len(paths) > 1 else "LineString",
                "coordinates": paths if len(paths) > 1 else paths[0],
            },
            "properties": f.get("attributes", {}),
        })

    # 2. Feeder metadata from FeederDetail (Layer 2)
    feeder_meta = {}
    try:
        f_res = await asyncio.to_thread(
            client.query,
            layer=2,
            where=f"FeederID = '{clean_id}' OR FeederID LIKE '%{clean_id}%'",
            out_fields="FeederID,Feeder_Name,Substation,Nominal_Voltage,ResCust,ComCust,IndCust,Total_DG,Existing_DG,Queued_DG,Division",
            limit=1,
        )
        if f_res.get("features"):
            feeder_meta = f_res["features"][0].get("attributes", {})
    except Exception:
        pass

    # 3. Substation feature from EDSubstations (Layer 0)
    substation_feature = None
    sub_name = feeder_meta.get("Substation")
    if sub_name:
        try:
            sub_res = await asyncio.to_thread(
                client.query,
                layer=0,
                where=f"UPPER(SubstationName) LIKE UPPER('%{sub_name}%')",
                out_fields="SubstationName,SubstationID,Voltage_kV,Existing_DG,Queued_DG,NUMBANKS,Division",
                limit=1,
                return_geometry=True,
                out_sr=4326,
            )
            if sub_res.get("features"):
                sf = sub_res["features"][0]
                pt = sf.get("geometry", {})
                if "x" in pt and "y" in pt:
                    substation_feature = {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [pt["x"], pt["y"]],
                        },
                        "properties": sf.get("attributes", {}),
                    }
                    if pt["x"] < min_lon: min_lon = pt["x"]
                    if pt["x"] > max_lon: max_lon = pt["x"]
                    if pt["y"] < min_lat: min_lat = pt["y"]
                    if pt["y"] > max_lat: max_lat = pt["y"]
        except Exception:
            pass

    bbox = [min_lon, min_lat, max_lon, max_lat] if min_lon <= max_lon else None

    # Compute summary stats (distinguish 'Unlikely to pass' from 'Likely to pass')
    screen_l_unlikely_count = sum(1 for f in features if "unlikely" in str(f["properties"].get("ScreenL", "")).lower())
    screen_l_pass_count = sum(1 for f in features if "likely" in str(f["properties"].get("ScreenL", "")).lower() and "unlikely" not in str(f["properties"].get("ScreenL", "")).lower())
    max_gen_kw = max((f["properties"].get("GenCapacity_kW") or 0 for f in features), default=0)
    max_load_kw = max((f["properties"].get("LoadCapacity_kW") or 0 for f in features), default=0)

    result = {
        "type": "FeatureCollection",
        "feeder_id": clean_id,
        "feeder_meta": feeder_meta,
        "substation_feature": substation_feature,
        "bbox": bbox,
        "count": len(features),
        "summary": {
            "total_sections": len(features),
            "screen_l_pass": screen_l_pass_count,
            "screen_l_unlikely": screen_l_unlikely_count,
            "max_gen_capacity_kw": max_gen_kw,
            "max_load_capacity_kw": max_load_kw,
        },
        "features": features,
    }
    _set_in_cache(cache_key, result)
    return result


@app.get("/api/map/substations")
async def get_map_substations():
    """Return GeoJSON FeatureCollection of major substations from Layer 0 (EDSubstations)."""
    cache_key = "substations_geojson"
    cached = _get_from_cache(cache_key)
    if cached is not None:
        return cached

    client = arcgis_service
    try:
        data = await asyncio.to_thread(
            client.query,
            layer=0,
            where="1=1",
            out_fields="OBJECTID,SubstationName,SubstationID,Division,Voltage_kV,NUMBANKS,Existing_DG,Queued_DG,Total_DG",
            limit=120,
            return_geometry=True,
            out_sr=4326,
            order_by="Existing_DG DESC",
        )
        features = []
        for f in data.get("features", []):
            pt = f.get("geometry", {})
            if "x" in pt and "y" in pt:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [pt["x"], pt["y"]],
                    },
                    "properties": f.get("attributes", {}),
                })
        result = {
            "type": "FeatureCollection",
            "count": len(features),
            "features": features,
        }
        _set_in_cache(cache_key, result)
        return result
    except Exception as e:
        return {"type": "FeatureCollection", "count": 0, "features": [], "error": str(e)}


@app.get("/api/map/fire-districts")
async def get_map_fire_districts():
    """Return GeoJSON FeatureCollection of CPUC High Fire Threat Districts (Layer 18)."""
    cache_key = "fire_districts_geojson"
    cached = _get_from_cache(cache_key)
    if cached is not None:
        return cached

    client = arcgis_service
    try:
        data = await asyncio.to_thread(
            client.query,
            layer=18,
            where="cpuc_tier IN (2, 3)",
            out_fields="OBJECTID,hftd,cpuc_tier,cpuc_fire_map,data_source",
            limit=25,
            return_geometry=True,
            out_sr=4326,
        )
        features = []
        for f in data.get("features", []):
            rings = f.get("geometry", {}).get("rings", [])
            if rings:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon" if len(rings) == 1 else "MultiPolygon",
                        "coordinates": rings if len(rings) == 1 else [rings],
                    },
                    "properties": f.get("attributes", {}),
                })
        result = {
            "type": "FeatureCollection",
            "count": len(features),
            "features": features,
        }
        _set_in_cache(cache_key, result)
        return result
    except Exception as e:
        return {"type": "FeatureCollection", "count": 0, "features": [], "error": str(e)}


# Mount static directory for frontend
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/api/map/network")
async def get_statewide_feeder_network():
    """Return pre-compressed statewide feeder network GeoJSON (3,259 feeders with ICA MW rollups)."""
    gz_path = STATIC_DIR / "data" / "feeder_network.geojson.gz"
    if gz_path.exists():
        content = gz_path.read_bytes()
        return Response(
            content=content,
            media_type="application/json",
            headers={
                "Content-Encoding": "gzip",
                "Cache-Control": "public, max-age=86400",
            },
        )
    raw_path = STATIC_DIR / "data" / "feeder_network.geojson"
    if raw_path.exists():
        return FileResponse(str(raw_path), media_type="application/json")
    raise HTTPException(status_code=404, detail="Feeder network data not built yet. Run build_feeder_network.py.")


@app.get("/api/geocode")
async def geocode_address(q: str):
    """Geocode an address to lat/lon using US Census Bureau Geocoder API with Nominatim fallback."""
    import httpx
    q_clean = q.strip()
    if not q_clean:
        return {"matched": False, "error": "Query cannot be empty"}

    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
    params = {"address": q_clean, "benchmark": "2020", "format": "json"}

    async with httpx.AsyncClient(timeout=8.0, verify=False) as http_client:
        try:
            r = await http_client.get(url, params=params)
            if r.status_code == 200:
                data = r.json()
                matches = data.get("result", {}).get("addressMatches", [])
                if matches:
                    pt = matches[0]["coordinates"]
                    return {
                        "matched": True,
                        "address": matches[0]["matchedAddress"],
                        "lon": float(pt["x"]),
                        "lat": float(pt["y"]),
                        "source": "US Census Bureau",
                    }
        except Exception:
            pass

        # Fallback to OpenStreetMap Nominatim
        nom_url = "https://nominatim.openstreetmap.org/search"
        nom_params = {"q": f"{q_clean}, California", "format": "json", "limit": 1}
        headers = {"User-Agent": "PGEDRPPublicPlanner/1.0"}
        try:
            r2 = await http_client.get(nom_url, params=nom_params, headers=headers)
            if r2.status_code == 200:
                nom_data = r2.json()
                if nom_data:
                    return {
                        "matched": True,
                        "address": nom_data[0].get("display_name", q_clean),
                        "lon": float(nom_data[0]["lon"]),
                        "lat": float(nom_data[0]["lat"]),
                        "source": "OpenStreetMap Nominatim",
                    }
        except Exception as e:
            return {"matched": False, "error": str(e)}

    return {"matched": False, "error": f"No California location found for '{q_clean}'"}


@app.get("/planner")
async def serve_planner():
    """Serve Senpilot-style AI Public Planning Tool."""
    planner_file = STATIC_DIR / "planner.html"
    if planner_file.exists():
        return FileResponse(str(planner_file))
    return {"message": "Planner page not found. Place planner.html in static/"}


@app.get("/")
async def serve_index():
    """Serve main frontend page."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "ArcGIS DRP Chatbot API is running. Place index.html in static/"}
