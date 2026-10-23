import { arcgisClient } from '../arcgisClient.js';
import { LAYER_CATALOG } from '../config.js';

export async function getLoadProfileTool({
  targetType = 'feeder',
  targetId,
  substationName,
  month,
  hour,
  monthHour,
  limit = 288 // 12 months * 24 hours = 288 profiles
}) {
  const isSubstation = targetType.toLowerCase() === 'substation';
  const tableId = isSubstation ? LAYER_CATALOG.SUBSTATION_LOAD_PROFILE.id : LAYER_CATALOG.FEEDER_LOAD_PROFILE.id;

  const conditions = [];

  if (isSubstation) {
    if (substationName) {
      const escaped = substationName.replace(/'/g, "''");
      conditions.push(`(UPPER(subname) LIKE UPPER('%${escaped}%'))`);
    } else if (targetId) {
      conditions.push(`(subid = ${parseInt(targetId, 10)})`);
    } else {
      throw new Error('For substation load profile, provide targetId (numeric) or substationName.');
    }

    if (monthHour) {
      conditions.push(`(monthhour = '${monthHour}')`);
    } else if (month) {
      const mStr = String(month).padStart(2, '0');
      conditions.push(`(monthhour LIKE '${mStr}_%')`);
    } else if (hour) {
      const hStr = String(hour).padStart(2, '0');
      conditions.push(`(monthhour LIKE '%_${hStr}')`);
    }
  } else {
    // Feeder
    if (!targetId) {
      throw new Error('For feeder load profile, targetId (feeder ID) is required.');
    }
    const cleanId = parseInt(String(targetId).replace(/\D/g, ''), 10);
    conditions.push(`(FeederID = ${cleanId})`);

    if (monthHour) {
      conditions.push(`(MonthHour = '${monthHour}')`);
    } else if (month) {
      const mStr = String(month).padStart(2, '0');
      conditions.push(`(MonthHour LIKE '${mStr}_%')`);
    } else if (hour) {
      const hStr = String(hour).padStart(2, '0');
      conditions.push(`(MonthHour LIKE '%_${hStr}')`);
    }
  }

  const where = conditions.join(' AND ');
  const orderByFields = isSubstation ? 'monthhour ASC' : 'MonthHour ASC';

  const result = await arcgisClient.queryLayer({
    layer: tableId,
    where,
    outFields: '*',
    resultRecordCount: limit,
    orderByFields,
    returnGeometry: false
  });

  // Calculate summary metrics
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let sumHigh = 0;
  let sumLow = 0;
  const count = result.features.length;

  for (const f of result.features) {
    const high = f.attributes.High ?? f.attributes.high ?? 0;
    const low = f.attributes.Low ?? f.attributes.low ?? 0;
    if (high > maxHigh) maxHigh = high;
    if (low < minLow) minLow = low;
    sumHigh += high;
    sumLow += low;
  }

  const summary = count > 0 ? {
    count,
    peakHigh: maxHigh,
    minLow: minLow,
    avgHigh: Math.round(sumHigh / count),
    avgLow: Math.round(sumLow / count),
    units: isSubstation ? 'MW' : 'kW'
  } : null;

  return {
    targetType,
    targetId: targetId || substationName,
    summary,
    records: result.features.map(f => f.attributes)
  };
}
