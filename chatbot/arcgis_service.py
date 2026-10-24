"""ArcGIS FeatureServer REST client for the PG&E DRP Compliance service."""

import json
import httpx
from typing import Any, Dict, List, Optional, Union

ARCGIS_BASE_URL = "https://services2.arcgis.com/mJaJSax0KPHoCNB6/ArcGIS/rest/services/DRPComplianceRelProd/FeatureServer"

LAYER_NAME_TO_ID = {
    "edsubstations": 0,
    "substations": 0,
    "etsubstations": 1,
    "feederdetail": 2,
    "feeders": 2,
    "linedetail": 3,
    "ica": 3,
    "ica not available": 4,
    "icanotavailable": 4,
    "transmissionlines": 5,
    "networked secondary buffer": 6,
    "substationprojects": 8,
    "tline projects": 9,
    "gnalinesecview": 10,
    "gnacircuitsview": 11,
    "dercircuitsview": 12,
    "dfcircuitsview": 13,
    "highfirethreatdistricts": 18,
    "fire": 18,
    "knownload": 19,
    "feederloadprofile": 23,
    "substationloadprofile": 25,
    "gnasubstationarea__peakfacilitydeficiencypercent": 28,
    "deficiencies": 28,
    "plannedinvestments_lnbadollarsperunitperyr": 29,
    "lnba": 29,
    "dur_project_execution": 30,
    "dfsubstationarea___peakfacilityloadingpercent": 31,
    "climate_zone": 32,
    "pendingload": 33,
}

class ArcGISService:
    def __init__(self, base_url: str = ARCGIS_BASE_URL):
        self.base_url = base_url.rstrip("/")
        # verify=False prevents OpenSSL 3.x strict intermediate CA errors on macOS
        self.client = httpx.Client(verify=False, timeout=30.0)
        self._service_cache: Optional[Dict[str, Any]] = None
        self._layer_cache: Dict[int, Dict[str, Any]] = {}
        self._query_cache: Dict[str, Dict[str, Any]] = {}

    def resolve_layer_id(self, layer: Union[int, str]) -> int:
        if isinstance(layer, int):
            return layer
        s = str(layer).strip().lower()
        if s.isdigit():
            return int(s)
        if s in LAYER_NAME_TO_ID:
            return LAYER_NAME_TO_ID[s]
        # Partial match
        clean = s.replace(" ", "").replace("_", "")
        for k, v in LAYER_NAME_TO_ID.items():
            if clean in k.replace(" ", "").replace("_", ""):
                return v
        raise ValueError(f"Unknown layer '{layer}'. Available: {list(LAYER_NAME_TO_ID.keys())[:8]}...")

    def get_service_metadata(self) -> Dict[str, Any]:
        """Fetch FeatureServer root metadata."""
        if self._service_cache:
            return self._service_cache
        url = f"{self.base_url}?f=json"
        resp = self.client.get(url)
        resp.raise_for_status()
        self._service_cache = resp.json()
        return self._service_cache

    def query(
        self,
        layer: Union[int, str],
        where: str = "1=1",
        out_fields: str = "*",
        limit: int = 25,
        offset: int = 0,
        order_by: Optional[str] = None,
        return_geometry: bool = False,
        out_sr: int = 4326,
        return_count_only: bool = False,
        out_statistics: Optional[Union[List[Dict[str, Any]], str]] = None,
        group_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        layer_id = self.resolve_layer_id(layer)
        stats_key = json.dumps(out_statistics) if isinstance(out_statistics, list) else str(out_statistics or "")
        cache_key = f"{layer_id}|{where}|{out_fields}|{limit}|{offset}|{order_by}|{return_geometry}|{return_count_only}|{stats_key}|{group_by or ''}"
        if cache_key in self._query_cache:
            return self._query_cache[cache_key]

        url = f"{self.base_url}/{layer_id}/query"
        params: Dict[str, Any] = {
            "where": where or "1=1",
            "outFields": out_fields,
            "returnGeometry": "true" if return_geometry else "false",
            "outSR": out_sr,
            "f": "json",
            "returnCountOnly": "true" if return_count_only else "false",
        }
        if out_statistics:
            params["outStatistics"] = json.dumps(out_statistics) if isinstance(out_statistics, list) else out_statistics
            if group_by:
                params["groupByFieldsForStatistics"] = group_by
        elif not return_count_only:
            params["resultRecordCount"] = min(limit, 1000)
            if offset:
                params["resultOffset"] = offset
            if order_by:
                params["orderByFields"] = order_by

        resp = self.client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            err = data["error"]
            raise RuntimeError(f"ArcGIS API error {err.get('code')}: {err.get('message')}")
        
        # Keep cache capped at 200 items
        if len(self._query_cache) > 200:
            self._query_cache.pop(next(iter(self._query_cache)))
        self._query_cache[cache_key] = data
        return data

    def spatial_query(
        self,
        layer: Union[int, str],
        longitude: float,
        latitude: float,
        distance_meters: float = 5000.0,
        where: str = "1=1",
        out_fields: str = "*",
        limit: int = 20,
    ) -> Dict[str, Any]:
        layer_id = self.resolve_layer_id(layer)
        url = f"{self.base_url}/{layer_id}/query"
        params: Dict[str, Any] = {
            "geometry": f'{{"x":{longitude},"y":{latitude},"spatialReference":{{"wkid":4326}}}}',
            "geometryType": "esriGeometryPoint",
            "spatialRel": "esriSpatialRelIntersects",
            "distance": distance_meters,
            "units": "esriSRUnit_Meter",
            "inSR": 4326,
            "outSR": 4326,
            "where": where or "1=1",
            "outFields": out_fields,
            "returnGeometry": "true",
            "resultRecordCount": min(limit, 500),
            "f": "json",
        }
        resp = self.client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            err = data["error"]
            raise RuntimeError(f"ArcGIS Spatial API error: {err.get('message')}")
        return data

arcgis_service = ArcGISService()
