import { arcgisClient } from '../arcgisClient.js';
import { LAYER_CATALOG } from '../config.js';

export async function searchSubstationsTool({
  name,
  substationId,
  division,
  minExistingDgKw,
  minQueuedDgKw,
  limit = 20,
  returnGeometry = true
}) {
  const conditions = [];

  if (name) {
    const escaped = name.replace(/'/g, "''");
    conditions.push(`(UPPER(SubstationName) LIKE UPPER('%${escaped}%'))`);
  }
  if (substationId) {
    const escaped = substationId.replace(/'/g, "''");
    conditions.push(`(SubstationID = '${escaped}')`);
  }
  if (division) {
    const escaped = division.replace(/'/g, "''");
    conditions.push(`(UPPER(Division) LIKE UPPER('%${escaped}%'))`);
  }
  if (minExistingDgKw !== undefined && minExistingDgKw !== null) {
    conditions.push(`(Existing_DG >= ${Number(minExistingDgKw)})`);
  }
  if (minQueuedDgKw !== undefined && minQueuedDgKw !== null) {
    conditions.push(`(Queued_DG >= ${Number(minQueuedDgKw)})`);
  }

  const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  return await arcgisClient.queryLayer({
    layer: LAYER_CATALOG.ED_SUBSTATIONS.id,
    where,
    outFields: 'OBJECTID,SubstationName,SubstationID,Division,Voltage_kV,NUMBANKS,UNGROUNDEDBANKS,Existing_DG,Queued_DG,Total_DG',
    resultRecordCount: limit,
    orderByFields: 'SubstationName ASC',
    returnGeometry
  });
}

export async function searchFeedersTool({
  feederId,
  feederName,
  substationName,
  division,
  minTotalCust,
  minDgKw,
  limit = 20,
  returnGeometry = false
}) {
  const conditions = [];

  if (feederId) {
    const escaped = feederId.replace(/'/g, "''");
    conditions.push(`(FeederID LIKE '%${escaped}%')`);
  }
  if (feederName) {
    const escaped = feederName.replace(/'/g, "''");
    conditions.push(`(Feeder_Name LIKE '%${escaped}%')`);
  }
  if (substationName) {
    const escaped = substationName.replace(/'/g, "''");
    conditions.push(`(UPPER(Substation) LIKE UPPER('%${escaped}%'))`);
  }
  if (division) {
    const escaped = division.replace(/'/g, "''");
    conditions.push(`(UPPER(Division) LIKE UPPER('%${escaped}%'))`);
  }
  if (minTotalCust !== undefined && minTotalCust !== null) {
    conditions.push(`(TotalCust >= ${Number(minTotalCust)})`);
  }
  if (minDgKw !== undefined && minDgKw !== null) {
    conditions.push(`(Total_DG >= ${Number(minDgKw)})`);
  }

  const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  return await arcgisClient.queryLayer({
    layer: LAYER_CATALOG.FEEDER_DETAIL.id,
    where,
    outFields: 'OBJECTID,FeederID,Feeder_Name,Substation,Nominal_Voltage,ResCust,ComCust,IndCust,AgrCust,OthCust,TotalCust,Existing_DG,Queued_DG,Total_DG,Division',
    resultRecordCount: limit,
    orderByFields: 'FeederID ASC',
    returnGeometry
  });
}
