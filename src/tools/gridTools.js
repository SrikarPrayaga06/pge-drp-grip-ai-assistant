import { arcgisClient } from '../arcgisClient.js';
import { LAYER_CATALOG } from '../config.js';

export async function getFireThreatInfoTool({
  longitude,
  latitude,
  tier,
  limit = 10
}) {
  if (longitude !== undefined && latitude !== undefined) {
    // Spatial intersection check
    const spatialResult = await arcgisClient.spatialQuery({
      layer: LAYER_CATALOG.HIGH_FIRE_THREAT_DISTRICTS.id,
      longitude,
      latitude,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'OBJECTID,hftd,cpuc_tier,cpuc_fire_map,data_source',
      resultRecordCount: limit,
      returnGeometry: false
    });

    return {
      coordinates: { longitude, latitude },
      inFireThreatDistrict: spatialResult.count > 0,
      fireThreatDistricts: spatialResult.features.map(f => f.attributes)
    };
  }

  // Attribute query by tier
  const where = tier ? `cpuc_tier = ${Number(tier)}` : '1=1';
  const result = await arcgisClient.queryLayer({
    layer: LAYER_CATALOG.HIGH_FIRE_THREAT_DISTRICTS.id,
    where,
    outFields: 'OBJECTID,hftd,cpuc_tier,cpuc_fire_map,data_source',
    resultRecordCount: limit,
    returnGeometry: false
  });

  return {
    queryTier: tier || 'all',
    count: result.count,
    records: result.features.map(f => f.attributes)
  };
}

export async function getGridDeficienciesTool({
  substationName,
  circuitName,
  facilityName,
  minDeficiencyPercent,
  minDeficiencyMw,
  limit = 20
}) {
  const conditions = [];

  if (substationName) {
    const escaped = substationName.replace(/'/g, "''");
    conditions.push(`(UPPER(substationname) LIKE UPPER('%${escaped}%'))`);
  }
  if (circuitName) {
    const escaped = circuitName.replace(/'/g, "''");
    conditions.push(`(UPPER(circuitname) LIKE UPPER('%${escaped}%'))`);
  }
  if (facilityName) {
    const escaped = facilityName.replace(/'/g, "''");
    conditions.push(`(UPPER(gnafacilityname) LIKE UPPER('%${escaped}%'))`);
  }

  const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  // Query GNA Substation deficiencies (Layer 28)
  const substationDeficiencies = await arcgisClient.queryLayer({
    layer: LAYER_CATALOG.GNA_SUBSTATION_DEFICIENCY.id,
    where,
    outFields: '*',
    resultRecordCount: limit,
    returnGeometry: false
  });

  // Query Planned Investments / LNBA (Layer 29)
  const lnbaInvestments = await arcgisClient.queryLayer({
    layer: LAYER_CATALOG.PLANNED_INVESTMENTS_LNBA.id,
    where: substationName ? `UPPER(substationid) LIKE UPPER('%${substationName.replace(/'/g, "''")}%')` : '1=1',
    outFields: 'projectname,projecttype,distributionservicerequired,lnbadollarsperunitperyr,deferrableyesorno,gnaneedid,gnafacilityname',
    resultRecordCount: limit,
    returnGeometry: false
  });

  return {
    query: { substationName, circuitName, facilityName },
    deficienciesFound: substationDeficiencies.count,
    deficiencies: substationDeficiencies.features.map(f => f.attributes),
    plannedInvestmentsLNBA: lnbaInvestments.features.map(f => f.attributes)
  };
}
