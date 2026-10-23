import { arcgisClient } from '../arcgisClient.js';
import { LAYER_CATALOG } from '../config.js';

export async function getIcaCapacityTool({
  feederId,
  lineSection,
  minGenCapacityKw,
  minLoadCapacityKw,
  screenL,
  limit = 20
}) {
  const conditions = [];

  if (feederId) {
    const escaped = feederId.replace(/'/g, "''");
    conditions.push(`(FeederId = '${escaped}' OR FeederId LIKE '%${escaped}%')`);
  }
  if (lineSection) {
    const escaped = lineSection.replace(/'/g, "''");
    conditions.push(`(CSV_LineSection = '${escaped}')`);
  }
  if (minGenCapacityKw !== undefined && minGenCapacityKw !== null) {
    conditions.push(`(GenCapacity_kW >= ${Number(minGenCapacityKw)})`);
  }
  if (minLoadCapacityKw !== undefined && minLoadCapacityKw !== null) {
    conditions.push(`(LoadCapacity_kW >= ${Number(minLoadCapacityKw)})`);
  }
  if (screenL) {
    const escaped = screenL.replace(/'/g, "''");
    conditions.push(`(UPPER(ScreenL) LIKE UPPER('%${escaped}%'))`);
  }

  const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  const result = await arcgisClient.queryLayer({
    layer: LAYER_CATALOG.LINE_DETAIL.id,
    where,
    outFields: 'FeederId,FeederName,CSV_LineSection,LoadCapacity_kW,GenCapacity_kW,GenericPVCapacity_kW,GenCapacity_no_OpFlex_kW,voltage_kv,phase_cnt,limiting_criteria,limiting_month_hour,ICA_Analysis_Date,ScreenL',
    resultRecordCount: limit,
    orderByFields: 'GenCapacity_kW DESC',
    returnGeometry: false
  });

  // If 0 records found and a feederId was queried, check if it's listed under 'ICA Not Available' (Layer 4)
  if (result.count === 0 && feederId) {
    const icaUnavailable = await arcgisClient.queryLayer({
      layer: LAYER_CATALOG.ICA_NOT_AVAILABLE.id,
      where: `feeder_id = '${feederId.replace(/'/g, "''")}'`,
      outFields: 'feeder_id,numberofphases,division,last_update_on_map',
      resultRecordCount: 5
    });

    if (icaUnavailable.count > 0) {
      return {
        ...result,
        icaStatus: 'ICA_NOT_AVAILABLE',
        note: `Feeder '${feederId}' is explicitly listed in Layer 4 (ICA Not Available). ICA analysis has not been performed or is unavailable for this circuit.`,
        unavailableDetails: icaUnavailable.features
      };
    }
  }

  return {
    ...result,
    icaStatus: result.count > 0 ? 'AVAILABLE' : 'NO_MATCHING_SECTIONS'
  };
}
