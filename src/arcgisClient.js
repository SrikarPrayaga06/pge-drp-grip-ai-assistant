import { ARCGIS_CONFIG, resolveLayerId } from './config.js';

class ArcGISClient {
  constructor(baseUrl = ARCGIS_CONFIG.featureServerUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.serviceMetadataCache = null;
    this.layerMetadataCache = new Map();
  }

  /**
   * Helper to execute HTTP GET with JSON response
   */
  async _get(url, params = {}) {
    const fullUrl = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        fullUrl.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
    }
    fullUrl.searchParams.set('f', 'json');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ARCGIS_CONFIG.timeoutMs);

    try {
      const response = await fetch(fullUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'ArcGIS-MCP-Server/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        const msg = data.error.message || 'ArcGIS Server error';
        const details = (data.error.details || []).join(', ');
        throw new Error(`${msg}${details ? ` (${details})` : ''} [Code ${data.error.code}]`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get service-level root information
   */
  async getServiceMetadata() {
    if (this.serviceMetadataCache) return this.serviceMetadataCache;
    const data = await this._get(this.baseUrl);
    this.serviceMetadataCache = data;
    return data;
  }

  /**
   * Get full details and schema for a specific layer or table
   */
  async getLayerDetails(layerIdentifier) {
    const layerId = resolveLayerId(layerIdentifier);
    if (this.layerMetadataCache.has(layerId)) {
      return this.layerMetadataCache.get(layerId);
    }

    const data = await this._get(`${this.baseUrl}/${layerId}`);
    this.layerMetadataCache.set(layerId, data);
    return data;
  }

  /**
   * Query a layer with SQL WHERE clause, field selection, and pagination
   */
  async queryLayer({
    layer,
    where = '1=1',
    outFields = '*',
    resultRecordCount = ARCGIS_CONFIG.defaultMaxRecords,
    resultOffset = 0,
    orderByFields,
    returnGeometry = false,
    outSR = ARCGIS_CONFIG.defaultSpatialReference,
    returnCountOnly = false,
    groupByFieldsForStatistics,
    outStatistics
  }) {
    const layerId = resolveLayerId(layer);
    const limit = Math.min(resultRecordCount || ARCGIS_CONFIG.defaultMaxRecords, ARCGIS_CONFIG.hardMaxRecords);

    const params = {
      where: where || '1=1',
      outFields: Array.isArray(outFields) ? outFields.join(',') : outFields,
      returnGeometry: Boolean(returnGeometry),
      outSR,
      returnCountOnly: Boolean(returnCountOnly)
    };

    if (!returnCountOnly) {
      params.resultRecordCount = limit;
      if (resultOffset) params.resultOffset = resultOffset;
      if (orderByFields) params.orderByFields = orderByFields;
      if (groupByFieldsForStatistics) params.groupByFieldsForStatistics = groupByFieldsForStatistics;
      if (outStatistics) params.outStatistics = outStatistics;
    }

    const result = await this._get(`${this.baseUrl}/${layerId}/query`, params);

    if (returnCountOnly) {
      return { layerId, count: result.count ?? 0 };
    }

    return {
      layerId,
      objectIdFieldName: result.objectIdFieldName,
      globalIdFieldName: result.globalIdFieldName,
      geometryType: result.geometryType,
      spatialReference: result.spatialReference,
      count: result.features ? result.features.length : 0,
      exceededTransferLimit: result.exceededTransferLimit || false,
      features: (result.features || []).map(f => ({
        attributes: f.attributes,
        geometry: f.geometry || null
      }))
    };
  }

  /**
   * Spatial query around a point or envelope
   */
  async spatialQuery({
    layer,
    longitude,
    latitude,
    distanceMeters,
    envelope,
    spatialRel = 'esriSpatialRelIntersects',
    where = '1=1',
    outFields = '*',
    resultRecordCount = ARCGIS_CONFIG.defaultMaxRecords,
    returnGeometry = true,
    outSR = ARCGIS_CONFIG.defaultSpatialReference
  }) {
    const layerId = resolveLayerId(layer);
    const limit = Math.min(resultRecordCount || ARCGIS_CONFIG.defaultMaxRecords, ARCGIS_CONFIG.hardMaxRecords);

    const params = {
      where: where || '1=1',
      outFields: Array.isArray(outFields) ? outFields.join(',') : outFields,
      returnGeometry: Boolean(returnGeometry),
      spatialRel,
      inSR: 4326,
      outSR,
      resultRecordCount: limit
    };

    if (longitude !== undefined && latitude !== undefined) {
      params.geometryType = 'esriGeometryPoint';
      params.geometry = {
        x: Number(longitude),
        y: Number(latitude),
        spatialReference: { wkid: 4326 }
      };
      if (distanceMeters && Number(distanceMeters) > 0) {
        params.distance = Number(distanceMeters);
        params.units = 'esriSRUnit_Meter';
      }
    } else if (envelope) {
      params.geometryType = 'esriGeometryEnvelope';
      params.geometry = {
        xmin: envelope.xmin,
        ymin: envelope.ymin,
        xmax: envelope.xmax,
        ymax: envelope.ymax,
        spatialReference: { wkid: 4326 }
      };
    } else {
      throw new Error('Spatial query requires either (longitude, latitude) or an envelope bounding box.');
    }

    const result = await this._get(`${this.baseUrl}/${layerId}/query`, params);

    return {
      layerId,
      geometryType: result.geometryType,
      spatialReference: result.spatialReference,
      count: result.features ? result.features.length : 0,
      features: (result.features || []).map(f => ({
        attributes: f.attributes,
        geometry: f.geometry || null
      }))
    };
  }
}

export const arcgisClient = new ArcGISClient();
