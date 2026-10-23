/**
 * Configuration and metadata catalog for PG&E DRP Compliance ArcGIS FeatureServer
 */

export const ARCGIS_CONFIG = {
  featureServerUrl: 'https://services2.arcgis.com/mJaJSax0KPHoCNB6/ArcGIS/rest/services/DRPComplianceRelProd/FeatureServer',
  defaultSpatialReference: 4326, // WGS84 for lat/long compatibility
  serverSpatialReference: 3857,  // Web Mercator
  defaultMaxRecords: 100,
  hardMaxRecords: 2000,
  timeoutMs: 30000
};

export const LAYER_CATALOG = {
  // Substations
  ED_SUBSTATIONS: { id: 0, name: 'EDSubstations', type: 'Point', description: 'Electric Distribution Substations with voltage, bank counts, existing and queued DG (kW).' },
  ET_SUBSTATIONS: { id: 1, name: 'ETSubstations', type: 'Point', description: 'Electric Transmission Substations.' },
  SUBSTATION_PROJECTS: { id: 8, name: 'SubstationProjects', type: 'Point', description: 'Planned and in-progress substation expansion projects with approval status.' },
  GNA_SUBSTATION_DEFICIENCY: { id: 28, name: 'GNASubstationArea__PeakFacilityDeficiencyPercent', type: 'Point', description: 'Grid Needs Assessment (GNA) forecasted peak facility deficiencies (MW and %) 2026-2035.' },
  DF_SUBSTATION_LOADING: { id: 31, name: 'DFSubstationArea___PeakFacilityLoadingPercent', type: 'Point', description: 'Distribution Forecast (DF) peak substation facility loading % 2026-2035.' },
  SUBSTATION_LOAD_PROFILE: { id: 25, name: 'SubstationLoadProfile', type: 'Table', description: 'Substation hourly high/low load profiles (MW) by MonthHour.' },

  // Feeders & Circuits
  FEEDER_DETAIL: { id: 2, name: 'FeederDetail', type: 'Polyline', description: 'Feeder details, customer breakdown (Residential, Commercial, Industrial, Agricultural), and DG totals.' },
  GNA_CIRCUITS_VIEW: { id: 11, name: 'GNACircuitsView', type: 'Polyline', description: 'Grid Needs Assessment circuit-level view.' },
  DER_CIRCUITS_VIEW: { id: 12, name: 'DERCircuitsView', type: 'Polyline', description: 'DER forecast 2026-2035 for PV, battery storage, and EV load by circuit.' },
  DF_CIRCUITS_VIEW: { id: 13, name: 'DFCircuitsView', type: 'Polyline', description: 'Distribution Forecast circuits view with facility ratings and loading.' },
  FEEDER_LOAD_PROFILE: { id: 23, name: 'FeederLoadProfile', type: 'Table', description: 'Feeder hourly high/low load profiles (kW) by MonthHour (01_00 to 12_23).' },

  // Line Details & Integration Capacity Analysis (ICA)
  LINE_DETAIL: { id: 3, name: 'LineDetail', type: 'Polyline', description: 'Integration Capacity Analysis (ICA) line sections with load capacity kW, generation capacity kW, PV capacity kW, and limiting criteria.' },
  ICA_NOT_AVAILABLE: { id: 4, name: 'ICA Not Available', type: 'Polyline', description: 'Feeder sections where ICA evaluation is unavailable.' },
  GNA_LINE_SEC_VIEW: { id: 10, name: 'GNALineSecView', type: 'Polyline', description: 'Grid Needs Assessment line section view with deficiency dates and ratings.' },

  // Transmission & Grid Projects
  TRANSMISSION_LINES: { id: 5, name: 'TransmissionLines', type: 'Polyline', description: 'Transmission lines with SAP functional location and rated kV.' },
  TLINE_PROJECTS: { id: 9, name: 'TLINE Projects', type: 'Polyline', description: 'Transmission line upgrade projects and projected in-service dates.' },
  PLANNED_INVESTMENTS_LNBA: { id: 29, name: 'PlannedInvestments_LNBADollarsperUnitperYr', type: 'Point', description: 'Locational Net Benefits Analysis (LNBA) planned investments and deferral values ($/unit/yr).' },
  DUR_PROJECT_EXECUTION: { id: 30, name: 'DUR_Project_Execution', type: 'Point', description: 'Distribution Upgrade Requirements (DUR) project execution tracking, milestones, and status.' },

  // Boundaries & Environmental
  NETWORKED_SECONDARY_BUFFER: { id: 6, name: 'Networked Secondary Buffer', type: 'Polygon', description: 'Networked secondary buffer boundaries.' },
  HIGH_FIRE_THREAT_DISTRICTS: { id: 18, name: 'HighFireThreatDistricts', type: 'Polygon', description: 'CPUC Tier 2 (Elevated) and Tier 3 (Extreme) High Fire Threat Districts (HFTD).' },
  CLIMATE_ZONE: { id: 32, name: 'Climate_Zone', type: 'Polygon', description: 'California Building Climate Zones (cz_code).' },

  // Interconnection Load
  KNOWN_LOAD: { id: 19, name: 'KnownLoad', type: 'Polyline', description: 'Interconnection known load requests with expected MW amount, circuit, and status.' },
  PENDING_LOAD: { id: 33, name: 'PendingLoad', type: 'Polyline', description: 'Pending interconnection load requests and statuses.' }
};

export function resolveLayerId(input) {
  if (typeof input === 'number') return input;
  const str = String(input).trim();
  const num = parseInt(str, 10);
  if (!isNaN(num) && String(num) === str) return num;

  const lower = str.toLowerCase();
  for (const item of Object.values(LAYER_CATALOG)) {
    if (item.name.toLowerCase() === lower || item.name.toLowerCase().replace(/[\s_]/g, '') === lower.replace(/[\s_]/g, '')) {
      return item.id;
    }
  }

  // Partial match fallback
  for (const item of Object.values(LAYER_CATALOG)) {
    if (item.name.toLowerCase().includes(lower)) {
      return item.id;
    }
  }

  throw new Error(`Layer '${input}' could not be resolved. Please use a layer ID (0, 2, 3, 18, etc.) or valid layer name.`);
}
