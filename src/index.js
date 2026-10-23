#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { listLayersTool, getLayerDetailsTool } from './tools/layerTools.js';
import { queryLayerTool, spatialQueryTool } from './tools/queryTools.js';
import { searchSubstationsTool, searchFeedersTool } from './tools/assetTools.js';
import { getIcaCapacityTool } from './tools/icaTools.js';
import { getLoadProfileTool } from './tools/profileTools.js';
import { getFireThreatInfoTool, getGridDeficienciesTool } from './tools/gridTools.js';

// Helper to wrap tool output safely for MCP
function formatResponse(data) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      }
    ]
  };
}

function formatError(error) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Error: ${error.message || String(error)}`
      }
    ]
  };
}

const server = new McpServer({
  name: 'arcgis-drp-grip-mcp-server',
  version: '1.0.0'
});

// Tool 1: List all layers and tables
server.tool(
  'arcgis_list_layers',
  'List all available layers and tables in the PG&E DRP / GRIP FeatureServer with geometry types, record counts, and descriptions. Filter by category or keyword.',
  {
    category: z.enum(['substation', 'feeder', 'circuit', 'ica', 'capacity', 'fire', 'load', 'project']).optional()
      .describe('Optional category filter to isolate relevant layers (e.g., "substation", "feeder", "ica", "fire", "load", "project")'),
    search: z.string().optional()
      .describe('Keyword search across layer names and descriptions')
  },
  async (args) => {
    try {
      const result = await listLayersTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 2: Get layer schema and metadata
server.tool(
  'arcgis_get_layer_details',
  'Get comprehensive schema metadata for any layer or table (by ID or name), including field names, types, aliases, relationships, and capabilities.',
  {
    layer: z.union([z.number(), z.string()])
      .describe('Layer ID (e.g. 0, 2, 3, 18, 23) or layer name (e.g. "EDSubstations", "FeederDetail", "LineDetail", "HighFireThreatDistricts")')
  },
  async (args) => {
    try {
      const result = await getLayerDetailsTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 3: General SQL / Attribute query
server.tool(
  'arcgis_query_layer',
  'Execute a SQL attribute query on any layer or table in the FeatureServer with WHERE filtering, field selection, sorting, and pagination.',
  {
    layer: z.union([z.number(), z.string()])
      .describe('Layer ID or name to query'),
    where: z.string().optional()
      .describe('SQL WHERE clause (default: "1=1"). E.g. "Division = \'San Francisco\'" or "Voltage_kV = \'12\'"'),
    outFields: z.string().optional()
      .describe('Comma-separated field list to return (default: "*")'),
    resultRecordCount: z.number().optional()
      .describe('Maximum number of records to return (default: 25, max: 2000)'),
    resultOffset: z.number().optional()
      .describe('Offset for pagination'),
    orderByFields: z.string().optional()
      .describe('Sorting expression, e.g. "Existing_DG DESC" or "OBJECTID ASC"'),
    returnGeometry: z.boolean().optional()
      .describe('Whether to return geometry coordinates (default: false for faster response)'),
    returnCountOnly: z.boolean().optional()
      .describe('If true, returns only the count of matching records without downloading attributes')
  },
  async (args) => {
    try {
      const result = await queryLayerTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 4: Spatial Query (Point buffer / Envelope)
server.tool(
  'arcgis_spatial_query',
  'Perform a spatial query to find electric infrastructure (substations, feeders, lines, fire districts) near coordinates (latitude/longitude + distance buffer in meters) or within a bounding box.',
  {
    layer: z.union([z.number(), z.string()])
      .describe('Layer ID or name to search against'),
    longitude: z.number().optional()
      .describe('Longitude in WGS84 (e.g. -122.4194)'),
    latitude: z.number().optional()
      .describe('Latitude in WGS84 (e.g. 37.7749)'),
    distanceMeters: z.number().optional()
      .describe('Search radius distance in meters around the point (e.g. 5000 for 5km)'),
    envelope: z.object({
      xmin: z.number(),
      ymin: z.number(),
      xmax: z.number(),
      ymax: z.number()
    }).optional().describe('Bounding box envelope in WGS84 coordinates'),
    where: z.string().optional()
      .describe('Optional secondary SQL attribute filter'),
    outFields: z.string().optional()
      .describe('Comma-separated field list to return (default: "*")'),
    resultRecordCount: z.number().optional()
      .describe('Maximum number of records to return (default: 25)'),
    returnGeometry: z.boolean().optional()
      .describe('Whether to return geometry coordinates (default: true)')
  },
  async (args) => {
    try {
      const result = await spatialQueryTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 5: Search Substations
server.tool(
  'arcgis_search_substations',
  'Search Electric Distribution Substations (Layer 0) by name, ID, division, or distributed generation thresholds (Existing/Queued DG in kW).',
  {
    name: z.string().optional().describe('Substation name pattern (e.g. "MISSION", "OAKLAND")'),
    substationId: z.string().optional().describe('Exact Substation ID (e.g. "02201")'),
    division: z.string().optional().describe('Geographic division (e.g. "San Francisco", "East Bay", "Peninsula")'),
    minExistingDgKw: z.number().optional().describe('Minimum existing distributed generation capacity in kW'),
    minQueuedDgKw: z.number().optional().describe('Minimum queued distributed generation capacity in kW'),
    limit: z.number().optional().describe('Max records to return (default: 20)'),
    returnGeometry: z.boolean().optional().describe('Whether to return coordinates (default: true)')
  },
  async (args) => {
    try {
      const result = await searchSubstationsTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 6: Search Feeders
server.tool(
  'arcgis_search_feeders',
  'Search Electric Distribution Feeders (Layer 2) by feeder ID, feeder name, parent substation, or customer counts.',
  {
    feederId: z.string().optional().describe('Feeder ID pattern (e.g. "022390402")'),
    feederName: z.string().optional().describe('Feeder name pattern'),
    substationName: z.string().optional().describe('Parent substation name'),
    division: z.string().optional().describe('Geographic division'),
    minTotalCust: z.number().optional().describe('Minimum total customer count served'),
    minDgKw: z.number().optional().describe('Minimum total DG kW'),
    limit: z.number().optional().describe('Max records to return (default: 20)')
  },
  async (args) => {
    try {
      const result = await searchFeedersTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 7: Get ICA Hosting Capacity
server.tool(
  'arcgis_get_ica_capacity',
  'Query Integration Capacity Analysis (ICA) hosting capacity for line sections (Layer 3) to evaluate generation capacity kW, load capacity kW, PV capacity kW, and Screen L pass status. Also checks Layer 4 if unavailable.',
  {
    feederId: z.string().optional().describe('Feeder ID to inspect (e.g. "022390402")'),
    lineSection: z.string().optional().describe('Specific CSV Line Section ID'),
    minGenCapacityKw: z.number().optional().describe('Filter by minimum generation capacity in kW'),
    minLoadCapacityKw: z.number().optional().describe('Filter by minimum load capacity in kW'),
    screenL: z.string().optional().describe('Screen L status filter (e.g. "Likely to pass")'),
    limit: z.number().optional().describe('Max records to return (default: 20)')
  },
  async (args) => {
    try {
      const result = await getIcaCapacityTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 8: Get Load Profiles
server.tool(
  'arcgis_get_load_profile',
  'Retrieve 8760 hourly / monthly load profiles for Feeders (Table 23) or Substations (Table 25). Computes peak high, minimum low, and average high/low load metrics.',
  {
    targetType: z.enum(['feeder', 'substation']).describe('Target entity type: "feeder" or "substation"'),
    targetId: z.union([z.string(), z.number()]).optional().describe('Feeder ID (e.g. 22390402) or Substation ID'),
    substationName: z.string().optional().describe('Substation name (if querying substation load profile)'),
    month: z.union([z.string(), z.number()]).optional().describe('Filter by month number (1 to 12)'),
    hour: z.union([z.string(), z.number()]).optional().describe('Filter by hour of day (0 to 23)'),
    monthHour: z.string().optional().describe('Specific MonthHour code, e.g. "07_14" for July 2 PM'),
    limit: z.number().optional().describe('Max records to return (default: 288 for full 12x24 matrix)')
  },
  async (args) => {
    try {
      const result = await getLoadProfileTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 9: Fire Threat District Info
server.tool(
  'arcgis_get_fire_threat_info',
  'Check whether a geographical coordinate falls within a CPUC High Fire Threat District (Tier 2 Elevated or Tier 3 Extreme) in Layer 18.',
  {
    longitude: z.number().optional().describe('Longitude in WGS84 (e.g. -122.4194)'),
    latitude: z.number().optional().describe('Latitude in WGS84 (e.g. 37.7749)'),
    tier: z.number().optional().describe('CPUC Tier filter (2 for Elevated, 3 for Extreme)'),
    limit: z.number().optional().describe('Max records to return')
  },
  async (args) => {
    try {
      const result = await getFireThreatInfoTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

// Tool 10: Grid Deficiencies and Investments
server.tool(
  'arcgis_get_grid_deficiencies',
  'Retrieve Grid Needs Assessment (GNA) peak facility deficiencies (MW and %) and Locational Net Benefits Analysis (LNBA) planned investments for a substation or circuit.',
  {
    substationName: z.string().optional().describe('Substation name or ID to check'),
    circuitName: z.string().optional().describe('Circuit name to check'),
    facilityName: z.string().optional().describe('GNA facility name'),
    limit: z.number().optional().describe('Max records to return (default: 20)')
  },
  async (args) => {
    try {
      const result = await getGridDeficienciesTool(args);
      return formatResponse(result);
    } catch (err) {
      return formatError(err);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Do not console.log to stdout as stdout is reserved for JSON-RPC MCP messages
  process.stderr.write('ArcGIS DRP / GRIP MCP Server running on stdio\n');
}

main().catch(err => {
  process.stderr.write(`Fatal server error: ${err.stack || err}\n`);
  process.exit(1);
});
