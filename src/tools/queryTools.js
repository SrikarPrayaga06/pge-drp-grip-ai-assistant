import { arcgisClient } from '../arcgisClient.js';

export async function queryLayerTool({
  layer,
  where = '1=1',
  outFields = '*',
  resultRecordCount = 25,
  resultOffset = 0,
  orderByFields,
  returnGeometry = false,
  returnCountOnly = false
}) {
  return await arcgisClient.queryLayer({
    layer,
    where,
    outFields,
    resultRecordCount,
    resultOffset,
    orderByFields,
    returnGeometry,
    returnCountOnly
  });
}

export async function spatialQueryTool({
  layer,
  longitude,
  latitude,
  distanceMeters,
  envelope,
  spatialRel = 'esriSpatialRelIntersects',
  where = '1=1',
  outFields = '*',
  resultRecordCount = 25,
  returnGeometry = true
}) {
  return await arcgisClient.spatialQuery({
    layer,
    longitude,
    latitude,
    distanceMeters,
    envelope,
    spatialRel,
    where,
    outFields,
    resultRecordCount,
    returnGeometry
  });
}
