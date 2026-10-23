"""FastAPI Web Server for ArcGIS DRP Chatbot and Functionality Verification Suite."""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .agent import ArcGISChatbot
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
        reply = await asyncio.to_thread(bot.chat, request.message, session_id=session_id)
        return ChatResponse(
            reply=reply,
            session_id=session_id,
            model=bot.active_model,
            last_used_model=bot.last_used_model,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")


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


@app.get("/api/sessions")
async def get_sessions_endpoint():
    """List all persisted session IDs."""
    bot = get_chatbot()
    sessions = bot.list_sessions()
    return {"sessions": sessions}


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


# Mount static directory for frontend
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def serve_index():
    """Serve main frontend page."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "ArcGIS DRP Chatbot API is running. Place index.html in static/"}
